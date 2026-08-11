# Auftrag: Website für telli. — responsiv, interaktiv, Apple-Design-Motion

Baue eine öffentliche Produkt-Website für **telli.**, eine iOS-App zum Erfassen von Migräne und
weiteren chronischen Beschwerden. Die Website ist die Vorstellungsseite der App: sie erklärt, was
telli. tut, zeigt die Oberfläche interaktiv und führt zur Warteliste. Sie ist **keine Web-App**,
aber sie fühlt sich an wie eine — jede Demo ist echt bedienbar, nichts ist ein Screenshot mit
Play-Button.

Alle Designressourcen liegen in diesem Ordner (`assets/`, `tokens.css`, `screens/`). Die
Motion- und Interaktionsphilosophie steht in `apple-design.md` — lies sie zuerst und behandle sie
als verbindlich, nicht als Inspiration.

---

## 1. Stack

- **Vite + React + TypeScript**
- **Motion** (`motion/react`, vormals Framer Motion) für jede Bewegung. Keine CSS-Transitions für
  alles, was der Nutzer anfassen kann.
- **CSS Modules** oder Vanilla-CSS mit Custom Properties. Kein Tailwind, kein UI-Framework —
  die Tokens in `tokens.css` sind das System.
- **Lenis** für Scroll-Dämpfung, optional. Kein Scroll-Hijacking, keine erzwungenen Full-Page-Snaps.
- Keine Analytics-, Cookie- oder Consent-Banner. Statische Auslieferung (Vercel/Netlify).

Struktur:

```
src/
  tokens.css            # unverändert übernehmen
  App.tsx
  sections/             # eine Datei pro Abschnitt
  components/
    PhoneFrame.tsx      # iPhone-Rahmen, skaliert mit rem
    SeverityScale.tsx   # bedienbarer 0–10-Regler
    DoseChecklist.tsx   # abhakbarer Einnahmeplan
    InsightChart.tsx    # Balken mit Zeitraumwechsel
    ThemeSwitch.tsx     # vier Themes live
    FaceMark.tsx        # animiertes Gesicht (SVG, aus assets/)
  hooks/
    useSpringDrag.ts    # 1:1-Tracking + Velocity-Handoff + Rubberband
    useInViewOnce.ts
```

---

## 2. Marke und Ton

Der Name ist **„telli."** — mit Punkt, immer, auch im Fließtext. Wortmarke 700, letter-spacing
−0.03em, Farbe `--primary-text`.

Die Zielgruppe hat an schlechten Tagen Licht- und Reizempfindlichkeit. Daraus folgen harte Regeln:

- **Kein Signalrot, nirgends.** Schwere wird über Sättigung und Füllgrad gezeigt, nicht über Farbe.
- Keine Verläufe im Hintergrund, keine bewegten Farbflächen, keine Autoplay-Videos, kein Parallax
  über die gesamte Höhe, kein Flackern.
- Keine Krankheits-Dramatik in der Sprache. Beschreibend, nie kausal: „trat zusammen mit", nicht
  „ausgelöst durch". Keine Heilsversprechen, kein „endlich".
- Deutsch, Sie-frei — die App duzt. Kurze Sätze, keine Marketing-Superlative.

---

## 3. Designsystem

`tokens.css` enthält vier fertige Themes als Attribut-Selektoren:
`blau-hell` (Standard), `rosa-hell`, `blau-dunkel`, `rosa-dunkel`. Setze das Attribut
`data-telli-theme` auf `<html>` und ändere nie eine Farbe direkt — immer über die Variablen.

**Paletten**
- Blau: `#064789` primär · `#427AA1` Daten · `#EBF2FA` Fläche · `#17301C` Text · `#04724D` Energie
- Rosa: `#49416D` primär · `#BEA2C2` Akzent · `#508991` Daten · `#E0EFDE` Energie

**Typografie** — Plus Jakarta Sans, Gewichte 400/500/600/700.
Tracking ist größenabhängig (siehe `apple-design.md` §15): Display −0.03em, Headline −0.02em,
Body 0. Line-height eng bei großen Größen (1.05–1.15), luftig im Fließtext (1.5–1.6).
Alle Größen in `rem`, `clamp()` für Display-Größen. Abstände in `rem`, damit die Seite mit der
Textgröße des Nutzers mitwächst.

