"""Konfiguration des Newsletters (Farben, Kopfbild, Fusszeile, Tracking).

Alles, was sich von Ausgabe zu Ausgabe *nicht* aendert, steht in der
config.json. Alles, was sich aendert, kommt aus der Word-Datei.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "template": "whf_newsletter.html",
    "brand": {
        "title": "WHF Impulse",
        "max_width": 650,
        "header_image_url": "https://files.crsend.com/186000/186049/images/whf_newsletter_2026_02_24/whf_newsletter_header.jpg",
        "header_image_alt": "WHF Impulse Header",
        "header_image_link": "",
    },
    "colors": {
        "dark": "#06465E",
        "teal": "#136F8B",
        "yellow": "#FFFC00",
        "page_background": "#f4f7f8",
        "content_background": "#ffffff",
        "text": "#333333",
        "divider": "#e0e0e0",
        "footer_bottom_background": "#ededed",
        "footer_bottom_text": "#777777",
    },
    "typography": {
        "font_family": "'Inter', Helvetica, Arial, sans-serif",
        "google_fonts_url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap",
    },
    "content": {
        # Zuordnung der Word-Ueberschriften zu den Rollen im Newsletter.
        # "auto" erkennt die Ebenen selbst: tiefste Ebene = Artikeltitel.
        "word_mapping": "auto",
        "cta_arrow": "→",
        "divider_after_intro": True,
        "divider_before_bereich": True,
        "link_target": "_blank",
    },
    "footer": {
        "columns": [
            {
                "heading": "Kontakt",
                "width": "30%",
                "html": (
                    "Ihr Kontakt für Fragen oder Anregungen zum Newsletter:<br /><br />"
                    "<strong>Thomas Rinke</strong><br />"
                    "Leitung Marketing | Kommunikation | Presse<br />"
                    "<strong>T</strong> +49 7131 3825 130<br />"
                    '<a href="mailto:t.rinke@heilbronn-franken.com" class="footer-mail">'
                    "t.rinke@heilbronn-franken.com</a>"
                ),
            },
            {
                "heading": "Herausgeber",
                "width": "40%",
                "html": (
                    "Wirtschaftsregion Heilbronn-Franken GmbH<br />"
                    "Koepffstraße 17 • 74076 Heilbronn<br />"
                    "<strong>T</strong> +49 (0)7131 3825-220<br />"
                    "<strong>F</strong> +49 (0)7131 3825-38<br />"
                    '<a href="https://www.heilbronn-franken.com" target="_blank" rel="noopener">'
                    "www.heilbronn-franken.com</a><br /><br />"
                    "Amtsgericht Stuttgart HRB 106 758<br />"
                    "Sitz der Gesellschaft ist Heilbronn<br />"
                    "Steuer-Nr. 65209/09008<br />"
                    "USt.-IdNr. DE 196996048<br />"
                    "<strong>Geschäftsführer:</strong> Bernhard Feßler<br /><br />"
                    "<strong>Vorsitzender:</strong><br />"
                    "Oberbürgermeister Harry Mergel"
                ),
            },
            {
                "heading": "Newsletter",
                "width": "30%",
                "html": (
                    "Sie möchten keinen Newsletter mehr erhalten? Dann klicken Sie "
                    '<a href="https://seu2.cleverreach.com/f/186049-187414/wwu/" '
                    'target="_blank" rel="noopener">hier</a>.'
                ),
            },
        ],
        "links": [
            {
                "label": "IMPRESSUM",
                "url": "https://www.heilbronn-franken.com/de/metanavigation/impressum.html",
            },
            {
                "label": "DATENSCHUTZ",
                "url": "https://www.heilbronn-franken.com/de/metanavigation/datenschutz.html",
            },
        ],
        "logos": [
            {
                "image": "https://files.crsend.com/186000/186049/images/whf_newsletter_2026_02_24/charta.png",
                "url": "https://www.charta-der-vielfalt.de/startseite.html",
                "alt": "Charta der Vielfalt",
                "margin_right": "15px",
            },
            {
                "image": "https://files.crsend.com/186000/186049/images/whf_newsletter_2026_02_24/proRegion.png",
                "url": "http://www.pro-region.de/de/proregion/index.php",
                "alt": "Pro Region",
            },
        ],
        "copyright": "© {jahr} Wirtschaftsregion Heilbronn-Franken GmbH",
    },
    "tracking_pixels": [
        "https://stats-eu2.crsend.com/stats/mc_[CLIENT_ID]_[MAILING_ID]_[USER_ID_SECURE].gif",
        "https://186049.seu2.cleverreach.com/op2/[CLIENT_ID]-[MAILING_ID]/[USER_AES].gif",
    ],
    "images": {
        # relative = Bilder in Unterordner schreiben und relativ verlinken
        # url      = base_url + Dateiname (nach Upload in den CleverReach-Medienpool)
        # inline   = als data:-URI einbetten (nur fuer die Vorschau sinnvoll)
        "mode": "relative",
        "base_url": "",
        "folder_suffix": "_bilder",
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


@dataclass
class Config:
    data: dict[str, Any] = field(
        default_factory=lambda: json.loads(json.dumps(DEFAULTS))
    )

    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self.data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def color(self, name: str) -> str:
        return str(self.get(f"colors.{name}", DEFAULTS["colors"].get(name, "#000000")))

    @property
    def width(self) -> int:
        return int(self.get("brand.max_width", 650))

    @property
    def font_family(self) -> str:
        return str(self.get("typography.font_family", DEFAULTS["typography"]["font_family"]))

    def merged_with(self, override: dict[str, Any]) -> "Config":
        return Config(_deep_merge(self.data, override))

    def save(self, path: str | Path) -> None:
        Path(path).write_text(
            json.dumps(self.data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )


def load_config(path: str | Path | None = None) -> Config:
    """Laedt eine config.json und legt sie ueber die Standardwerte."""

    config = Config()
    if path is None:
        return config
    file = Path(path)
    if not file.is_file():
        return config
    try:
        raw = json.loads(file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{file.name} ist kein gueltiges JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"{file.name}: erwartet wird ein JSON-Objekt")
    return config.merged_with(raw)


def find_config(start: str | Path | None = None) -> Path | None:
    """Sucht config.json neben der Word-Datei, im Arbeitsordner, dann im Programm."""

    candidates: list[Path] = []
    if start is not None:
        start_path = Path(start)
        candidates.append(start_path if start_path.is_dir() else start_path.parent)
    candidates.append(Path.cwd())
    candidates.append(exe_dir())
    candidates.append(app_root())
    seen: set[Path] = set()
    for folder in candidates:
        folder = folder.resolve()
        if folder in seen:
            continue
        seen.add(folder)
        candidate = folder / "config.json"
        if candidate.is_file():
            return candidate
    return None


def app_root() -> Path:
    """Ordner mit den mitgelieferten Dateien (Vorlagen).

    In der von PyInstaller gebauten .exe liegen diese in einem temporaeren
    Entpackordner (sys._MEIPASS), nicht neben der .exe.
    """

    import sys

    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[2]


def exe_dir() -> Path:
    """Ordner, in dem die .exe liegt -- dort sucht das Programm die config.json."""

    import sys

    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def template_dir() -> Path:
    return app_root() / "templates"
