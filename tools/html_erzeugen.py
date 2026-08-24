"""Baut die eigenstaendige HTML-Fassung des Stil-Uebersetzers.

Ergebnis ist eine einzelne Datei ohne Server, ohne Installation und ohne
Fremddateien: Profil, Messtechnik, Bewertung und Uebersetzer stecken darin.
Sie laesst sich auf jeden Webspace legen.

    python tools/html_erzeugen.py                       Demo-Profil
    python tools/html_erzeugen.py -p korpus/stilprofil.json -o Uebersetzer.html

Der API-Schluessel wird *nicht* eingebaut. Er wird von der Person eingetragen,
die die Seite benutzt, und bleibt in deren Browser.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WURZEL / "src"))

from berniespeaks.analyse import Stilprofil, profil_suchen  # noqa: E402

VORLAGE = WURZEL / "src" / "berniespeaks" / "ui" / "standalone.html"
OBERFLAECHE = WURZEL / "src" / "berniespeaks" / "ui" / "index.html"
VERMITTLER = WURZEL / "src" / "berniespeaks" / "ui" / "api.php"


def stil_holen() -> str:
    """Zieht den <style>-Block aus der Server-Oberflaeche.

    So steht das Aussehen nur an einer Stelle: aendert sich die Gestaltung,
    aendert sich beides zugleich.
    """

    roh = OBERFLAECHE.read_text(encoding="utf-8")
    treffer = re.search(r"<style>(.*?)</style>", roh, re.DOTALL)
    if not treffer:
        raise SystemExit(f"Kein <style>-Block in {OBERFLAECHE}")
    return treffer.group(1)


def bauen(profil: Stilprofil, titel: str = "", unterzeile: str = "") -> str:
    seite = VORLAGE.read_text(encoding="utf-8")
    daten = json.dumps(profil.als_dict(), ensure_ascii=False, separators=(",", ":"))
    seite = seite.replace("{{STIL}}", stil_holen())
    seite = seite.replace("{{TITEL}}", titel or "Bernie Speaks")
    seite = seite.replace("{{UNTERZEILE}}", json.dumps(unterzeile, ensure_ascii=False))
    # Der Profiltext kann Zeichenfolgen enthalten, die den Skriptblock
    # vorzeitig beenden wuerden.
    return seite.replace("{{PROFIL}}", daten.replace("</script", "<\\/script"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Eigenstaendige HTML-Fassung bauen")
    parser.add_argument("-p", "--profil", help="Stilprofil (Standard: gefundenes Profil)")
    parser.add_argument("-o", "--ausgabe", default="Stil-Uebersetzer.html", help="Zieldatei")
    parser.add_argument("-t", "--titel", default="", help="Titel der Seite")
    parser.add_argument("-u", "--unterzeile", default="",
                        help="Zeile unter dem Titel; ohne Angabe bleibt sie weg")
    parser.add_argument("--ohne-vermittler", action="store_true",
                        help="nur die HTML-Datei schreiben, keine api.php daneben")
    args = parser.parse_args()

    profil = Stilprofil.laden(args.profil or profil_suchen())
    ziel = Path(args.ausgabe)
    ziel.write_text(bauen(profil, args.titel, args.unterzeile), encoding="utf-8")
    print(f"{ziel}  ({ziel.stat().st_size / 1024:.0f} kB, Profil: {profil.name}, "
          f"{profil.quelle.get('posts', 0)} Beitraege)")

    if not args.ohne_vermittler:
        nachbar = ziel.parent / "api.php"
        nachbar.write_text(VERMITTLER.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"{nachbar}  (Vermittler -- Schluessel dort eintragen, dann brauchen "
              f"Besucher keinen eigenen)")

    print("Beide Dateien in denselben Ordner auf den Webspace legen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
