# Word → Newsletter-HTML

Wandelt eine Word-Datei in fertiges HTML für den CleverReach-Versand um —
im bestehenden Layout des Newsletters (Kopfbild, gelbe Rubrik-Balken,
Artikel mit CTA-Link, dreispaltige Fußzeile, Tracking-Pixel).

Redaktionsablauf: Text in Word schreiben → Datei ins Programm ziehen →
**HTML kopieren** → in CleverReach in den Quelltext-Editor einfügen. Fertig.

---

## Schnellstart

**Variante A — als Windows-Programm (empfohlen für die Redaktion)**

1. `Newsletter-Tool.exe` doppelklicken (Bauanleitung siehe unten)
2. „Word-Datei wählen …“ → die fertige `.docx` auswählen
3. „HTML kopieren“ → in CleverReach einfügen

Über „Vorschau im Browser“ lässt sich das Ergebnis vorher ansehen,
unter „Hinweise“ stehen erkannte Probleme (z. B. Artikel ohne Link).

**Variante B — ohne Installation, mit Python**

```bash
python start.py                          # Fenster öffnen
python start.py newsletter.docx          # erzeugt newsletter.html
python start.py newsletter.docx --open   # und öffnet sie im Browser
```

Es wird nur Python 3.9+ benötigt, keine zusätzlichen Pakete.

---

## Wie die Word-Datei aufgebaut sein muss

Entscheidend sind die **Formatvorlagen** in Word (Register *Start* →
Formatvorlagen), nicht Schriftgröße oder Fettschrift von Hand.

| In Word | Wird im Newsletter zu | Beispiel |
| --- | --- | --- |
| **Überschrift 1** | Anrede über der Einleitung (`h1`) | „Liebe Leserinnen und Leser,“ |
| *Standardabsätze danach* | Einleitungstext | Vorwort der Geschäftsführung |
| **Überschrift 2** | Großer Bereichstitel (`h3`) | „Wirtschaftsregion aktiv“ |
| **Überschrift 3** | Rubrik mit gelbem Balken (`h2`) | „Fachkräfte“, „Aktuelles“ |
| **Überschrift 4** | Artikelüberschrift, verlinkt | „STADTRADELN 2026“ |
| *Standardabsatz* | Fließtext (`p`) | Artikeltext |
| *Absatz, der **nur** aus einem Link besteht* | CTA-Link mit Pfeil | „Jetzt anmelden →“ |
| Aufzählung / Nummerierung | `ul` / `ol` | Stichpunktliste |
| **fett** / *kursiv* | `<strong>` / `<em>` | Hervorhebungen |
| Umbruch mit `Shift`+`Enter` | `<br />` | „Herzliche Grüße“ + Name |
| Absatz mit `---` | Trennlinie | — |

Ein Bereich (Überschrift 2) und die direkt darauf folgende Rubrik
(Überschrift 3) landen im selben Abschnitt — wie in der Vorlage.
Eine Rubrik ohne Bereich darüber (z. B. „Highlight“) funktioniert ebenso.

### Links setzen

* **Artikelüberschrift:** Text der Überschrift 4 markieren → `Strg`+`K` → URL einfügen.
  Diese URL landet automatisch auf der Überschrift *und* wird für die Verlinkung genutzt.
* **CTA-Link:** eigener Absatz, komplett verlinkt, z. B. „Jetzt anmelden“.
  Der Pfeil `→` wird automatisch angehängt.
* `mailto:`-Links werden erkannt und ohne `target="_blank"` ausgegeben.

### Kopfdaten (optional)

Ganz oben im Dokument, jeweils eine Zeile:

```
Betreff: WHF Impulse – Ausgabe Mai 2026
Vorschautext: Neuer Markenauftritt, Filmwettbewerb und Termine aus der Region
```

`Betreff` wird zum `<title>`, `Vorschautext` zum unsichtbaren Preheader
(die Zeile, die im Postfach neben dem Betreff steht). Diese Zeilen
erscheinen **nicht** im sichtbaren Newsletter. Weitere mögliche Schlüssel:
`Titel`, `Datum`, `Ausgabe`, `Kopfbild` (URL eines abweichenden Headerbilds),
`Kopfbild-Link`.

### Wenn keine Formatvorlagen benutzt werden

Alternativ lassen sich die Rollen direkt in den Text schreiben:

```
[Bereich] Wirtschaftsregion aktiv
[Rubrik] Fachkräfte
[Artikel] Für Gründerinnen: Steuern im Blick behalten
[CTA] Jetzt anmelden | https://www.heilbronn-franken.com/event/infobites-steuern/
[Trenner]
```

Das funktioniert auch gemischt mit Formatvorlagen.

### Ebenen-Erkennung

Standardmäßig erkennt das Programm die Zuordnung selbst (`"word_mapping": "auto"`):
die **tiefste** verwendete Überschriftebene wird zur Artikelüberschrift, die
Ebene darüber zur Rubrik, die darüber zum Bereich. Wer also nur mit
Überschrift 1–3 arbeitet, bekommt trotzdem das richtige Ergebnis.
Feste Zuordnung ist in der `config.json` möglich:

