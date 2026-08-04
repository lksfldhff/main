"""Erzeugt aus dem Dokumentmodell fertiges CleverReach-HTML.

Aufbau der Ausgabe (entspricht der bestehenden Newsletter-Vorlage):

    div.intro       Anrede (h1) + Einleitungstext
    div.divider
    div.section     optional h3 (Bereich) + h2 (Rubrik)
      div.article     a.article-title + Absaetze + a.cta
"""

from __future__ import annotations

import base64
import datetime as _dt
import html
import re
from dataclasses import dataclass, field
from pathlib import Path

from .blocks import Block, Document, Inline
from .config import Config, template_dir

ROLES = ("intro", "bereich", "rubrik", "artikel")
TAG_PATTERN = re.compile(
    r"^\s*\[(bereich|rubrik|artikel|kategorie|thema|cta|button|trenner|divider)\]\s*",
    re.IGNORECASE,
)
TAG_ROLE = {
    "bereich": "bereich",
    "kategorie": "bereich",
    "rubrik": "rubrik",
    "thema": "rubrik",
    "artikel": "artikel",
}
NO_TARGET_SCHEMES = ("mailto:", "tel:", "#", "{")


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def attr(value: str) -> str:
    return html.escape(value, quote=True)


def clean_url(url: str) -> str:
    return re.sub(r"\s+", "", url.strip())


def link_attrs(href: str, config: Config) -> str:
    href = clean_url(href)
    target = str(config.get("content.link_target", "_blank"))
    if href.lower().startswith(NO_TARGET_SCHEMES) or not target:
        return f'href="{attr(href)}"'
    return f'href="{attr(href)}" target="{attr(target)}" rel="noopener"'


# --------------------------------------------------------------- Strukturen


@dataclass
class Article:
    title: list[Inline] = field(default_factory=list)
    href: str | None = None
    blocks: list[Block] = field(default_factory=list)


@dataclass
class Section:
    bereich: str = ""
    rubrik: str = ""
    lead: list[Block] = field(default_factory=list)
    articles: list[Article] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.bereich or self.rubrik or self.lead or self.articles)


@dataclass
class Newsletter:
    anrede: list[Inline] = field(default_factory=list)
    intro: list[Block] = field(default_factory=list)
    sections: list[Section] = field(default_factory=list)


# ------------------------------------------------------------- Rollenlogik


def _strip_tag(block: Block) -> tuple[str, Block]:
    """Erkennt und entfernt eine Markierung wie "[Rubrik] Fachkraefte"."""
    if not block.inlines:
        return "", block
    match = TAG_PATTERN.match(block.inlines[0].text)
    if not match:
        return "", block
    tag = match.group(1).lower()
    first = block.inlines[0]
    rest = first.text[match.end():]
    inlines = ([Inline(text=rest, bold=first.bold, italic=first.italic,
                       underline=first.underline, strike=first.strike, href=first.href)]
               if rest else [])
    inlines.extend(block.inlines[1:])
    clone = Block(
        kind=block.kind, level=block.level, inlines=inlines, items=block.items,
        ordered=block.ordered, text=block.text, href=block.href, src=block.src,
        alt=block.alt, raw=block.raw, rows=block.rows, header_row=block.header_row,
    )
    return tag, clone


def resolve_mapping(blocks: list[Block], config: Config) -> dict[int, str]:
    """Ordnet Word-Ueberschriftsebenen den Rollen im Newsletter zu."""

    setting = config.get("content.word_mapping", "auto")
    if isinstance(setting, dict):
        mapping: dict[int, str] = {}
        for key, role in setting.items():
            try:
                level = int(key)
            except (TypeError, ValueError):
                continue
            if role in ROLES:
                mapping[level] = role
        if mapping:
            return mapping

    headings = [b for b in blocks if b.kind == "heading"]
    if not headings:
        return {}
    levels = sorted({b.level for b in headings})
    mapping = {}

    first_is_intro = (
        headings[0].level == levels[0]
        and sum(1 for b in headings if b.level == levels[0]) == 1
        and blocks.index(headings[0]) <= 2
    )
    if first_is_intro:
        mapping[levels[0]] = "intro"
        levels = levels[1:]
    if not levels:
        return mapping

    remaining = list(levels)
    mapping[remaining[-1]] = "artikel"
    if len(remaining) >= 2:
        mapping[remaining[-2]] = "rubrik"
    for level in remaining[:-2]:
        mapping[level] = "bereich"
    return mapping


