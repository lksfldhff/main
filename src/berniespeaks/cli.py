"""Kommandozeile fuer berniespeaks."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import korpus as korpus_modul, llm, merkmale, score
from .analyse import WURZEL, Stilprofil, analysiere, profil_suchen
from .uebersetzer import Uebersetzer

EIGENER_KORPUS = WURZEL / "korpus"
DEMOKORPUS = WURZEL / "beispiel" / "demokorpus.jsonl"


def _text_einlesen(wert: str) -> str:
    """Nimmt Text, einen Dateipfad oder '-' fuer die Standardeingabe."""

    if wert == "-":
        return sys.stdin.read()
    pfad = Path(wert)
    try:
        if pfad.is_file():
            if pfad.suffix.lower() == ".docx":
                return korpus_modul.docx_text(pfad)
            return pfad.read_text(encoding="utf-8")
    except OSError:
        pass
    return wert


def _profil_laden(pfad: str | None) -> Stilprofil:
    return Stilprofil.laden(pfad or profil_suchen())


def _korpus_suchen(profil_pfad: str | None = None) -> korpus_modul.Korpus | None:
    """Sucht Beitraege fuer die Beispielauswahl in der Anweisung.

    Zuerst das eigene Material in korpus/, sonst der mitgelieferte
    Demo-Korpus. Findet sich nichts, greift der Uebersetzer auf die im Profil
    hinterlegten Beispiele zurueck.
    """

    for ordner in (Path.cwd() / "korpus", EIGENER_KORPUS):
        if ordner.is_dir():
            try:
                gefunden = korpus_modul.lade(ordner)
                if len(gefunden):
                    return gefunden
            except (OSError, ValueError):
                pass
    if DEMOKORPUS.is_file():
        try:
            return korpus_modul.lade(DEMOKORPUS)
        except (OSError, ValueError):
            return None
    return None


# ------------------------------------------------------------------ lernen ----


def befehl_lernen(args) -> int:
    korpus = korpus_modul.lade(*args.quellen)
    if not len(korpus):
        print("Kein verwertbarer Text gefunden.", file=sys.stderr)
        print(korpus_modul.LINKEDIN_HINWEIS, file=sys.stderr)
        return 1

    profil = analysiere(korpus, name=args.name)
    # Gelernte Profile landen neben dem eigenen Material, nicht im Paket:
    # sie geben Formulierungen und Beispieltexte wieder her.
    ziel = Path(args.ausgabe) if args.ausgabe else (EIGENER_KORPUS / "stilprofil.json")
    profil.speichern(ziel)

    print(f"Gelernt aus {len(korpus)} Beitraegen ({profil.quelle['woerter']} Woerter).")
    print(f"Profil gespeichert: {ziel}")
    print()
    _profil_zusammenfassung(profil)

    if args.pruefen:
        print()
        _kalibrierung_zeigen(profil, korpus)
    return 0


def _profil_zusammenfassung(profil: Stilprofil) -> None:
    print("Gemessene Merkmale (Mittelwert ± Streuung je Beitrag):")
    for name in merkmale.NAMEN:
        titel, einheit = merkmale.beschriftung(name)
        print(f"  {titel:22} {profil.soll(name):8.2f} ± {profil.streuung(name):6.2f}   {einheit}")
    print()
    print("Haeufigste Emojis:  " + " ".join(e for e, _ in profil.emoji.get("haeufigste", [])[:16]))
    print("Typische Woerter:   " + ", ".join(profil.inhaltswoerter[:14]))
    print("Typische Wendungen: " + "; ".join(w["text"] for w in profil.lexikon.get("wendungen", [])[:6]))
    print(f"Personennamen erkannt und aus dem Profil entfernt: {profil.quelle.get('personennamen_erkannt', 0)}")


def _kalibrierung_zeigen(profil: Stilprofil, korpus: korpus_modul.Korpus) -> None:
    """Prueft die Trennschaerfe gegen fremde Texte."""

    fremd = _vergleichstexte()
    ergebnis = score.kalibrierung(profil, korpus.texte, fremd)
    print("Trennschaerfe des Profils:")
    print(f"  eigene Texte  {ergebnis['eigen']['mittel']:5.1f} von 100 (± {ergebnis['eigen']['streuung']:.1f})")
    print(f"  fremde Texte  {ergebnis['fremd']['mittel']:5.1f} von 100 (± {ergebnis['fremd']['streuung']:.1f})")
    print(f"  Abstand       {ergebnis['abstand']:5.1f} Punkte = {ergebnis['trennschaerfe']:.1f} Streuungen")
    if ergebnis["trennschaerfe"] < 2:
        print("  Achtung: zu wenig Abstand. Der Korpus ist vermutlich zu klein oder zu gemischt.")


def _vergleichstexte() -> list[str]:
    """Neutrale deutsche Texte als Gegenprobe."""

    return [
        "Die Sitzung des Ausschusses findet am kommenden Dienstag statt. Die Unterlagen "
        "werden vorab per E-Mail versandt. Um Rueckmeldung bis Freitag wird gebeten.",
        "Der Jahresabschluss wurde geprueft und ohne Einschraenkungen testiert. Die Bilanzsumme "
        "betraegt 4,2 Millionen Euro. Der Vorstand schlaegt vor, den Gewinn vorzutragen.",
        "Zur Anmeldung ist das Formular vollstaendig auszufuellen und zu unterschreiben. "
        "Unvollstaendige Antraege koennen nicht bearbeitet werden.",
        "Das Programm liest eine Word-Datei ein und erzeugt daraus fertiges HTML. "
        "Massgeblich sind die Formatvorlagen, nicht die Schriftgroesse.",
        "Wir bitten um Verstaendnis, dass der Termin verschoben werden muss. "
        "Ein neuer Vorschlag folgt in der kommenden Woche.",
        "Nach laengerer Diskussion einigte sich das Gremium auf einen Kompromiss. "
        "Die Umsetzung soll im ersten Quartal beginnen.",
    ]


# ------------------------------------------------------------- uebersetzen ----


def befehl_uebersetzen(args) -> int:
    profil = _profil_laden(args.profil)
    einstellung = llm.erkenne()
    uebersetzer = Uebersetzer(profil, llm.Klient(einstellung), _korpus_suchen(args.profil))
    eingabe = _text_einlesen(args.text)

    if args.richtung == "zu_klartext":
        ergebnis = uebersetzer.zu_klartext(eingabe, motor=args.motor)
    else:
        ergebnis = uebersetzer.zu_bernie(eingabe, staerke=args.staerke, motor=args.motor)

    if args.json:
        print(json.dumps(ergebnis.als_dict(), ensure_ascii=False, indent=2))
        return 0

    print(ergebnis.text)
    if args.ausfuehrlich:
        print()
        print(f"[{ergebnis.motor}, {ergebnis.runden} Runde(n)]", end="")
        if ergebnis.bewertung:
            print(f"  Note {ergebnis.bewertung.punkte:.0f}/100 -- {ergebnis.bewertung.urteil}")
            for abweichung in ergebnis.bewertung.maengel(4):
                print(f"  - {abweichung.satz()}")
        else:
            print()
    for hinweis in ergebnis.hinweise:
        print(f"Hinweis: {hinweis}", file=sys.stderr)
    return 0


# ----------------------------------------------------------------- pruefen ----


def befehl_pruefen(args) -> int:
    profil = _profil_laden(args.profil)
    text = _text_einlesen(args.text)
    ergebnis = score.bewerte(text, profil)

    if args.json:
        print(json.dumps(ergebnis.als_dict(), ensure_ascii=False, indent=2))
        return 0

    print(f"Note {ergebnis.punkte:.1f} von 100 -- {ergebnis.urteil}")
    print(f"  Form {ergebnis.formpunkte:.1f} | Wortschatz {ergebnis.wortschatzpunkte:.1f}")
    print()
    for abweichung in sorted(ergebnis.abweichungen, key=lambda a: a.verlust, reverse=True):
        titel, einheit = merkmale.beschriftung(abweichung.merkmal)
        zeichen = "ok" if abweichung.richtung == "passt" else abweichung.richtung
        print(f"  {titel:22} {abweichung.ist:8.2f}  soll {abweichung.soll:7.2f}  {zeichen:9} ({einheit})")
    return 0


# ------------------------------------------------------------------ profil ----


def befehl_profil(args) -> int:
    profil = _profil_laden(args.profil)
    print(f"{profil.name} -- gelernt am {profil.erzeugt}")
    print(f"Quelle: {', '.join(Path(q).name for q in profil.quelle.get('dateien', []))}")
    print(f"{profil.quelle.get('posts', 0)} Beitraege, {profil.quelle.get('woerter', 0)} Woerter")
    print()
    _profil_zusammenfassung(profil)
    return 0


def befehl_anbieter(args) -> int:
    einstellung = llm.erkenne()
    print("Erkannte Einstellung:", einstellung.beschriftung if einstellung.vorhanden else "keine (Offline-Betrieb)")
    print()
    print("Bekannte Anbieter:")
    for eintrag in llm.uebersicht():
        haken = "bereit" if eintrag["bereit"] else "     -"
        umgebung = ", ".join(eintrag["umgebung"]) or "kein Schluessel noetig"
        print(f"  [{haken}] {eintrag['beschriftung']:44} {eintrag['modell']:38} {umgebung}")
    print()
    print("Einstellen ueber Umgebungsvariablen oder bernie.json:")
    print("  BERNIE_ANBIETER, BERNIE_MODELL, BERNIE_SCHLUESSEL, BERNIE_BASIS, BERNIE_AUFWAND")
    return 0


def befehl_web(args) -> int:
    from .web import starten

    return starten(port=args.port, profil_pfad=args.profil, oeffnen=not args.kein_browser)


# ------------------------------------------------------------------- Aufbau ----


def parser_bauen() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="berniespeaks",
        description="Lernt einen Schreibstil aus Textmaterial und uebersetzt Texte in diesen Stil.",
    )
    unter = parser.add_subparsers(dest="befehl")

    lernen = unter.add_parser("lernen", help="Stilprofil aus Quellen lernen")
    lernen.add_argument("quellen", nargs="+", help=".docx, .txt, .csv (LinkedIn-Export), .html, .jsonl oder Ordner")
    lernen.add_argument("-o", "--ausgabe", help="Zieldatei des Profils")
    lernen.add_argument("--name", default="Stilprofil", help="Name des Profils")
    lernen.add_argument("--pruefen", action="store_true", help="Trennschaerfe gegen fremde Texte messen")
    lernen.set_defaults(funktion=befehl_lernen)

    ueber = unter.add_parser("uebersetzen", help="Text in den gelernten Stil bringen")
    ueber.add_argument("text", help="Text, Dateipfad oder '-' fuer Standardeingabe")
    ueber.add_argument("-r", "--richtung", choices=("zu_bernie", "zu_klartext"), default="zu_bernie")
    ueber.add_argument("-m", "--motor", choices=("auto", "offline", "modell"), default="auto")
    ueber.add_argument("-s", "--staerke", type=float, default=1.0, help="0.5 = zurueckhaltend, 1.5 = uebertrieben")
    ueber.add_argument("-p", "--profil", help="anderes Stilprofil")
    ueber.add_argument("-v", "--ausfuehrlich", action="store_true", help="Note und Abweichungen mit ausgeben")
    ueber.add_argument("--json", action="store_true")
    ueber.set_defaults(funktion=befehl_uebersetzen)

    klartext = unter.add_parser("klartext", help="Kurzform fuer 'uebersetzen -r zu_klartext'")
    klartext.add_argument("text")
    klartext.add_argument("-m", "--motor", choices=("auto", "offline", "modell"), default="auto")
    klartext.add_argument("-p", "--profil")
    klartext.add_argument("-v", "--ausfuehrlich", action="store_true")
    klartext.add_argument("--json", action="store_true")
    klartext.set_defaults(funktion=befehl_uebersetzen, richtung="zu_klartext", staerke=1.0)

    pruefen = unter.add_parser("pruefen", help="Wie nah liegt ein Text am Profil?")
    pruefen.add_argument("text", help="Text, Dateipfad oder '-'")
    pruefen.add_argument("-p", "--profil")
    pruefen.add_argument("--json", action="store_true")
    pruefen.set_defaults(funktion=befehl_pruefen)

    profil = unter.add_parser("profil", help="Gelerntes Profil anzeigen")
    profil.add_argument("-p", "--profil")
    profil.set_defaults(funktion=befehl_profil)

    anbieter = unter.add_parser("anbieter", help="Verfuegbare Sprachmodelle anzeigen")
    anbieter.set_defaults(funktion=befehl_anbieter)

    web = unter.add_parser("web", help="Oberflaeche im Browser starten")
    web.add_argument("--port", type=int, default=8765)
    web.add_argument("-p", "--profil")
    web.add_argument("--kein-browser", action="store_true")
    web.set_defaults(funktion=befehl_web)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = parser_bauen()
    args = parser.parse_args(argv)
    if not getattr(args, "funktion", None):
        parser.print_help()
        return 0
    try:
        return args.funktion(args)
    except FileNotFoundError as fehler:
        print(str(fehler), file=sys.stderr)
        return 1
    except BrokenPipeError:  # z. B. Ausgabe in "| head"
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
