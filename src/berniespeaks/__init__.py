"""berniespeaks -- Schreibstil messen, erkennen und uebersetzen.

    from berniespeaks import Stilprofil, Uebersetzer, bewerte

    profil = Stilprofil.laden()
    print(bewerte("Ein Text", profil).punkte)
    print(Uebersetzer(profil).zu_bernie("Ich schaffe es nicht bis Freitag.").text)
"""

from .analyse import Stilprofil, analysiere, lade_hintergrund
from .korpus import Korpus, Post, lade
from .score import Bewertung, bewerte, kalibrierung
from .uebersetzer import Ergebnis, Uebersetzer

__all__ = [
    "Stilprofil",
    "analysiere",
    "lade_hintergrund",
    "Korpus",
    "Post",
    "lade",
    "Bewertung",
    "bewerte",
    "kalibrierung",
    "Ergebnis",
    "Uebersetzer",
]
__version__ = "1.0.0"
