"""Der Erkennungsalgorithmus: aus Textmaterial wird ein messbares Stilprofil.

Vier Verfahren greifen ineinander:

1. **Merkmalsmessung** (merkmale.py) je Beitrag -- daraus Mittelwert und
   Streuung fuer jedes der Merkmale. Das ergibt die Soll-Werte, an denen sich
   spaeter jeder erzeugte Text messen lassen muss.

2. **Keyness** -- welche Woerter kommen *auffaellig* oft vor? Verglichen wird
   gegen deutsche Normalhaeufigkeiten (daten/hintergrund_de.json.gz). Gerechnet
   wird mit dem Log-Odds-Ratio mit informativem Dirichlet-Prior nach Monroe,
   Colaresi und Quinn (2008) -- das ist stabiler als blosses Zaehlen: seltene
   Woerter mit einem einzigen Treffer schiessen nicht nach oben, haeufige
   Funktionswoerter verschwinden nicht.

3. **Mustergewinnung** -- Emoji-Ketten, Aufzaehlungszeichen, Hashtags,
   Eroeffnungs- und Schlusszeilen, wiederkehrende Wendungen und
   Organisationsnamen werden direkt aus dem Material gezogen. Nichts davon
   steht im Programmcode; alles kommt aus dem Korpus.

4. **Namensschutz** -- erkannte Personennamen werden aus allen gespeicherten
   Listen entfernt. Das Profil haelt nur ihre Anzahl fest. So laesst sich das
   Profil weitergeben, ohne persoenliche Daten Dritter mitzuschleppen, und der
   Generator kann keine echten Namen in erfundene Texte streuen.
"""

from __future__ import annotations

import gzip
import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from . import merkmale, text as t
from .korpus import Korpus

DATEN = Path(__file__).resolve().parent / "daten"
WURZEL = Path(__file__).resolve().parents[2]
HINTERGRUND_DATEI = DATEN / "hintergrund_de.json.gz"
# Das mitgelieferte Demo-Profil. Es stammt aus erfundenen Beitraegen
# (beispiel/demokorpus.jsonl) und enthaelt keine personenbezogenen Daten.
DEMOPROFIL = DATEN / "stilprofil.json"
# Ein selbst gelerntes Profil liegt neben dem eigenen Material und bleibt dort
# -- der Ordner korpus/ ist bewusst nicht im Repository.
EIGENES_PROFIL = "stilprofil.json"


def profil_suchen() -> Path:
    """Eigenes Profil bevorzugen, sonst das mitgelieferte Demo-Profil."""

    for ordner in (Path.cwd() / "korpus", WURZEL / "korpus"):
        kandidat = ordner / EIGENES_PROFIL
        if kandidat.is_file():
            return kandidat
    return DEMOPROFIL

PROFIL_VERSION = 1

# Zipf-Wert fuer Woerter, die in der Referenz gar nicht vorkommen. 1.2
# entspricht "etwa 16 Treffer je Milliarde Woerter" -- selten genug, dass
# Eigenschoepfungen wie "Wertschaetzungsoffensive" auffallen duerfen.
UNBEKANNT_ZIPF = 1.2
# Staerke des Priors. Je groesser, desto mehr Belege braucht ein Wort, um als
# auffaellig zu gelten.
PRIOR = 500.0
# Ab wie vielen Treffern ein Wort ueberhaupt in die Auswertung kommt.
MINDESTTREFFER = 2
# Ab dieser Normalhaeufigkeit gilt ein Wort als Alltagswort ("und", "haben").
ALLTAG_AB_ZIPF = 4.8
# Auf diese Groesse wird der deutsche Referenzkorpus hochgerechnet (Woerter).
REFERENZGROESSE = 1_000_000.0

