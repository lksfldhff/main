"""Tests fuer die Stilerkennung und den Uebersetzer.

Aufruf:  python -m unittest discover -s tests
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tools"))

from berniespeaks import analyse, inhalt, korpus, llm, merkmale, score, text  # noqa: E402
from berniespeaks.cli import main as cli_main  # noqa: E402
from berniespeaks.uebersetzer import Uebersetzer  # noqa: E402

# Geprueft wird gegen den mitgelieferten Demo-Korpus aus erfundenen Beitraegen.
# Echtes Material liegt in korpus/ und ist bewusst nicht im Repository.
KORPUSDATEI = ROOT / "beispiel" / "demokorpus.jsonl"
PROFILDATEI = ROOT / "src" / "berniespeaks" / "daten" / "stilprofil.json"

NEUTRAL = (
    "Die Sitzung des Ausschusses findet am kommenden Dienstag statt. Die Unterlagen werden "
    "vorab per E-Mail versandt. Um Rueckmeldung bis Freitag wird gebeten. Der Vorsitzende "
    "bittet darum, die Tagesordnung vorher zu lesen."
)


class TestTextbausteine(unittest.TestCase):
    def test_emoji_mit_mehreren_codepoints_zaehlt_einmal(self):
        # Hautfarbe, Zero-Width-Joiner und Variantenselektor gehoeren zusammen.
        self.assertEqual(text.emojis("👩🏻 👩‍🦰 ☀️ 🇩🇪 1️⃣"), ["👩🏻", "👩‍🦰", "☀️", "🇩🇪", "1️⃣"])

    def test_emoji_laeufe_werden_gruppiert(self):
        laeufe = text.emoji_laeufe("Los 🚀🚀🚀 jetzt 🤩")
        self.assertEqual([len(lauf) for lauf in laeufe], [3, 1])

    def test_pfeil_im_fliesstext_ist_kein_emoji(self):
        self.assertEqual(text.emojis("A → B"), [])
        self.assertEqual(text.emojis("➡️ Punkt"), ["➡️"])

    def test_woerter_ohne_emojis_und_hashtags(self):
        self.assertEqual(text.woerter("Danke 🚀 #bettertogether Leute"), ["Danke", "Leute"])

    def test_hashtag_praefix_aus_linkedin_export(self):
        self.assertEqual(text.hashtags(text.normalisieren("Hashtag#heimat")), ["#heimat"])

    def test_private_zeichen_werden_entfernt(self):
        self.assertEqual(text.normalisieren("AB"), "AB")

    def test_ordnungszahl_trennt_keinen_satz(self):
        self.assertEqual(len(text.saetze("Wir treffen uns am 12. September in Heilbronn.")), 1)

    def test_abkuerzung_trennt_keinen_satz(self):
        self.assertEqual(len(text.saetze("Prof. Dr. Meier kommt auch.")), 1)

    def test_zeilenumbruch_ist_satzgrenze(self):
        self.assertEqual(len(text.saetze("Erste Zeile\nZweite Zeile")), 2)

    def test_versal_und_dehnung(self):
        self.assertTrue(text.ist_versalwort("KRASS"))
        self.assertFalse(text.ist_versalwort("A"))
        self.assertTrue(text.ist_gedehnt("soooo"))
        self.assertFalse(text.ist_gedehnt("Schnee"))


class TestMerkmale(unittest.TestCase):
    def test_emoji_dichte_wird_je_100_woerter_gerechnet(self):
        gemessen = merkmale.messen("eins zwei drei vier 🚀")
        self.assertAlmostEqual(gemessen["emoji_je_100_woerter"], 25.0)

    def test_merkmale_sind_laengenunabhaengig(self):
        einzeln = "Wir schaffen das 🚀 gemeinsam."
        gemessen_kurz = merkmale.messen(einzeln)
        gemessen_lang = merkmale.messen("\n\n".join([einzeln] * 5))
        self.assertAlmostEqual(
            gemessen_kurz["emoji_je_100_woerter"], gemessen_lang["emoji_je_100_woerter"], places=6
        )

    def test_leerer_text_ergibt_nullen_statt_fehler(self):
        gemessen = merkmale.messen("")
        self.assertEqual(set(gemessen), set(merkmale.NAMEN))
        self.assertEqual(gemessen["emoji_je_100_woerter"], 0.0)

    def test_versalanteil(self):
        gemessen = merkmale.messen("Das war KRASS gut")
        self.assertAlmostEqual(gemessen["versal_wortanteil"], 0.25)

    def test_verteilung_liefert_streuung(self):
        v = merkmale.verteilung([1.0, 3.0])
        self.assertEqual(v["mittel"], 2.0)
        self.assertEqual(v["streuung"], 1.0)


class TestKorpus(unittest.TestCase):
    def test_leerzeilen_trennen_beitraege(self):
        roh = ("Erster Beitrag mit genuegend Zeichen, damit er die Mindestlaenge erreicht.\n\n"
               "Zweiter Beitrag, ebenfalls lang genug fuer die Mindestlaenge der Erkennung.")
        self.assertEqual(len(korpus.posts_aus_text(roh)), 2)

    def test_trennzeile_hat_vorrang(self):
        roh = ("Erster Beitrag mit Leerzeile drin.\n\nGehoert noch dazu und ist lang genug dafuer.\n"
               "---\nZweiter Beitrag, ebenfalls lang genug fuer die Mindestlaenge der Erkennung.")
        self.assertEqual(len(korpus.posts_aus_text(roh)), 2)

    def test_linkedin_export_csv(self):
        with tempfile.TemporaryDirectory() as ordner:
            pfad = Path(ordner) / "Shares.csv"
            pfad.write_text(
                'Date,ShareLink,ShareCommentary,Visibility\n'
                '2026-01-01,http://x,"Ein Beitrag aus dem Datenexport, der lang genug ist, um die Mindestlaenge sicher zu erreichen 🚀",MEMBER_NETWORK\n',
                encoding="utf-8",
            )
            geladen = korpus.lade(pfad)
        self.assertEqual(len(geladen), 1)
        self.assertIn("🚀", geladen.posts[0].text)

    def test_doppelte_beitraege_werden_entfernt(self):
        with tempfile.TemporaryDirectory() as ordner:
            gleich = "Derselbe Beitrag, in jedem Fall lang genug fuer die Mindestlaenge der Erkennung."
            (Path(ordner) / "a.txt").write_text(gleich, encoding="utf-8")
            (Path(ordner) / "b.txt").write_text(gleich, encoding="utf-8")
            self.assertEqual(len(korpus.lade(Path(ordner))), 1)

    def test_docx_wird_zu_zeilen(self):
        from beispiel_erzeugen import DocBuilder

        bauer = DocBuilder()
        bauer.para("Erste Zeile mit genuegend Zeichen fuer die Mindestlaenge der Erkennung.")
        bauer.para("Zweite Zeile, ebenfalls lang genug fuer die Mindestlaenge der Erkennung.")
        with tempfile.TemporaryDirectory() as ordner:
            pfad = Path(ordner) / "probe.docx"
            bauer.save(pfad)
            roh = korpus.docx_text(pfad)
            geladen = korpus.lade(pfad)
        self.assertIn("Erste Zeile", roh)
        self.assertIn("\n", roh)
        self.assertGreaterEqual(len(geladen), 1)


class TestAnalyse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hg = analyse.lade_hintergrund()

    def test_hintergrund_ist_vorhanden(self):
        self.assertGreater(len(self.hg.zipf), 10000)
        self.assertGreater(self.hg.zipf["und"], self.hg.zipf.get("hufeisen", 0))

    def test_keyness_hebt_das_ungewoehnliche_wort(self):
        # Gleich oft im Korpus, aber "Hufeisen" ist im Deutschen viel seltener
        # als "haben" -- also ist es das auffaelligere Wort.
        from collections import Counter

        haeufigkeiten = Counter({"hufeisen": 6, "haben": 6, "haus": 6})
        werte = dict((w, z) for w, _, z in analyse.keyness(haeufigkeiten, self.hg))
        self.assertGreater(werte["hufeisen"], werte["haben"])
        self.assertGreater(werte["haus"], werte["haben"])

    def test_keyness_ignoriert_einzeltreffer(self):
        from collections import Counter

        self.assertEqual(analyse.keyness(Counter({"einmalig": 1}), self.hg), [])

    def test_personenname_gegen_substantiv(self):
        texte = [
            "Liebe Iris Rosenbauer, das war ein schoener Abend.",
            "Iris Rosenbauer hat den Abend eroeffnet.",
            "Es war mir eine Ehre. Die Ehre gebuehrt dem Team.",
        ]
        namen = analyse.personennamen(texte, self.hg)
        self.assertIn("Rosenbauer", namen)
        self.assertNotIn("Ehre", namen)

    def test_anonymisieren_ersetzt_nur_namen(self):
        ergebnis = analyse.anonymisieren("Danke, liebe Iris Rosenbauer!", {"Iris", "Rosenbauer"})
        self.assertNotIn("Rosenbauer", ergebnis)
        self.assertIn("Danke", ergebnis)

    def test_profil_ueberlebt_speichern_und_laden(self):
        profil = analyse.Stilprofil.laden(PROFILDATEI)
        with tempfile.TemporaryDirectory() as ordner:
            ziel = Path(ordner) / "p.json"
            profil.speichern(ziel)
            zurueck = analyse.Stilprofil.laden(ziel)
        self.assertEqual(zurueck.name, profil.name)
        self.assertAlmostEqual(zurueck.soll("emoji_je_100_woerter"), profil.soll("emoji_je_100_woerter"))

    def test_profil_enthaelt_keine_erkannten_namen(self):
        profil = analyse.analysiere(korpus.lade(KORPUSDATEI), name="Test")
        korpustexte = korpus.lade(KORPUSDATEI).texte
        namen = analyse.personennamen(korpustexte, self.hg)
        gespeichert = " ".join(profil.inhaltswoerter + [w["text"] for w in profil.lexikon["wendungen"]])
        for name in namen:
            self.assertNotIn(name.lower(), gespeichert.lower().split())

    def test_analyse_erzeugt_alle_bausteine(self):
        profil = analyse.analysiere(korpus.lade(KORPUSDATEI), name="Test")
        self.assertEqual(set(profil.merkmale), set(merkmale.NAMEN))
        for schluessel in ("schluesselwoerter", "inhaltswoerter", "wendungen", "oeffner", "schluesser"):
            self.assertIn(schluessel, profil.lexikon)
        self.assertTrue(profil.emoji["haeufigste"])
        self.assertTrue(profil.beispiele)

    def test_leerer_korpus_meldet_fehler(self):
        with self.assertRaises(ValueError):
            analyse.analysiere(korpus.Korpus())


class TestProfilsuche(unittest.TestCase):
    def test_ohne_angabe_wird_ein_profil_gefunden(self):
        profil = analyse.Stilprofil.laden()
        self.assertTrue(profil.merkmale)
        self.assertTrue(profil.name)

    def test_eigenes_profil_hat_vorrang(self):
        gefunden = analyse.profil_suchen()
        eigenes = ROOT / "korpus" / "stilprofil.json"
        if eigenes.is_file():
            self.assertEqual(gefunden, eigenes)
        else:
            self.assertEqual(gefunden, analyse.DEMOPROFIL)


class TestBewertung(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profil = analyse.Stilprofil.laden(PROFILDATEI)
        cls.korpus = korpus.lade(KORPUSDATEI)

    def test_eigene_texte_liegen_deutlich_ueber_fremden(self):
        ergebnis = score.kalibrierung(self.profil, self.korpus.texte, [NEUTRAL] * 3)
        self.assertGreater(ergebnis["eigen"]["mittel"], ergebnis["fremd"]["mittel"] + 20)
        self.assertGreater(ergebnis["trennschaerfe"], 2.0)

    def test_neutraler_text_faellt_durch(self):
        bewertung = score.bewerte(NEUTRAL, self.profil)
        self.assertLess(bewertung.punkte, 55)
        self.assertEqual(bewertung.urteil, "klingt nach jemand anderem")

    def test_maengel_nennen_die_richtige_richtung(self):
        bewertung = score.bewerte(NEUTRAL, self.profil)
        emoji = next(a for a in bewertung.abweichungen if a.merkmal == "emoji_je_100_woerter")
        self.assertEqual(emoji.richtung, "zu wenig")

    def test_auftrag_ist_lesbar(self):
        auftrag = score.bewerte(NEUTRAL, self.profil).auftrag(3)
        self.assertIn("Emoji-Dichte", auftrag)
        self.assertLessEqual(len(auftrag.splitlines()), 3)

    def test_bewertung_als_dict_ist_serialisierbar(self):
        json.dumps(score.bewerte(NEUTRAL, self.profil).als_dict())


class TestInhalt(unittest.TestCase):
    def test_datum_und_uhrzeit(self):
        gefunden = inhalt.erkenne("Der Termin am 5. Juli um 10:00 Uhr steht.")
        self.assertTrue(any("5. Juli" in d for d in gefunden.daten))
        self.assertTrue(any("10:00" in d for d in gefunden.daten))

    def test_anliegen_absage(self):
        self.assertEqual(inhalt.erkenne("Ich kann leider nicht kommen.").anliegen, "absage")

    def test_anliegen_einladung(self):
        self.assertEqual(inhalt.erkenne("Wir laden Sie herzlich ein zur Veranstaltung.").anliegen, "einladung")

    def test_namen_werden_als_pflichtangabe_gefuehrt(self):
        gefunden = inhalt.erkenne("Bitte melde dich bei Sabine Zappold wegen der Zahlen.")
        self.assertIn("Sabine Zappold", gefunden.pflichtangaben())

    def test_kernsaetze_sind_begrenzt(self):
        lang = " ".join(f"Das ist Satz Nummer {i} mit etwas Fuellmaterial." for i in range(20))
        self.assertLessEqual(len(inhalt.erkenne(lang).kernsaetze), 3)


class TestUebersetzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profil = analyse.Stilprofil.laden(PROFILDATEI)
        cls.korpus = korpus.lade(KORPUSDATEI)
        cls.uebersetzer = Uebersetzer(cls.profil, korpus=cls.korpus)

    def test_offline_ist_reproduzierbar(self):
        eingabe = "Wir treffen uns am Montag zur Abstimmung ueber das neue Vorhaben im grossen Saal."
        erst = self.uebersetzer.zu_bernie(eingabe, motor="offline").text
        zweit = self.uebersetzer.zu_bernie(eingabe, motor="offline").text
        self.assertEqual(erst, zweit)

    def test_offline_bringt_den_text_naeher_an_das_profil(self):
        eingabe = (
            "Wir laden alle Mitarbeitenden zum Sommerfest am 5. Juli ein. Anmeldung bis 20. Juni. "
            "Es gibt Essen, Musik und eine Fuehrung durch die neue Halle."
        )
        vorher = score.bewerte(eingabe, self.profil).punkte
        nachher = self.uebersetzer.zu_bernie(eingabe, motor="offline").bewertung.punkte
        self.assertGreater(nachher, vorher + 10)

    def test_staerke_erhoeht_die_emoji_dichte(self):
        eingabe = "Wir treffen uns am Montag zur Abstimmung ueber das neue Vorhaben im grossen Saal."
        wenig = merkmale.messen(self.uebersetzer.zu_bernie(eingabe, 0.5, "offline").text)
        viel = merkmale.messen(self.uebersetzer.zu_bernie(eingabe, 1.5, "offline").text)
        self.assertGreater(viel["emoji_je_100_woerter"], wenig["emoji_je_100_woerter"])

    def test_offline_erhaelt_datum_und_zahlen(self):
        ergebnis = self.uebersetzer.zu_bernie("Anmeldung bis 20. Juni, es kommen 250 Gaeste.", motor="offline")
        self.assertIn("20. Juni", ergebnis.text)
        self.assertIn("250", ergebnis.text)

    def test_anweisung_kommt_aus_dem_profil(self):
        anweisung = self.uebersetzer.anweisung_stil("Ein Testtext ueber ein Sommerfest.")
        self.assertIn(f"{self.profil.soll('emoji_je_100_woerter'):.0f}", anweisung)
        self.assertIn(self.profil.emoji["haeufigste"][0][0], anweisung)
        self.assertIn(self.profil.inhaltswoerter[0], anweisung)

    def test_beispiele_werden_nach_aehnlichkeit_gewaehlt(self):
        beispiele = self.uebersetzer.beispiele_waehlen("Geraete, Rollcontainer und IT-Sicherheit im Buero", 2)
        self.assertEqual(len(beispiele), 2)
        self.assertTrue(any("IT-Sicherheit" in b for b in beispiele))

    def test_stil_abziehen_entfernt_schmuck(self):
        entkleidet = self.uebersetzer.stil_abziehen("Das war KRASS gut 🚀🚀🚀 #bettertogether")
        self.assertNotIn("🚀", entkleidet)
        self.assertNotIn("#bettertogether", entkleidet)
        self.assertNotIn("KRASS", entkleidet)

    def test_klartext_offline_nennt_die_kernaussage(self):
        ergebnis = self.uebersetzer.zu_klartext(self.korpus.posts[0].text, motor="offline")
        self.assertGreater(len(ergebnis.text), 20)
        self.assertEqual(text.emojis(ergebnis.text), [])

    def test_leere_eingabe_wird_abgefangen(self):
        ergebnis = self.uebersetzer.zu_bernie("   ", motor="offline")
        self.assertEqual(ergebnis.text, "")
        self.assertTrue(ergebnis.hinweise)

    def test_ohne_modell_faellt_der_automatikmodus_auf_offline(self):
        ohne = Uebersetzer(self.profil, llm.Klient(llm.Einstellung()), self.korpus)
        ergebnis = ohne.zu_bernie("Ein kurzer Text ueber das Sommerfest.", motor="auto")
        self.assertEqual(ergebnis.motor, "offline")
        self.assertTrue(ergebnis.hinweise)


class TestAnbindung(unittest.TestCase):
    def test_umgebung_wird_gelesen(self):
        import os

        alt = {k: os.environ.get(k) for k in ("BERNIE_ANBIETER", "BERNIE_MODELL", "BERNIE_SCHLUESSEL")}
        os.environ.update({"BERNIE_ANBIETER": "groq", "BERNIE_MODELL": "x", "BERNIE_SCHLUESSEL": "y"})
        try:
            einstellung = llm.erkenne()
            self.assertEqual(einstellung.anbieter, "groq")
            self.assertEqual(einstellung.format, "openai")
            self.assertTrue(llm.Klient(einstellung).bereit)
        finally:
            for schluessel, wert in alt.items():
                if wert is None:
                    os.environ.pop(schluessel, None)
                else:
                    os.environ[schluessel] = wert

    def test_ohne_einstellung_kein_aufruf(self):
        with self.assertRaises(llm.LLMFehler):
            llm.Klient(llm.Einstellung()).frage("system", "text")

    def test_antwort_auslesen_beide_formate(self):
        self.assertEqual(llm.Klient._auslesen({"content": [{"type": "text", "text": "hallo"}]}), "hallo")
        self.assertEqual(llm.Klient._auslesen({"choices": [{"message": {"content": "hallo"}}]}), "hallo")


class TestKommandozeile(unittest.TestCase):
    def test_pruefen_liefert_json(self):
        import io
        import contextlib

        puffer = io.StringIO()
        with contextlib.redirect_stdout(puffer):
            rueckgabe = cli_main(["pruefen", NEUTRAL, "--json"])
        self.assertEqual(rueckgabe, 0)
        self.assertIn("punkte", json.loads(puffer.getvalue()))

    def test_uebersetzen_offline_ohne_fehler(self):
        import io
        import contextlib

        puffer = io.StringIO()
        with contextlib.redirect_stdout(puffer):
            rueckgabe = cli_main(["uebersetzen", "Wir sehen uns am Montag.", "-m", "offline"])
        self.assertEqual(rueckgabe, 0)
        self.assertTrue(puffer.getvalue().strip())


if __name__ == "__main__":
    unittest.main()
