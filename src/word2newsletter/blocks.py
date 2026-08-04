"""Datenmodell zwischen Word-Datei und HTML-Ausgabe.

Der Reader erzeugt aus der .docx-Datei eine Liste von Bloecken, der Renderer
macht daraus HTML. Beide Seiten kennen nur dieses Modell -- dadurch laesst sich
das Layout aendern, ohne das Word-Parsing anzufassen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Inline:
    """Ein Textstueck innerhalb eines Absatzes."""

    text: str = ""
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    href: str | None = None
    linebreak: bool = False


@dataclass
class ListItem:
    inlines: list[Inline] = field(default_factory=list)
    level: int = 0


@dataclass
class Block:
    """Ein Layout-Baustein des Newsletters.

    kind ist eines von:
      heading    -- level 1..3
      paragraph  -- inlines
      list       -- items, ordered
      button     -- text, href
      image      -- src, alt, href
      divider    -- keine weiteren Felder
      quote      -- inlines
      table      -- rows (Liste von Zeilen, Zeile = Liste von Zellen mit inlines)
      html       -- raw (unveraenderte HTML-Uebernahme)
    """

    kind: str
    level: int = 0
    inlines: list[Inline] = field(default_factory=list)
    items: list[ListItem] = field(default_factory=list)
    ordered: bool = False
    text: str = ""
    href: str | None = None
    src: str = ""
    alt: str = ""
    raw: str = ""
    rows: list[list[list[Inline]]] = field(default_factory=list)
    header_row: bool = False

    @property
    def plain_text(self) -> str:
        return "".join(i.text for i in self.inlines).strip()


@dataclass
class ImageAsset:
    """Ein aus der Word-Datei extrahiertes Bild."""

    name: str
    data: bytes
    content_type: str = "image/png"


@dataclass
class Document:
    """Das komplette eingelesene Word-Dokument."""

    meta: dict[str, str] = field(default_factory=dict)
    blocks: list[Block] = field(default_factory=list)
    images: dict[str, ImageAsset] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def get_meta(self, *keys: str, default: str = "") -> str:
        for key in keys:
            value = self.meta.get(key)
            if value:
                return value
        return default

    def to_dict(self) -> dict[str, Any]:
        """Nur fuer Debug-Ausgaben."""
        return {
            "meta": self.meta,
            "blocks": [b.kind for b in self.blocks],
            "images": sorted(self.images),
            "warnings": self.warnings,
        }