ORGWORT = re.compile(
    r"^(?:GmbH|AG|KG|SE|mbH|e\.?\s?V\.?|eG|Verband|Verbands|Bundesverband|Landesverband|"
    r"Ministerium|Hochschule|Universitaet|Universität|Stiftung|IHK|HWK|Gruppe|Institut|"
    r"Verein|Kammer|Netzwerk|Handelsverband|Wirtschaftsrat|Gesellschaft|Akademie|"
    r"Wirtschaftsregion|Kontaktstelle|Initiative|Club|Konzern|Werk|Werke)$",
    re.IGNORECASE,
)
NAMENSKONTEXT = re.compile(
    r"^(?:liebe|lieber|liebes|herr|herrn|frau|dr|prof|kollege|kollegin|kollegen|"
    r"präsident|praesident|präsidentin|geschäftsführer|geschäftsführerin|"
    r"ministerin|minister|oberbürgermeister)$",
    re.IGNORECASE,
)
# Begleiter, die vor einem deutschen Substantiv stehen -- aber nicht vor einem Namen.
BEGLEITER = frozenset(
    """der die das den dem des ein eine einen einem einer eines kein keine keinen keinem
    mein meine meinen meinem meiner unser unsere unseren unserem unserer euer eure
    dieser diese dieses diesem diesen jeder jede jedes viele alle im am zum zur beim vom
    ins ans aufs mehr weniger""".split()
)
UNBEKANNT_AB = 3.2
TOKEN = re.compile(r"[^\W\d_][\w'’-]*", re.UNICODE)


# ------------------------------------------------------------ Hintergrund ----


@dataclass
class Hintergrund:
    """Deutsche Normalhaeufigkeiten plus englische Wortliste."""

    zipf: dict[str, float] = field(default_factory=dict)
    englisch: frozenset[str] = frozenset()
    quelle: str = ""

    def wahrscheinlichkeit(self, wort: str) -> float:
        """Erwartete Auftretenswahrscheinlichkeit im normalen Deutsch."""

        return 10 ** (self.zipf.get(wort.lower(), UNBEKANNT_ZIPF) - 9)

    def bekannt(self, wort: str, ab: float = UNBEKANNT_AB) -> bool:
        return self.zipf.get(wort.lower(), 0.0) >= ab


_hintergrund_zwischenspeicher: Hintergrund | None = None


def lade_hintergrund(pfad: str | Path | None = None) -> Hintergrund:
    """Laedt die Referenzhaeufigkeiten (einmal je Programmlauf)."""

    global _hintergrund_zwischenspeicher
    if pfad is None and _hintergrund_zwischenspeicher is not None:
        return _hintergrund_zwischenspeicher

    ziel = Path(pfad) if pfad else HINTERGRUND_DATEI
    if not ziel.exists():
        leer = Hintergrund(quelle="fehlt -- python tools/hintergrund_erzeugen.py")
        if pfad is None:
            _hintergrund_zwischenspeicher = leer
        return leer

    oeffnen = gzip.open if ziel.suffix == ".gz" else open
    with oeffnen(ziel, "rt", encoding="utf-8") as fh:
        daten = json.load(fh)
    ergebnis = Hintergrund(
        zipf={k: float(v) for k, v in daten.get("zipf", {}).items()},
        englisch=frozenset(daten.get("englisch", [])),
        quelle=daten.get("quelle", ""),
    )
    if pfad is None:
        _hintergrund_zwischenspeicher = ergebnis
    return ergebnis


# ---------------------------------------------------------------- Keyness ----