def build_newsletter(doc: Document, config: Config) -> Newsletter:
    """Gruppiert die flache Blockliste zu Intro, Bereichen, Rubriken, Artikeln."""

    mapping = resolve_mapping(doc.blocks, config)
    newsletter = Newsletter()
    section: Section | None = None
    article: Article | None = None
    intro_done = False

    def ensure_section() -> Section:
        nonlocal section
        if section is None:
            section = Section()
            newsletter.sections.append(section)
        return section

    for original in doc.blocks:
        tag, block = _strip_tag(original)
        if tag in ("trenner", "divider"):
            block = Block(kind="divider")
            tag = ""
        if tag in ("cta", "button"):
            block = _as_cta(block)
            tag = ""

        role = TAG_ROLE.get(tag, "")
        if block.kind == "heading" and not role:
            role = mapping.get(block.level, "artikel")

        if role == "intro" and not intro_done and not newsletter.sections:
            newsletter.anrede = block.inlines
            intro_done = True
            continue

        if role == "bereich":
            section = Section(bereich=block.plain_text)
            newsletter.sections.append(section)
            article = None
            continue

        if role == "rubrik":
            if section is not None and not section.rubrik and not section.articles and not section.lead:
                section.rubrik = block.plain_text
            else:
                section = Section(rubrik=block.plain_text)
                newsletter.sections.append(section)
            article = None
            continue

        if role == "artikel":
            href = next((i.href for i in block.inlines if i.href), None)
            article = Article(title=block.inlines, href=href)
            ensure_section().articles.append(article)
            continue

        # Normaler Inhalt landet beim zuletzt geoeffneten Container.
        if article is not None:
            article.blocks.append(block)
        elif section is not None:
            section.lead.append(block)
        else:
            newsletter.intro.append(block)

    newsletter.sections = [s for s in newsletter.sections if not s.is_empty]
    return newsletter


def _as_cta(block: Block) -> Block:
    """"[CTA] Jetzt anmelden | https://..." wird zu einem Link-Absatz."""
    text = "".join(i.text for i in block.inlines)
    href = next((i.href for i in block.inlines if i.href), None)
    label = text
    if "|" in text:
        label, _, url = text.partition("|")
        href = clean_url(url) or href
    label = label.strip()
    return Block(kind="paragraph", inlines=[Inline(text=label, href=href or "#")])


def is_cta(block: Block) -> bool:
    """Ein Absatz, der komplett aus einem einzigen Link besteht."""
    if block.kind != "paragraph":
        return False
    texts = [i for i in block.inlines if i.text.strip()]
    if not texts:
        return False
    hrefs = {i.href for i in texts}
    return len(hrefs) == 1 and next(iter(hrefs)) not in (None, "")


# -------------------------------------------------------------- Rendering


