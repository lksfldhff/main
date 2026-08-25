"""Misst einen Text in Zahlen -- die gemeinsame Sprache von Analyse und Bewertung.

Jedes Merkmal ist eine einzelne Zahl, die sich fuer einen ganzen Korpus
genauso berechnen laesst wie fuer einen einzelnen Satz. Genau das macht den
Kreis geschlossen:

    Korpus  --merkmale-->  Sollwerte (Mittelwert und Streuung je Merkmal)
    Entwurf --merkmale-->  Istwerte  --Vergleich-->  Abweichungen

Die Abweichungen sind es, die spaeter dem Sprachmodell zurueckgemeldet werden
("zu wenig Emojis, zu lange Saetze") und die den Offline-Generator steuern.

Die Merkmale sind *laengennormiert* (je 100 Woerter, je Satz, Anteile), damit
ein Zweizeiler mit einem langen Post vergleichbar bleibt.
"""

from __future__ import annotations

import re
import statistics
from typing import Callable

from . import text as t

# Endungen, an denen sich Substantivierungen erkennen lassen.
NOMINALENDUNG = re.compile(
    r"(?:ung|ungen|heit|heiten|keit|keiten|schaft|schaften|tion|tionen|"
    r"ismus|taet|tät|nis|nisse|tum|erei|barkeit|lichkeit)$",
    re.IGNORECASE,
)
# Zeilenanfaenge, die eine Aufzaehlung markieren.
AUFZAEHLUNG = re.compile(r"^\s*(?:[-*•▪▫‣·]|\d+[.)]|" + t.EMOJI.pattern + r")\s*\S")
ZITAT = re.compile(r"[„“”\"»«].{4,}?[„“”\"»«]", re.DOTALL)
ICH_WIR = re.compile(r"\b(?:ich|mir|mich|mein\w*|wir|uns|unser\w*)\b", re.IGNORECASE)

# Reihenfolge und Namen der Merkmale. Nur diese Liste bestimmt, was gemessen
# und was verglichen wird -- an einer Stelle erweitern genuegt.
NAMEN: tuple[str, ...] = (
    "emoji_je_100_woerter",
    "anteil_saetze_mit_emoji",
    "emoji_lauflaenge",
    "emoji_wiederholung",
    "versal_wortanteil",
    "dehnung_je_1000",
    "ausrufe_je_satz",
    "doppelausruf_anteil",
    "fragen_anteil",
    "ellipsen_je_100_woerter",
    "woerter_je_satz",
    "woerter_je_zeile",
    "wortlaenge",
    "nominal_anteil",
    "anglizismus_je_100",
    "hashtags_je_100_woerter",
    "aufzaehlungszeilen_anteil",
    "zitat_je_100_woerter",
    "ich_wir_je_100_woerter",
)

# Wie stark ein Merkmal in die Gesamtbewertung eingeht. Emojis, Versalien und
# Satzlaenge tragen den Stil am deutlichsten und wiegen darum schwerer.
GEWICHTE: dict[str, float] = {
    "emoji_je_100_woerter": 2.0,
    "anteil_saetze_mit_emoji": 1.5,
    "emoji_lauflaenge": 1.5,
    "emoji_wiederholung": 0.7,
    "versal_wortanteil": 1.5,
    "dehnung_je_1000": 0.6,
    "ausrufe_je_satz": 1.0,
    "doppelausruf_anteil": 0.5,
    "fragen_anteil": 0.4,
    "ellipsen_je_100_woerter": 0.6,
    "woerter_je_satz": 1.2,
    "woerter_je_zeile": 0.8,
    "wortlaenge": 0.8,
    "nominal_anteil": 0.8,
    "anglizismus_je_100": 0.7,
    "hashtags_je_100_woerter": 0.8,
    "aufzaehlungszeilen_anteil": 0.6,
    "zitat_je_100_woerter": 0.4,
    "ich_wir_je_100_woerter": 1.0,
}

