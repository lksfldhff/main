"""Anbindung an Sprachmodelle -- anbieterunabhaengig und ohne Fremdpakete.

Unterstuetzt werden Anthropic (Claude) und jede Schnittstelle im
OpenAI-Format. Damit laufen auch die kostenlosen Wege:

    Ollama       laeuft lokal auf dem eigenen Rechner, kostet nichts
    OpenRouter   hat kostenlose Modelle (Endung ":free")
    Groq         kostenloses Kontingent
    Mistral, DeepSeek, OpenAI, jede andere OpenAI-kompatible Adresse

Eingestellt wird ueber Umgebungsvariablen oder eine bernie.json:

    BERNIE_ANBIETER=ollama            anthropic | openrouter | groq | ollama | ...
    BERNIE_MODELL=llama3.1            leer lassen fuer die Voreinstellung
    BERNIE_SCHLUESSEL=...             oder ANTHROPIC_API_KEY, GROQ_API_KEY, ...
    BERNIE_BASIS=http://...           eigene Adresse (z. B. LM Studio)

Ohne jede Einstellung sucht das Programm selbst: erst ein gesetzter
Schluessel, dann ein laufendes Ollama, sonst bleibt es beim Offline-Betrieb.

Warum kein offizielles SDK? Das Projekt wird als einzelne .exe ohne
Installation weitergegeben und kommt darum durchweg mit der Standardbibliothek
aus. Ausserdem muss derselbe Code drei verschiedene Anbieter bedienen.
"""

from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ZEITSPERRE = 90
VERSUCHE = 2

# Voreinstellungen je Anbieter. "format" entscheidet ueber den Aufbau der
# Anfrage: das Anthropic-Format oder das OpenAI-Format.
ANBIETER: dict[str, dict] = {
    "anthropic": {
        "basis": "https://api.anthropic.com",
        "pfad": "/v1/messages",
        "modell": "claude-opus-5",
        "format": "anthropic",
        "umgebung": ["ANTHROPIC_API_KEY"],
        "beschriftung": "Claude (Anthropic)",
    },
    "openrouter": {
        "basis": "https://openrouter.ai/api/v1",
        "pfad": "/chat/completions",
        "modell": "meta-llama/llama-3.3-70b-instruct:free",
        "format": "openai",
        "umgebung": ["OPENROUTER_API_KEY"],
        "beschriftung": "OpenRouter (kostenlose Modelle verfuegbar)",
    },
    "groq": {
        "basis": "https://api.groq.com/openai/v1",
        "pfad": "/chat/completions",
        "modell": "llama-3.3-70b-versatile",
        "format": "openai",
        "umgebung": ["GROQ_API_KEY"],
        "beschriftung": "Groq (kostenloses Kontingent)",
    },
    "mistral": {
        "basis": "https://api.mistral.ai/v1",
        "pfad": "/chat/completions",
        "modell": "mistral-large-latest",
        "format": "openai",
        "umgebung": ["MISTRAL_API_KEY"],
        "beschriftung": "Mistral",
    },
    "deepseek": {
        "basis": "https://api.deepseek.com/v1",
        "pfad": "/chat/completions",
        "modell": "deepseek-chat",
        "format": "openai",
        "umgebung": ["DEEPSEEK_API_KEY"],
        "beschriftung": "DeepSeek",
    },
    "openai": {
        "basis": "https://api.openai.com/v1",
        "pfad": "/chat/completions",
        "modell": "gpt-4o-mini",
        "format": "openai",
        "umgebung": ["OPENAI_API_KEY"],
        "beschriftung": "OpenAI",
    },
    "ollama": {
        "basis": "http://localhost:11434/v1",
        "pfad": "/chat/completions",
        "modell": "llama3.1",
        "format": "openai",
        "umgebung": [],
        "beschriftung": "Ollama (lokal, kostenlos)",
    },
}

# Reihenfolge der Selbsterkennung.
SUCHREIHENFOLGE = ("anthropic", "groq", "openrouter", "mistral", "deepseek", "openai")

FEHLERTEXTE = {
    400: "Die Anfrage wurde abgelehnt (400). Meist stimmt der Modellname nicht.",
    401: "Der Schluessel wird nicht akzeptiert (401). Er ist falsch, widerrufen oder unvollstaendig kopiert.",
    403: "Zugriff verweigert (403). Der Schluessel hat fuer diese Anfrage keine Berechtigung.",
    404: "Modell oder Adresse nicht gefunden (404).",
    413: "Der Text ist zu lang fuer dieses Modell (413).",
    429: "Zu viele Anfragen (429). Kurz warten und erneut versuchen.",
    500: "Der Anbieter meldet einen internen Fehler (500).",
    529: "Der Dienst ist ueberlastet (529). Bitte erneut versuchen.",
}


