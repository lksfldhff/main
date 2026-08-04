"""Liest .docx-Dateien ohne externe Abhaengigkeiten.

Eine .docx ist ein ZIP-Archiv mit XML. Wir lesen daraus:
  word/document.xml            -- Inhalt (Absaetze, Tabellen, Bilder)
  word/_rels/document.xml.rels -- Ziele von Hyperlinks und Bildern
  word/styles.xml              -- Formatvorlagen-Namen ("Ueberschrift 2" usw.)
  word/numbering.xml           -- Aufzaehlung oder Nummerierung
  word/media/*                 -- eingebettete Bilder

Bewusst ohne python-docx: so laesst sich das Programm ohne Installation als
einzelne .exe ausliefern.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

from .blocks import Block, Document, ImageAsset, Inline, ListItem

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

# Schluessel, die ganz oben im Dokument als "Schluessel: Wert" stehen duerfen.
META_KEYS = {
    "betreff": "betreff",
    "subject": "betreff",
    "vorschautext": "vorschautext",
    "preheader": "vorschautext",
    "preview": "vorschautext",
    "titel": "titel",
    "title": "titel",
    "ausgabe": "ausgabe",
    "datum": "datum",
    "date": "datum",
    "kopfbild": "kopfbild",
    "headerbild": "kopfbild",
    "header": "kopfbild",
    "kopfbild-link": "kopfbild_link",
    "headerlink": "kopfbild_link",
    "absender": "absender",
}

HEADING_NAME = re.compile(r"^(?:heading|[uü]berschrift)\s*([1-6])$", re.IGNORECASE)
HEADING_ID = re.compile(r"^(?:heading|[uü]?berschrift)\s*([1-6])$", re.IGNORECASE)
TITLE_NAMES = {"title", "titel"}
DIVIDER_TEXT = re.compile(r"^\s*(?:-{3,}|_{3,}|\*{3,})\s*$")
META_LINE = re.compile(r"^\s*([A-Za-zÄÖÜäöüß\- ]{2,24})\s*:\s*(.+?)\s*$")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _bool_attr(element, default: bool = True) -> bool:
    """<w:b/> heisst an, <w:b w:val="0"/> heisst aus."""
    if element is None:
        return False
    value = element.get(W + "val")
    if value is None:
        return default
    return value not in ("0", "false", "none", "off")


class _Paragraph:
    """Zwischenform eines Absatzes, bevor daraus ein Block wird."""

    __slots__ = ("inlines", "style_name", "style_id", "level", "num_id", "ilvl", "images", "is_quote")

    def __init__(self) -> None:
        self.inlines: list[Inline] = []
        self.style_name: str = ""
        self.style_id: str = ""
        self.level: int = 0
        self.num_id: str | None = None
        self.ilvl: int = 0
        self.images: list[str] = []
        self.is_quote: bool = False

    @property
    def text(self) -> str:
        return "".join(i.text for i in self.inlines).strip()


class DocxReader:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if not self.path.is_file():
            raise FileNotFoundError(f"Word-Datei nicht gefunden: {self.path}")
        try:
            self.zip = zipfile.ZipFile(self.path)
        except zipfile.BadZipFile as exc:
            raise ValueError(
                f"{self.path.name} ist keine gueltige .docx-Datei. "
                "Aeltere .doc-Dateien bitte in Word als .docx speichern."
            ) from exc
        self.warnings: list[str] = []
        self.images: dict[str, ImageAsset] = {}
        self._rels = self._read_rels()
        self._styles = self._read_styles()
        self._numbering = self._read_numbering()

    # ---------------------------------------------------------------- Hilfen

    def _xml(self, name: str):
        from xml.etree import ElementTree as ET

        try:
            data = self.zip.read(name)
        except KeyError:
            return None
        return ET.fromstring(data)

    def _read_rels(self) -> dict[str, str]:
        root = self._xml("word/_rels/document.xml.rels")
        if root is None:
            return {}
        rels: dict[str, str] = {}
        for rel in root:
            rid = rel.get("Id")
            target = rel.get("Target", "")
            if rid:
                rels[rid] = target
        return rels

    def _read_styles(self) -> dict[str, str]:
        root = self._xml("word/styles.xml")
        if root is None:
            return {}
        styles: dict[str, str] = {}
        for style in root.findall(W + "style"):
            style_id = style.get(W + "styleId") or ""
            name_el = style.find(W + "name")
            name = (name_el.get(W + "val") if name_el is not None else "") or ""
            styles[style_id] = name.strip().lower()
        return styles

    def _read_numbering(self) -> dict[str, dict[int, str]]:
        """numId -> {ilvl: numFmt}, z.B. {"3": {0: "bullet"}}."""
        root = self._xml("word/numbering.xml")
        if root is None:
            return {}
        abstract: dict[str, dict[int, str]] = {}
        for node in root.findall(W + "abstractNum"):
            aid = node.get(W + "abstractNumId") or ""
            levels: dict[int, str] = {}
            for lvl in node.findall(W + "lvl"):
                try:
                    ilvl = int(lvl.get(W + "ilvl") or 0)
                except ValueError:
                    ilvl = 0
                fmt_el = lvl.find(W + "numFmt")
                levels[ilvl] = (fmt_el.get(W + "val") if fmt_el is not None else "bullet") or "bullet"
            abstract[aid] = levels
        result: dict[str, dict[int, str]] = {}
        for node in root.findall(W + "num"):
            num_id = node.get(W + "numId") or ""
            ref = node.find(W + "abstractNumId")
            aid = (ref.get(W + "val") if ref is not None else "") or ""
            result[num_id] = abstract.get(aid, {})
        return result

    def _heading_level(self, style_id: str, style_name: str, outline: int | None) -> int:
        match = HEADING_NAME.match(style_name)
        if match:
            return int(match.group(1))
        match = HEADING_ID.match(style_id)
        if match:
            return int(match.group(1))
        if style_name in TITLE_NAMES or style_id.lower() in TITLE_NAMES:
            return 1
        if outline is not None and 0 <= outline <= 5:
            return outline + 1
        return 0

    # -------------------------------------------------------------- Parsing

    def _run_inlines(self, run, href: str | None) -> list[Inline]:
        props = run.find(W + "rPr")
        bold = italic = underline = strike = False
        if props is not None:
            bold = _bool_attr(props.find(W + "b"))
            italic = _bool_attr(props.find(W + "i"))
            underline_el = props.find(W + "u")
            underline = underline_el is not None and (underline_el.get(W + "val") or "single") != "none"
            strike = _bool_attr(props.find(W + "strike"))

        inlines: list[Inline] = []
        for child in run:
            tag = _local(child.tag)
            if tag == "t":
                text = child.text or ""
                if text:
                    inlines.append(
                        Inline(text=text, bold=bold, italic=italic, underline=underline,
                               strike=strike, href=href)
                    )
            elif tag == "br":
                inlines.append(Inline(linebreak=True))
            elif tag == "tab":
                inlines.append(Inline(text=" "))
            elif tag in ("drawing", "pict", "object"):
                name = self._extract_image(child)
                if name:
                    inlines.append(Inline(text=f"\x00IMG:{name}\x00", href=href))
        return inlines

    def _extract_image(self, element) -> str | None:
        rid = None
        for node in element.iter():
            rid = node.get(R + "embed") or node.get(R + "link") or node.get(R + "id")
            if rid:
                break
        if not rid:
            return None
        target = self._rels.get(rid)
        if not target:
            return None
        if target.startswith("http"):
            return target
        name = target.split("/")[-1]
        if name not in self.images:
            for candidate in (f"word/{target.lstrip('/')}", f"word/media/{name}", target):
                try:
                    data = self.zip.read(candidate)
                except KeyError:
                    continue
                suffix = Path(name).suffix.lower().lstrip(".") or "png"
                mime = {"jpg": "jpeg", "jpe": "jpeg", "svg": "svg+xml"}.get(suffix, suffix)
                self.images[name] = ImageAsset(name=name, data=data, content_type=f"image/{mime}")
                break
            else:
                self.warnings.append(f"Bild {name} konnte nicht gelesen werden.")
                return None
        return name

    def _collect_inlines(self, container, href: str | None = None) -> list[Inline]:
        inlines: list[Inline] = []
        for child in container:
            tag = _local(child.tag)
            if tag == "r":
                inlines.extend(self._run_inlines(child, href))
            elif tag == "hyperlink":
                rid = child.get(R + "id")
                target = self._rels.get(rid or "", "")
                anchor = child.get(W + "anchor")
                link = target or (f"#{anchor}" if anchor else None)
                inlines.extend(self._collect_inlines(child, link or href))
            elif tag == "fldSimple":
                instr = child.get(W + "instr") or ""
                match = re.search(r'HYPERLINK\s+"([^"]+)"', instr)
                inlines.extend(self._collect_inlines(child, match.group(1) if match else href))
            elif tag in ("ins", "smartTag", "bdo", "dir"):
                inlines.extend(self._collect_inlines(child, href))
            elif tag == "sdt":
                content = child.find(W + "sdtContent")
                if content is not None:
                    inlines.extend(self._collect_inlines(content, href))
            # w:del (geloeschter Text), w:bookmarkStart usw. werden ignoriert
        return inlines

    def _parse_paragraph(self, element) -> _Paragraph:
        para = _Paragraph()
        props = element.find(W + "pPr")
        outline = None
        if props is not None:
            style_el = props.find(W + "pStyle")
            para.style_id = (style_el.get(W + "val") if style_el is not None else "") or ""
            para.style_name = self._styles.get(para.style_id, para.style_id.lower())
            outline_el = props.find(W + "outlineLvl")
            if outline_el is not None:
                try:
                    outline = int(outline_el.get(W + "val") or "9")
                except ValueError:
                    outline = None
            num_pr = props.find(W + "numPr")
            if num_pr is not None:
                num_el = num_pr.find(W + "numId")
                ilvl_el = num_pr.find(W + "ilvl")
                para.num_id = (num_el.get(W + "val") if num_el is not None else None)
                try:
                    para.ilvl = int(ilvl_el.get(W + "val") or 0) if ilvl_el is not None else 0
                except ValueError:
                    para.ilvl = 0
        para.level = self._heading_level(para.style_id, para.style_name, outline)
        para.is_quote = "quote" in para.style_name or "zitat" in para.style_name
        para.inlines = self._collect_inlines(element)
        return para

    def _iter_body(self, body):
        for child in body:
            tag = _local(child.tag)
            if tag == "p":
                yield "p", child
            elif tag == "tbl":
                yield "tbl", child
            elif tag == "sdt":
                content = child.find(W + "sdtContent")
                if content is not None:
                    yield from self._iter_body(content)

    def _parse_table(self, element) -> list[list[list[Inline]]]:
        rows: list[list[list[Inline]]] = []
        for row in element.findall(W + "tr"):
            cells: list[list[Inline]] = []
            for cell in row.findall(W + "tc"):
                inlines: list[Inline] = []
                for para in cell.findall(W + "p"):
                    if inlines:
                        inlines.append(Inline(linebreak=True))
                    inlines.extend(self._collect_inlines(para))
                cells.append(inlines)
            if cells:
                rows.append(cells)
        return rows

    # ----------------------------------------------------------- Umwandlung

    def _split_images(self, inlines: list[Inline]) -> tuple[list[Inline], list[str]]:
        """Bilder aus dem Textfluss ziehen -- E-Mail-Layouts wollen sie als Block."""
        clean: list[Inline] = []
        images: list[str] = []
        for inline in inlines:
            if inline.text.startswith("\x00IMG:"):
                images.append(inline.text[5:-1])
            else:
                clean.append(inline)
        return clean, images

    def _blocks_from_paragraph(self, para: _Paragraph) -> list[Block]:
        inlines, images = self._split_images(para.inlines)
        while inlines and not inlines[0].text.strip() and not inlines[0].linebreak:
            inlines.pop(0)
        while inlines and not inlines[-1].text.strip() and not inlines[-1].linebreak:
            inlines.pop()
        text = "".join(i.text for i in inlines).strip()

        blocks: list[Block] = []
        for name in images:
            src = name if not name.startswith("http") else name
            blocks.append(Block(kind="image", src=src, alt=text[:120]))

        if not text:
            return blocks
        if DIVIDER_TEXT.match(text):
            blocks.append(Block(kind="divider"))
            return blocks
        if para.level:
            blocks.append(Block(kind="heading", level=para.level, inlines=inlines))
        elif para.is_quote:
            blocks.append(Block(kind="quote", inlines=inlines))
        else:
            blocks.append(Block(kind="paragraph", inlines=inlines))
        return blocks

    def _list_format(self, para: _Paragraph) -> bool:
        levels = self._numbering.get(para.num_id or "", {})
        fmt = levels.get(para.ilvl, "bullet")
        return fmt not in ("bullet", "none")

    def read(self) -> Document:
        root = self._xml("word/document.xml")
        if root is None:
            raise ValueError(f"{self.path.name}: word/document.xml fehlt.")
        body = root.find(W + "body")
        if body is None:
            raise ValueError(f"{self.path.name}: Dokument enthaelt keinen Textkoerper.")

        paragraphs: list[tuple[str, object]] = []
        for kind, element in self._iter_body(body):
            if kind == "p":
                paragraphs.append(("p", self._parse_paragraph(element)))
            else:
                paragraphs.append(("tbl", self._parse_table(element)))

        meta = self._read_core_meta()
        index = self._read_front_matter(paragraphs, meta)

        blocks: list[Block] = []
        pending_list: list[ListItem] = []
        pending_ordered = False

        def flush_list() -> None:
            nonlocal pending_list, pending_ordered
            if pending_list:
                blocks.append(Block(kind="list", items=pending_list, ordered=pending_ordered))
                pending_list = []
                pending_ordered = False

        for kind, item in paragraphs[index:]:
            if kind == "tbl":
                flush_list()
                rows = item  # type: ignore[assignment]
                if rows:
                    blocks.append(Block(kind="table", rows=rows, header_row=True))
                continue

            para: _Paragraph = item  # type: ignore[assignment]
            if para.num_id is not None and para.level == 0 and para.text:
                inlines, images = self._split_images(para.inlines)
                ordered = self._list_format(para)
                if pending_list and ordered != pending_ordered:
                    flush_list()
                pending_ordered = ordered
                pending_list.append(ListItem(inlines=inlines, level=para.ilvl))
                for name in images:
                    flush_list()
                    blocks.append(Block(kind="image", src=name))
                continue

            flush_list()
            blocks.extend(self._blocks_from_paragraph(para))

        flush_list()
        return Document(meta=meta, blocks=blocks, images=self.images, warnings=self.warnings)

    def _read_core_meta(self) -> dict[str, str]:
        meta: dict[str, str] = {}
        root = self._xml("docProps/core.xml")
        if root is None:
            return meta
        for child in root:
            if _local(child.tag) == "title" and (child.text or "").strip():
                meta.setdefault("titel", child.text.strip())
        return meta

    def _read_front_matter(self, paragraphs: list[tuple[str, object]], meta: dict[str, str]) -> int:
        """Liest fuehrende "Schluessel: Wert"-Zeilen und eine fuehrende 2-Spalten-Tabelle."""
        index = 0
        while index < len(paragraphs):
            kind, item = paragraphs[index]
            if kind == "tbl":
                rows = item  # type: ignore[assignment]
                if not rows or len(rows[0]) != 2:
                    break
                matched = False
                for row in rows:
                    key = "".join(i.text for i in row[0]).strip().rstrip(":").lower()
                    value = "".join(i.text for i in row[1]).strip()
                    if key in META_KEYS and value:
                        meta[META_KEYS[key]] = value
                        matched = True
                if not matched:
                    break
                index += 1
                continue

            para: _Paragraph = item  # type: ignore[assignment]
            text = para.text
            if not text:
                index += 1
                continue
            if para.level:
                break
            match = META_LINE.match(text)
            if not match:
                break
            key = match.group(1).strip().lower()
            if key not in META_KEYS:
                break
            meta[META_KEYS[key]] = match.group(2).strip()
            index += 1
        return index


def read_docx(path: str | Path) -> Document:
    """Liest eine .docx-Datei und liefert das Dokumentmodell."""
    return DocxReader(path).read()
