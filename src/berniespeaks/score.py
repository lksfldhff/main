"""Bewertet, wie nah ein Text an einem gelernten Stilprofil liegt.

Das ist die Gegenrichtung zur Analyse und der eigentliche Nutzen des
Verfahrens: dieselben Merkmale, die aus dem Korpus die Sollwerte ergeben
haben, werden am Pruefling gemessen und verglichen.

Aus dem Vergleich faellt zweierlei ab:

  * eine Zahl von 0 bis 100 -- "wie sehr klingt das nach ihm?"
  * eine Liste konkreter Abweichungen -- "Emoji-Dichte 2.1 statt 13.1"

Die Liste ist wichtiger als die Zahl: sie geht als Nachbesserungsauftrag an
das Sprachmodell zurueck und steuert den Offline-Generator.

Bewertet wird je Merkmal mit einer Glockenkurve um den Sollwert. Die Breite
der Glocke ist die im Korpus beobachtete Streuung -- ein Merkmal, das er
selbst sehr unterschiedlich handhabt, darf auch im Entwurf schwanken; eines,
das er immer gleich macht, nicht.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import merkmale
from .analyse import Stilprofil, lade_hintergrund

# Anteil der Gesamtnote, der auf die Formmerkmale entfaellt; der Rest auf den
# Wortschatz.
FORMANTEIL = 0.75
# Mindestbreite der Glocke, relativ zum Sollwert. Verhindert, dass ein Merkmal
# mit winziger Streuung jede Abweichung sofort mit null Punkten abstraft.
MINDESTBREITE = 0.35
# Absolute Untergrenze fuer Merkmale, deren Sollwert nahe null liegt.
BODEN = 0.02


@dataclass
class Abweichung:
    """Ein Merkmal im Vergleich: gemessen, erwartet, wie weit daneben."""

    merkmal: str
    ist: float
    soll: float
    breite: float
    gewicht: float

    @property
    def z(self) -> float:
        return (self.ist - self.soll) / self.breite if self.breite else 0.0

    @property
    def punkte(self) -> float:
        """Teilnote von 0 bis 1 -- Glockenkurve um den Sollwert."""

        return math.exp(-0.5 * min(self.z * self.z, 60.0))

    @property
    def richtung(self) -> str:
        if abs(self.z) < 0.75:
            return "passt"
        return "zu wenig" if self.z < 0 else "zu viel"

    @property
    def verlust(self) -> float:
        """Wie viele Punkte dieses Merkmal die Gesamtnote kostet."""

        return (1.0 - self.punkte) * self.gewicht

    def satz(self) -> str:
        titel, einheit = merkmale.beschriftung(self.merkmal)
        return f"{titel}: {self.ist:.1f} statt {self.soll:.1f} ({einheit}) -- {self.richtung}"

    def als_dict(self) -> dict:
        return {
            "merkmal": self.merkmal,
            "titel": merkmale.beschriftung(self.merkmal)[0],
            "einheit": merkmale.beschriftung(self.merkmal)[1],
            "ist": round(self.ist, 3),
            "soll": round(self.soll, 3),
            "z": round(self.z, 2),
            "punkte": round(self.punkte, 3),
            "richtung": self.richtung,
        }


@dataclass
class Bewertung:
    """Das Ergebnis eines Vergleichs."""

    punkte: float
    formpunkte: float
    wortschatzpunkte: float
    abweichungen: list[Abweichung] = field(default_factory=list)

    @property
    def urteil(self) -> str:
        if self.punkte >= 80:
            return "klingt nach ihm"
        if self.punkte >= 62:
            return "geht in die Richtung"
        if self.punkte >= 40:
            return "erkennbar angelehnt"
        return "klingt nach jemand anderem"

    def maengel(self, anzahl: int = 5) -> list[Abweichung]:
        """Die Merkmale, die am meisten Punkte kosten."""

        schlecht = [a for a in self.abweichungen if a.richtung != "passt"]
        schlecht.sort(key=lambda a: a.verlust, reverse=True)
        return schlecht[:anzahl]

    def auftrag(self, anzahl: int = 5) -> str:
        """Die Maengel als Nachbesserungsauftrag in Worten."""

        return "\n".join(f"- {a.satz()}" for a in self.maengel(anzahl))

    def als_dict(self) -> dict:
        return {
            "punkte": round(self.punkte, 1),
            "urteil": self.urteil,
            "formpunkte": round(self.formpunkte, 1),
            "wortschatzpunkte": round(self.wortschatzpunkte, 1),
            "merkmale": [a.als_dict() for a in self.abweichungen],
        }


def _breite(soll: float, streuung: float) -> float:
    return max(streuung, abs(soll) * MINDESTBREITE, BODEN)


def bewerte(roh: str, profil: Stilprofil) -> Bewertung:
    """Vergleicht einen Text mit einem Stilprofil."""

    hg = lade_hintergrund()
    gemessen = merkmale.messen(roh, hg.englisch)

    abweichungen: list[Abweichung] = []
    for name in merkmale.NAMEN:
        soll = profil.soll(name)
        abweichungen.append(
            Abweichung(
                merkmal=name,
                ist=gemessen[name],
                soll=soll,
                breite=_breite(soll, profil.streuung(name)),
                gewicht=merkmale.gewicht(name),
            )
        )

    gewichtssumme = sum(a.gewicht for a in abweichungen) or 1.0
    formpunkte = 100 * sum(a.punkte * a.gewicht for a in abweichungen) / gewichtssumme

    treffer_soll = profil.lexikon.get("treffer_je_100", {})
    soll_wert = float(treffer_soll.get("mittel", 0.0))
    ist_wert = merkmale.lexikontreffer(roh, profil.inhaltswoerter, [w["text"] for w in profil.lexikon.get("wendungen", [])])
    if soll_wert <= 0:
        wortschatzpunkte = 100.0
    else:
        # Mehr typische Woerter als ueblich ist kein Fehler -- darum nur nach
        # unten bestraft.
        wortschatzpunkte = 100 * min(1.0, ist_wert / soll_wert) ** 0.7

    gesamt = FORMANTEIL * formpunkte + (1 - FORMANTEIL) * wortschatzpunkte
    return Bewertung(gesamt, formpunkte, wortschatzpunkte, abweichungen)


def kalibrierung(profil: Stilprofil, eigene: list[str], fremde: list[str]) -> dict:
    """Prueft, ob das Profil ueberhaupt trennscharf ist.

    Liefert die Durchschnittsnoten fuer eigenes Material und fuer fremde
    Texte. Liegen sie dicht beieinander, taugt das Profil nichts -- dann ist
    der Korpus zu klein oder zu uneinheitlich.
    """

    eigen_noten = [bewerte(text, profil).punkte for text in eigene]
    fremd_noten = [bewerte(text, profil).punkte for text in fremde]
    eigen = merkmale.verteilung(eigen_noten)
    fremd = merkmale.verteilung(fremd_noten)
    abstand = eigen["mittel"] - fremd["mittel"]
    streuung = math.sqrt((eigen["streuung"] ** 2 + fremd["streuung"] ** 2) / 2) or 1.0
    return {
        "eigen": eigen,
        "fremd": fremd,
        "abstand": abstand,
        "trennschaerfe": abstand / streuung,
        "eigen_noten": [round(n, 1) for n in eigen_noten],
        "fremd_noten": [round(n, 1) for n in fremd_noten],
    }