# Klartext fuer Rueckmeldungen an das Sprachmodell und an die Oberflaeche.
BESCHRIFTUNG: dict[str, tuple[str, str]] = {
    "emoji_je_100_woerter": ("Emoji-Dichte", "Emojis je 100 Woerter"),
    "anteil_saetze_mit_emoji": ("Emojis je Satz", "Anteil der Saetze mit Emoji"),
    "emoji_lauflaenge": ("Emoji-Ketten", "Emojis je zusammenhaengendem Lauf"),
    "emoji_wiederholung": ("Emoji-Wiederholung", "Anteil der Laeufe aus demselben Emoji"),
    "versal_wortanteil": ("GROSSSCHREIBUNG", "Anteil komplett grossgeschriebener Woerter"),
    "dehnung_je_1000": ("Wortdehnung", "gedehnte Woerter (SOOO) je 1000 Woerter"),
    "ausrufe_je_satz": ("Ausrufezeichen", "Ausrufezeichen je Satz"),
    "doppelausruf_anteil": ("Doppelausruf", "Anteil ‼️ an allen Ausrufezeichen"),
    "fragen_anteil": ("Fragen", "Anteil der Fragesaetze"),
    "ellipsen_je_100_woerter": ("Gedankenpunkte", "… je 100 Woerter"),
    "woerter_je_satz": ("Satzlaenge", "Woerter je Satz"),
    "woerter_je_zeile": ("Zeilenlaenge", "Woerter je Zeile"),
    "wortlaenge": ("Wortlaenge", "Buchstaben je Wort"),
    "nominal_anteil": ("Substantivierungen", "Anteil Woerter auf -ung, -heit, -keit ..."),
    "anglizismus_je_100": ("Anglizismen", "englische Woerter je 100 Woerter"),
    "hashtags_je_100_woerter": ("Hashtags", "Hashtags je 100 Woerter"),
    "aufzaehlungszeilen_anteil": ("Aufzaehlungen", "Anteil Zeilen mit Aufzaehlungszeichen"),
    "zitat_je_100_woerter": ("Zitate", "Zitatzeichen je 100 Woerter"),
    "ich_wir_je_100_woerter": ("Ich und Wir", "Selbstbezuege je 100 Woerter"),
}


def messen(roh: str, englisch: frozenset[str] | set[str] | None = None) -> dict[str, float]:
    """Berechnet alle Merkmale eines Textes.

    *englisch* ist die Wortliste zur Anglizismus-Erkennung; ohne sie bleibt
    dieses eine Merkmal auf 0.
    """

    inhalt = t.normalisieren(roh)
    woerter = t.woerter(inhalt)
    saetze = t.saetze(inhalt)
    zeilen = t.zeilen(inhalt)
    laeufe = t.emoji_laeufe(inhalt)
    alle_emojis = [e for lauf in laeufe for e in lauf]

    anzahl_woerter = len(woerter)
    anzahl_saetze = len(saetze)
    teilen = t.sicher_teilen

    saetze_mit_emoji = sum(1 for s in saetze if t.EMOJI.search(s))
    wiederholungen = sum(1 for lauf in laeufe if len(lauf) > 1 and len(set(lauf)) == 1)
    mehrfachlaeufe = sum(1 for lauf in laeufe if len(lauf) > 1)

    ohne = t.ohne_emojis(inhalt)
    einfach = ohne.count("!")
    doppelt = inhalt.count("‼")
    fragen = sum(1 for s in saetze if t.ohne_emojis(s).strip().endswith("?"))
    versal = sum(1 for w in woerter if t.ist_versalwort(w))
    gedehnt = sum(1 for w in woerter if t.ist_gedehnt(w))
    nominal = sum(1 for w in woerter if len(w) > 5 and NOMINALENDUNG.search(w))

    anglizismen = 0
    if englisch:
        anglizismen = sum(1 for w in woerter if w.lower() in englisch)

    aufzaehlung = sum(1 for z in zeilen if AUFZAEHLUNG.match(z))

    return {
        "emoji_je_100_woerter": 100 * teilen(len(alle_emojis), anzahl_woerter),
        "anteil_saetze_mit_emoji": teilen(saetze_mit_emoji, anzahl_saetze),
        "emoji_lauflaenge": teilen(len(alle_emojis), len(laeufe)),
        "emoji_wiederholung": teilen(wiederholungen, mehrfachlaeufe),
        "versal_wortanteil": teilen(versal, anzahl_woerter),
        "dehnung_je_1000": 1000 * teilen(gedehnt, anzahl_woerter),
        "ausrufe_je_satz": teilen(einfach + doppelt, anzahl_saetze),
        "doppelausruf_anteil": teilen(doppelt, einfach + doppelt),
        "fragen_anteil": teilen(fragen, anzahl_saetze),
        "ellipsen_je_100_woerter": 100 * teilen(inhalt.count("…") + len(re.findall(r"\.\.\.", inhalt)), anzahl_woerter),
        "woerter_je_satz": teilen(anzahl_woerter, anzahl_saetze),
        "woerter_je_zeile": teilen(anzahl_woerter, len(zeilen)),
        "wortlaenge": teilen(sum(len(w) for w in woerter), anzahl_woerter),
        "nominal_anteil": teilen(nominal, anzahl_woerter),
        "anglizismus_je_100": 100 * teilen(anglizismen, anzahl_woerter),
        "hashtags_je_100_woerter": 100 * teilen(len(t.hashtags(inhalt)), anzahl_woerter),
        "aufzaehlungszeilen_anteil": teilen(aufzaehlung, len(zeilen)),
        "zitat_je_100_woerter": 100 * teilen(len(ZITAT.findall(inhalt)), anzahl_woerter),
        "ich_wir_je_100_woerter": 100 * teilen(len(ICH_WIR.findall(ohne)), anzahl_woerter),
    }


