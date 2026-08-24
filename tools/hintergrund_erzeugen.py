"""Erzeugt die Hintergrund-Haeufigkeiten fuer die Stilanalyse.

Die Stilanalyse misst, welche Woerter im Bernie-Korpus *auffaellig oft*
vorkommen. Dafuer braucht sie einen Vergleichsmassstab: wie haeufig ist ein
Wort im normalen Deutsch? Diese Referenz kommt aus dem Paket `wordfreq`
(zusammengesetzt aus Wikipedia, Untertiteln, Nachrichten, Buechern, Twitter).

Das Paket wird nur *hier* gebraucht, einmalig beim Bauen. Zur Laufzeit liest
berniespeaks nur die erzeugte Datei -- das Programm bleibt ohne Fremdpakete.

    pip install wordfreq
    python tools/hintergrund_erzeugen.py

Ergebnis: src/berniespeaks/daten/hintergrund_de.json.gz
"""

from __future__ import annotations

import gzip
import json
import sys
from datetime import date
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "src" / "berniespeaks" / "daten" / "hintergrund_de.json.gz"

# So viele deutsche Wortformen werden als Referenz gespeichert. 40.000 deckt
# den normalen Sprachgebrauch ab; alles darunter gilt als "seltenes Wort".
ANZAHL_DE = 40000
# Englische Wortformen zur Anglizismus-Erkennung.
ANZAHL_EN = 20000
# Englische Woerter, die im Deutschen mindestens so gelaeufig sind, zaehlen
# nicht als Anglizismus ("Team", "Job", "Internet" sind laengst Deutsch).
EINGEDEUTSCHT_AB_ZIPF = 4.0


def main() -> int:
    try:
        from wordfreq import get_frequency_dict, top_n_list, zipf_frequency
    except ImportError:
        print("Bitte zuerst installieren:  pip install wordfreq", file=sys.stderr)
        return 1

    import math

    de = get_frequency_dict("de")
    woerter = [w for w in top_n_list("de", ANZAHL_DE) if w.isalpha()]
    zipf = {w: round(math.log10(de[w] * 1e9), 3) for w in woerter}

    englisch = []
    for w in top_n_list("en", ANZAHL_EN):
        if not w.isalpha() or len(w) < 3:
            continue
        if zipf_frequency(w, "de") >= EINGEDEUTSCHT_AB_ZIPF:
            continue
        englisch.append(w)

    daten = {
        "quelle": "wordfreq (Wikipedia, Untertitel, Nachrichten, Buecher, Social Media)",
        "erzeugt": date.today().isoformat(),
        "sprache": "de",
        "beschreibung": (
            "zipf: Zipf-Haeufigkeit je Wortform (log10 der Vorkommen je Milliarde Woerter). "
            "englisch: englische Wortformen, die im Deutschen selten sind -- Grundlage der "
            "Anglizismus-Erkennung."
        ),
        "zipf": zipf,
        "englisch": englisch,
    }

    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(ZIEL, "wt", encoding="utf-8") as fh:
        json.dump(daten, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{ZIEL}  ({ZIEL.stat().st_size / 1024:.0f} kB, {len(zipf)} deutsche, {len(englisch)} englische Wortformen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