**Form**
- Radien: 24 (Zeilen, kleine Controls) · 32 (Kacheln) · 36–40 (Karten, Sheets) · 999 (alle Buttons,
  Chips, Switches).
- **Keine Rahmen.** Trennung durch Fläche, Abstand und genau einen Schatten:
  `0 12px 34px rgba(44,7,53,.05)`. Schwebende Elemente: `0 14px 40px rgba(44,7,53,.10)`.
- Der dunkle Hero (`--hero`) mit einem darüber geschobenen hellen Sheet (Radius 40 oben,
  −36px Versatz) ist das Leitmotiv der App. Übernimm es für den Website-Hero.

**Material** (Apple-Design §12): die Kopfnavigation ist eine schwebende, transluzente Pille
(`backdrop-filter: blur(20px) saturate(180%)`, Fläche `rgba` aus `--bg`), Inhalt scrollt darunter.
Kein 1px-Border darunter, sondern eine weiche Maske am Übergang. `prefers-reduced-transparency`
schaltet auf deckend.

---

## 4. Aufbau der Seite

Ein durchgehender Scroll, sieben Abschnitte. Jeder Abschnitt hat **eine** Aussage und **eine**
bedienbare Sache.

### 1 — Hero
Dunkle Fläche (`--hero`), volle Breite. Links Wortmarke, Headline, ein Satz, zwei Buttons
(„Auf die Warteliste" primär, „So funktioniert es" sekundär, scrollt weiter). Rechts das
Telefon mit dem Startscreen der App.

Headline: **„Dein Tagebuch für Tage, an denen nichts geht."**
Unterzeile: „telli. erfasst Migräne, ME/CFS und Magen-Darm-Beschwerden in wenigen Sekunden — und
zeigt dir, was damit zusammentraf."

Das Gesicht aus `assets/telli-startscreen.svg` zeichnet sich beim Laden per
`stroke-dashoffset` (Braue → Augen → Nase → Mund, 60 ms Versatz), die Punkte blenden versetzt ein.
Der Blick des Gesichts folgt dem Mauszeiger leicht (max. 3 px, gefedert, `damping 1.0`) — auf
Touch-Geräten und bei `reduce` entfällt das.

### 2 — Das Problem
Drei Kacheln auf `--surface2`, kein Schatten: „Notizen im Handy", „Papierkalender", „Erinnerung".
Kurze Zeile je Kachel, warum das im Arztgespräch nicht trägt. Nüchtern, kein Spott.

### 3 — Erfassen in Sekunden (interaktiv)
Der wichtigste Abschnitt. Links Text, rechts ein echtes Formular:

- **`SeverityScale`** — Regler 0–10, drag mit 1:1-Tracking. Der Griff ist eine gefüllte
  28-px-Scheibe in der Intensitätsfarbe mit weißem Kern, **ohne Rahmen und ohne Schatten**.
  Bahn 10 px auf `--surface2`, Füllung `--primary`. Beim Loslassen rastet er mit
  Momentum-Projektion auf den nächsten Ganzwert (`apple-design.md` §6), Velocity wird an die
  Feder übergeben (§5). Der Wertchip pulst 1 → 1.07 → 1. Tastatur: Pfeiltasten, Home/End,
  `aria-valuenow`.
- Darunter drei Symptom-Chips zum Umschalten (Lichtempfindlichkeit, Übelkeit, Nacken), Druck auf
  `pointerdown` sichtbar (Scale 0.97).
- Ein „Speichern"-Button löst die **Gesichts-Sequenz** aus: das Gesicht skaliert mit leichtem
  Überschwingen ein (`damping 0.8`, `response 0.3`), ein weicher Ring läuft nach außen, Text
  „Eintrag gespeichert", nach 1,65 s zurück. Danach ist das Formular wieder bedienbar.

Textaussage: aufschlüsseln statt zusammenfassen. „Orthostatische Beschwerden" ist als Begriff
unbrauchbar — telli. fragt Schwindel, Schwarzwerden vor den Augen und Schwäche nach dem Aufstehen
getrennt ab, jeweils auf einer Skala von 0 bis 10. Ärzte rechnen in dieser Skala.