class Renderer:
    def __init__(self, doc: Document, config: Config, image_prefix: str = "") -> None:
        self.doc = doc
        self.config = config
        self.image_prefix = image_prefix
        self.notes: list[str] = []

    # ---- Inline

    def inlines(self, inlines: list[Inline], keep_link: bool = True) -> str:
        parts: list[str] = []
        buffer: list[Inline] = []
        current: str | None = None

        def flush() -> None:
            nonlocal buffer, current
            if not buffer:
                return
            inner = "".join(self._one(i) for i in buffer)
            if current and keep_link:
                parts.append(f"<a {link_attrs(current, self.config)}>{inner}</a>")
            else:
                parts.append(inner)
            buffer = []

        for inline in inlines:
            if inline.linebreak:
                flush()
                current = None
                parts.append("<br />")
                continue
            if inline.href != current:
                flush()
                current = inline.href
            buffer.append(inline)
        flush()
        return "".join(parts).strip()

    def _one(self, inline: Inline) -> str:
        text = esc(inline.text)
        if not text:
            return ""
        if inline.bold:
            text = f"<strong>{text}</strong>"
        if inline.italic:
            text = f"<em>{text}</em>"
        if inline.underline:
            text = f"<u>{text}</u>"
        if inline.strike:
            text = f"<s>{text}</s>"
        return text

    def plain(self, inlines: list[Inline]) -> str:
        return esc("".join(i.text for i in inlines).strip())

    # ---- Bilder

    def image_src(self, name: str) -> str:
        if name.startswith(("http://", "https://", "data:")):
            return name
        mode = str(self.config.get("images.mode", "relative"))
        if mode == "url":
            base = str(self.config.get("images.base_url", "")).rstrip("/")
            if not base:
                self.notes.append(
                    f"Bild {name}: images.base_url ist leer -- bitte in der config.json eintragen."
                )
                return name
            return f"{base}/{name}"
        if mode == "inline":
            asset = self.doc.images.get(name)
            if asset is None:
                return name
            data = base64.b64encode(asset.data).decode("ascii")
            return f"data:{asset.content_type};base64,{data}"
        return f"{self.image_prefix}{name}" if self.image_prefix else name

    # ---- Bloecke

    def block(self, block: Block) -> str:
        if block.kind == "paragraph":
            if is_cta(block):
                return self.cta(block)
            body = self.inlines(block.inlines)
            return f"<p>{body}</p>" if body else ""
        if block.kind == "divider":
            return '<div class="divider">&nbsp;</div>'
        if block.kind == "quote":
            return f"<blockquote>{self.inlines(block.inlines)}</blockquote>"
        if block.kind == "list":
            return self.list_block(block)
        if block.kind == "image":
            return self.image_block(block)
        if block.kind == "table":
            return self.table_block(block)
        if block.kind == "heading":
            # Ueberschrift unterhalb der Artikelebene -- als fetter Absatz ausgeben.
            return f"<p><strong>{self.plain(block.inlines)}</strong></p>"
        if block.kind == "html":
            return block.raw
        return ""

    def cta(self, block: Block) -> str:
        href = next((i.href for i in block.inlines if i.href), "#")
        label = "".join(i.text for i in block.inlines).strip()
        arrow = str(self.config.get("content.cta_arrow", "→"))
        if arrow and not label.endswith(arrow):
            label = f"{label} {arrow}"
        return f'<a {link_attrs(href, self.config)} class="cta">{esc(label)}</a>'

    def list_block(self, block: Block) -> str:
        tag = "ol" if block.ordered else "ul"
        items = "".join(f"<li>{self.inlines(item.inlines)}</li>" for item in block.items)
        return f"<{tag}>{items}</{tag}>"

    def image_block(self, block: Block) -> str:
        src = self.image_src(block.src)
        alt = attr(block.alt or "")
        img = f'<img src="{attr(src)}" alt="{alt}" class="article-image" />'
        if block.href:
            return f"<a {link_attrs(block.href, self.config)}>{img}</a>"
        return img

    def table_block(self, block: Block) -> str:
        border = self.config.color("divider")
        rows_html: list[str] = []
        for index, row in enumerate(block.rows):
            cells: list[str] = []
            header = block.header_row and index == 0
            tag = "th" if header else "td"
            weight = "font-weight:800;" if header else ""
            for cell in row:
                cells.append(
                    f'<{tag} style="padding:8px 12px;border:1px solid {border};'
                    f'text-align:left;font-size:15px;line-height:1.6;{weight}">'
                    f"{self.inlines(cell)}</{tag}>"
                )
            rows_html.append("<tr>" + "".join(cells) + "</tr>")
        return (
            '<table width="100%" border="0" cellspacing="0" cellpadding="0" role="presentation" '
            f'style="margin:0 0 20px 0;border-collapse:collapse;color:{self.config.color("text")};">'
            "<tbody>" + "".join(rows_html) + "</tbody></table>"
        )

    def blocks(self, blocks: list[Block]) -> list[str]:
        return [html_ for html_ in (self.block(b) for b in blocks) if html_]

    # ---- Bereiche

    def article(self, article: Article) -> str:
        title = self.plain(article.title)
        if article.href:
            head = (
                f'<a {link_attrs(article.href, self.config)} class="article-title">{title}</a>'
            )
        else:
            head = f'<span class="article-title">{title}</span>'
            if title:
                self.notes.append(f'Artikel "{title}" hat keinen Link auf der Ueberschrift.')
        parts = [head, *self.blocks(article.blocks)]
        return '<div class="article">' + "\n".join(parts) + "</div>"

    def section(self, section: Section) -> str:
        parts: list[str] = []
        if section.bereich:
            parts.append(f"<h3>{esc(section.bereich)}</h3>")
        if section.rubrik:
            parts.append(f"<h2>{esc(section.rubrik)}</h2>")
        parts.extend(self.blocks(section.lead))
        parts.extend(self.article(a) for a in section.articles)
        return '<div class="section">' + "\n".join(parts) + "</div>"

    def content(self, newsletter: Newsletter) -> str:
        divider = '<div class="divider">&nbsp;</div>'
        parts: list[str] = []

        intro_parts: list[str] = []
        if newsletter.anrede:
            intro_parts.append(f"<h1>{self.plain(newsletter.anrede)}</h1>")
        intro_parts.extend(self.blocks(newsletter.intro))
        if intro_parts:
            parts.append('<div class="intro">' + "\n".join(intro_parts) + "</div>")
            if newsletter.sections and self.config.get("content.divider_after_intro", True):
                parts.append(divider)

        before_bereich = bool(self.config.get("content.divider_before_bereich", True))
        for index, section in enumerate(newsletter.sections):
            if index > 0 and section.bereich and before_bereich and parts[-1] != divider:
                parts.append(divider)
            parts.append(self.section(section))
        return "\n".join(parts)