```json
"content": { "word_mapping": { "1": "intro", "2": "rubrik", "3": "artikel" } }
```

Eine fertig ausgefüllte Beispieldatei liegt unter
[`beispiel/Newsletter-Vorlage.docx`](beispiel/Newsletter-Vorlage.docx) —
am besten als Kopiervorlage für jede neue Ausgabe verwenden.

---

## Bilder aus der Word-Datei

E-Mails können keine Bilder aus einer Word-Datei mitschicken; sie müssen im
Internet liegen. Deshalb gibt es in der `config.json` drei Betriebsarten:

| `images.mode` | Verhalten |
| --- | --- |
| `relative` (Standard) | Bilder werden neben die HTML-Datei in einen Unterordner geschrieben und relativ verlinkt — gut für die Vorschau |
| `url` | Verlinkt `images.base_url` + Dateiname — nach dem Upload in den CleverReach-Medienpool die richtige Wahl |
| `inline` | Bettet die Bilder direkt ins HTML ein — nur zum Anschauen, **nicht** zum Versenden |

Kopfbild und Fußzeilen-Logos sind ohnehin feste URLs aus der `config.json`
und davon nicht betroffen.

---

## Anpassen: `config.json`

Alles, was sich von Ausgabe zu Ausgabe **nicht** ändert, steht hier — der
Text kommt aus Word, der Rahmen aus dieser Datei:

* `brand` — Kopfbild-URL, Alt-Text, maximale Breite (650 px)
* `colors` — Dunkelblau `#06465E`, Petrol `#136F8B`, Gelb `#FFFC00` usw.
* `typography` — Schriftfamilie und Google-Fonts-URL
* `content` — CTA-Pfeil, Trennlinien-Regeln, Überschriften-Zuordnung
* `footer` — die drei Fußzeilen-Spalten (Kontakt, Herausgeber, Newsletter),
  Impressum-/Datenschutz-Links, Logos, Copyright (`{jahr}` wird ersetzt)
* `tracking_pixels` — die CleverReach-Zählpixel mit `[CLIENT_ID]` usw.

Das Programm sucht die `config.json` in dieser Reihenfolge: neben der
Word-Datei → im aktuellen Ordner → neben der `.exe`. So kann ein einzelner
Newsletter bei Bedarf eine eigene Konfiguration bekommen.

Das Layout selbst (HTML-Gerüst und CSS) steht in
[`templates/whf_newsletter.html`](templates/whf_newsletter.html).

---

## Windows-Programm bauen

Auf einem **Windows-Rechner** mit installiertem Python:

```
pip install pyinstaller
python build_exe.py
```

Ergebnis: `dist/Newsletter-Tool.exe` (läuft ohne Python-Installation) und
daneben die `config.json`. Beide Dateien zusammen weitergeben; zum Anpassen
von Fußzeile oder Farben genügt danach das Bearbeiten der `config.json`.

PyInstaller erzeugt nur Programme für das System, auf dem es läuft — die
`.exe` muss also unter Windows gebaut werden.

---

## Kommandozeile

```bash
python start.py newsletter.docx                    # newsletter.html daneben
python start.py newsletter.docx -o versand.html    # eigener Zielname
python start.py newsletter.docx --stdout           # HTML auf die Konsole
python start.py newsletter.docx --images url       # Bildmodus überschreiben
python start.py newsletter.docx -c meine.json      # andere Konfiguration
```

## Tests

```bash
python -m unittest discover -s tests
```

38 Tests prüfen das Einlesen der Word-Datei, die Ebenen-Erkennung, die
erzeugte HTML-Struktur, Maskierung von Sonderzeichen und die Konfiguration.

## Aufbau des Projekts

```
start.py                          Startpunkt (Fenster oder Kommandozeile)
build_exe.py                      baut die Windows-.exe
config.json                       Farben, Kopfbild, Fußzeile, Tracking
templates/whf_newsletter.html     HTML-Gerüst und CSS des Newsletters
beispiel/Newsletter-Vorlage.docx  ausgefüllte Beispiel-Word-Datei
src/word2newsletter/
    docx_reader.py                liest .docx (ohne Fremdbibliotheken)
    blocks.py                     Datenmodell zwischen Word und HTML
    renderer.py                   baut Intro, Abschnitte, Artikel, CTA
    config.py                     Konfiguration und Standardwerte
    gui.py                        Fenster-Version
    cli.py                        Kommandozeile
tools/beispiel_erzeugen.py        erzeugt die Beispiel-Word-Datei neu
tests/                            Testfälle
```

## Grenzen

* Word-Dateien im alten Format `.doc` werden nicht gelesen — in Word einmal
  als `.docx` speichern.
* Textfarben, Schriftarten und Spaltenlayouts aus Word werden bewusst
  **nicht** übernommen: Das Aussehen kommt aus der Vorlage, damit jede
  Ausgabe gleich aussieht.
* Word-Tabellen werden als einfache HTML-Tabellen ausgegeben.