def keyness(
    haeufigkeiten: Counter[str],
    hintergrund: Hintergrund,
    prior: float = PRIOR,
    mindesttreffer: int = MINDESTTREFFER,
    referenzgroesse: float = REFERENZGROESSE,
) -> list[tuple[str, int, float]]:
    """Log-Odds-Ratio mit informativem Dirichlet-Prior.

    Nach Monroe, Colaresi und Quinn (2008), "Fightin' Words". Verglichen wird
    der Korpus gegen einen Referenzkorpus aus normalem Deutsch: dessen
    Haeufigkeiten stehen als Zipf-Werte bereit und werden auf eine
    Referenzgroesse von einer Million Woertern hochgerechnet.

        y1 = Treffer im Korpus,            n1 = Korpusgroesse
        y2 = erwartete Treffer im Deutsch, n2 = Referenzgroesse
        a  = prior * p(Wort)                   -- glaettet seltene Woerter

        delta   = log( (y1+a) / (n1+prior-y1-a) ) - log( (y2+a) / (n2+prior-y2-a) )
        sigma^2 = 1/(y1+a) + 1/(y2+a)
        z       = delta / sigma

    Der z-Wert sagt: um wie viele Streuungen liegt dieses Wort ueber seinem
    normalen Vorkommen. Er straft Zufallstreffer ab (ein einziges seltenes
    Wort reisst die Liste nicht an sich) und laesst Allerweltswoerter nur
    dann hoch, wenn sie wirklich deutlich haeufiger sind.
    """

    gesamt = sum(haeufigkeiten.values())
    if not gesamt:
        return []

    ergebnis: list[tuple[str, int, float]] = []
    for wort, treffer in haeufigkeiten.items():
        if treffer < mindesttreffer:
            continue
        anteil = hintergrund.wahrscheinlichkeit(wort)
        a = max(prior * anteil, 1e-9)
        referenz = anteil * referenzgroesse
        delta = math.log((treffer + a) / max(gesamt + prior - treffer - a, 1e-9)) - math.log(
            (referenz + a) / max(referenzgroesse + prior - referenz - a, 1e-9)
        )
        sigma = math.sqrt(1.0 / (treffer + a) + 1.0 / (referenz + a))
        ergebnis.append((wort, treffer, delta / sigma if sigma else 0.0))

    ergebnis.sort(key=lambda e: e[2], reverse=True)
    return ergebnis


# ----------------------------------------------------------- Namensschutz ----


def personennamen(texte: list[str], hintergrund: Hintergrund) -> set[str]:
    """Findet Wortformen, die mit hoher Wahrscheinlichkeit Personennamen sind.

    Die Haeufigkeit allein hilft nicht weiter: "Sabine" (Zipf 4.1) und "Ehre"
    (Zipf 4.5) sind gleich gelaeufig. Entscheidend ist der Satzkontext, und
    zwar ueber alle Vorkommen im Korpus hinweg:

      * Vor einem deutschen Substantiv steht fast immer ein Begleiter
        ("die Ehre", "das Personal"). Vor einem Namen so gut wie nie.
      * Namen stehen paarweise (Vorname Nachname) oder hinter einer Anrede
        ("liebe Iris", "Herr Burger").

    Ein Wort gilt als Personenname, wenn es nie einen Begleiter vor sich hat
    und mindestens einmal in einem Namenskontext steht. Woerter, die
    unmittelbar an einem Organisationswort haengen, sind ausgenommen -- sie
    gehoeren zum Namen der Einrichtung.
    """

    begleiter = 0
    hinweis = 1
    zaehler: dict[str, list[int]] = {}

    def buchen(wort: str, feld: int) -> None:
        zaehler.setdefault(wort, [0, 0])[feld] += 1

    for roh in texte:
        for satz in t.saetze(t.normalisieren(roh)):
            marken = TOKEN.findall(t.ohne_emojis(satz))
            for i, wort in enumerate(marken):
                if not wort[:1].isupper() or len(wort) < 3 or ORGWORT.match(wort):
                    continue
                if wort.lower() in BEGLEITER:  # "Euer", "Unsere" am Satzanfang
                    continue
                # GROSSGESCHRIEBENES ist Betonung, kein Name; Woerter auf
                # -ung, -heit, -keit ... sind Ableitungen, keine Namen.
                if t.ist_versalwort(wort) or merkmale.NOMINALENDUNG.search(wort):
                    continue
                nachbarn = marken[max(0, i - 1):i] + marken[i + 1:i + 2]
                if any(ORGWORT.match(n) for n in nachbarn):
                    continue

                davor = marken[i - 1].rstrip(".") if i else ""
                danach = marken[i + 1] if i + 1 < len(marken) else ""

                if davor.lower() in BEGLEITER:
                    buchen(wort, begleiter)
                    continue
                if NAMENSKONTEXT.match(davor):
                    buchen(wort, hinweis)
                    continue
                paar = bool(danach[:1].isupper() and len(danach) > 2 and not ORGWORT.match(danach))
                vorher_paar = bool(davor[:1].isupper() and len(davor) > 2 and not ORGWORT.match(davor))
                if (paar or vorher_paar) and i > 0:
                    buchen(wort, hinweis)

    return {
        wort
        for wort, (mit_begleiter, mit_hinweis) in zaehler.items()
        if mit_begleiter == 0 and mit_hinweis > 0 and not hintergrund.bekannt(wort, 5.2)
    }


