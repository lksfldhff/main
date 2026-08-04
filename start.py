"""Startpunkt der Anwendung.

Ohne Argumente oeffnet sich das Fenster, mit Dateipfad laeuft die
Umwandlung direkt auf der Kommandozeile:

    python start.py                       -> Fenster
    python start.py newsletter.docx       -> newsletter.html
    python start.py newsletter.docx --open
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from word2newsletter.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
