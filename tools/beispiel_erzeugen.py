"""Erzeugt die Beispiel-Word-Datei (Vorlage fuer die Redaktion).

Aufruf:  python tools/beispiel_erzeugen.py [zielpfad.docx]

Bewusst ohne python-docx geschrieben, damit das Repository ohne Installation
funktioniert. Die erzeugte Datei laesst sich in Word normal oeffnen und
bearbeiten.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>"""

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>WHF Impulse</dc:title>
<dc:creator>Redaktion</dc:creator>
</cp:coreProperties>"""


def styles_xml() -> str:
    parts = [
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {NS}>',
        '<w:style w:type="paragraph" w:default="1" w:styleId="Standard">'
        '<w:name w:val="Normal"/></w:style>',
        '<w:style w:type="paragraph" w:styleId="Listenabsatz">'
        '<w:name w:val="List Paragraph"/></w:style>',
    ]
    for level in range(1, 5):
        parts.append(
            f'<w:style w:type="paragraph" w:styleId="berschrift{level}">'
            f'<w:name w:val="heading {level}"/>'
            f'<w:pPr><w:outlineLvl w:val="{level - 1}"/></w:pPr>'
            f'<w:rPr><w:b/></w:rPr></w:style>'
        )
    parts.append("</w:styles>")
    return "".join(parts)


class DocBuilder:
    def __init__(self) -> None:
        self.body: list[str] = []
        self.rels: list[tuple[str, str]] = []

    def _rid(self, url: str) -> str:
        rid = f"rId{len(self.rels) + 100}"
        self.rels.append((rid, url))
        return rid

    def _run(self, text: str, bold: bool = False, italic: bool = False) -> str:
        props = ""
        if bold or italic:
            props = "<w:rPr>" + ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") + "</w:rPr>"
        return f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'

    def para(self, *runs: str, style: str | None = None) -> None:
        props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        self.body.append(f"<w:p>{props}{''.join(runs)}</w:p>")

    def text(self, content: str, style: str | None = None) -> None:
        self.para(self._run(content), style=style)

    def rich(self, pieces: list[tuple[str, bool]], style: str | None = None) -> None:
        self.para(*[self._run(t, bold=b) for t, b in pieces], style=style)

    def link_para(self, label: str, url: str, style: str | None = None) -> None:
        rid = self._rid(url)
        run = self._run(label)
        self.para(f'<w:hyperlink r:id="{rid}">{run}</w:hyperlink>', style=style)

    def bullet(self, content: str) -> None:
        self.body.append(
            '<w:p><w:pPr><w:pStyle w:val="Listenabsatz"/><w:numPr>'
            '<w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
            f"{self._run(content)}</w:p>"
        )

    def empty(self) -> None:
        self.body.append("<w:p/>")

    def document_xml(self) -> str:
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f"<w:document {NS}><w:body>{''.join(self.body)}"
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'
            "</w:body></w:document>"
        )

    def rels_xml(self) -> str:
        rows = "".join(
            f'<Relationship Id="{rid}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
            f'Target="{escape(url, {chr(34): "&quot;"})}" TargetMode="External"/>'
            for rid, url in self.rels
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
            'Target="styles.xml"/>'
            f"{rows}</Relationships>"
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", CONTENT_TYPES)
            zf.writestr("_rels/.rels", ROOT_RELS)
            zf.writestr("docProps/core.xml", CORE)
            zf.writestr("word/styles.xml", styles_xml())
            zf.writestr("word/document.xml", self.document_xml())
            zf.writestr("word/_rels/document.xml.rels", self.rels_xml())


def build() -> DocBuilder:
    doc = DocBuilder()

    # --- Kopfdaten (optional, werden nicht in den Text uebernommen)
    doc.text("Betreff: WHF Impulse – Ausgabe Mai 2026")
    doc.text("Vorschautext: Neuer Markenauftritt, Filmwettbewerb und Termine aus der Region")
    doc.empty()

    # --- Intro: Ueberschrift 1 = Anrede
    doc.text("Liebe Leserinnen und Leser,", style="berschrift1")
    doc.rich([
        ("Die ersten Monate dieses Jahres waren für uns bei der WHF intensiv, "
         "arbeitsreich und voller Aufbruch. Mit unserem neuen Marketingteam und dem "
         "geschärften Markenauftritt haben wir wichtige Schritte gemacht, um ", False),
        ("Die Wirtschaftsregion Heilbronn-Franken", True),
        (" sichtbarer und wirksamer zu präsentieren.", False),
    ])
    doc.text("Herzliche Grüße")
    doc.text("Ihr Bernhard Feßler")

    # --- Abschnitt ohne Bereich: nur Rubrik (Ueberschrift 3)
    doc.text("Highlight", style="berschrift3")
    doc.link_para(
        "Frauen. Fachkräfte. Film ab!",
        "https://www.heilbronn-franken.com/angebote/kontaktstelle-frau-und-beruf/filmwettbewerb/",
        style="berschrift4",
    )
    doc.text(
        "Zum 10-jährigen Jubiläum der Kontaktstelle Frau und Beruf Heilbronn-Franken "
        "startet mit den „WHF Perspektiven“ ein besonderer Filmwettbewerb: Gesucht "
        "werden echte Geschichten von Frauen, Unternehmen und Engagierten aus der Region."
    )
    doc.text("Die besten Beiträge werden öffentlich präsentiert – beim Open-Air-Fahrradkino.")
    doc.link_para(
        "Mehr erfahren",
        "https://www.heilbronn-franken.com/angebote/kontaktstelle-frau-und-beruf/filmwettbewerb/",
    )

    # --- Bereich (Ueberschrift 2) + Rubrik (Ueberschrift 3)
    doc.text("Wirtschaftsregion aktiv", style="berschrift2")
    doc.text("Fachkräfte", style="berschrift3")

    doc.link_para(
        "Für Gründerinnen: Steuern im Blick behalten",
        "https://www.heilbronn-franken.com/event/infobites-steuern/",
        style="berschrift4",
    )
    doc.text(
        "Welche Steuern sind für Selbstständige relevant? Im Online-Kurs „Infobites "
        "Existenzgründung“ am 12. Mai von 10 bis 12 Uhr erhalten Gründerinnen einen "
        "kompakten Überblick zu Einkommensteuer, Umsatzsteuer und Gewerbesteuer."
    )
    doc.link_para("Jetzt anmelden", "https://www.heilbronn-franken.com/event/infobites-steuern/")

    doc.link_para(
        "Mentoring: Ein Gewinn für beide Seiten",
        "mailto:frauundberuf@heilbronn-franken.com",
        style="berschrift4",
    )
    doc.text("Fachkräftegewinnung braucht oft neue Wege. Unsere Mentorinnen berichten regelmäßig:")
    doc.bullet("Perspektivwechsel für das eigene unternehmerische Denken")
    doc.bullet("Zertifikate durch das begleitende Kompetenztraining")
    doc.link_para("Kontakt aufnehmen und Infos erhalten", "mailto:frauundberuf@heilbronn-franken.com")

    # --- Weitere Rubrik
    doc.text("Aktuelles", style="berschrift3")
    doc.link_para(
        "STADTRADELN 2026: Gemeinsam Kilometer sammeln",
        "https://www.stadtradeln.de/heilbronn",
        style="berschrift4",
    )
    doc.text(
        "Vom 19. Juni bis zum 9. Juli tritt Heilbronn wieder gemeinsam in die Pedale. "
        "Jeder gefahrene Kilometer zählt und kann bequem per App erfasst werden."
    )
    doc.link_para("Jetzt registrieren und mitradeln", "https://www.stadtradeln.de/heilbronn")

    return doc


def main(argv: list[str]) -> int:
    target = Path(argv[1]) if len(argv) > 1 else Path("beispiel/Newsletter-Vorlage.docx")
    build().save(target)
    print(f"Beispiel-Word-Datei erzeugt: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