# ---------------------------------------------------------- Kopf und Fuss


def render_header(doc: Document, config: Config) -> str:
    url = doc.get_meta("kopfbild") or str(config.get("brand.header_image_url", ""))
    if not url:
        return ""
    alt = attr(str(config.get("brand.header_image_alt", "")))
    width = int(config.get("brand.max_width", 650))
    img = (
        f'<img src="{attr(clean_url(url))}" alt="{alt}" width="{width}" class="header-image" />'
    )
    link = doc.get_meta("kopfbild_link") or str(config.get("brand.header_image_link", ""))
    if link:
        img = f"<a {link_attrs(link, config)}>{img}</a>"
    return f'<div class="header-container">{img}</div>'


def render_footer_columns(config: Config) -> str:
    columns = config.get("footer.columns", []) or []
    cells: list[str] = []
    for index, column in enumerate(columns):
        width = attr(str(column.get("width", f"{100 // max(len(columns), 1)}%")))
        padding = ' style="padding-right: 15px;"' if index < len(columns) - 1 else ""
        heading = esc(str(column.get("heading", "")))
        body = str(column.get("html", ""))
        cells.append(
            f'<td class="footer-col" valign="top" width="{width}"{padding}>'
            f'<div class="footer-heading">{heading}</div>'
            f'<div class="footer-text">{body}</div></td>'
        )
    return "\n".join(cells)


def render_footer_links(config: Config) -> str:
    links = config.get("footer.links", []) or []
    separator = (
        f'<span style="color: {config.color("footer_bottom_text")}; margin: 0 8px;">|</span>'
    )
    rendered = [
        f'<a {link_attrs(str(link.get("url", "")), config)}>{esc(str(link.get("label", "")))}</a>'
        for link in links
        if link.get("label")
    ]
    return f" {separator} ".join(rendered)