class LLMFehler(RuntimeError):
    """Fehler beim Aufruf eines Sprachmodells, mit erklaerender Meldung."""

    def __init__(self, meldung: str, status: int | None = None, kein_schluessel: bool = False):
        super().__init__(meldung)
        self.status = status
        self.kein_schluessel = kein_schluessel


@dataclass
class Einstellung:
    """Welcher Anbieter, welches Modell, welcher Schluessel."""

    anbieter: str = ""
    modell: str = ""
    schluessel: str = ""
    basis: str = ""
    aufwand: str = "medium"
    max_zeichen: int = 8000

    @property
    def vorhanden(self) -> bool:
        return bool(self.anbieter)

    @property
    def format(self) -> str:
        return ANBIETER.get(self.anbieter, {}).get("format", "openai")

    @property
    def beschriftung(self) -> str:
        eintrag = ANBIETER.get(self.anbieter, {})
        return f"{eintrag.get('beschriftung', self.anbieter)} – {self.modell}"

    def als_dict(self) -> dict:
        return {
            "anbieter": self.anbieter,
            "modell": self.modell,
            "basis": self.basis,
            "aufwand": self.aufwand,
            "schluessel_gesetzt": bool(self.schluessel),
        }


def _ollama_laeuft(adresse: str = "localhost", port: int = 11434) -> bool:
    try:
        with socket.create_connection((adresse, port), timeout=0.4):
            return True
    except OSError:
        return False


