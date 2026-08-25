#!/usr/bin/env python3
"""Startpunkt fuer den Stil-Uebersetzer.

    python bernie.py                     Oberflaeche im Browser oeffnen
    python bernie.py "Text ..."          Text in den gelernten Stil bringen
    python bernie.py lernen korpus/      Stilprofil neu lernen
    python bernie.py --hilfe             alle Befehle

Ohne Argumente startet die Oberflaeche. Wird ein Text uebergeben, der kein
bekannter Befehl ist, wird er direkt uebersetzt.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from berniespeaks.cli import main, parser_bauen  # noqa: E402

BEFEHLE = {"lernen", "uebersetzen", "klartext", "pruefen", "profil", "anbieter", "web"}


def start() -> int:
    argumente = sys.argv[1:]
    if not argumente:
        return main(["web"])
    if argumente[0] in ("--hilfe", "-h", "--help"):
        parser_bauen().print_help()
        return 0
    if argumente[0] in BEFEHLE:
        return main(argumente)
    return main(["uebersetzen", *argumente, "--ausfuehrlich"])


if __name__ == "__main__":
    raise SystemExit(start())
