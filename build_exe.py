"""Baut die Windows-Anwendung (Newsletter-Tool.exe) mit PyInstaller.

Voraussetzung (einmalig, auf einem Windows-Rechner):
    pip install pyinstaller

Aufruf:
    python build_exe.py

Ergebnis:
    dist/Newsletter-Tool.exe   -- laeuft ohne Python-Installation
    dist/config.json           -- hier Farben, Fusszeile und Bild-URLs pflegen

Die .exe muss auf Windows gebaut werden; PyInstaller erzeugt keine
Windows-Programme unter Linux oder macOS.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "Newsletter-Tool"


def main() -> int:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller fehlt. Bitte zuerst ausfuehren:  pip install pyinstaller")
        return 1

    separator = ";" if sys.platform == "win32" else ":"
    command = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--windowed",
        "--name", NAME,
        "--paths", str(ROOT / "src"),
        "--add-data", f"{ROOT / 'templates'}{separator}templates",
        str(ROOT / "start.py"),
    ]
    icon = ROOT / "icon.ico"
    if icon.is_file():
        command[-1:-1] = ["--icon", str(icon)]

    print(" ".join(command))
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode != 0:
        return result.returncode

    # config.json neben die .exe legen -- dort wird sie zuerst gesucht.
    target = ROOT / "dist" / "config.json"
    if not target.exists():
        shutil.copy(ROOT / "config.json", target)

    print()
    print(f"Fertig:  dist/{NAME}.exe")
    print("Die config.json daneben legen und dort Fusszeile/Bild-URLs pflegen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
