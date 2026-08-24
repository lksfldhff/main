# Stil-Übersetzer — schreibt Texte so, wie er sie schreiben würde

Zweites Werkzeug in diesem Repository, unabhängig vom Newsletter-Konverter.

Es **misst** einen Schreibstil aus vorhandenen Texten, **erkennt** ihn in
beliebigen anderen Texten wieder und **übersetzt** damit in beide Richtungen:
sachlicher Text → sein Stil, und sein Stil → Klartext.

Kein Satz des Stils steht im Programmcode. Alles — Emoji-Dichte, Kettenlängen,
Großschreibungsquote, Wortschatz, Eröffnungs- und Schlussformeln — wird aus dem
Material gerechnet. Ein anderer Korpus ergibt automatisch einen anderen Stil.

```
python bernie.py                  Oberfläche im Browser
python bernie.py "Ich schaffe die Präsentation nicht bis Freitag."
python bernie.py lernen korpus/   Profil aus dem eigenen Material lernen
python bernie.py anbieter         Welches Sprachmodell ist eingerichtet?
```

> **Das eigene Textmaterial liegt nicht im Repository.** Echte LinkedIn-Beiträge
> und dienstliche E-Mails enthalten Namen realer Personen und interne
> Absprachen; dieses Repository ist öffentlich. Der Ordner `korpus/` ist deshalb
> in `.gitignore` — siehe [korpus/LIESMICH.md](korpus/LIESMICH.md). Mitgeliefert
> ist ein **Demo-Korpus aus 14 erfundenen Beiträgen**
> (`beispiel/demokorpus.jsonl`), damit alles sofort läuft. Alle Zahlen unten
> stammen aus diesem Demo-Korpus und sind mit `python bernie.py profil`
> nachzurechnen.

---

## Wie die Erkennung funktioniert

Vier Schritte, alle nachvollziehbar und alle ohne Fremdpakete.

### 1. Merkmale messen

19 Kennzahlen je Beitrag, alle längennormiert, damit ein Zweizeiler mit einem
langen Post vergleichbar bleibt. Aus den 14 Beiträgen des Demo-Korpus ergibt
sich:

| Merkmal | Sollwert | Streuung | Einheit |
| --- | ---: | ---: | --- |
| Emoji-Dichte | 15.96 | ± 7.21 | Emojis je 100 Wörter |
| Emojis je Satz | 0.61 | ± 0.24 | Anteil der Sätze mit Emoji |
| Emoji-Ketten | 1.48 | ± 0.47 | Emojis je zusammenhängendem Lauf |
| Emoji-Wiederholung | 0.61 | ± 0.43 | Anteil der Läufe aus demselben Emoji |
| GROSSSCHREIBUNG | 0.06 | ± 0.08 | Anteil komplett großgeschriebener Wörter |
| Wortdehnung | 1.93 | ± 6.96 | gedehnte Wörter (SOOO) je 1000 Wörter |
| Ausrufezeichen | 0.11 | ± 0.13 | Ausrufezeichen je Satz |
| Doppelausruf | 0.14 | ± 0.35 | Anteil ‼️ an allen Ausrufezeichen |
| Gedankenpunkte | 0.54 | ± 1.10 | … je 100 Wörter |
| Satzlänge | 7.07 | ± 0.94 | Wörter je Satz |
| Zeilenlänge | 8.61 | ± 1.44 | Wörter je Zeile |
| Wortlänge | 5.66 | ± 0.38 | Buchstaben je Wort |
| Substantivierungen | 0.04 | ± 0.03 | Anteil Wörter auf -ung, -heit, -keit … |
| Anglizismen | 1.12 | ± 1.74 | englische Wörter je 100 Wörter |
| Hashtags | 0.85 | ± 1.79 | Hashtags je 100 Wörter |
| Aufzählungen | 0.06 | ± 0.15 | Anteil Zeilen mit Aufzählungszeichen |
| Zitate | 0.34 | ± 0.94 | Zitatzeichen je 100 Wörter |
| Ich und Wir | 6.43 | ± 3.19 | Selbstbezüge je 100 Wörter |

