# telli. — Produkt-Website

Vorstellungsseite für **telli.**, eine iOS-App zum Erfassen von Migräne und weiteren
chronischen Beschwerden. Keine Web-App, aber jede Demo auf der Seite ist echt
bedienbar — mit Maus, Touch und Tastatur.

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # nach dist/, statisch ausliefern (Vercel, Netlify, …)
npm run preview    # gebautes Ergebnis ansehen
npm run typecheck
```

Keine Umgebungsvariablen, kein Backend, keine Analytics, kein Consent-Banner.

---

## Aufbau

```
src/
  tokens.css              die vier Themes, unverändert aus dem Designordner
  global.css              Schrift, Basiswerte, Typo-Bausteine, Themewechsel
  App.tsx                 Hero + Sheet + Abschnitte
  sections/               ein Abschnitt je Datei
  components/
    PhoneFrame.tsx        Geräterahmen, skaliert in rem
    SeverityScale.tsx     bedienbarer 0–10-Regler
    DoseChecklist.tsx     abhakbarer Einnahmeplan
    InsightChart.tsx      Auswertung mit Zeitraumwechsel
    ThemeSwitch.tsx       vier Themes live
    FaceMark.tsx          animiertes Gesicht (SVG)
    Nav.tsx, Knopf.tsx, Eintritt.tsx, Warteliste.tsx
  hooks/
    useSpringDrag.ts      1:1-Tracking, Momentum, Gummiband, Velocity-Handoff
    useInViewOnce.ts      Scroll-Eintritt genau einmal
    useTheme.ts           data-telli-theme auf <html>
    useReduziert.ts       prefers-reduced-motion
  lib/
    motion.ts             Federn, Projektion, Gummiband
    data.ts               Beispieldaten der Auswertung
design/                   Vorlage: PROMPT.md, apple-design.md, Screens, Assets
```

## Bewegung

Grundlage ist `design/apple-design.md`. Bewegt werden ausschließlich `transform`
und `opacity`.

| Zweck | Wert |
| --- | --- |
| Standard-Feder | `bounce: 0`, `duration: 0.35` |
| nach einer Geste | `bounce: 0.2`, `duration: 0.4` |
| Scroll-Eintritt | 12 px, 340 ms, 50 ms Versatz, einmalig |
| `reduce` | Überblendung in 120 ms |

Der Regler ist der Prüfstein: 1:1-Tracking mit Greifpunkt und `setPointerCapture`,
Gummiband an den Enden, Momentum-Projektion beim Loslassen, Velocity-Handoff an
die Feder — und jederzeit unterbrechbar, weil die Position eine MotionValue ist
und jede Bewegung vom aktuellen Bildschirmwert startet.

Zwei bewusste Abweichungen von der Vorlage, beide im Code kommentiert:

* **Wurfweite begrenzt.** Die Projektionsformel aus `apple-design.md` §6 ist für
  Scrollflächen gedacht und wirft schon bei 500 px/s rund 250 px weit. Auf einer
  Bahn von etwa 300 px läge damit jede zügige Geste am Anschlag, deshalb wird der
  Wurf auf anderthalb Rastschritte gedeckelt (`useSpringDrag.ts`).
* **Sprung ohne Geschwindigkeit.** Ein Tippen auf die Bahn setzt die Position per
  `jump()` statt `set()`, sonst flösse der Sprung als Geschwindigkeit in die
  Projektion ein und der Wert würde weitergeworfen.

## Farben

Alle Farben kommen aus `tokens.css`; das Theme hängt am Attribut
`data-telli-theme` auf `<html>` und wird vor dem ersten Paint gesetzt.

* Kein Signalrot — Schwere zeigt sich über Sättigung und Füllgrad.
* Keine Verläufe, keine Rahmen, genau zwei Schattenwerte.
* Ruhiger Text steht durchgehend auf `--ink2`: `--ink3` bis `--ink5` erreichen in
  den hellen Themes bei normaler Schriftgröße keine 4,5:1. Die Hierarchie kommt
  aus Größe und Gewicht.
* In den dunklen Themes ist `--primary` ein Mittelton, auf dem weder helle noch
  dunkle Schrift 4,5:1 erreicht. Hauptknöpfe drehen sich dort um: helle Fläche,
  dunkle Schrift (`--knopf-flaeche` / `--knopf-text` in `global.css`).

## Zahlen

Alle Werte der Auswertung stehen in `src/lib/data.ts`. Die Wochenbalken summieren
sich exakt auf die Kopfschmerztage des Zeitraums, und jeder Nenner leitet sich aus
dem Zeitraum ab — bei den Zyklusfaktoren aus den Zyklustagen, sonst aus den
Kopfschmerztagen.

| Zeitraum | Tage | ⌀ Intensität | ⌀ Dauer | längste Pause | erfasst |
| --- | --- | --- | --- | --- | --- |
| 30 Tage | 7 | 6,1 | 5,8 h | 9 Tage | 26 von 30 |
| 90 Tage | 21 | 5,8 | 6,2 h | 12 Tage | 84 von 90 |
| Eigener | 12 | 5,4 | 6,0 h | 11 Tage | 48 von 52 |

## Warteliste

Ohne Backend. In `src/components/Warteliste.tsx` steht ein Platzhalter:

```ts
const WARTELISTE_ENDPUNKT = ''   // z. B. 'https://formspree.io/f/xxxxxxxx'
const WARTELISTE_MAIL = 'warteliste@telli.app'
```

Ist der Endpunkt leer, öffnet das Formular das Mailprogramm. Beides muss vor dem
Start durch echte Werte ersetzt werden — ebenso die Links zu Impressum und
Datenschutz in `src/sections/Fusszeile.tsx`.

## Schrift

Plus Jakarta Sans liegt selbst gehostet unter `public/fonts/` (Latin und
Latin-Ext, variabel 400–700). Die Ersatzschrift bekommt in `global.css` die
gemessenen Metriken der echten Schrift aufgezwungen, damit `font-display: swap`
keinen Layout-Shift erzeugt.

## Gemessen

Lighthouse (mobil, gebautes Ergebnis): Performance 98, Accessibility 100,
Best Practices 100, SEO 100, CLS 0. axe-core meldet in allen vier Themes keine
Verstöße. Bei 320 px Breite läuft nichts über, bei 200 % Textgröße bricht nichts.