def organisationen(texte: list[str], grenze: int = 40) -> list[str]:
    """Zieht Organisations- und Verbandsnamen aus dem Material."""

    treffer: Counter[str] = Counter()
    verbinder = {"der", "die", "das", "des", "den", "und", "für", "fuer", "von", "im", "am", "in"}
    for roh in texte:
        for zeile in t.zeilen(t.normalisieren(roh)):
            marken = TOKEN.findall(t.ohne_emojis(zeile))
            for i, wort in enumerate(marken):
                if not ORGWORT.match(wort):
                    continue
                links = i
                while links > 0:
                    kandidat = marken[links - 1]
                    if kandidat[:1].isupper() or kandidat.lower() in verbinder:
                        links -= 1
                    else:
                        break
                rechts = i
                while rechts + 1 < len(marken):
                    kandidat = marken[rechts + 1]
                    if kandidat[:1].isupper() or kandidat.lower() in verbinder:
                        rechts += 1
                    else:
                        break
                teile = marken[links:rechts + 1]
                # Fuehrende Artikel gehoeren nicht zum Namen.
                while teile and teile[0].lower() in verbinder:
                    teile = teile[1:]
                name = " ".join(teile).strip()
                if 2 <= len(teile) <= 6 and sum(1 for m in teile if m[:1].isupper()) >= 2:
                    treffer[name] += 1
    return [name for name, _ in treffer.most_common(grenze)]


# ------------------------------------------------------------- Mustersuche ----


def wendungen(
    texte: list[str],
    namen: set[str],
    hintergrund: "Hintergrund",
    laengen: tuple[int, ...] = (3, 4, 5),
    mindesttreffer: int = 2,
    grenze: int = 60,
) -> list[dict]:
    """Wiederkehrende Wortfolgen -- der Klebstoff des Stils.

    Gesucht sind Formulierungen, nicht Inhalte. Deshalb fliegen Folgen raus,
    die einen Personennamen enthalten oder ueberwiegend aus Eigennamen
    bestehen ("whf die wirtschaftsregion heilbronn-franken" ist ein
    Firmenname, keine Wendung). Kuerzere Folgen, die vollstaendig in einer
    laengeren aufgehen, werden ebenfalls verworfen: sonst steht "es war mir"
    dreimal neben "es war mir eine Ehre".
    """

    kleine_namen = {n.lower() for n in namen}
    zaehler: Counter[tuple[str, ...]] = Counter()
    for roh in texte:
        for satz in t.saetze(t.normalisieren(roh)):
            marken = [w.lower() for w in t.woerter(satz)]
            if len(marken) < 3:
                continue
            for n in laengen:
                for folge in t.gleitfenster(marken, n):
                    if any(w in kleine_namen for w in folge):
                        continue
                    # Akronyme und Eigennamen ("whf", "vdu", "transformotive")
                    # fehlen in der deutschen Referenz voellig -- eine Wendung,
                    # die davon lebt, ist ein Name und keine Formulierung.
                    if any(hintergrund.zipf.get(w, 0.0) < 2.5 for w in folge):
                        continue
                    eigennamen = sum(1 for w in folge if not hintergrund.bekannt(w, 4.0))
                    if eigennamen * 2 > len(folge):
                        continue
                    zaehler[folge] += 1

    kandidaten = [(folge, n) for folge, n in zaehler.items() if n >= mindesttreffer]
    kandidaten.sort(key=lambda e: (len(e[0]), e[1]), reverse=True)

    behalten: list[tuple[tuple[str, ...], int]] = []
    for folge, n in kandidaten:
        text = " ".join(folge)
        if any(text in " ".join(gross) and n <= gn for gross, gn in behalten):
            continue
        behalten.append((folge, n))

    behalten.sort(key=lambda e: (e[1], len(e[0])), reverse=True)
    return [{"text": " ".join(folge), "n": n} for folge, n in behalten[:grenze]]