Die Streuung ist so wichtig wie der Mittelwert: sie sagt, wie *fest* eine
Gewohnheit ist. Bei der Emoji-Dichte schwankt er stark, bei der Wortlänge kaum
— entsprechend streng wird später bewertet.

Dazu kommen die Verteilungen: Emoji-Läufe sind zu 61 % einzeln, zu 25 %
Zweierketten, der Rest länger; sie stehen zu 70 % **mitten im Satz**, zu 18 %
am Satzende und zu 12 % am Zeilenanfang. Genau das macht den Klang aus.

### 2. Wortschatz mit Keyness bestimmen

Welche Wörter kommen *auffällig* oft vor? Bloßes Zählen liefert „und, die,
wir". Deshalb wird gegen deutsche Normalhäufigkeiten verglichen — 40.000
Wortformen mit Zipf-Werten, einmalig aus dem Paket `wordfreq` erzeugt und als
`daten/hintergrund_de.json.gz` abgelegt (zur Laufzeit wird nichts nachgeladen).

Gerechnet wird mit dem **Log-Odds-Ratio mit informativem Dirichlet-Prior**
(Monroe/Colaresi/Quinn 2008, *Fightin' Words*):

```
delta   = log( (y₁+a) / (n₁+prior−y₁−a) ) − log( (y₂+a) / (n₂+prior−y₂−a) )
sigma²  = 1/(y₁+a) + 1/(y₂+a)          a = prior · p(Wort im Deutschen)
z       = delta / sigma
```

y₁ ist der Treffer im Korpus, y₂ der erwartete Treffer in einer Million Wörtern
normalen Deutschs. Der Prior glättet: ein einzelner Zufallstreffer reißt die
Liste nicht an sich, ein Allerweltswort kommt nur nach oben, wenn es wirklich
deutlich häufiger ist als sonst.

Ergebnis für den Demo-Korpus:

> zuversicht · mittelstand · familienunternehmen · transformation ·
> wirtschaftsförderung · freue · schöner · industrie · auftrag · verantwortung ·
> zugleich · starke · heißt

### 3. Bausteine aus dem Material ziehen

Ohne jede Handarbeit werden gefunden:

* **Emojis** mit Häufigkeit: 🚀 🙏 🥇 🤩 🤝 😎 ✊ ➡️ 🤗 💪 🥂 💯
* **Ketten**, wie sie wirklich vorkommen: 🚀🚀🚀 · 🤝🤝 · 🚀🚀🚀🚀 · 🥂🥂
* **Aufzählungszeichen** am Zeilenanfang: 🥇 ➡️ 💣
* **Wendungen** (wiederkehrende Wortfolgen): „was für ein", „nehme ich mit",
  „viel Spaß gemacht"
* **Eröffnungs- und Schlusszeilen**, **Hashtags**, **Organisationsnamen**
* **Sechs typische Beiträge** als Stilbeispiele — ausgewählt wird der jeweils
  *durchschnittlichste*, nicht der auffälligste

### 4. Namensschutz

Häufigkeit allein trennt Namen nicht von Substantiven: „Sabine" (Zipf 4.1) und
„Ehre" (Zipf 4.5) sind gleich geläufig. Entscheidend ist der Satzkontext über
alle Vorkommen hinweg:

* Vor einem deutschen Substantiv steht fast immer ein Begleiter („die Ehre").
  Vor einem Namen so gut wie nie.
* Namen stehen paarweise oder hinter einer Anrede („liebe Iris", „Herr Burger").

Wörter, die **nie** einen Begleiter vor sich haben und mindestens einmal im
Namenskontext stehen, gelten als Personenname. Im echten Material sind das 240
Wortformen. Sie fliegen aus allen gespeicherten Listen; in den Stilbeispielen
werden sie durch `[Name]` ersetzt. Das Profil hält nur ihre *Anzahl* fest.

Das ist eine Heuristik, kein Ersatz für eine Durchsicht — aber es verhindert,
dass echte Namen aus fremden Beiträgen in erfundene Texte wandern.

### 5. Was sich nicht messen lässt

Aus 22 Beiträgen lässt sich die *Form* zuverlässig messen — Dichten, Längen,
Verteilungen. Die *Figur* dahinter nicht: politische Prägung, Steckenpferde,
wiederkehrende Bekenntnisse, der Tonfall des wohlmeinenden Ratgebers. Das sind
Zuschreibungen, keine Messwerte.

Dafür hat das Profil ein eigenes Feld, `eigenheiten` — freier Text, der
unverändert in die Anweisung geht und sauber vom gemessenen Teil getrennt
bleibt:

```json
{ "eigenheiten": "PFERDE: Sein Steckenpferd. Bilder aus Reitsport und Stall …" }
```

Der Stärkeregler steuert nicht nur Emoji-Dichte und Großschreibung, sondern
auch, wie dick die Figur aufgetragen wird — von einem einzigen Bild im ganzen
Text bis zu einem in jedem Absatz.

Der Unterschied ist wichtig: die gemessenen Werte machen, dass es nach **ihm**
klingt; die Figur macht, dass es *charakteristisch* klingt. Ohne die Messwerte
käme ein beliebiger Wichtigtuer heraus, ohne die Figur eine brave Kopie.

---

## Der Beweis, dass die Erkennung trägt

Das Profil ist nur etwas wert, wenn es *trennt*. Deshalb misst
`python bernie.py lernen korpus/ --pruefen` gegen neutrale deutsche Texte:

```
Demo-Korpus (14 erfundene Beiträge)
  eigene Texte   76.2 von 100  (± 7.8)
  fremde Texte   39.1 von 100  (± 3.1)
  Abstand        37.1 Punkte = 6.6 Streuungen

Echtes Material (22 Beiträge, lokal)
  eigene Texte   77.5 von 100  (± 8.8)
  fremde Texte   40.6 von 100  (± 2.5)
  Abstand        36.9 Punkte = 5.7 Streuungen
```

Rund sechs Standardabweichungen Abstand — in beiden Fällen. Zum Nachrechnen:

```bash
python bernie.py pruefen "Wir bitten um Rückmeldung bis Freitag."   #  ~39
python bernie.py pruefen beispiel/demokorpus.jsonl                   #  hoch
```

Dieselbe Bewertung steckt im Übersetzer — und macht ihn erst brauchbar.

---

## Der Übersetzer: erzeugen, nachmessen, nachschärfen

```
Eingabe
  → Inhalt erkennen      Aussage, Zahlen, Daten, Namen, Anliegen, Grundton
  → Anweisung bauen      aus den gemessenen Werten, nicht aus Handarbeit
  → Beispiele wählen     die inhaltlich ähnlichsten echten Beiträge
  → Entwurf erzeugen     Sprachmodell
  → Entwurf bewerten     Note 0–100 plus konkrete Abweichungsliste
  → nachschärfen         Abweichungen gehen als Auftrag zurück ins Modell
  → besten Entwurf ausgeben
```

Der Entwurf wird nicht geglaubt, sondern **nachgemessen**. Liegt er unter 72
Punkten, geht er mit der Mängelliste zurück:

```
- Emoji-Dichte: 2.1 statt 13.1 (Emojis je 100 Wörter) -- zu wenig
- Satzlänge: 21.4 statt 9.6 (Wörter je Satz) -- zu viel
```

Höchstens zwei Nachbesserungen, danach gewinnt der beste Entwurf. Das gleicht
aus, was ein Modell allein nicht trifft — auch kleine kostenlose Modelle werden
so brauchbar.

**Die Inhaltserkennung** hält fest, was erhalten bleiben muss. Aus

> „Ich schaffe die Präsentation für den Beirat nicht bis Freitag, 12. September.
> Können wir auf Montag 10:00 Uhr verschieben?"

wird

```
Anliegen: absage
Kernaussagen: … (die zwei wichtigsten Sätze)
Diese Angaben müssen wörtlich erhalten bleiben: Freitag, 12. September, Montag, 10:00 Uhr
```

Das geht als Pflichtinhalt mit in die Anweisung — so bleiben Termine und Zahlen
stehen, auch wenn der Rest umgeschrieben wird.

### Offline-Modus

Ohne Sprachmodell springt ein Generator ein, der die **Form** aus den Messwerten
nachbaut: Emoji-Budget aus der gemessenen Dichte, Kettenlängen aus der
gemessenen Verteilung, Großschreibung in der gemessenen Quote, dazu Eröffnung,
Schluss und Hashtags aus dem Material. Datums- und Zahlenangaben werden dabei
geschützt, damit aus „20. Juni" kein „20. ✊ Juni" wird.

Er erreicht rund 70–85 Punkte und ist reproduzierbar (gleicher Text → gleiches
Ergebnis). **Er formuliert aber nicht neu** — das kann nur ein Sprachmodell. Der
Offline-Modus ist der Notnagel, nicht der Hauptweg.

---

## Eine einzelne HTML-Datei zum Hochladen

Wer keinen Python-Rechner nebenherlaufen lassen will, baut sich die
eigenständige Fassung: **eine Datei**, die alles mitbringt — Profil,
Messtechnik, Bewertung, Anweisungsbau und Offline-Generator. Kein Server,
keine Installation. Sie lässt sich auf jeden Webspace legen.

```bash
python tools/html_erzeugen.py                              # mit dem Demo-Profil
python tools/html_erzeugen.py -p korpus/stilprofil.json \
                              -o Stil-Uebersetzer.html \
                              -t "Bernie Speaks"           # mit dem eigenen Profil
```

Dabei entsteht neben der HTML-Datei eine **`api.php`**. Beide gehören in
denselben Ordner auf dem Webspace. Sie ist der Unterschied zwischen „geht" und
„geht sofort":

| | ohne `api.php` | mit `api.php` |
| --- | --- | --- |
| Schlüssel | jeder Besucher trägt seinen eigenen ein | liegt einmal auf dem Server |
| Wo liegt er | im Browser des Besuchers | serverseitig, nie im Browser |
| Aufruf | Browser → Anbieter (CORS-abhängig) | Browser → eigene Adresse → Anbieter |
| Erster Eindruck | Feld ausfüllen, dann geht's | Text eintippen, fertig |

Die Seite sucht die `api.php` beim Laden von selbst. Findet sie eine mit
hinterlegtem Schlüssel, verschwindet das Schlüsselfeld. Findet sie keine, bleibt
alles beim Alten — die Datei funktioniert auch allein.

Eintragen lässt sich der Schlüssel oben in der `api.php` oder über die
Umgebungsvariable `BERNIE_SCHLUESSEL`. Der Anbieter wird am Präfix erkannt:
`sk-ant-…` → Claude, `gsk_…` → Groq, `sk-or-…` → OpenRouter.

> **Wer die Adresse kennt, verbraucht das Guthaben.** Bei einer öffentlich
> erreichbaren Seite in der `api.php` ein `BERNIE_ZUGANG` setzen — dann fragt
> die Seite nach einem Zugangswort — oder die Seite hinter einen
> Passwortschutz legen. Eingebaut ist außerdem eine Bremse von 60 Anfragen je
> Stunde und Absender.

Zwei Dinge unterscheiden die HTML- von der Python-Fassung:

* **Anglizismen** werden nicht gemessen — dafür bräuchte es die englische
  Wortliste, die nur die Python-Fassung mitbringt. Die übrigen 18 Merkmale sind
  identisch, die Note bedeutet dasselbe.
* Per Doppelklick geöffnet (`file://`) läuft nur die Mechanik: `api.php` wird
  nicht ausgeführt, und den direkten Aufruf des Anbieters blockieren manche
  Browser. **Auf einem Webspace funktioniert beides.**

Wer die Datei öffentlich stellt: sie enthält das gelernte Profil, also
Formulierungen und anonymisierte Beispieltexte. Für eine öffentliche Adresse
besser das Demo-Profil nehmen — oder die Seite hinter einem Passwortschutz
ablegen.

---

## Ein Sprachmodell einrichten

`python bernie.py anbieter` zeigt, was bereitliegt. Drei kostenlose Wege:

**Ollama — lokal, kostenlos, nichts verlässt den Rechner**

```bash
# ollama.com herunterladen, dann:
ollama pull llama3.1
```
Mehr ist nicht nötig: ein laufendes Ollama wird von selbst erkannt.

**Groq — kostenloses Kontingent, sehr schnell**

```bash
export GROQ_API_KEY=gsk_...          # console.groq.com
```

**OpenRouter — kostenlose Modelle (Endung `:free`)**

```bash
export OPENROUTER_API_KEY=sk-or-...  # openrouter.ai
```

**Claude — die beste Qualität, kostenpflichtig**

```bash
export ANTHROPIC_API_KEY=sk-ant-...  # console.anthropic.com
```

Feineinstellung über Umgebungsvariablen oder eine `bernie.json` neben dem
Programm:

```json
{ "anbieter": "groq", "modell": "llama-3.3-70b-versatile", "aufwand": "medium" }
```

| Variable | Bedeutung |
| --- | --- |
| `BERNIE_ANBIETER` | `anthropic`, `groq`, `openrouter`, `mistral`, `deepseek`, `openai`, `ollama` |
| `BERNIE_MODELL` | Modellname; leer lassen für die Voreinstellung |
| `BERNIE_SCHLUESSEL` | Schlüssel, falls nicht über die übliche Variable gesetzt |
| `BERNIE_BASIS` | eigene Adresse, z. B. LM Studio unter `http://localhost:1234/v1` |
| `BERNIE_AUFWAND` | nur Claude: `low`, `medium`, `high` |

Der Schlüssel bleibt auf der Programmseite. Die Oberfläche läuft über einen
lokalen Server auf `127.0.0.1`, der das Modell für sie aufruft — im Browser
landet nie ein Schlüssel.

---

## Mehr Material einlesen

Je mehr echte Texte, desto schärfer das Profil. 15 bis 20 Beiträge sind die
Untergrenze; ab etwa 50 wird es spürbar stabiler.

```bash
python bernie.py lernen korpus/ mehr-posts.docx --name "Bernhard Feßler" --pruefen
```

Gelesen werden `.docx`, `.txt`, `.md`, `.csv`, `.html`, `.json`, `.jsonl` und
ganze Ordner. Doppelte Beiträge fliegen automatisch raus. Das Profil landet als
`korpus/stilprofil.json` und wird von allen Befehlen automatisch bevorzugt —
ohne eigenes Profil greift das mitgelieferte Demo-Profil.

**LinkedIn.** Profile lassen sich nicht abrufen: sie stehen hinter der
Anmeldung, und automatisches Auslesen verstößt gegen die Nutzungsbedingungen.
Drei erlaubte Wege zu denselben Texten:

1. **Datenexport** (empfohlen): LinkedIn → Einstellungen → Datenschutz → *Kopie
   Ihrer Daten* anfordern. Aus dem ZIP die `Shares.csv` nehmen — sie wird direkt
   verstanden.
2. **Seite speichern**: Profil öffnen, Beiträge aufklappen, mit `Strg`+`S` als
   HTML sichern, diese Datei übergeben.
3. **Kopieren**: Beiträge in eine `.txt` oder `.docx` einfügen, je Beitrag eine
   Leerzeile dazwischen.

---

## Befehle

```bash
python bernie.py                                  Oberfläche im Browser
python bernie.py "Text ..."                       übersetzen, mit Note
python bernie.py uebersetzen text.docx -v         aus einer Datei
python bernie.py uebersetzen "..." -s 1.4         stärker aufgedreht (0.5–1.5)
python bernie.py uebersetzen "..." -m offline     ohne Sprachmodell
python bernie.py klartext "Text mit 🚀🚀🚀"        Gegenrichtung
python bernie.py pruefen "Text"                   Wie nah am Profil?
python bernie.py profil                           gelerntes Profil anzeigen
python bernie.py lernen <quellen> --pruefen       neu lernen und prüfen
python bernie.py anbieter                         Sprachmodelle anzeigen
python bernie.py web --port 8080                  Oberfläche auf anderem Port
python tools/html_erzeugen.py                     eigenständige HTML-Datei bauen
```

Alle Befehle können mit `--json` maschinenlesbar ausgeben.

Als Programmbibliothek:

```python
from berniespeaks import Stilprofil, Uebersetzer, bewerte

profil = Stilprofil.laden()
print(bewerte("Ein Text 🚀🚀", profil).punkte)
print(Uebersetzer(profil).zu_bernie("Ich schaffe es nicht bis Freitag.").text)
```

---

## Aufbau

```
bernie.py                          Startpunkt
beispiel/demokorpus.jsonl          14 erfundene Beiträge -- Demo und Testgrundlage
korpus/                            eigenes Material, NICHT im Repository
    LIESMICH.md                    was hier hineingehört
    stilprofil.json                daraus gelerntes Profil (bleibt lokal)
src/berniespeaks/
    text.py                        Emojis, Wörter, Satzgrenzen — reine Messtechnik
    merkmale.py                    die 19 Kennzahlen
    korpus.py                      Word, LinkedIn-Export, HTML, Text einlesen
    analyse.py                     Keyness, Mustersuche, Namensschutz, Profil
    score.py                       Bewertung und Abweichungen
    inhalt.py                      Was steht drin: Aussage, Zahlen, Anliegen
    llm.py                         Anbindung an Claude, Groq, OpenRouter, Ollama
    uebersetzer.py                 beide Richtungen, Regelkreis, Offline-Generator
    cli.py / web.py                Bedienung
    ui/index.html                  Oberfläche für den lokalen Server
    ui/standalone.html             Vorlage der eigenständigen Fassung
    ui/api.php                     Vermittler für den Webspace (Schlüssel serverseitig)
    daten/hintergrund_de.json.gz   deutsche Normalhäufigkeiten (Referenz)
    daten/stilprofil.json          Demo-Profil aus dem Demo-Korpus
tools/
    hintergrund_erzeugen.py        Referenzdaten neu bauen (braucht `wordfreq`)
    korpus_erzeugen.py             Korpus aus Word + Beitragsgrenzen bauen
    html_erzeugen.py               eigenständige HTML-Datei bauen
tests/test_stil.py                 56 Testfälle
```

Zur Laufzeit werden **keine** Fremdpakete gebraucht — wie beim
Newsletter-Konverter, damit sich beides als einzelne `.exe` weitergeben lässt.
`wordfreq` wird nur einmal beim Erzeugen der Referenzdaten benötigt.

---

## Grenzen

* **Der Offline-Modus formuliert nicht um.** Er trifft die Form, nicht die
  Wortwahl. Für „schreibt es wirklich in seinen Worten" braucht es ein
  Sprachmodell.
* **14 bis 22 Beiträge sind wenig.** Merkmale mit großer Streuung (Wortdehnung,
  Hashtags, Doppelausruf) sind entsprechend unsicher. Mehr Material hilft direkt.
* **Die Notenskala ist an diesem Korpus geeicht**, weil dieselben Beiträge
  Sollwerte *und* Vergleichswerte liefern. Für eine strenge Prüfung Beiträge
  zurückhalten und erst danach bewerten.
* **Die Namenserkennung ist eine Heuristik.** Sie greift die klaren Fälle ab,
  fängt aber nicht jeden Namen — vor einer Weitergabe des Profils bitte
  durchsehen.
* **Das echte Material enthält personenbezogene Daten Dritter** (Namen aus
  LinkedIn-Beiträgen, eine E-Mail-Adresse, interne Absprachen). Deshalb liegt es
  in `korpus/` und ist von `.gitignore` ausgenommen. Wer das Repository auf
  privat stellt, kann das ändern — solange es öffentlich ist, besser nicht.
