"""Liest das Textmaterial ein, aus dem der Schreibstil gelernt wird.

Unterstuetzte Quellen:

  .jsonl   ein Post je Zeile, Feld "text"  -- das Format des Projektkorpus
  .docx    Word-Datei; Posts werden an Trennzeilen (---) oder Leerzeilen geteilt
  .txt/.md Textdatei, gleiche Trennregeln
  .csv     LinkedIn-Datenexport (Shares.csv, Comments.csv) oder eine Spalte Text
  .html    gespeicherte LinkedIn-Seite (Browser: "Seite speichern unter ...")
  Ordner   alles darin, rekursiv

LinkedIn selbst laesst sich nicht abrufen: Profile stehen hinter der Anmeldung,
und automatisches Auslesen ist in den Nutzungsbedingungen untersagt. Der Weg
ueber den offiziellen Datenexport (Einstellungen > Datenschutz > Kopie Ihrer
Daten) liefert dieselben Texte und ist erlaubt.
"""

from __future__ import annotations

import csv
import html
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from .text import normalisieren, zeichen_ohne_leer

LINKEDIN_HINWEIS = (
    "LinkedIn-Profile lassen sich nicht direkt abrufen -- sie stehen hinter der "
    "Anmeldung, und automatisches Auslesen verstoesst gegen die Nutzungsbedingungen.\n"
    "Drei erlaubte Wege zu denselben Texten:\n"
    "  1. Datenexport: LinkedIn > Einstellungen > Datenschutz > Kopie Ihrer Daten "
    "anfordern. Aus dem ZIP die Shares.csv nehmen.\n"
    "  2. Profilseite im Browser oeffnen, Beitraege aufklappen, mit Strg+S als "
    "HTML speichern und diese Datei uebergeben.\n"
    "  3. Beitraege kopieren und in eine .txt oder .docx einfuegen, je Post eine "
    "Leerzeile dazwischen."
)

TRENNZEILE = re.compile(r"^\s*(?:-{3,}|_{3,}|\*{3,}|={3,}|#{3,})\s*$", re.MULTILINE)
MINDESTZEICHEN = 60

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@dataclass
class Post:
    """Ein einzelner Beitrag."""

    text: str
    quelle: str = ""
    nr: int = 0

    @property
    def laenge(self) -> int:
        return zeichen_ohne_leer(self.text)


@dataclass
class Korpus:
    """Alle eingelesenen Beitraege."""

    posts: list[Post] = field(default_factory=list)
    quellen: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.posts)

    def __iter__(self):
        return iter(self.posts)

    @property
    def texte(self) -> list[str]:
        return [p.text for p in self.posts]

    def zusammenfuegen(self, andere: "Korpus") -> "Korpus":
        return Korpus(self.posts + andere.posts, self.quellen + andere.quellen)


# ------------------------------------------------------------ Word-Datei ----


def docx_text(pfad: Path) -> str:
    """Reiner Text einer .docx -- mit Zeilenumbruechen, ohne Formatierung.

    Absatzenden und weiche Umbrueche (Shift+Enter) werden zu \\n. Die
    Zeilenstruktur ist bei LinkedIn-Posts stilrelevant (Aufzaehlungen,
    Namensbloecke, Hashtag-Zeile) und darf nicht verlorengehen.
    """

    with zipfile.ZipFile(pfad) as archiv:
        roh = archiv.read("word/document.xml").decode("utf-8")
    roh = re.sub(r"<w:p\b[^>]*/>", "\n", roh)
    roh = roh.replace("</w:p>", "\n")
    roh = re.sub(r"<w:br\b[^>]*/?>", "\n", roh)
    roh = re.sub(r"<w:tab\b[^>]*/?>", " ", roh)
    roh = re.sub(r"<[^>]+>", "", roh)
    return html.unescape(roh)


# ----------------------------------------------------------------- HTML ----


def html_text(roh: str) -> str:
    roh = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", " ", roh)
    roh = re.sub(r"(?i)<br\s*/?>", "\n", roh)
    roh = re.sub(r"(?i)</(p|div|li|h[1-6]|section|article|tr)>", "\n\n", roh)
    roh = re.sub(r"<[^>]+>", " ", roh)
    return html.unescape(roh)


# ------------------------------------------------------------ Aufteilung ----