def umfang(roh: str) -> dict[str, int]:
    """Rohe Groessen eines Textes -- keine Stilmerkmale, nur Umfang."""

    inhalt = t.normalisieren(roh)
    return {
        "zeichen": t.zeichen_ohne_leer(inhalt),
        "woerter": len(t.woerter(inhalt)),
        "saetze": len(t.saetze(inhalt)),
        "zeilen": len(t.zeilen(inhalt)),
        "absaetze": len(t.absaetze(inhalt)),
    }


def verteilung(werte: list[float]) -> dict[str, float]:
    """Mittelwert, Streuung und Quantile einer Messreihe."""

    if not werte:
        return {"mittel": 0.0, "streuung": 0.0, "median": 0.0, "p10": 0.0, "p90": 0.0}
    geordnet = sorted(werte)

    def quantil(q: float) -> float:
        if len(geordnet) == 1:
            return geordnet[0]
        pos = q * (len(geordnet) - 1)
        unten = int(pos)
        oben = min(unten + 1, len(geordnet) - 1)
        return geordnet[unten] + (pos - unten) * (geordnet[oben] - geordnet[unten])

    return {
        "mittel": statistics.fmean(werte),
        "streuung": statistics.pstdev(werte) if len(werte) > 1 else 0.0,
        "median": statistics.median(werte),
        "p10": quantil(0.10),
        "p90": quantil(0.90),
    }


def messreihe(
    texte: list[str], englisch: frozenset[str] | set[str] | None = None
) -> dict[str, dict[str, float]]:
    """Merkmale vieler Texte, je Merkmal zu einer Verteilung zusammengefasst."""

    einzeln = [messen(text, englisch) for text in texte]
    return {name: verteilung([m[name] for m in einzeln]) for name in NAMEN}


def lexikontreffer(roh: str, woerter_liste: list[str], wendungen_liste: list[str]) -> float:
    """Wie dicht liegen typische Woerter und Wendungen im Text (je 100 Woerter)?

    Diese Zahl misst den Wortschatz statt der Form. Sie ergaenzt die uebrigen
    Merkmale: ein Text kann die richtige Emoji-Dichte haben und trotzdem nach
    jemand anderem klingen, weil ihm die typischen Formulierungen fehlen.
    """

    inhalt = t.normalisieren(roh).lower()
    marken = [w.lower() for w in t.woerter(inhalt)]
    if not marken:
        return 0.0
    menge = set(marken)
    treffer = sum(1 for wort in woerter_liste if wort.lower() in menge)
    treffer += 2 * sum(1 for wendung in wendungen_liste if wendung.lower() in inhalt)
    return 100 * treffer / len(marken)


def gewicht(name: str) -> float:
    return GEWICHTE.get(name, 1.0)


def beschriftung(name: str) -> tuple[str, str]:
    return BESCHRIFTUNG.get(name, (name, name))


def je_merkmal(funktion: Callable[[str], float]) -> dict[str, float]:
    return {name: funktion(name) for name in NAMEN}