def _konfigurationsdatei(zusatz: str | Path | None = None) -> dict:
    kandidaten = []
    if zusatz:
        kandidaten.append(Path(zusatz))
    kandidaten += [
        Path.cwd() / "bernie.json",
        Path(__file__).resolve().parent.parent.parent / "bernie.json",
        Path.home() / ".bernie.json",
    ]
    for pfad in kandidaten:
        try:
            if pfad.is_file():
                return json.loads(pfad.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return {}


def erkenne(konfiguration: str | Path | None = None) -> Einstellung:
    """Ermittelt die Anbindung aus Datei, Umgebung oder laufendem Ollama."""

    datei = _konfigurationsdatei(konfiguration)
    umgebung = os.environ

    anbieter = (umgebung.get("BERNIE_ANBIETER") or datei.get("anbieter") or "").strip().lower()
    modell = (umgebung.get("BERNIE_MODELL") or datei.get("modell") or "").strip()
    schluessel = (umgebung.get("BERNIE_SCHLUESSEL") or datei.get("schluessel") or "").strip()
    basis = (umgebung.get("BERNIE_BASIS") or datei.get("basis") or "").strip()
    aufwand = (umgebung.get("BERNIE_AUFWAND") or datei.get("aufwand") or "medium").strip()

    if not anbieter:
        for kandidat in SUCHREIHENFOLGE:
            for name in ANBIETER[kandidat]["umgebung"]:
                if umgebung.get(name):
                    anbieter, schluessel = kandidat, umgebung[name]
                    break
            if anbieter:
                break
    if not anbieter and _ollama_laeuft():
        anbieter = "ollama"
    if not anbieter:
        return Einstellung()

    eintrag = ANBIETER.get(anbieter)
    if eintrag is None:
        # Unbekannter Name: als OpenAI-kompatible Adresse behandeln.
        eintrag = {"basis": basis, "pfad": "/chat/completions", "modell": modell, "format": "openai", "umgebung": []}
        ANBIETER[anbieter] = {**eintrag, "beschriftung": anbieter}

    if not schluessel:
        for name in eintrag.get("umgebung", []):
            if umgebung.get(name):
                schluessel = umgebung[name]
                break

    return Einstellung(
        anbieter=anbieter,
        modell=modell or eintrag["modell"],
        schluessel=schluessel,
        basis=basis or eintrag["basis"],
        aufwand=aufwand,
        max_zeichen=int(datei.get("max_zeichen", 8000)),
    )


@dataclass
class Klient:
    """Stellt eine Anfrage an das eingestellte Sprachmodell."""

    einstellung: Einstellung = field(default_factory=erkenne)

    @property
    def bereit(self) -> bool:
        if not self.einstellung.vorhanden:
            return False
        if self.einstellung.anbieter == "ollama":
            return True
        return bool(self.einstellung.schluessel)

    def frage(self, system: str, nutzer: str, max_zeichen: int | None = None) -> str:
        """Schickt Systemanweisung und Nutzertext hin und liefert die Antwort."""

        if not self.einstellung.vorhanden:
            raise LLMFehler(
                "Kein Sprachmodell eingestellt. Entweder einen Schluessel setzen "
                "(z. B. ANTHROPIC_API_KEY oder GROQ_API_KEY) oder Ollama starten. "
                "Ohne Modell laeuft nur der Offline-Modus.",
                kein_schluessel=True,
            )
        if not self.bereit:
            raise LLMFehler(
                f"Fuer {self.einstellung.anbieter} fehlt der Schluessel. "
                "In der Umgebung setzen oder in bernie.json eintragen.",
                kein_schluessel=True,
            )

        eintrag = ANBIETER[self.einstellung.anbieter]
        grenze = max_zeichen or self.einstellung.max_zeichen
        adresse = self.einstellung.basis.rstrip("/") + eintrag["pfad"]

        if self.einstellung.format == "anthropic":
            kopf = {
                "content-type": "application/json",
                "x-api-key": self.einstellung.schluessel,
                "anthropic-version": "2023-06-01",
            }
            koerper: dict = {
                "model": self.einstellung.modell,
                "max_tokens": grenze,
                "system": system,
                "messages": [{"role": "user", "content": nutzer}],
            }
            # Die aktuellen Claude-Modelle denken von sich aus mit; die Tiefe
            # wird ueber den Aufwand gesteuert. Temperatur gibt es dort nicht
            # mehr -- mitschicken wuerde die Anfrage zurueckweisen.
            if self.einstellung.aufwand:
                koerper["output_config"] = {"effort": self.einstellung.aufwand}
        else:
            kopf = {"content-type": "application/json"}
            if self.einstellung.schluessel:
                kopf["authorization"] = f"Bearer {self.einstellung.schluessel}"
            koerper = {
                "model": self.einstellung.modell,
                "max_tokens": grenze,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": nutzer},
                ],
            }

        letzter: LLMFehler | None = None
        for versuch in range(VERSUCHE):
            try:
                return self._senden(adresse, kopf, koerper)
            except LLMFehler as fehler:
                letzter = fehler
                if fehler.status in (429, 500, 502, 503, 529) and versuch + 1 < VERSUCHE:
                    time.sleep(2 * (versuch + 1))
                    continue
                raise
        raise letzter or LLMFehler("Unbekannter Fehler")

    def _senden(self, adresse: str, kopf: dict, koerper: dict) -> str:
        anfrage = urllib.request.Request(
            adresse, data=json.dumps(koerper).encode("utf-8"), headers=kopf, method="POST"
        )
        try:
            with urllib.request.urlopen(anfrage, timeout=ZEITSPERRE) as antwort:
                daten = json.loads(antwort.read().decode("utf-8"))
        except urllib.error.HTTPError as fehler:
            rohtext = ""
            try:
                rohtext = fehler.read().decode("utf-8", "replace")
                einzelheit = json.loads(rohtext).get("error", {})
                einzelheit = einzelheit.get("message", "") if isinstance(einzelheit, dict) else str(einzelheit)
            except (ValueError, AttributeError):
                einzelheit = rohtext[:200]
            meldung = FEHLERTEXTE.get(fehler.code, f"Der Anbieter antwortete mit Status {fehler.code}.")
            if einzelheit:
                meldung += f" Meldung: {einzelheit}"
            raise LLMFehler(meldung, status=fehler.code) from None
        except urllib.error.URLError as fehler:
            raise LLMFehler(
                f"Keine Verbindung zu {adresse}. Grund: {fehler.reason}. "
                "Bei Ollama pruefen, ob es laeuft; sonst die Internetverbindung.",
            ) from None
        except (TimeoutError, socket.timeout):
            raise LLMFehler(f"Zeitueberschreitung nach {ZEITSPERRE} Sekunden.") from None

        text = self._auslesen(daten)
        if not text.strip():
            raise LLMFehler("Die Antwort des Modells war leer.")
        return text.strip()

    @staticmethod
    def _auslesen(daten: dict) -> str:
        if "content" in daten:  # Anthropic
            bloecke = daten.get("content") or []
            return "\n".join(b.get("text", "") for b in bloecke if b.get("type") == "text")
        auswahl = (daten.get("choices") or [{}])[0]
        nachricht = auswahl.get("message") or {}
        inhalt = nachricht.get("content")
        if isinstance(inhalt, list):  # manche Anbieter liefern Blockliste
            return "\n".join(teil.get("text", "") for teil in inhalt if isinstance(teil, dict))
        return inhalt or auswahl.get("text", "")


def uebersicht() -> list[dict]:
    """Alle bekannten Anbieter mit Angabe, ob ein Schluessel bereitliegt."""

    ergebnis = []
    for name, eintrag in ANBIETER.items():
        schluessel = any(os.environ.get(n) for n in eintrag.get("umgebung", []))
        if name == "ollama":
            schluessel = _ollama_laeuft()
        ergebnis.append(
            {
                "name": name,
                "beschriftung": eintrag.get("beschriftung", name),
                "modell": eintrag.get("modell", ""),
                "bereit": schluessel,
                "umgebung": eintrag.get("umgebung", []),
            }
        )
    return ergebnis