def posts_aus_text(text: str) -> list[str]:
    """Teilt Fliesstext in einzelne Beitraege.

    Erst an ausdruecklichen Trennzeilen (---), sonst an Leerzeilen. Bleibt
    dabei nur ein einziger, sehr langer Block uebrig, wird zeilenweise geteilt:
    so sehen aus Zwischenablage kopierte Sammlungen aus.
    """

    text = normalisieren(text)
    if TRENNZEILE.search(text):
        teile = TRENNZEILE.split(text)
    else:
        teile = re.split(r"\n\s*\n", text)
    teile = [t.strip() for t in teile if zeichen_ohne_leer(t) >= MINDESTZEICHEN]
    if len(teile) <= 1 and zeichen_ohne_leer(text) > 4 * MINDESTZEICHEN:
        zeilenweise = [z.strip() for z in text.split("\n") if zeichen_ohne_leer(z) >= MINDESTZEICHEN]
        if len(zeilenweise) > len(teile):
            return zeilenweise
    return teile


def _csv_texte(pfad: Path) -> list[str]:
    """Textspalten aus einer CSV, bevorzugt das LinkedIn-Exportformat."""

    roh = pfad.read_text(encoding="utf-8-sig", errors="replace")
    # LinkedIn stellt der eigentlichen Tabelle manchmal Hinweiszeilen voran.
    zeilen = roh.split("\n")
    for start in range(min(6, len(zeilen))):
        probe = "\n".join(zeilen[start:])
        leser = csv.DictReader(io.StringIO(probe))
        felder = [f for f in (leser.fieldnames or []) if f]
        treffer = [f for f in felder if f.strip() in ("ShareCommentary", "Message", "Text", "Inhalt", "Post")]
        if not treffer:
            continue
        spalte = treffer[0]
        return [(zeile.get(spalte) or "").strip() for zeile in leser]
    return []


def lade_datei(pfad: str | Path) -> Korpus:
    """Liest eine einzelne Quelldatei."""

    pfad = Path(pfad)
    endung = pfad.suffix.lower()

    if endung == ".jsonl":
        posts = []
        for zeile in pfad.read_text(encoding="utf-8").splitlines():
            zeile = zeile.strip()
            if not zeile:
                continue
            eintrag = json.loads(zeile)
            posts.append(Post(normalisieren(eintrag["text"]), eintrag.get("quelle", pfad.name), eintrag.get("nr", 0)))
        return Korpus(posts, [str(pfad)])

    if endung == ".docx":
        rohtexte = posts_aus_text(docx_text(pfad))
    elif endung in (".txt", ".md"):
        rohtexte = posts_aus_text(pfad.read_text(encoding="utf-8", errors="replace"))
    elif endung == ".csv":
        rohtexte = [normalisieren(t) for t in _csv_texte(pfad)]
    elif endung in (".html", ".htm"):
        rohtexte = posts_aus_text(html_text(pfad.read_text(encoding="utf-8", errors="replace")))
    elif endung == ".json":
        daten = json.loads(pfad.read_text(encoding="utf-8"))
        eintraege = daten if isinstance(daten, list) else daten.get("posts", [])
        rohtexte = [normalisieren(e if isinstance(e, str) else e.get("text", "")) for e in eintraege]
    else:
        raise ValueError(f"Unbekanntes Format: {pfad.name}")

    posts = [
        Post(t, pfad.name, i + 1)
        for i, t in enumerate(rohtexte)
        if zeichen_ohne_leer(t) >= MINDESTZEICHEN
    ]
    return Korpus(posts, [str(pfad)])


def lade(*pfade: str | Path, doppelte_entfernen: bool = True) -> Korpus:
    """Liest Dateien und Ordner ein und haengt sie aneinander."""

    korpus = Korpus()
    for eingabe in pfade:
        pfad = Path(eingabe)
        if pfad.is_dir():
            for kind in sorted(pfad.rglob("*")):
                if kind.is_file() and kind.suffix.lower() in (
                    ".jsonl", ".docx", ".txt", ".md", ".csv", ".html", ".htm", ".json"
                ):
                    korpus = korpus.zusammenfuegen(lade_datei(kind))
        else:
            korpus = korpus.zusammenfuegen(lade_datei(pfad))

    if doppelte_entfernen:
        gesehen: set[str] = set()
        einmalig: list[Post] = []
        for post in korpus.posts:
            schluessel = re.sub(r"\s+", "", post.text)[:400]
            if schluessel in gesehen:
                continue
            gesehen.add(schluessel)
            einmalig.append(post)
        korpus.posts = einmalig

    for nummer, post in enumerate(korpus.posts, 1):
        post.nr = nummer
    return korpus


def schreiben(korpus: Korpus, ziel: str | Path) -> Path:
    """Schreibt einen Korpus als .jsonl (ein Post je Zeile)."""

    ziel = Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    with ziel.open("w", encoding="utf-8") as fh:
        for post in korpus.posts:
            fh.write(json.dumps({"nr": post.nr, "quelle": post.quelle, "text": post.text}, ensure_ascii=False) + "\n")
    return ziel
