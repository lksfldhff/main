"""Baut den Projektkorpus korpus/bernie-posts.jsonl.

Das Ausgangsmaterial liegt doppelt vor:

  korpus/bernie-linkedin.docx  -- mit Zeilenstruktur, aber ohne Post-Grenzen
  korpus/bernie-linkedin.txt   -- ein Post je Zeile, aber ohne Zeilenstruktur

Die Zeilenstruktur ist stilrelevant (Aufzaehlungen, Namensbloecke,
Hashtag-Zeile), die Post-Grenzen sind es fuer alle Kennzahlen "je Post".
Dieses Werkzeug fuehrt beides zusammen: es sucht jeden Post aus der .txt im
zeichenweise geglaetteten Text der .docx und schneidet ihn dort mitsamt
Umbruechen heraus.

    python tools/korpus_erzeugen.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WURZEL / "src"))

from berniespeaks import korpus as k  # noqa: E402
from berniespeaks.text import normalisieren, zeichen_ohne_leer  # noqa: E402

DOCX = WURZEL / "korpus" / "bernie-linkedin.docx"
GRENZEN = WURZEL / "korpus" / "bernie-linkedin.txt"
ZIEL = WURZEL / "korpus" / "bernie-posts.jsonl"

# Zeilen, die in keinem Beitrag etwas verloren haben.
RAUSCHEN = re.compile(r"^-?\s*sent\s+mobile\s+with\s+my\s+iPhone", re.IGNORECASE)
# Anreden eroeffnen eine Nachricht ...
ANREDE = re.compile(
    r"^(?:liebe|lieber|liebes|hallo|moin|servus|guten\s+(?:tag|morgen|abend)|"
    r"sehr\s+geehrte|werte|hi)\b",
    re.IGNORECASE,
)
# ... Grussformeln schliessen sie.
GRUSS = re.compile(
    r"^(?:viele|herzliche|beste|freundliche|liebe|sonnige|sportliche|"
    r"mit\s+\w+)\s+gr(?:ue|ü)(?:sse|ße)|^(?:vg|lg|mfg|bis\s+dahin)\b",
    re.IGNORECASE,
)
# Zitierte Fremdnachricht in einer E-Mail-Antwort -- nicht von ihm geschrieben.
ZITATKOPF = re.compile(r"^Am\s+.{0,80}\bschrieb\b.{0,160}:\s*$", re.IGNORECASE)

def glaetten(text: str) -> tuple[str, list[int]]:
    """Text ohne Leerraum, dazu je Zeichen der Index im Ursprungstext."""

    zeichen: list[str] = []
    index: list[int] = []
    for i, c in enumerate(text):
        if not c.isspace():
            zeichen.append(c)
            index.append(i)
    return "".join(zeichen), index


def zusammenfassen(teile: list[str]) -> list[str]:
    """Setzt aus den Bruchstuecken vollstaendige Nachrichten zusammen.

    Das Material enthaelt neben LinkedIn-Posts auch dienstliche E-Mails, deren
    Absaetze einzeln dastehen -- ebenso Anrede, Grussformel und Signatur. Drei
    Regeln stellen die Einheiten wieder her:

      * Eine Anrede wird nur dann als E-Mail-Beginn gewertet, wenn in
        Reichweite auch eine Grussformel folgt. Dann werden Anrede, Rumpf,
        Gruss und die kurzen Signaturzeilen zu einer Nachricht verbunden.
        Ohne Grussformel bleibt es ein Post, der eben mit einer Anrede
        beginnt ("Liebe Community!") -- das ist auf LinkedIn ueblich.
      * Zu kurze Bruchstuecke haengen an ihrem Vorgaenger.
      * Alles hinter einem Zitatkopf ("Am ... schrieb ...:") stammt von
        jemand anderem und fliegt raus -- gelernt werden soll *sein* Stil.
    """

    teile = [t.strip() for t in teile if t.strip() and not RAUSCHEN.match(t.strip())]

    # Zitierte Fremdnachrichten entfernen: ab dem Zitatkopf bis zur naechsten
    # eigenen Anrede oder bis zum Ende.
    gesaeubert: list[str] = []
    zitat = False
    for teil in teile:
        if ZITATKOPF.match(teil):
            zitat = True
            continue
        if zitat:
            if ANREDE.match(teil):
                zitat = False
            else:
                continue
        gesaeubert.append(teil)
    teile = gesaeubert

    fertig: list[str] = []
    i = 0
    anzahl = len(teile)
    while i < anzahl:
        teil = teile[i]

        if ANREDE.match(teil):
            schluss = _gruss_suchen(teile, i)
            if schluss is not None:
                while schluss + 1 < anzahl and zeichen_ohne_leer(teile[schluss + 1]) < k.MINDESTZEICHEN:
                    schluss += 1
                fertig.append("\n".join(teile[i:schluss + 1]).strip())
                i = schluss + 1
                continue

        if zeichen_ohne_leer(teil) >= k.MINDESTZEICHEN:
            fertig.append(teil)
        elif fertig:
            fertig[-1] = fertig[-1] + "\n" + teil
        i += 1

    return [t for t in fertig if zeichen_ohne_leer(t) >= k.MINDESTZEICHEN]


def _gruss_suchen(teile: list[str], start: int, fenster: int = 25) -> int | None:
    """Index der Grussformel, die zu der Anrede an Position *start* gehoert."""

    for j in range(start + 1, min(len(teile), start + 1 + fenster)):
        if ANREDE.match(teile[j]):
            return None
        if GRUSS.match(teile[j]):
            return j
    return None


def main() -> int:
    if not DOCX.exists():
        print(f"fehlt: {DOCX}", file=sys.stderr)
        return 1

    quelle = normalisieren(k.docx_text(DOCX))

    if GRENZEN.exists():
        grenztexte = [z for z in GRENZEN.read_text(encoding="utf-8").split("\n") if z.strip()]
        flach, index = glaetten(quelle)
        posts: list[str] = []
        pos = 0
        verfehlt = 0
        for zeile in grenztexte:
            # Beide Seiten gleich normalisieren, sonst passt z. B. der
            # LinkedIn-Praefix "Hashtag#" nicht mehr auf "#".
            schluessel = re.sub(r"\s+", "", normalisieren(zeile))
            if not schluessel:
                continue
            treffer = flach.find(schluessel, pos)
            if treffer < 0:
                verfehlt += 1
                continue
            start = index[treffer]
            ende = index[treffer + len(schluessel) - 1] + 1
            posts.append(quelle[start:ende].strip())
            pos = treffer + len(schluessel)
        if verfehlt:
            print(f"Hinweis: {verfehlt} Post-Grenzen nicht wiedergefunden", file=sys.stderr)
    else:
        posts = k.posts_aus_text(quelle)

    posts = zusammenfassen(posts)
    ergebnis = k.Korpus([k.Post(p, DOCX.name, i + 1) for i, p in enumerate(posts)], [str(DOCX)])
    k.schreiben(ergebnis, ZIEL)

    zeichen = sum(p.laenge for p in ergebnis.posts)
    print(f"{ZIEL}  ({len(ergebnis)} Posts, {zeichen} Zeichen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
