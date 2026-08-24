"""Uebersetzt Texte in den gelernten Stil -- und wieder zurueck.

Der Ablauf in Richtung Stil:

    Eingabe
      -> Inhalt erkennen        (inhalt.py: Aussage, Zahlen, Namen, Anliegen)
      -> Anweisung bauen        (aus dem gemessenen Profil, nicht aus Handarbeit)
      -> Entwurf erzeugen       (Sprachmodell oder Offline-Generator)
      -> Entwurf bewerten       (score.py: Note und Abweichungsliste)
      -> bei Bedarf nachschaerfen, mit den Abweichungen als Auftrag
      -> besten Entwurf ausgeben

Der letzte Schritt ist der Kern: der Entwurf wird nicht geglaubt, sondern
nachgemessen. Erreicht er die Schwelle nicht, geht er mit der konkreten
Maengelliste zurueck ins Modell. Das funktioniert mit jedem Anbieter, auch
mit kleinen kostenlosen Modellen -- der Regelkreis gleicht aus, was das
Modell allein nicht trifft.

Ohne Sprachmodell arbeitet der Offline-Generator: er setzt Emoji-Dichte,
Kettenlaengen, Grossschreibungsquote und Bausteine direkt aus den gemessenen
Werten des Profils zusammen.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from . import merkmale, text as t
from .analyse import Stilprofil, lade_hintergrund
from .inhalt import DATUM, UHRZEIT, Inhalt, erkenne as inhalt_erkennen
from .korpus import Korpus
from .llm import Klient, LLMFehler
from .score import Bewertung, bewerte

# Ab dieser Note gilt ein Entwurf als gut genug.
SCHWELLE = 72.0
# So oft wird hoechstens nachgeschaerft.
NACHBESSERUNGEN = 2
# So viele Stilbeispiele kommen in die Anweisung.
BEISPIELE = 3


@dataclass
class Ergebnis:
    """Eine fertige Uebersetzung samt Nachweis."""

    text: str
    richtung: str
    motor: str
    bewertung: Bewertung | None = None
    runden: int = 1
    hinweise: list[str] = field(default_factory=list)
    inhalt: Inhalt | None = None
    entwuerfe: list[tuple[str, float]] = field(default_factory=list)

    def als_dict(self) -> dict:
        return {
            "text": self.text,
            "richtung": self.richtung,
            "motor": self.motor,
            "runden": self.runden,
            "hinweise": self.hinweise,
            "bewertung": self.bewertung.als_dict() if self.bewertung else None,
            "inhalt": self.inhalt.als_dict() if self.inhalt else None,
        }


class Uebersetzer:
    """Bindet Profil, Inhaltserkennung, Sprachmodell und Bewertung zusammen."""

    def __init__(
        self,
        profil: Stilprofil,
        klient: Klient | None = None,
        korpus: Korpus | None = None,
        schwelle: float = SCHWELLE,
    ) -> None:
        self.profil = profil
        self.klient = klient or Klient()
        self.korpus = korpus
        self.schwelle = schwelle
        self.hintergrund = lade_hintergrund()

    # ------------------------------------------------------------ Richtung 1 --

    def zu_bernie(
        self,
        roh: str,
        staerke: float = 1.0,
        motor: str = "auto",
        nachbesserungen: int = NACHBESSERUNGEN,
    ) -> Ergebnis:
        """Schreibt einen sachlichen Text im gelernten Stil."""

        roh = t.normalisieren(roh)
        if not roh.strip():
            return Ergebnis("", "zu_bernie", "offline", hinweise=["Kein Text uebergeben."])

        gefunden = inhalt_erkennen(roh, self.hintergrund)
        hinweise: list[str] = []

        if motor == "offline" or (motor == "auto" and not self.klient.bereit):
            if motor == "auto":
                hinweise.append(
                    "Kein Sprachmodell erreichbar -- der Offline-Generator hat uebernommen. "
                    "Er trifft die Form, formuliert aber nicht neu."
                )
            entwurf = self.offline_stil(roh, staerke)
            return Ergebnis(
                entwurf, "zu_bernie", "offline", bewerte(entwurf, self.profil), 1, hinweise, gefunden
            )

        anweisung = self.anweisung_stil(roh, staerke)
        auftrag = f"{gefunden.beschreibung()}\n\nText:\n{roh}"
        entwuerfe: list[tuple[str, float]] = []

        try:
            for runde in range(1 + max(0, nachbesserungen)):
                antwort = self.klient.frage(anweisung, auftrag)
                note = bewerte(antwort, self.profil)
                entwuerfe.append((antwort, note.punkte))
                if note.punkte >= self.schwelle:
                    break
                auftrag = (
                    f"{gefunden.beschreibung()}\n\nText:\n{roh}\n\n"
                    f"Dein bisheriger Entwurf:\n{antwort}\n\n"
                    "Der Entwurf liegt noch daneben. Gemessen wurde:\n"
                    f"{note.auftrag()}\n\n"
                    "Schreibe ihn neu und gleiche genau diese Punkte aus. "
                    "Inhalt und Fakten bleiben unveraendert."
                )
        except LLMFehler as fehler:
            if not entwuerfe:
                entwurf = self.offline_stil(roh, staerke)
                hinweise.append(f"Sprachmodell nicht erreichbar ({fehler}). Offline-Generator eingesprungen.")
                return Ergebnis(
                    entwurf, "zu_bernie", "offline", bewerte(entwurf, self.profil), 1, hinweise, gefunden
                )
            hinweise.append(f"Nachbesserung abgebrochen: {fehler}")

        bester, punkte = max(entwuerfe, key=lambda e: e[1])
        if punkte < self.schwelle:
            hinweise.append(
                f"Beste Note {punkte:.0f} von 100 -- unter der Schwelle von {self.schwelle:.0f}. "
                "Meist hilft ein laengerer Ausgangstext oder ein groesseres Modell."
            )
        return Ergebnis(
            bester, "zu_bernie", "modell", bewerte(bester, self.profil), len(entwuerfe), hinweise, gefunden, entwuerfe
        )

    # ------------------------------------------------------------ Richtung 2 --

    def zu_klartext(self, roh: str, motor: str = "auto") -> Ergebnis:
        """Loest einen Text im gelernten Stil in nuechternes Deutsch auf."""

        roh = t.normalisieren(roh)
        if not roh.strip():
            return Ergebnis("", "zu_klartext", "offline", hinweise=["Kein Text uebergeben."])

        entkleidet = self.stil_abziehen(roh)
        gefunden = inhalt_erkennen(entkleidet or roh, self.hintergrund)
        hinweise: list[str] = []

        if motor == "offline" or (motor == "auto" and not self.klient.bereit):
            if motor == "auto":
                hinweise.append("Kein Sprachmodell erreichbar -- nuechterne Fassung aus der Inhaltserkennung.")
            return Ergebnis(self.offline_klartext(gefunden), "zu_klartext", "offline", None, 1, hinweise, gefunden)

        try:
            antwort = self.klient.frage(self.anweisung_klartext(), roh)
        except LLMFehler as fehler:
            hinweise.append(f"Sprachmodell nicht erreichbar ({fehler}). Offline-Fassung erzeugt.")
            return Ergebnis(self.offline_klartext(gefunden), "zu_klartext", "offline", None, 1, hinweise, gefunden)

        return Ergebnis(antwort, "zu_klartext", "modell", None, 1, hinweise, gefunden)

    # ------------------------------------------------------------ Anweisungen --

    def anweisung_stil(self, roh: str, staerke: float = 1.0) -> str:
        """Baut die Systemanweisung aus den gemessenen Werten des Profils.

        Kein Satz darin ist von Hand geschrieben worden: Emoji-Dichte,
        Kettenlaenge, Grossschreibungsquote, Satzlaenge, Wortschatz und
        Beispiele kommen alle aus der Analyse. Ein anderes Profil ergibt
        automatisch eine andere Anweisung.
        """

        p = self.profil
        emoji_rate = p.soll("emoji_je_100_woerter") * staerke
        kette = p.soll("emoji_lauflaenge")
        versal = p.soll("versal_wortanteil") * 100 * staerke
        satzlaenge = p.soll("woerter_je_satz")
        position = p.emoji.get("position", {})
        haeufigste = " ".join(e for e, _ in p.emoji.get("haeufigste", [])[:14])
        ketten = "  ".join(k for k, _ in p.emoji.get("ketten", [])[:6])
        marker = " ".join(z for z, _ in p.struktur.get("aufzaehlungszeichen", [])[:5])
        woerter = ", ".join(p.inhaltswoerter[:35])
        wendung = "; ".join(w["text"] for w in p.lexikon.get("wendungen", [])[:14])
        oeffner = " | ".join(p.lexikon.get("oeffner", [])[:6])
        schluesser = " | ".join(p.lexikon.get("schluesser", [])[:6])
        hashtags = " ".join(h for h, _ in p.lexikon.get("hashtags", [])[:10])
        orgs = "; ".join(p.lexikon.get("organisationen", [])[:8])

        teile = [
            f"Du schreibst wie {p.name or 'die Person'}. Dieser Schreibstil wurde aus "
            f"{p.quelle.get('posts', 0)} eigenen Texten vermessen; die Werte stehen unten. Du "
            "formulierst den Text des Nutzers in diesem Stil neu. Antworte immer auf Deutsch und gib "
            "ausschliesslich den fertigen Text aus -- keine Erklaerung, keine Ueberschrift, keine "
            "Anfuehrungszeichen um das Ganze.",
            "GEMESSENE WERTE, an die du dich haeltst:\n"
            f"- Emojis: rund {emoji_rate:.0f} je 100 Woerter, im Schnitt {kette:.1f} je Emoji-Gruppe.\n"
            f"- {p.soll('anteil_saetze_mit_emoji') * 100:.0f} Prozent der Saetze tragen mindestens ein Emoji.\n"
            f"- Emoji-Gruppen stehen zu {position.get('innen', 0) * 100:.0f} Prozent mitten im Satz, "
            f"zu {position.get('satzende', 0) * 100:.0f} Prozent am Satzende, "
            f"zu {position.get('zeilenanfang', 0) * 100:.0f} Prozent am Zeilenanfang.\n"
            f"- {p.emoji.get('lauflaenge_verteilung', {}).get('1', 0) * 100:.0f} Prozent der Gruppen sind "
            f"ein einzelnes Emoji, der Rest sind Ketten -- meist dasselbe Emoji wiederholt, nicht gemischt.\n"
            f"- {versal:.0f} Prozent der Woerter stehen komplett in GROSSBUCHSTABEN (Betonung).\n"
            f"- Saetze sind kurz: im Schnitt {satzlaenge:.0f} Woerter.\n"
            f"- Selbstbezuege (ich, wir, mir, uns): {p.soll('ich_wir_je_100_woerter'):.0f} je 100 Woerter.\n"
            f"- Gedankenpunkte (…) und Ausrufezeichen kommen vor, aber sparsam: "
            f"{p.soll('ellipsen_je_100_woerter'):.1f} bzw. {p.soll('ausrufe_je_satz'):.2f} je Satz.",
            f"DIESE EMOJIS kommen im Material vor, andere nicht: {haeufigste}\n"
            f"Typische Ketten: {ketten}\n"
            f"Aufzaehlungszeilen beginnen mit: {marker}",
            f"WORTSCHATZ, der auffaellig oft vorkommt: {woerter}",
            f"WIEDERKEHRENDE WENDUNGEN: {wendung}",
            f"SO FANGEN TEXTE AN: {oeffner}\nSO HOEREN SIE AUF: {schluesser}",
        ]
        if hashtags:
            teile.append(f"HASHTAGS am Ende, klein geschrieben, nur wenn es passt: {hashtags}")
        if orgs:
            teile.append(f"Genannte Einrichtungen (nur uebernehmen, wenn sie zum Inhalt passen): {orgs}")

        beispiele = self.beispiele_waehlen(roh)
        if beispiele:
            teile.append(
                "SO KLINGT DAS im Original -- uebernimm Ton, Emoji-Dichte und Aufbau, "
                "nie den Inhalt:\n\n" + "\n\n---\n\n".join(beispiele)
            )

        teile.append(
            "PFLICHTEN: Die Aussage des Originals bleibt erhalten, ebenso alle Zahlen, Daten und "
            "Namen. Erfinde keine Personen, keine Zitate und keine Termine. [Name] in den "
            "Beispielen ist ein Platzhalter -- uebernimm ihn nicht. Hoechstens doppelt so lang "
            "wie das Original."
        )
        return "\n\n".join(teile)

    def anweisung_klartext(self) -> str:
        """Die Gegenrichtung: Stil abziehen, Aussage behalten."""

        p = self.profil
        woerter = ", ".join(p.inhaltswoerter[:25])
        wendung = "; ".join(w["text"] for w in p.lexikon.get("wendungen", [])[:10])
        return "\n\n".join(
            [
                "Du bist ein nuechterner Uebersetzer. Der Nutzer liefert einen ueberschwaenglichen "
                "deutschen Text voller Emojis, Betonungen in Grossbuchstaben, Floskeln und Hashtags.",
                "Deine Aufgabe: Sage in klaren, kurzen Saetzen, was tatsaechlich gemeint ist. "
                "Keine Emojis, keine Hashtags, keine Ausrufezeichen, keine Grossbuchstaben-Betonung, "
                "keine Floskeln. Benutze Verben statt Substantivierungen.",
                "Streiche alles, was keine Information traegt: Dankesformeln, Selbstdarstellung, "
                "Bekenntnisse, aneinandergereihte Namen und Einrichtungen. Erfinde nichts hinzu. "
                "Zahlen, Daten und Namen, die eine Rolle spielen, bleiben stehen.",
                f"Typische Floskeln dieses Stils, die nichts bedeuten: {wendung}. "
                f"Haeufige Schmuckwoerter: {woerter}.",
                "Deutlich kuerzer als das Original, meist ein bis drei Saetze. Sagt der Text nichts "
                "Konkretes, schreibe genau das. Gib ausschliesslich die nuechterne Fassung aus.",
            ]
        )

    def beispiele_waehlen(self, roh: str, anzahl: int = BEISPIELE) -> list[str]:
        """Sucht die Stilbeispiele, die inhaltlich am naechsten liegen.

        Aehnlicher Inhalt heisst aehnlicher Aufbau -- ein Beispiel ueber eine
        Veranstaltung hilft bei einer Einladung mehr als eines ueber die
        IT-Sicherheit. Gibt es keinen Korpus, kommen die im Profil
        hinterlegten typischen Beitraege zum Zug.
        """

        quelle = self.korpus.texte if self.korpus else self.profil.beispiele
        if not quelle:
            return []
        if len(quelle) <= anzahl:
            return list(quelle)

        def inhaltswoerter(text: str) -> set[str]:
            return {
                w.lower()
                for w in t.woerter(t.ohne_emojis(text))
                if len(w) > 3 and self.hintergrund.zipf.get(w.lower(), 2.0) < 5.6
            }

        gesucht = inhaltswoerter(roh)
        if not gesucht:
            return list(quelle[:anzahl])

        bewertet = []
        for beispiel in quelle:
            menge = inhaltswoerter(beispiel)
            if not menge:
                continue
            aehnlich = len(gesucht & menge) / ((len(gesucht) * len(menge)) ** 0.5)
            bewertet.append((aehnlich, beispiel))
        bewertet.sort(key=lambda e: e[0], reverse=True)
        return [beispiel for _, beispiel in bewertet[:anzahl]]

    # -------------------------------------------------------- Offline-Betrieb --

    def offline_stil(self, roh: str, staerke: float = 1.0) -> str:
        """Erzeugt den Stil ohne Sprachmodell, allein aus den Messwerten.

        Der Text wird nicht neu formuliert -- das kann nur ein Sprachmodell.
        Nachgebaut wird die *Form*: Emojis in der gemessenen Dichte, Ketten aus
        der gemessenen Laengenverteilung, Grossschreibung in der gemessenen
        Quote, dazu Eroeffnung, Schluss und Hashtags aus dem Material.

        Wichtig ist die Reihenfolge: erst wird der ganze Text zusammengesetzt,
        dann werden die Mengen auf die *fertige* Laenge gerechnet. Wer je Satz
        rundet, landet regelmaessig beim Doppelten -- und genau das wuerde die
        Bewertung anschliessend anmahnen.
        """

        p = self.profil
        wuerfel = random.Random(roh)
        saetze = t.saetze(roh) or [roh]
        eingabe_woerter = len(t.woerter(roh))

        # 1. Rahmen festlegen. Kurze Nachrichten bekommen keinen Aufbau
        #    verpasst -- sonst besteht der Text nur noch aus Bausteinen.
        kopf = ""
        fuss = ""
        oeffner = [z for z in p.lexikon.get("oeffner", []) if 2 <= len(t.woerter(z)) <= 6]
        schluesser = [z for z in p.lexikon.get("schluesser", []) if 3 <= len(t.woerter(z)) <= 10]
        if oeffner and eingabe_woerter >= 30:
            kopf = wuerfel.choice(oeffner)
        if schluesser and eingabe_woerter >= 18:
            fuss = wuerfel.choice(schluesser)

        hashtagzeile = ""
        hashtags = [h for h, _ in p.lexikon.get("hashtags", [])]
        erwartet = eingabe_woerter / 100 * p.soll("hashtags_je_100_woerter") * staerke
        if hashtags and wuerfel.random() < min(1.0, erwartet):
            anzahl = max(1, round(erwartet))
            hashtagzeile = " ".join(wuerfel.sample(hashtags, min(anzahl, len(hashtags))))

        # 2. Grossschreibung mit einem Budget fuer den ganzen Text.
        saetze = self._versalien(saetze, p.soll("versal_wortanteil") * staerke, wuerfel)

        # 3. Emoji-Budget auf die fertige Laenge rechnen, abzueglich der
        #    Emojis, die in den uebernommenen Bausteinen schon stecken.
        gesamt = eingabe_woerter + sum(len(t.woerter(z)) for z in (kopf, fuss, hashtagzeile))
        budget = round(gesamt / 100 * p.soll("emoji_je_100_woerter") * staerke)
        budget -= sum(len(t.emojis(z)) for z in (kopf, fuss))
        saetze = self._emojis_verteilen(saetze, max(0, budget), staerke, wuerfel)

        bloecke = [kopf, " ".join(saetze), fuss, hashtagzeile]
        return "\n\n".join(b for b in bloecke if b.strip())

    def _emojis_verteilen(
        self, saetze: list[str], budget: int, staerke: float, wuerfel: random.Random
    ) -> list[str]:
        """Verteilt das Emoji-Budget auf die Saetze -- Laengen und Positionen
        werden aus den gemessenen Verteilungen gezogen."""

        if budget <= 0:
            return saetze

        p = self.profil
        emojis = [e for e, _ in p.emoji.get("haeufigste", [])] or ["🚀"]
        gewichte = [n for _, n in p.emoji.get("haeufigste", [])] or [1]
        laengen = p.emoji.get("lauflaenge_verteilung") or {"1": 1.0}
        wiederholung = p.soll("emoji_wiederholung")
        innen = p.emoji.get("position", {}).get("innen", 0.5)

        def lauf(hoechstens: int) -> str:
            anzahl = min(hoechstens, int(wuerfel.choices(list(laengen), weights=list(laengen.values()))[0]))
            anzahl = max(1, anzahl)
            erstes = wuerfel.choices(emojis, weights=gewichte)[0]
            if anzahl == 1:
                return erstes
            if wuerfel.random() < wiederholung:
                return erstes * anzahl
            return erstes + "".join(wuerfel.choices(emojis, weights=gewichte)[0] for _ in range(anzahl - 1))

        # Saetze in zufaelliger Reihenfolge bedienen, damit nicht immer der
        # erste Satz alles abbekommt.
        reihenfolge = list(range(len(saetze)))
        wuerfel.shuffle(reihenfolge)
        anteil_mit = min(1.0, p.soll("anteil_saetze_mit_emoji") * staerke)

        for durchgang in range(3):
            for i in reihenfolge:
                if budget <= 0:
                    break
                # Im ersten Durchgang nur so viele Saetze bedienen, wie es der
                # gemessene Anteil vorsieht.
                if durchgang == 0 and wuerfel.random() > anteil_mit:
                    continue
                gruppe = lauf(budget)
                budget -= len(t.emojis(gruppe))
                stelle = self._einfuegestelle(saetze[i], wuerfel) if wuerfel.random() < innen else None
                if stelle is None:
                    saetze[i] = f"{saetze[i]} {gruppe}"
                else:
                    marken = saetze[i].split(" ")
                    marken.insert(stelle, gruppe)
                    saetze[i] = " ".join(marken)
            if budget <= 0:
                break
        return saetze

    @staticmethod
    def _einfuegestelle(satz: str, wuerfel: random.Random) -> int | None:
        """Waehlt eine Wortluecke fuer eine Emoji-Gruppe mitten im Satz.

        Datums-, Uhrzeit- und Zahlenangaben duerfen dabei nicht zerrissen
        werden: aus "20. Juni" wuerde sonst "20. ✊ Juni".
        """

        marken = satz.split(" ")
        if len(marken) <= 5:
            return None

        gesperrt: list[tuple[int, int]] = [
            (treffer.start(), treffer.end())
            for muster in (DATUM, UHRZEIT)
            for treffer in muster.finditer(satz)
        ]

        moeglich: list[int] = []
        stelle = 0
        for i, marke in enumerate(marken):
            stelle += len(marke) + 1  # Position der Luecke hinter diesem Wort
            if i < 2 or i >= len(marken) - 1:
                continue
            if any(anfang < stelle < ende for anfang, ende in gesperrt):
                continue
            moeglich.append(i + 1)
        return wuerfel.choice(moeglich) if moeglich else None

    def _versalien(self, saetze: list[str], quote: float, wuerfel: random.Random) -> list[str]:
        """Hebt einzelne Woerter in GROSSBUCHSTABEN -- mit einem Budget fuer
        den ganzen Text, nicht je Satz."""

        if quote <= 0:
            return saetze
        zerlegt = [satz.split(" ") for satz in saetze]
        kandidaten = [
            (i, j)
            for i, marken in enumerate(zerlegt)
            for j, m in enumerate(marken)
            if len(re.sub(r"\W", "", m)) >= 5 and not m.isupper() and not t.EMOJI.search(m)
        ]
        gesamt = sum(len(m) for m in zerlegt)
        wieviele = min(len(kandidaten), round(gesamt * quote))
        for i, j in wuerfel.sample(kandidaten, wieviele) if wieviele else []:
            zerlegt[i][j] = zerlegt[i][j].upper()
        return [" ".join(marken) for marken in zerlegt]

    def stil_abziehen(self, roh: str) -> str:
        """Entfernt die gelernten Stilmerkmale und laesst den Inhalt stehen.

        Was entfernt wird, steht nicht im Programm, sondern im Profil: die
        gemessenen Eroeffnungs- und Schlussformeln, die gefundenen Wendungen,
        Hashtags und Emojis. Ein anderes Profil raeumt andere Floskeln weg.
        """

        p = self.profil
        text = t.ohne_emojis(t.normalisieren(roh))
        text = re.sub(r"#[^\W\d_][\w-]*", " ", text)

        floskeln = [w["text"] for w in p.lexikon.get("wendungen", []) if len(w["text"].split()) >= 3]
        floskeln += [z for z in p.lexikon.get("oeffner", []) + p.lexikon.get("schluesser", []) if len(z) > 8]
        for floskel in sorted(floskeln, key=len, reverse=True):
            text = re.sub(re.escape(floskel), " ", text, flags=re.IGNORECASE)

        # GROSSGESCHRIEBENES zurueck in normale Schreibung.
        def normal(treffer: re.Match) -> str:
            wort = treffer.group(0)
            return wort.capitalize() if len(wort) > 3 else wort

        text = re.sub(r"\b[A-ZÄÖÜ]{3,}\b", normal, text)
        text = re.sub(r"[!‼]+", ".", text)
        text = re.sub(r"\s*\n\s*", ". ", text)
        text = re.sub(r"\s{2,}", " ", text)
        text = re.sub(r"(?:\s*\.){2,}", ".", text)
        return text.strip(" .,-–") + "." if text.strip() else ""

    def offline_klartext(self, gefunden: Inhalt) -> str:
        """Nuechterne Fassung ohne Sprachmodell: die erkannten Kernaussagen."""

        saetze = [s.strip() for s in gefunden.kernsaetze if len(t.woerter(s)) >= 3]
        if not saetze:
            return "Keine konkrete Aussage erkennbar."
        ergebnis = " ".join(s if s.endswith((".", "?", "!")) else s + "." for s in saetze)
        pflicht = [a for a in gefunden.pflichtangaben() if a not in ergebnis]
        if pflicht:
            ergebnis += " Genannt werden ausserdem: " + ", ".join(pflicht) + "."
        return ergebnis
