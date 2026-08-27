# Particle Image – Analyse & Nachbau

Nachbau des ["Particle Image"-Effekts von React Bits Pro](https://pro.reactbits.dev/docs/components/particle-image):
*„an image dissolved into GPU particles that swirl apart and reassemble"* – ein Bild, das in
GPU-Partikel aufgelöst wird, auseinanderwirbelt und sich wieder zusammensetzt.

Der Code hier ist eine **eigenständige Neuimplementierung von Grund auf** (kein kopierter
Quelltext der Pro-Bibliothek), ohne Abhängigkeiten, mit WebGL-Renderer und Canvas-2D-Fallback.

**Demo ausprobieren:** `demo.html` einfach im Browser öffnen (funktioniert offline per Doppelklick).

---

## 1. Wie der Original-Effekt funktioniert

Der Effekt gehört zu einer bekannten Familie von „Image-to-Particles"-Techniken
(im Original zusammen mit der Schwester-Komponente *Particle Text*, die dieselben
Stellschrauben dokumentiert: `particleSize`, `particleGap`, `friction`, Maus-Interaktion).
Die Pipeline besteht aus vier Bausteinen:

### a) Bild abtasten (Sampling)
Das Quellbild wird in ein unsichtbares `<canvas>` gezeichnet und per
`getImageData()` pixelweise ausgelesen. Auf einem Raster mit Schrittweite
`particleGap` wird für jeden ausreichend deckenden Pixel (Alpha über einem
Schwellwert) ein **Partikel** erzeugt, das sich zwei Dinge merkt:

- seine **Heimatposition** (wo der Pixel im fertigen Bild liegt) und
- seine **Farbe** (RGBA des Pixels).

Je kleiner der Gap, desto mehr Partikel, desto feiner – und teurer – das Bild.

### b) Physik-Simulation
Jedes Partikel ist ein Massepunkt mit Position und Geschwindigkeit. Pro Frame wirken:

- **Federkraft** Richtung Heimatposition: `F = (heimat − position) · spring`
- **Reibung**: `v = (v + F) · friction` – der `friction`-Wert (0…1) bestimmt,
  wie schwungvoll oder träge sich alles anfühlt
- **Wirbelkraft**: eine Kraftkomponente **quer** zur Zugrichtung. Dadurch fliegen
  die Partikel nicht auf Geraden, sondern in Spiralen ein und aus – das ist das
  charakteristische „swirl apart / reassemble"
- **Maus-Abstoßung**: innerhalb von `mouseRadius` werden Partikel mit
  quadratisch abfallender Kraft vom Zeiger weggedrückt; lässt man los, ziehen
  die Federn sie zurück ins Bild

Für „auflösen" wird das Federziel von der Heimat auf ein zufälliges **Streuziel**
umgeschaltet (plus Anfangsimpuls nach außen und eine tangentiale Kraft um die
Bildmitte, damit die Wolke kreist statt stillzustehen). Für „zusammensetzen"
wieder zurück – zeitlich leicht gestaffelt, damit das Bild „hereinströmt".

### c) GPU-Rendering
Zehntausende Partikel jedes Frame per DOM oder `fillRect` zu zeichnen wäre zu
langsam. Das Original rendert deshalb per **WebGL**: alle Partikel liegen als
Typed-Array-Attribute (Position, Farbe, Größe) im GPU-Speicher und werden mit
**einem einzigen `POINTS`-Drawcall** gezeichnet. Ein Fragment-Shader formt aus
jedem Punkt-Sprite einen weichen, runden Punkt (`smoothstep` über den Abstand
zur Sprite-Mitte).

### d) React-Hülle
Eine Komponente kapselt Canvas + Engine, übernimmt Props als Optionen,
reagiert auf Resize/Unmount und stellt Methoden wie `dissolve()`/`assemble()` bereit.

---

## 2. Aufbau des Nachbaus

| Datei | Inhalt |
|---|---|
| `particle-image.js` | Die komplette Engine (UMD, keine Abhängigkeiten): Sampling, Physik, WebGL-Renderer, Canvas-2D-Fallback |
| `ParticleImage.jsx` | React-Wrapper mit Props + Ref-API für React-Projekte |
| `demo.html` | Eigenständige Demo mit Reglern, Bild-Upload und Drag-&-Drop (läuft per Doppelklick, ohne Server) |

Die Physik läuft mit festem Zeitschritt (60 Hz, unabhängig von der
Display-Refreshrate) auf der CPU über `Float32Array`s; nur die Positionen werden
pro Frame per `bufferSubData` zur GPU hochgeladen. Bis zur Obergrenze
`maxParticles` (Standard 60 000) bleibt das flüssig – darüber vergrößert die
Engine den Gap automatisch.

## 3. Verwendung

### Vanilla JS / beliebige Seite

```html
<canvas id="fx" style="width: 100%; height: 480px;"></canvas>
<script src="particle-image.js"></script>
<script>
  const fx = new ParticleImage(document.getElementById('fx'), {
    src: 'logo.png',        // URL, <img> oder <canvas>
    particleGap: 4,
    particleSize: 2,
    mouseRadius: 110,
    mouseStrength: 9,
  });
  // fx.dissolve(); fx.assemble(); fx.toggle(); fx.burst(x, y);
</script>
```

### React

```jsx
import { useRef } from 'react';
import ParticleImage from './ParticleImage.jsx';

function Hero() {
  const fx = useRef(null);
  return (
    <div style={{ height: 480 }}>
      <ParticleImage
        ref={fx}
        src="/logo.png"
        particleGap={4}
        particleSize={2}
        mouseRadius={110}
        mouseStrength={9}
        friction={0.86}
        swirl={1}
      />
      <button onClick={() => fx.current.toggle()}>Auflösen / Zusammensetzen</button>
    </div>
  );
}
```

## 4. Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `src` | – | Bildquelle: URL, `HTMLImageElement` oder `HTMLCanvasElement` |
| `particleGap` | `4` | Rasterabstand beim Abtasten in CSS-Pixeln (kleiner = mehr Partikel) |
| `particleSize` | `2` | Punktdurchmesser in CSS-Pixeln (mit leichter Zufallsvariation) |
| `alphaThreshold` | `24` | Pixel mit geringerem Alpha werden übersprungen |
| `maxParticles` | `60000` | Obergrenze; der Gap wird sonst automatisch vergrößert |
| `padding` | `24` | Innenabstand des eingepassten Bilds zum Canvas-Rand |
| `spring` | `0.06` | Federkraft Richtung Heimatposition |
| `friction` | `0.86` | Geschwindigkeits-Dämpfung (0…1, höher = schwungvoller) |
| `swirl` | `1` | Stärke des Wirbelns beim Auflösen/Zusammensetzen (0 = geradlinig) |
| `scatterRadius` | `1.1` | Streuweite der aufgelösten Wolke relativ zur Canvas-Diagonale |
| `jitter` | `0.6` | Feines „Eigenleben" im zusammengesetzten Zustand |
| `assembleStagger` | `0.7` | Zeitliche Staffelung beim Zusammensetzen in Sekunden |
| `mouseRadius` | `110` | Wirkradius des Zeigers in CSS-Pixeln (`0` = aus) |
| `mouseStrength` | `9` | Abstoßungskraft des Zeigers |
| `mouseDrag` | `0.12` | Wie stark schnelle Zeigerbewegungen Partikel „mitreißen" |
| `autoAssemble` | `true` | Intro-Animation (verstreut → Bild) direkt nach dem Laden |
| `renderer` | `'auto'` | `'auto'` (WebGL, sonst Fallback), `'webgl'`, `'canvas2d'` |
| `pixelRatio` | `0` | `0` = `devicePixelRatio` (auf 2 begrenzt) |
| `onReady` | – | Callback `({ count, renderer })` nach dem Aufbau |

### Methoden

`assemble()`, `dissolve()`, `toggle()`, `isAssembled()`,
`burst(x, y, strength?)` (Druckwelle, wird bei Klick automatisch ausgelöst),
`setImage(src)`, `setOptions({...})`, `resize()`, `destroy()`.

## 5. Hinweise

- **CORS:** `getImageData()` funktioniert nur, wenn das Bild von derselben
  Herkunft stammt oder mit CORS-Headern ausgeliefert wird (die Engine setzt
  `crossOrigin="anonymous"`). Hochgeladene Dateien und generierte Canvases sind
  immer unkritisch.
- **Performance:** Standardwerte (Gap 4) ergeben je nach Bild ~10 000–40 000
  Partikel bei einem Drawcall – auf der GPU unproblematisch. Der
  Canvas-2D-Fallback ist deutlich langsamer; dort helfen größerer Gap oder
  kleinere Flächen.
- Die Demo zeichnet ihr Beispielbild selbst (Schriftzug + Orbit-Motiv), damit
  sie ohne Internet und ohne lokalen Server läuft.