UNBRAUCHBAR = re.compile(r"https?://|www\.|@[\w.-]+|\S+@\S+\.\w+")


def _zeilen_saeubern(zeilen: list[str], namen: set[str], grenze: int) -> list[str]:
    """Behaelt nur Zeilen, die als Baustein wiederverwendbar sind.

    Raus fliegen Links, Adressen, @-Erwaehnungen und Zeilen, die nur aus
    Namen bestehen: als Eroeffnung oder Schluss eines neuen Textes waeren sie
    schlicht falsch.
    """

    ergebnis: list[str] = []
    gesehen: set[str] = set()
    for zeile in zeilen:
        zeile = zeile.strip()
        if len(zeile) < 4 or len(zeile) > 140:
            continue
        if UNBRAUCHBAR.search(zeile):
            continue
        if any(wort in namen for wort in t.woerter(zeile)):
            continue
        schluessel = re.sub(r"\W+", "", zeile.lower())
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        ergebnis.append(zeile)
        if len(ergebnis) >= grenze:
            break
    return ergebnis


def anonymisieren(roh: str, namen: set[str]) -> str:
    """Ersetzt erkannte Personennamen durch [Name].

    So lassen sich echte Beitraege als Stilbeispiele im Profil ablegen, ohne
    personenbezogene Daten Dritter mitzuschleppen -- und das Sprachmodell
    bekommt keine echten Namen vorgesetzt, die es in erfundene Texte
    uebernehmen koennte.
    """

    if not namen:
        return roh

    def ersetzen(treffer: re.Match) -> str:
        wort = treffer.group(0)
        return "[Name]" if wort in namen else wort

    ergebnis = TOKEN.sub(ersetzen, roh)
    # "[Name] [Name] [Name]" ist ein Name, kein Namensblock.
    return re.sub(r"(?:\[Name\][\s,]*){2,}", "[Name] ", ergebnis).strip()


def typische_beitraege(
    texte: list[str],
    verteilungen: dict[str, dict[str, float]],
    hintergrund: Hintergrund,
    anzahl: int = 6,
) -> list[str]:
    """Waehlt die Beitraege, die dem Durchschnitt des Korpus am naechsten kommen.

    Sie dienen als Stilbeispiele. Genommen wird nicht der laengste oder
    schrillste Beitrag, sondern der typischste: der mit dem geringsten
    Abstand zum Mittelwert ueber alle Merkmale.
    """

    bewertet: list[tuple[float, str]] = []
    for text in texte:
        gemessen = merkmale.messen(text, hintergrund.englisch)
        abstand = 0.0
        for name in merkmale.NAMEN:
            soll = verteilungen[name]["mittel"]
            breite = max(verteilungen[name]["streuung"], abs(soll) * 0.35, 0.02)
            abstand += ((gemessen[name] - soll) / breite) ** 2 * merkmale.gewicht(name)
        bewertet.append((abstand, text))
    bewertet.sort(key=lambda e: e[0])
    return [text for _, text in bewertet[:anzahl]]


def namensblock(zeile: str, hintergrund: Hintergrund) -> bool:
    """Erkennt Zeilen, die nur aus aneinandergereihten Namen bestehen."""

    marken = TOKEN.findall(t.ohne_emojis(zeile))
    if len(marken) < 3:
        return False
    gross = sum(1 for m in marken if m[:1].isupper())
    unbekannt = sum(1 for m in marken if not hintergrund.bekannt(m))
    return gross / len(marken) > 0.75 and unbekannt / len(marken) > 0.4


# -------------------------------------------------------------- Stilprofil ----


