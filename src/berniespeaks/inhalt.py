"""Erkennt, *was* in einem Text steht -- unabhaengig davon, *wie* er klingt.

Die Stilanalyse misst die Form. Fuer eine Uebersetzung braucht es die zweite
Haelfte: welche Aussage, welche Zahlen, welche Namen, welches Anliegen. Diese
Angaben werden

  * dem Sprachmodell als Pflichtinhalt mitgegeben ("diese Fakten muessen
    erhalten bleiben"),
  * vom Offline-Generator als Geruest benutzt,
  * in der Gegenrichtung zur nuechternen Zusammenfassung verdichtet.

Gearbeitet wird ohne Sprachmodell: Satzgewichtung nach Begriffsseltenheit
(je seltener ein Wort im normalen Deutsch, desto mehr traegt es zur Aussage
bei), dazu Mustererkennung fuer Datum, Uhrzeit, Zahl und Anliegen.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import text as t
from .analyse import Hintergrund, lade_hintergrund

DATUM = re.compile(
    r"\b(?:\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{2,4})?|\d{1,2}\.\s?(?:Januar|Februar|März|Maerz|April|Mai|Juni|Juli|"
    r"August|September|Oktober|November|Dezember)(?:\s+\d{4})?|(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|"
    r"Samstag|Sonntag)(?:\s+\d{1,2}\.\s?\w+)?|KW\s?\d{1,2}|morgen|übermorgen|heute|nächste\s+Woche)\b",
    re.IGNORECASE,
)
UHRZEIT = re.compile(r"\b\d{1,2}[:.]\d{2}\s?(?:Uhr)?\b|\b\d{1,2}\s?Uhr\b")
ZAHL = re.compile(r"\b\d+(?:[.,]\d+)?\s?(?:%|Prozent|Euro|EUR|€|Mio\.?|Mrd\.?|Teilnehmer|Personen|Leute)?\b")

ANLIEGEN = (
    ("absage", re.compile(r"\b(?:absag\w*|sage\s+ab|abgesagt|fällt\s+aus|schaffe\s+(?:es\s+)?nicht|"
                          r"kann\s+(?:leider\s+)?nicht|klappt\s+nicht|geht\s+nicht|müssen\s+verschieben|"
                          r"verschieb\w*)\b", re.IGNORECASE)),
    ("zusage", re.compile(r"\b(?:sage\s+zu|zusag\w*|bin\s+dabei|passt\s+(?:mir\s+)?|gerne|einverstanden|"
                          r"machen\s+wir|bestätige)\b", re.IGNORECASE)),
    ("bitte", re.compile(r"\b(?:bitte|könnt\w*\s+(?:ihr|sie|du)|kannst\s+du|würde(?:st|n)?\s+(?:du|ihr|sie)|"
                         r"brauche|benötige|schick\w*\s+mir|meld\w*\s+dich)\b", re.IGNORECASE)),
    ("einladung", re.compile(r"\b(?:lade\s+\w+\s+ein|einladung|einladen|seid\s+dabei|kommt\s+vorbei|"
                             r"anmeld\w*|veranstaltung|termin\s+steht|findet\s+statt)\b", re.IGNORECASE)),
    ("dank", re.compile(r"\b(?:danke|dank\w*|vielen\s+Dank|herzlichen\s+Dank)\b", re.IGNORECASE)),
    ("frage", re.compile(r"\?")),
)

POSITIV = re.compile(
    r"\b(?:gut|super|toll|schön|freu\w*|gelungen|erfolg\w*|stolz|gern\w*|danke|klasse|prima|"
    r"stark|beeindruck\w*|spannend|gewonnen|geschafft)\b",
    re.IGNORECASE,
)
NEGATIV = re.compile(
    r"\b(?:schlecht|problem\w*|fehler|ärger\w*|leider|schade|schwierig|kritisch|verzöger\w*|"
    r"abgesagt|ausgefallen|beschwer\w*|sorge|risiko|nicht\s+geschafft)\b",
    re.IGNORECASE,
)


@dataclass
class Inhalt:
    """Was der Text sagt."""

    kernsaetze: list[str] = field(default_factory=list)
    begriffe: list[str] = field(default_factory=list)
    daten: list[str] = field(default_factory=list)
    zahlen: list[str] = field(default_factory=list)
    namen: list[str] = field(default_factory=list)
    anliegen: str = "information"
    stimmung: str = "neutral"

    def pflichtangaben(self) -> list[str]:
        """Alles, was in der Uebersetzung erhalten bleiben muss."""

        return self.daten + self.zahlen + self.namen

    def als_dict(self) -> dict:
        return {
            "kernsaetze": self.kernsaetze,
            "begriffe": self.begriffe,
            "daten": self.daten,
            "zahlen": self.zahlen,
            "namen": self.namen,
            "anliegen": self.anliegen,
            "stimmung": self.stimmung,
        }

    def beschreibung(self) -> str:
        """Der Inhalt in Worten -- geht so in die Anweisung an das Modell."""

        zeilen = [f"Anliegen: {self.anliegen}", f"Grundton: {self.stimmung}"]
        if self.kernsaetze:
            zeilen.append("Kernaussagen:")
            zeilen += [f"  - {satz}" for satz in self.kernsaetze]
        pflicht = self.pflichtangaben()
        if pflicht:
            zeilen.append("Diese Angaben muessen woertlich erhalten bleiben: " + ", ".join(pflicht))
        return "\n".join(zeilen)


def _wortgewichte(woerter: list[str], hintergrund: Hintergrund) -> dict[str, float]:
    """Je seltener ein Wort im normalen Deutsch, desto mehr Gewicht."""

    gewichte: dict[str, float] = {}
    for wort in woerter:
        klein = wort.lower()
        if len(klein) < 4:
            continue
        zipf = hintergrund.zipf.get(klein, 2.0)
        if zipf > 5.6:  # Allerweltswoerter tragen nichts bei
            continue
        gewichte[klein] = gewichte.get(klein, 0.0) + max(0.5, 7.0 - zipf)
    return gewichte


def erkenne(roh: str, hintergrund: Hintergrund | None = None, kernsaetze: int = 3) -> Inhalt:
    """Zerlegt einen Text in seine Aussage."""

    hg = hintergrund or lade_hintergrund()
    inhalt = t.normalisieren(roh)
    ohne = t.ohne_emojis(inhalt)
    saetze = [s for s in t.saetze(inhalt) if len(t.woerter(s)) >= 3]

    gewichte = _wortgewichte(t.woerter(ohne), hg)

    bewertet: list[tuple[float, int, str]] = []
    for nummer, satz in enumerate(saetze):
        marken = [w.lower() for w in t.woerter(satz)]
        if not marken:
            continue
        punkte = sum(gewichte.get(w, 0.0) for w in set(marken)) / (len(marken) ** 0.5)
        # Der erste Satz traegt in kurzen Nachrichten meist die Aussage.
        if nummer == 0:
            punkte *= 1.25
        if DATUM.search(satz) or UHRZEIT.search(satz):
            punkte *= 1.2
        bewertet.append((punkte, nummer, satz))

    bewertet.sort(reverse=True)
    ausgewaehlt = sorted(bewertet[:kernsaetze], key=lambda e: e[1])

    begriffe = sorted(gewichte, key=lambda w: gewichte[w], reverse=True)[:12]

    namen: list[str] = []
    for treffer in re.finditer(r"\b[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][\wäöüß.-]+)+", ohne):
        name = treffer.group(0).strip()
        if name not in namen and len(name.split()) <= 4:
            namen.append(name)

    anliegen = "information"
    for bezeichnung, muster in ANLIEGEN:
        if muster.search(ohne):
            anliegen = bezeichnung
            break

    gut, schlecht = len(POSITIV.findall(ohne)), len(NEGATIV.findall(ohne))
    stimmung = "positiv" if gut > schlecht else "negativ" if schlecht > gut else "neutral"

    daten = _einmalig(DATUM.findall(ohne) + UHRZEIT.findall(ohne))
    # Zahlen, die schon in einer Datums- oder Uhrzeitangabe stecken, nicht
    # doppelt auffuehren; nackte ein- bis zweistellige Zahlen sagen nichts.
    zahlen = [
        z.strip() for z in ZAHL.findall(ohne)
        if any(c.isdigit() for c in z)
        and not any(z.strip() in angabe for angabe in daten)
        and (len(re.sub(r"\D", "", z)) > 2 or re.search(r"[^\d\s.,]", z))
    ]

    return Inhalt(
        kernsaetze=[satz for _, _, satz in ausgewaehlt],
        begriffe=begriffe,
        daten=daten,
        zahlen=_einmalig(zahlen),
        namen=namen[:8],
        anliegen=anliegen,
        stimmung=stimmung,
    )


def _einmalig(werte: list[str], grenze: int = 8) -> list[str]:
    ergebnis: list[str] = []
    for wert in werte:
        wert = wert.strip()
        if wert and wert not in ergebnis:
            ergebnis.append(wert)
    return ergebnis[:grenze]
