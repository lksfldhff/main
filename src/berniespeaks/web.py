"""Oberflaeche im Browser -- der Uebersetzer zum Anfassen.

Ein kleiner Webserver aus der Standardbibliothek, der nur auf dem eigenen
Rechner lauscht. Das Sprachmodell wird auf der Serverseite aufgerufen; der
Schluessel bleibt damit in der Umgebung oder in der bernie.json und kommt nie
in den Browser. Das loest zwei Probleme der reinen HTML-Fassung: kein
Schluessel im Quelltext und keine vom Browser blockierten Anfragen (CORS).
"""

from __future__ import annotations

import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import llm
from .analyse import Stilprofil, profil_suchen
from .cli import _korpus_suchen
from .uebersetzer import Uebersetzer

OBERFLAECHE = Path(__file__).resolve().parent / "ui" / "index.html"
HOECHSTLAENGE = 20000


class Griff(BaseHTTPRequestHandler):
    """Beantwortet die wenigen Anfragen der Oberflaeche."""

    server_version = "berniespeaks"
    uebersetzer: Uebersetzer
    einstellung: llm.Einstellung

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        pass  # keine Zugriffsprotokolle auf der Konsole

    # ------------------------------------------------------------------ GET --

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._senden(200, "text/html; charset=utf-8", OBERFLAECHE.read_bytes())
        elif self.path == "/api/status":
            self._json(200, self._status())
        else:
            self._senden(404, "text/plain; charset=utf-8", b"Nicht gefunden")

    def _status(self) -> dict:
        profil = self.uebersetzer.profil
        return {
            "profil": {
                "name": profil.name,
                "erzeugt": profil.erzeugt,
                "posts": profil.quelle.get("posts", 0),
                "woerter": profil.quelle.get("woerter", 0),
            },
            "anbieter": self.einstellung.anbieter,
            "modell": self.einstellung.modell,
            "beschriftung": self.einstellung.beschriftung if self.einstellung.vorhanden else "",
            "bereit": self.uebersetzer.klient.bereit,
            "anbieterliste": llm.uebersicht(),
        }

    # ----------------------------------------------------------------- POST --

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/uebersetzen":
            self._senden(404, "text/plain; charset=utf-8", b"Nicht gefunden")
            return
        try:
            laenge = int(self.headers.get("content-length", "0"))
            anfrage = json.loads(self.rfile.read(laenge).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"fehler": "Die Anfrage war nicht lesbar."})
            return

        text = str(anfrage.get("text", ""))[:HOECHSTLAENGE]
        richtung = anfrage.get("richtung", "zu_bernie")
        motor = anfrage.get("motor", "auto")
        try:
            staerke = float(anfrage.get("staerke", 1.0))
        except (TypeError, ValueError):
            staerke = 1.0
        staerke = min(2.0, max(0.3, staerke))

        if not text.strip():
            self._json(400, {"fehler": "Kein Text uebergeben."})
            return

        try:
            if richtung == "zu_klartext":
                ergebnis = self.uebersetzer.zu_klartext(text, motor=motor)
            else:
                ergebnis = self.uebersetzer.zu_bernie(text, staerke=staerke, motor=motor)
        except Exception as fehler:  # noqa: BLE001 -- die Oberflaeche soll den Grund sehen
            self._json(500, {"fehler": f"{type(fehler).__name__}: {fehler}"})
            return

        self._json(200, ergebnis.als_dict())

    # ------------------------------------------------------------- Hilfsmittel --

    def _json(self, status: int, nutzlast: dict) -> None:
        self._senden(status, "application/json; charset=utf-8", json.dumps(nutzlast, ensure_ascii=False).encode("utf-8"))

    def _senden(self, status: int, typ: str, koerper: bytes) -> None:
        self.send_response(status)
        self.send_header("content-type", typ)
        self.send_header("content-length", str(len(koerper)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(koerper)


def starten(port: int = 8765, profil_pfad: str | None = None, oeffnen: bool = True) -> int:
    """Startet den lokalen Server und oeffnet den Browser."""

    profil = Stilprofil.laden(profil_pfad or profil_suchen())
    einstellung = llm.erkenne()
    Griff.uebersetzer = Uebersetzer(profil, llm.Klient(einstellung), _korpus_suchen(profil_pfad))
    Griff.einstellung = einstellung

    server = ThreadingHTTPServer(("127.0.0.1", port), Griff)
    adresse = f"http://127.0.0.1:{port}/"
    print(f"Bernie Speaks laeuft auf {adresse}")
    print(f"Profil: {profil.name} ({profil.quelle.get('posts', 0)} Beitraege)")
    print("Sprachmodell:", einstellung.beschriftung if einstellung.vorhanden else "keines -- nur Offline-Betrieb")
    print("Beenden mit Strg+C")

    if oeffnen:
        threading.Timer(0.6, lambda: webbrowser.open(adresse)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")
    finally:
        server.server_close()
    return 0
