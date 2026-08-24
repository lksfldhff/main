"""Textbausteine, auf denen Analyse, Bewertung und Erzeugung aufsetzen.

Alles hier ist reine Messtechnik: Emojis finden, Woerter zaehlen, Saetze
trennen. Bewusst ohne Fremdpakete und ohne Annahmen darueber, *wie* jemand
schreibt -- diese Datei kennt keinen einzigen Bernie-Begriff.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable

# ---------------------------------------------------------------- Emojis ----

# Zeichenbereiche mit Emoji-Darstellung. Bewusst eng gefasst: normale
# Satzzeichen und Pfeile wie "->" sollen nicht als Emoji durchgehen.
_BASISBEREICHE = (
    "\U0001F000-\U0001F0FF"  # Mahjong, Spielkarten
    "\U0001F100-\U0001F1E5"  # eingekreiste Zeichen
    "\U0001F300-\U0001F5FF"  # Symbole und Piktogramme
    "\U0001F600-\U0001F64F"  # Gesichter
    "\U0001F680-\U0001F6FF"  # Verkehr, Objekte
    "\U0001F900-\U0001F9FF"  # ergaenzende Piktogramme
    "\U0001FA00-\U0001FAFF"  # erweiterte Piktogramme
    "☀-➿"          # Wettersymbole bis Dingbats (enthaelt ➡ = Pfeil-Emoji)
    "⬀-⯿"          # Sterne, Kreise
    "⤴⤵"           # gebogene Pfeile
    "↔-↙↩↪"  # Pfeil-Emojis
    "‼⁉"           # !! und !?
    "©®™"     # (c) (R) (TM)
    "ℹⓂ〰〽㊗㊙"
)
_MODIFIKATOR = "[︎️\U0001F3FB-\U0001F3FF]"
_FLAGGE = "[\U0001F1E6-\U0001F1FF]{2}"
_TASTE = "[0-9#*]️?⃣"
_BASIS = f"[{_BASISBEREICHE}]"

# Ein Treffer = ein sichtbares Emoji, auch wenn es aus mehreren Codepoints
# besteht (Hautfarbe, Familien mit Zero-Width-Joiner, Flaggen, Tastenkappen).
EMOJI = re.compile(
    f"(?:{_FLAGGE}|{_TASTE}|{_BASIS}{_MODIFIKATOR}*(?:‍{_BASIS}{_MODIFIKATOR}*)*)"
)
# Ein Lauf: mehrere Emojis direkt hintereinander, wie "🚀🚀🚀".
EMOJI_LAUF = re.compile(f"(?:{EMOJI.pattern})+")

# --------------------------------------------------------------- Woerter ----

# [^\W\d_] ist "Buchstabe" in Unicode -- ohne Ziffern und Unterstrich.
WORT = re.compile(r"[^\W\d_][^\W\d_'’-]*(?:[-'’][^\W\d_][^\W\d_'’-]*)*", re.UNICODE)
HASHTAG = re.compile(r"#[^\W\d_][\wÀ-ɏ]*", re.UNICODE)
# LinkedIn-Exporte schreiben "Hashtag#thema" statt "#thema".
_HASHTAG_PRAEFIX = re.compile(r"\bHashtag(?=#)")

# Abkuerzungen, deren Punkt keine Satzgrenze ist.
ABKUERZUNGEN = (
    "Prof.", "Dr.", "Dipl.", "Ing.", "e.V.", "e. V.", "z.B.", "z. B.", "u.a.", "u. a.",
    "ggf.", "bzw.", "inkl.", "exkl.", "ca.", "Nr.", "Mio.", "Mrd.", "Str.", "Abs.",
    "evtl.", "usw.", "etc.", "Hr.", "Fr.", "St.", "Co.", "sog.", "vgl.", "s.o.", "u.U.",
    "i.d.R.", "d.h.", "z.T.", "Tel.", "Fax.", "Nr..",
)
_PUNKT_ERSATZ = ""

PRIVATZEICHEN = re.compile("[\ufeff\u200b-\u200c\ue000-\uf8ff]")
SATZENDE = re.compile(r"(?<=[.!?…‼⁉])[\s]+")
# Ordnungszahlen ("12. September", "36. Karrieretag") enden nicht den Satz.
ORDNUNGSZAHL = re.compile(r"\b(\d{1,2})\.(?=\s+[A-ZÄÖÜ0-9])")


def normalisieren(text: str) -> str:
    """Vereinheitlicht Zeichen, ohne stilrelevante Merkmale zu zerstoeren.

    Geschuetzte Leerzeichen und Zeilenendungen werden geglaettet, der
    LinkedIn-Export-Praefix "Hashtag#" wird zu "#". Emojis, Grossschreibung,
    Anfuehrungszeichen und Ausrufezeichen bleiben unangetastet -- sie sind
    genau das, was gemessen werden soll.
    """

    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace(" ", " ").replace(" ", " ").replace(" ", " ")
    # Byte-Order-Mark, Null-Breite-Zeichen und Symbole aus dem privaten
    # Unicode-Bereich (Aufzaehlungszeichen aus Outlook) tragen keine Bedeutung.
    text = PRIVATZEICHEN.sub("", text)
    text = _HASHTAG_PRAEFIX.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def emojis(text: str) -> list[str]:
    """Alle Emojis in Reihenfolge des Auftretens."""

    return EMOJI.findall(text)


def emoji_laeufe(text: str) -> list[list[str]]:
    """Emojis gruppiert nach zusammenhaengenden Laeufen."""

    return [EMOJI.findall(m.group(0)) for m in EMOJI_LAUF.finditer(text)]


def ohne_emojis(text: str) -> str:
    return EMOJI_LAUF.sub(" ", text)


def woerter(text: str) -> list[str]:
    """Wortformen ohne Emojis, Hashtags und Zahlen."""

    return WORT.findall(HASHTAG.sub(" ", ohne_emojis(text)))


def hashtags(text: str) -> list[str]:
    return [h.lower() for h in HASHTAG.findall(text)]


def zeilen(text: str) -> list[str]:
    """Nicht-leere Zeilen -- die Zeile ist in LinkedIn-Posts eine Stileinheit."""

    return [z.strip() for z in text.split("\n") if z.strip()]


def absaetze(text: str) -> list[str]:
    """Bloecke, die durch Leerzeilen getrennt sind."""

    return [a.strip() for a in re.split(r"\n\s*\n", text) if a.strip()]


def saetze(text: str, zeilen_trennen: bool = True) -> list[str]:
    """Zerlegt Text in Saetze.

    Zeilenumbrueche gelten als Satzgrenze: in diesem Material endet ein
    Gedanke oft mit einem Emoji statt mit einem Punkt, und die naechste Zeile
    faengt neu an. Abkuerzungspunkte werden vorher maskiert, damit
    "Prof. Dr. Meier" ein Satz bleibt.
    """

    rohteile = text.split("\n") if zeilen_trennen else [text]
    ergebnis: list[str] = []
    for teil in rohteile:
        maskiert = ORDNUNGSZAHL.sub(r"\1" + _PUNKT_ERSATZ, teil)
        for abk in ABKUERZUNGEN:
            maskiert = maskiert.replace(abk, abk.replace(".", _PUNKT_ERSATZ))
        for satz in SATZENDE.split(maskiert):
            satz = satz.replace(_PUNKT_ERSATZ, ".").strip()
            if satz:
                ergebnis.append(satz)
    return ergebnis


def ist_versalwort(wort: str) -> bool:
    """GROSSGESCHRIEBENES Wort mit mindestens zwei Buchstaben."""

    return len(wort) >= 2 and wort.isupper() and any(c.isalpha() for c in wort)


DEHNUNG = re.compile(r"([^\W\d_])\1{2,}", re.UNICODE)


def ist_gedehnt(wort: str) -> bool:
    """soooo, jaaa, mega-langgezogene Woerter."""

    return bool(DEHNUNG.search(wort))


def satzform(satz: str) -> str:
    """Grobe Form eines Satzes: aussage, frage, ausruf, aufzaehlung, block."""

    kern = ohne_emojis(satz).strip()
    if re.match(r"^\s*(?:[-*•▪▫➡⬅\U0001F947-\U0001F949\U0001F4A3])", satz.strip()):
        return "aufzaehlung"
    if EMOJI.match(satz.strip()) and len(kern) > 0:
        return "aufzaehlung"
    if kern.endswith("?"):
        return "frage"
    if kern.endswith("!") or "‼" in satz:
        return "ausruf"
    return "aussage"


def zeichen_ohne_leer(text: str) -> int:
    return len(re.sub(r"\s", "", text))


def gross_anteil(text: str) -> float:
    """Anteil der Grossbuchstaben an allen Buchstaben."""

    buchstaben = [c for c in text if c.isalpha()]
    if not buchstaben:
        return 0.0
    return sum(1 for c in buchstaben if c.isupper()) / len(buchstaben)


def sicher_teilen(zaehler: float, nenner: float) -> float:
    return zaehler / nenner if nenner else 0.0


def gleitfenster(folge: Iterable[str], n: int) -> Iterable[tuple[str, ...]]:
    """Alle n-Gramme einer Folge."""

    fenster: list[str] = []
    for element in folge:
        fenster.append(element)
        if len(fenster) > n:
            fenster.pop(0)
        if len(fenster) == n:
            yield tuple(fenster)
