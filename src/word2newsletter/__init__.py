"""Word-Dokumente in fertiges Newsletter-HTML (CleverReach-tauglich) umwandeln."""

from .blocks import Block, Document, Inline
from .config import Config, load_config
from .docx_reader import read_docx
from .renderer import render_document

__all__ = [
    "Block",
    "Document",
    "Inline",
    "Config",
    "load_config",
    "read_docx",
    "render_document",
]

__version__ = "1.0.0"