### 4 — Medikamente (interaktiv)
Ein `DoseChecklist` mit drei Dosen (08:00 Metoprolol 50 mg, 14:20 Sumatriptan 50 mg,
22:00 Magnesium 300 mg). Abhaken: Kreis füllt sich radial (200 ms), Haken zeichnet sich per
`stroke-dashoffset` (220 ms), der Name wird durchgestrichen — der Strich läuft von links nach
rechts (180 ms) — die Zeile sinkt in der Sättigung, der Zähler oben („2 von 3") pulst.

Zweite Aussage im Abschnitt: Medikament per Foto der Packung erfassen oder manuell aus der
Datenbank, mit Nebenwirkungen. Als ruhige Liste, nicht als Feature-Wolke.

### 5 — Zusammenhänge (interaktiv, das Herzstück)
Ein `InsightChart` mit Zeitraum-Switch (30 Tage / 90 Tage / Eigener) als Pille. Der aktive Pill
**gleitet** zwischen den Positionen (`layoutId`), die Balkenhöhen **morphen** beim Wechsel statt
neu aufzubauen.

Echte Beispieldaten, konsistent zueinander — alle Nenner leiten sich aus den Kopfschmerztagen
des Zeitraums ab:

| Zeitraum | Tage | ⌀ Intensität | ⌀ Dauer | längste Pause | erfasst |
|---|---|---|---|---|---|
| 30 Tage | 7 | 6,1 | 5,8 h | 9 Tage | 26 von 30 |
| 90 Tage | 21 | 5,8 | 6,2 h | 12 Tage | 84 von 90 |
| Eigener | 12 | 5,4 | 6,0 h | 11 Tage | 48 von 52 |

Zusammenhänge (Balken, absteigend): Luftdruckabfall 73 % · Schlaf unter 6 Stunden 64 % ·
Tage 1–2 der Menstruation 58 % · Stress am Vortag 45 % · Alkohol 18 % („zu wenig Daten", grau).
Balkenfarbe: ≥ 60 % `--primary`, ≥ 40 % `--data`, darunter `--track`.

Begleitsymptome: Lichtempfindlichkeit 86 % · Übelkeit 67 % · Geräuschempfindlichkeit 52 % ·
Nackenbeschwerden 43 % · Aura 19 %.

Unter jedem Diagramm steht die Einordnung: **„Zusammentreffen ist keine Ursache."** Und einmal
sichtbar auf der Seite: telli. stellt keine Diagnose, alle Zahlen stammen aus den eigenen
Einträgen.

Balken wachsen aus der Grundlinie, sobald sie im Viewport sind (380 ms, 35 ms Versatz je Balken),
horizontale Balken von links (500 ms, 50 ms Versatz). Jeweils nur einmal, nicht bei jedem Scroll.

### 6 — Alles bleibt auf dem Gerät
Datenschutz als eigener Abschnitt, weil es Kaufgrund ist: lokale Speicherung, keine Konten,
Export als PDF/CSV für den Arzttermin. Vier kurze Punkte, kein Schloss-Icon-Kitsch.

### 7 — Darstellung + Warteliste
Der `ThemeSwitch` schaltet die **ganze Seite** live zwischen den vier Themes (Palette ×
Hell/Dunkel). Jede Palette-Karte zeigt ihre **eigenen** drei Farben, nicht die gerade aktiven.
Der Wechsel läuft als kurze Überblendung (200 ms), nie als harter Sprung.

Darunter das Warteliste-Formular: eine E-Mail-Zeile, ein Button, Inline-Validierung beim Verlassen
des Feldes (nicht beim Tippen, nicht erst beim Absenden). Erfolgsmeldung ersetzt das Feld
in-place, kein Modal. Ohne Backend: `mailto:` oder ein Formspree-Endpunkt, Platzhalter im Code
markieren.

Footer: Wortmarke, Impressum, Datenschutz, „In Vorbereitung — telli. funktioniert ohne Konto."

---

## 5. Interaktion und Motion — verbindlich

Grundlage ist `apple-design.md`. Die wichtigsten Punkte für diese Seite:

- **Feder statt Dauer.** Standard `bounce: 0`, `duration: 0.35`. Überschwingen (`bounce: 0.2`)
  nur, wenn eine Wurf- oder Zieh-Geste vorausging — Regler-Snap, Gesichts-Sequenz. Nie bei
  Elementen, die nur eingeblendet werden.
- **Antwort auf `pointerdown`**, nicht auf `click`. Jeder Button bekommt Scale 0.97 sofort.
- **1:1-Tracking** beim Regler, mit `setPointerCapture` und Respekt für den Greifpunkt.
- **Unterbrechbar.** Jede Bewegung startet vom aktuellen Bildschirmwert. Der Regler darf mitten
  im Snap neu gegriffen werden.
- **Momentum-Projektion** beim Loslassen:
  `ziel = position + (v/1000) * 0.998 / (1 - 0.998)`, dann auf den nächsten Rastwert.
- **Rubberband** an den Enden der Skala statt harter Stopp.
- **Symmetrische Wege.** Was von rechts kommt, geht nach rechts. `transform-origin` auf dem
  auslösenden Element.
- **Scroll-Eintritte** höchstens 12 px Weg, 340 ms, gestaffelt 40–60 ms, **einmalig**. Kein
  Element erscheint zweimal, kein Abschnitt bewegt sich beim Zurückscrollen erneut.
- Animiert werden ausschließlich `transform` und `opacity`.

**`prefers-reduced-motion: reduce`**: alles wird zur Überblendung in 120 ms. Kein Blickfolgen,
kein Gesichts-Zeichnen (das Gesicht steht sofort fertig), kein Ring, kein Balkenwachstum
(Endzustand direkt), kein Scroll-Versatz. Die Seite muss in diesem Modus vollständig verständlich
bleiben — das ist keine Notlösung, sondern der Modus, in dem die Zielgruppe an schlechten Tagen
surft.

---

## 6. Responsives Verhalten

Drei Bereiche, keine Gerätenamen:

- **schmal (< 44rem)** — eine Spalte. Das Telefon wird zur vollen Breite mit maximal 22rem Höhe,
  die interaktiven Demos stehen über dem Text. Die Navigation ist eine schwebende Pille unten,
  nicht oben — dort ist der Daumen.
- **mittel (44–68rem)** — zwei Spalten in Abschnitt 3–5, Hero noch einspaltig.
- **breit (> 68rem)** — Hero zweispaltig, Inhaltsbreite maximal 76rem zentriert, das Telefon
  sitzt sticky, während der Text daneben scrollt (nur in Abschnitt 3–5, und nur bei
  `hover: hover`).

Kein horizontales Scrollen bei 320 px Breite. Alle Touch-Ziele mindestens 44 px. Die
Karten-Slider (Gesundheitsübersicht) nutzen natives Snap-Scrolling mit `scroll-snap-type`,
niemals Auto-Play.

---

## 7. Abnahme

Die Seite ist fertig, wenn:

1. Regler, Checkliste, Zeitraum-Switch und Theme-Switch **wirklich bedienbar** sind — mit Maus,
   Touch und Tastatur.
2. Der Regler mitten in der Snap-Bewegung neu gegriffen werden kann, ohne zu springen.
3. Bei `prefers-reduced-motion: reduce` keine Bewegung mehr stattfindet und trotzdem alles lesbar
   und bedienbar ist.
4. Bei 320 px Breite nichts überläuft und bei 200 % Textgröße kein Layout bricht.
5. Kein Rot, kein Verlauf, kein Rahmen, kein zweiter Schattenwert auf der ganzen Seite.
6. Lighthouse: Performance ≥ 95, Accessibility 100. Kein Layout-Shift beim Laden der Schrift
   (`font-display: swap` + passende Fallback-Metriken).
7. Jede Zahl auf der Seite ist mit der Tabelle in Abschnitt 5 konsistent.

---

## 8. Was im Ordner liegt

- `apple-design.md` — Motion- und Interaktionsgrundlage, verbindlich.
- `tokens.css` — die vier Themes, unverändert übernehmen.
- `assets/telli-startscreen.svg` — Startscreen als Vektor, alle Formen mit IDs
  (`#face-brow`, `#face-eye-left`, `#face-eye-right`, `#face-nose`, `#face-mouth`,
  `#dot-1`…`#dot-3`, `#shape-large`…). Basis für die Hero-Animation.
- `assets/telli-app-icon-1024.png` — Wortmarke als Icon.
- `assets/darkmode-palette.svg` — Herleitung der Dunkelvariante.
- `screens/` — 21 Screens der App als PNG, Referenz für Layout, Abstände und Inhalte.
- `screens/auswertungen-vollstaendig.jpg` — der komplette Auswertungs-Screen, Vorlage für
  Abschnitt 5.