def render_footer_logos(config: Config) -> str:
    logos = config.get("footer.logos", []) or []
    parts: list[str] = []
    for logo in logos:
        margin = logo.get("margin_right", "")
        style = "display: inline-block; vertical-align: middle;"
        if margin:
            style += f" margin-right: {margin};"
        img = (
            f'<img src="{attr(clean_url(str(logo.get("image", ""))))}" style="{attr(style)}" '
            f'alt="{attr(str(logo.get("alt", "")))}" />'
        )
        url = str(logo.get("url", ""))
        parts.append(f"<a {link_attrs(url, config)}>{img}</a>" if url else img)
    return " ".join(parts)


def render_tracking(config: Config) -> str:
    pixels = config.get("tracking_pixels", []) or []
    return "\n".join(
        f'<img src="{attr(clean_url(str(pixel)))}" border="0" alt="" height="1" width="1" />'
        for pixel in pixels
        if str(pixel).strip()
    )


def render_preheader(doc: Document) -> str:
    text = doc.get_meta("vorschautext")
    if not text:
        return ""
    padding = "&#847;&zwnj;&nbsp;" * 40
    return (
        '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;'
        'font-size:1px;line-height:1px;color:#ffffff;opacity:0;">'
        f"{esc(text)}{padding}</div>"
    )


# ------------------------------------------------------------ Zusammenbau


def load_template(config: Config, folder: Path | None = None) -> str:
    name = str(config.get("template", "whf_newsletter.html"))
    base = folder or template_dir()
    path = Path(base) / name
    if not path.is_file():
        raise FileNotFoundError(f"Vorlage nicht gefunden: {path}")
    return path.read_text(encoding="utf-8")


def render_document(
    doc: Document,
    config: Config | None = None,
    image_prefix: str = "",
    template_folder: Path | None = None,
) -> tuple[str, list[str]]:
    """Baut das komplette HTML. Liefert (html, hinweise)."""

    config = config or Config()
    renderer = Renderer(doc, config, image_prefix=image_prefix)
    newsletter = build_newsletter(doc, config)
    content = renderer.content(newsletter)

    title = doc.get_meta("betreff", "titel") or str(config.get("brand.title", "Newsletter"))
    copyright_text = str(config.get("footer.copyright", "")).replace(
        "{jahr}", str(_dt.date.today().year)
    )

    values = {
        "TITLE": esc(title),
        "PREHEADER": render_preheader(doc),
        "HEADER": render_header(doc, config),
        "CONTENT": content,
        "FOOTER_COLUMNS": render_footer_columns(config),
        "FOOTER_LINKS": render_footer_links(config),
        "FOOTER_LOGOS": render_footer_logos(config),
        "COPYRIGHT": esc(copyright_text),
        "TRACKING": render_tracking(config),
        "FONT_FAMILY": str(config.font_family),
        "GOOGLE_FONTS_URL": str(config.get("typography.google_fonts_url", "")),
        "MAX_WIDTH": str(config.width),
        "C_DARK": config.color("dark"),
        "C_TEAL": config.color("teal"),
        "C_YELLOW": config.color("yellow"),
        "C_PAGE_BG": config.color("page_background"),
        "C_CONTENT_BG": config.color("content_background"),
        "C_TEXT": config.color("text"),
        "C_DIVIDER": config.color("divider"),
        "C_FOOTER_BOTTOM_BG": config.color("footer_bottom_background"),
        "C_FOOTER_BOTTOM_TEXT": config.color("footer_bottom_text"),
    }

    output = load_template(config, template_folder)
    for key, value in values.items():
        output = output.replace("{{" + key + "}}", value)

    notes = list(doc.warnings) + renderer.notes
    if not newsletter.sections:
        notes.append(
            "Es wurde kein einziger Abschnitt erkannt -- pruefe die Ueberschriften-"
            "Formatvorlagen in der Word-Datei."
        )
    return output, notes