@dataclass
class Stilprofil:
    """Alles, was ueber einen Schreibstil gemessen wurde."""

    version: int = PROFIL_VERSION
    name: str = ""
    erzeugt: str = ""
    quelle: dict = field(default_factory=dict)
    merkmale: dict[str, dict[str, float]] = field(default_factory=dict)
    emoji: dict = field(default_factory=dict)
    struktur: dict = field(default_factory=dict)
    lexikon: dict = field(default_factory=dict)
    beispiele: list[str] = field(default_factory=list)

    def als_dict(self) -> dict:
        return {
            "version": self.version,
            "name": self.name,
            "erzeugt": self.erzeugt,
            "quelle": self.quelle,
            "merkmale": self.merkmale,
            "emoji": self.emoji,
            "struktur": self.struktur,
            "lexikon": self.lexikon,
            "beispiele": self.beispiele,
        }

    @classmethod
    def aus_dict(cls, daten: dict) -> "Stilprofil":
        return cls(
            version=int(daten.get("version", PROFIL_VERSION)),
            name=daten.get("name", ""),
            erzeugt=daten.get("erzeugt", ""),
            quelle=daten.get("quelle", {}),
            merkmale=daten.get("merkmale", {}),
            emoji=daten.get("emoji", {}),
            struktur=daten.get("struktur", {}),
            lexikon=daten.get("lexikon", {}),
            beispiele=daten.get("beispiele", []),
        )

    def speichern(self, pfad: str | Path) -> Path:
        pfad = Path(pfad)
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_text(json.dumps(self.als_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return pfad

    @classmethod
    def laden(cls, pfad: str | Path | None = None) -> "Stilprofil":
        ziel = Path(pfad) if pfad else profil_suchen()
        if not ziel.exists():
            raise FileNotFoundError(
                f"Kein Stilprofil unter {ziel}. Erst lernen:  python -m berniespeaks lernen <quelle>"
            )
        return cls.aus_dict(json.loads(ziel.read_text(encoding="utf-8")))

    def soll(self, name: str) -> float:
        return float(self.merkmale.get(name, {}).get("mittel", 0.0))

    def streuung(self, name: str) -> float:
        return float(self.merkmale.get(name, {}).get("streuung", 0.0))

    @property
    def schluesselwoerter(self) -> list[str]:
        return [e["wort"] for e in self.lexikon.get("schluesselwoerter", [])]

    @property
    def inhaltswoerter(self) -> list[str]:
        return [e["wort"] for e in self.lexikon.get("inhaltswoerter", [])]


def analysiere(korpus: Korpus, name: str = "", hintergrund: Hintergrund | None = None) -> Stilprofil:
    """Lernt aus einem Korpus ein vollstaendiges Stilprofil."""

    hg = hintergrund or lade_hintergrund()
    texte = [t.normalisieren(text) for text in korpus.texte]
    if not texte:
        raise ValueError("Der Korpus ist leer.")

    namen = personennamen(texte, hg)

    # 1. Merkmale je Beitrag -> Verteilungen
    verteilungen = merkmale.messreihe(texte, hg.englisch)

    # 2. Keyness
    haeufigkeiten: Counter[str] = Counter()
    for text in texte:
        for wort in t.woerter(text):
            if len(wort) < 3 or wort in namen:
                continue
            haeufigkeiten[wort.lower()] += 1
    bewertet = keyness(haeufigkeiten, hg)
    schluesselwoerter = [
        {"wort": wort, "n": n, "z": round(z, 2), "zipf": round(hg.zipf.get(wort, 0.0), 2)}
        for wort, n, z in bewertet[:120]
    ]
    # Alltagswoerter ("und", "wir") sind statistisch auffaellig, taugen aber
    # nicht als Wortschatz-Vorgabe. Darum zusaetzlich die inhaltstragenden
    # Woerter: alles, was im normalen Deutsch nicht ohnehin staendig vorkommt.
    inhaltswoerter = [
        eintrag for eintrag in (
            {"wort": wort, "n": n, "z": round(z, 2), "zipf": round(hg.zipf.get(wort, 0.0), 2)}
            for wort, n, z in bewertet
        )
        if eintrag["zipf"] < ALLTAG_AB_ZIPF
    ][:80]

    # 3. Muster
    alle_emojis: Counter[str] = Counter()
    ketten: Counter[str] = Counter()
    laufpositionen = {"zeilenanfang": 0, "satzende": 0, "innen": 0}
    lauflaengen: Counter[int] = Counter()
    aufzaehlungszeichen: Counter[str] = Counter()
    hashtags: Counter[str] = Counter()
    erste_zeilen: list[str] = []
    letzte_zeilen: list[str] = []
    namensblockzeilen = 0
    zeilen_gesamt = 0

    for text in texte:
        zeilen = t.zeilen(text)
        zeilen_gesamt += len(zeilen)
        if zeilen:
            erste_zeilen.append(zeilen[0])
            letzte_zeilen.append(zeilen[-1])
        for zeile in zeilen:
            if namensblock(zeile, hg):
                namensblockzeilen += 1
            treffer = t.EMOJI_LAUF.match(zeile)
            if treffer:
                aufzaehlungszeichen[t.emojis(treffer.group(0))[0]] += 1
        for lauf in t.emoji_laeufe(text):
            alle_emojis.update(lauf)
            lauflaengen[min(len(lauf), 6)] += 1
            if len(lauf) > 1:
                ketten["".join(lauf)] += 1
        for treffer in t.EMOJI_LAUF.finditer(text):
            davor = text[:treffer.start()].rstrip()
            danach = text[treffer.end():].lstrip()
            if not davor or davor.endswith("\n") or text[:treffer.start()].endswith("\n"):
                laufpositionen["zeilenanfang"] += 1
            elif not danach or danach.startswith("\n") or davor.endswith((".", "!", "?", "…")):
                laufpositionen["satzende"] += 1
            else:
                laufpositionen["innen"] += 1
        hashtags.update(t.hashtags(text))

    lauf_gesamt = max(sum(lauflaengen.values()), 1)
    positionen_gesamt = max(sum(laufpositionen.values()), 1)

    gefundene_wendungen = wendungen(texte, namen, hg)
    lexikon_woerter = [e["wort"] for e in inhaltswoerter]
    lexikon_wendungen = [w["text"] for w in gefundene_wendungen]
    treffer = merkmale.verteilung(
        [merkmale.lexikontreffer(text, lexikon_woerter, lexikon_wendungen) for text in texte]
    )

    profil = Stilprofil(
        name=name or "Stilprofil",
        erzeugt=date.today().isoformat(),
        quelle={
            "dateien": korpus.quellen,
            "posts": len(korpus),
            "woerter": sum(len(t.woerter(text)) for text in texte),
            "zeichen": sum(t.zeichen_ohne_leer(text) for text in texte),
            "personennamen_erkannt": len(namen),
            "hintergrund": hg.quelle,
        },
        merkmale=verteilungen,
        emoji={
            "haeufigste": [[e, n] for e, n in alle_emojis.most_common(40)],
            "vielfalt": len(alle_emojis),
            "ketten": [[k, n] for k, n in ketten.most_common(25)],
            "lauflaenge_verteilung": {
                str(laenge): round(anzahl / lauf_gesamt, 4) for laenge, anzahl in sorted(lauflaengen.items())
            },
            "position": {
                schluessel: round(wert / positionen_gesamt, 4) for schluessel, wert in laufpositionen.items()
            },
        },
        struktur={
            "aufzaehlungszeichen": [[z, n] for z, n in aufzaehlungszeichen.most_common(10)],
            "namensblock_zeilenanteil": round(namensblockzeilen / max(zeilen_gesamt, 1), 4),
            "zeilen_gesamt": zeilen_gesamt,
        },
        lexikon={
            "schluesselwoerter": schluesselwoerter,
            "inhaltswoerter": inhaltswoerter,
            "wendungen": gefundene_wendungen,
            "treffer_je_100": treffer,
            "oeffner": _zeilen_saeubern(
                [z for z in erste_zeilen if not namensblock(z, hg)], namen, 25
            ),
            "schluesser": _zeilen_saeubern(
                [z for z in letzte_zeilen if not namensblock(z, hg)], namen, 25
            ),
            "hashtags": [[h, n] for h, n in hashtags.most_common(40)],
            "organisationen": organisationen(texte),
        },
    )
    profil.beispiele = [
        anonymisieren(text, namen) for text in typische_beitraege(texte, verteilungen, hg)
    ]
    return profil
