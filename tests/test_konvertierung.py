"""Tests fuer die Umwandlung Word -> Newsletter-HTML.

Aufruf:  python -m unittest discover -s tests
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from beispiel_erzeugen import DocBuilder, build  # noqa: E402
from word2newsletter.config import Config, load_config  # noqa: E402
from word2newsletter.docx_reader import read_docx  # noqa: E402
from word2newsletter.renderer import build_newsletter, render_document, resolve_mapping  # noqa: E402


def convert_builder(builder: DocBuilder, config: Config | None = None) -> tuple[str, list[str]]:
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "test.docx"
        builder.save(path)
        doc = read_docx(path)
    return render_document(doc, config or Config())


class BeispielTest(unittest.TestCase):
    """Prueft das mitgelieferte Beispieldokument gegen die Zielstruktur."""

    @classmethod
    def setUpClass(cls) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "beispiel.docx"
            build().save(path)
            cls.doc = read_docx(path)
        cls.html, cls.notes = render_document(cls.doc, Config())

    def test_kopfdaten_werden_gelesen(self) -> None:
        self.assertEqual(self.doc.meta["betreff"], "WHF Impulse – Ausgabe Mai 2026")
        self.assertIn("Filmwettbewerb", self.doc.meta["vorschautext"])

    def test_kopfdaten_erscheinen_nicht_im_text(self) -> None:
        self.assertNotIn("Betreff:", self.html)
        self.assertNotIn("Vorschautext:", self.html)

    def test_betreff_wird_titel(self) -> None:
        self.assertIn("<title>WHF Impulse – Ausgabe Mai 2026</title>", self.html)

    def test_vorschautext_als_preheader(self) -> None:
        self.assertIn("mso-hide:all", self.html)
        self.assertIn("Neuer Markenauftritt", self.html)

    def test_anrede_wird_h1(self) -> None:
        self.assertIn("<h1>Liebe Leserinnen und Leser,</h1>", self.html)

    def test_intro_umschliesst_einleitung(self) -> None:
        intro = self.html.split('<div class="intro">')[1].split("</div>")[0]
        self.assertIn("Bernhard Feßler", intro)
        self.assertNotIn('class="article"', intro)

    def test_fettschrift_bleibt_erhalten(self) -> None:
        self.assertIn("<strong>Die Wirtschaftsregion Heilbronn-Franken</strong>", self.html)

    def test_bereich_wird_h3_rubrik_wird_h2(self) -> None:
        self.assertIn("<h3>Wirtschaftsregion aktiv</h3>", self.html)
        self.assertIn("<h2>Fachkräfte</h2>", self.html)
        self.assertIn("<h2>Highlight</h2>", self.html)

    def test_bereich_und_rubrik_im_selben_abschnitt(self) -> None:
        abschnitt = self.html.split("<h3>Wirtschaftsregion aktiv</h3>")[1]
        self.assertTrue(abschnitt.lstrip().startswith("<h2>Fachkräfte</h2>"))

    def test_artikeltitel_ist_verlinkt(self) -> None:
        self.assertIn(
            '<a href="https://www.stadtradeln.de/heilbronn" target="_blank" '
            'rel="noopener" class="article-title">STADTRADELN 2026: Gemeinsam Kilometer sammeln</a>',
            self.html,
        )

    def test_reiner_linkabsatz_wird_cta(self) -> None:
        self.assertIn('class="cta">Jetzt anmelden →</a>', self.html)
        self.assertNotIn("<p><a", self.html)

    def test_mailto_ohne_target(self) -> None:
        self.assertIn('<a href="mailto:frauundberuf@heilbronn-franken.com" class="article-title">', self.html)

    def test_aufzaehlung_wird_liste(self) -> None:
        self.assertIn("<ul><li>Perspektivwechsel", self.html)

    def test_abschnitte_und_artikel_gezaehlt(self) -> None:
        self.assertEqual(self.html.count('<div class="section">'), 3)
        self.assertEqual(self.html.count('<div class="article">'), 4)

    def test_trenner_nur_vor_bereichen(self) -> None:
        # Nach dem Intro und vor "Wirtschaftsregion aktiv", sonst nicht.
        self.assertEqual(self.html.count('<div class="divider">'), 2)

    def test_kopfbild_und_fusszeile(self) -> None:
        self.assertIn('class="header-image"', self.html)
        self.assertIn("Amtsgericht Stuttgart HRB 106 758", self.html)
        self.assertIn("IMPRESSUM", self.html)
        self.assertIn("Charta der Vielfalt", self.html)

    def test_tracking_pixel_vorhanden(self) -> None:
        self.assertIn("[CLIENT_ID]", self.html)
        self.assertIn('height="1" width="1"', self.html)

    def test_keine_platzhalter_uebrig(self) -> None:
        self.assertNotIn("{{", self.html)
        self.assertNotIn("}}", self.html)

    def test_keine_hinweise(self) -> None:
        self.assertEqual(self.notes, [])


class MappingTest(unittest.TestCase):
    def test_auto_erkennt_vier_ebenen(self) -> None:
        doc = DocBuilder()
        doc.text("Anrede", style="berschrift1")
        doc.text("Bereich", style="berschrift2")
        doc.text("Rubrik", style="berschrift3")
        doc.text("Artikel", style="berschrift4")
        doc.text("Text")
        html, _ = convert_builder(doc)
        self.assertIn("<h1>Anrede</h1>", html)
        self.assertIn("<h3>Bereich</h3>", html)
        self.assertIn("<h2>Rubrik</h2>", html)
        self.assertIn('class="article-title">Artikel</span>', html)

    def test_auto_erkennt_drei_ebenen(self) -> None:
        """Ohne Ueberschrift 4 wird Ebene 3 zum Artikeltitel."""
        doc = DocBuilder()
        doc.text("Anrede", style="berschrift1")
        doc.text("Rubrik", style="berschrift2")
        doc.text("Artikel", style="berschrift3")
        doc.text("Text")
        html, _ = convert_builder(doc)
        self.assertIn("<h2>Rubrik</h2>", html)
        self.assertIn('class="article-title">Artikel</span>', html)

    def test_feste_zuordnung_aus_config(self) -> None:
        doc = DocBuilder()
        doc.text("Rubrik", style="berschrift1")
        doc.text("Artikel", style="berschrift2")
        doc.text("Text")
        config = Config().merged_with(
            {"content": {"word_mapping": {"1": "rubrik", "2": "artikel"}}}
        )
        html, _ = convert_builder(doc, config)
        self.assertIn("<h2>Rubrik</h2>", html)
        self.assertIn('class="article-title">Artikel</span>', html)

    def test_markierungen_im_text(self) -> None:
        """[Rubrik]/[Artikel] funktionieren ohne Word-Formatvorlagen."""
        doc = DocBuilder()
        doc.text("[Bereich] Wirtschaft")
        doc.text("[Rubrik] Termine")
        doc.text("[Artikel] Mein Titel")
        doc.text("Beschreibung")
        doc.text("[CTA] Jetzt anmelden | https://example.org/x")
        html, _ = convert_builder(doc)
        self.assertIn("<h3>Wirtschaft</h3>", html)
        self.assertIn("<h2>Termine</h2>", html)
        self.assertIn('class="article-title">Mein Titel</span>', html)
        self.assertIn('href="https://example.org/x" target="_blank" rel="noopener" class="cta">'
                      "Jetzt anmelden →</a>", html)

    def test_ohne_ueberschriften_alles_intro(self) -> None:
        doc = DocBuilder()
        doc.text("Nur ein Absatz")
        html, notes = convert_builder(doc)
        self.assertIn("<p>Nur ein Absatz</p>", html)
        self.assertTrue(any("Abschnitt" in n for n in notes))

    def test_resolve_mapping_ohne_ueberschriften(self) -> None:
        self.assertEqual(resolve_mapping([], Config()), {})


class InhaltTest(unittest.TestCase):
    def test_sonderzeichen_werden_maskiert(self) -> None:
        doc = DocBuilder()
        doc.text("Titel & <Test>", style="berschrift1")
        doc.text('Anführung "Test" & mehr')
        html, _ = convert_builder(doc)
        self.assertIn("<h1>Titel &amp; &lt;Test&gt;</h1>", html)
        self.assertIn("&amp; mehr", html)
        self.assertNotIn("<Test>", html)

    def test_zeilenumbruch_wird_br(self) -> None:
        doc = DocBuilder()
        doc.para(
            '<w:r><w:t>Herzliche Grüße</w:t></w:r><w:r><w:br/></w:r>'
            "<w:r><w:t>Ihr Team</w:t></w:r>"
        )
        html, _ = convert_builder(doc)
        self.assertIn("Herzliche Grüße<br />Ihr Team", html)

    def test_trennlinie_aus_drei_strichen(self) -> None:
        doc = DocBuilder()
        doc.text("Text")
        doc.text("---")
        doc.text("Weiter")
        html, _ = convert_builder(doc)
        self.assertIn('<div class="divider">&nbsp;</div>', html)

    def test_zitat_wird_blockquote(self) -> None:
        doc = DocBuilder()
        doc.body.append(
            '<w:p><w:pPr><w:pStyle w:val="Zitat"/></w:pPr>'
            "<w:r><w:t>Ein Zitat</w:t></w:r></w:p>"
        )
        html, _ = convert_builder(doc)
        self.assertIn("<blockquote>Ein Zitat</blockquote>", html)

    def test_hinweis_bei_artikel_ohne_link(self) -> None:
        doc = DocBuilder()
        doc.text("Rubrik", style="berschrift1")
        doc.text("Titel ohne Link", style="berschrift2")
        doc.text("Text")
        _, notes = convert_builder(doc)
        self.assertTrue(any("keinen Link" in n for n in notes))

    def test_link_target_konfigurierbar(self) -> None:
        doc = DocBuilder()
        doc.link_para("Link", "https://example.org")
        config = Config().merged_with({"content": {"link_target": ""}})
        html, _ = convert_builder(doc, config)
        self.assertIn('<a href="https://example.org" class="cta">', html)

    def test_cta_pfeil_abschaltbar(self) -> None:
        doc = DocBuilder()
        doc.link_para("Link", "https://example.org")
        config = Config().merged_with({"content": {"cta_arrow": ""}})
        html, _ = convert_builder(doc, config)
        self.assertIn(">Link</a>", html)

    def test_farben_aus_config(self) -> None:
        config = Config().merged_with({"colors": {"yellow": "#FF0000"}})
        doc = DocBuilder()
        doc.text("Test")
        html, _ = convert_builder(doc, config)
        self.assertIn("border-left: 4px solid #FF0000", html)
        self.assertNotIn("#FFFC00", html)


class RobustheitTest(unittest.TestCase):
    def test_fehlende_datei(self) -> None:
        with self.assertRaises(FileNotFoundError):
            read_docx("gibt-es-nicht.docx")

    def test_keine_docx_datei(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "kaputt.docx"
            path.write_text("kein zip", encoding="utf-8")
            with self.assertRaises(ValueError):
                read_docx(path)

    def test_config_ueberschreibt_nur_gesetzte_werte(self) -> None:
        config = Config().merged_with({"brand": {"title": "Neu"}})
        self.assertEqual(config.get("brand.title"), "Neu")
        self.assertEqual(config.get("brand.max_width"), 650)

    def test_mitgelieferte_config_ist_ladbar(self) -> None:
        config = load_config(ROOT / "config.json")
        self.assertEqual(config.get("template"), "whf_newsletter.html")

    def test_beispieldatei_liegt_im_repo(self) -> None:
        beispiel = ROOT / "beispiel" / "Newsletter-Vorlage.docx"
        self.assertTrue(beispiel.is_file(), "beispiel/Newsletter-Vorlage.docx fehlt")
        doc = read_docx(beispiel)
        newsletter = build_newsletter(doc, Config())
        self.assertEqual(len(newsletter.sections), 3)


if __name__ == "__main__":
    unittest.main()
