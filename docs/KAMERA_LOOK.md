# Kamera & Look (Cinematic Post-Processing)

Einstellungen → **Kamera & Look**: Preset, Ein/Aus, Vorher/Nachher (geteilter Bildschirm), Performance-Modus und je ein Regler pro Effekt. Alles wirkt sofort (nur Uniform-Updates, kein Neuladen).

## Pipeline (Grafikqualität Mittel/Hoch)

```
RenderPass (HDR, Half-Float)  →  GTAO (nur Hoch)  →  MistBloomPass (1/2 … 1/32 Auflösung)
  →  CinematicPass (1 Vollbild-Pass)  →  FXAA (Mittel; Hoch nutzt 4× MSAA)
```

`CinematicPass` ersetzt OutputPass + bisherigen Grading-Pass und macht in einem Shader:
Objektiv-Verzeichnung → chromatische Aberration (3 Taps nur wenn aktiv) → Bloom + Black-Pro-Mist im HDR →
ACES-Tonemapping (gleiche Kurve und Belichtung wie der Renderer) → sRGB → Color Grading → Vignette → Filmkorn.

| Effekt | Umsetzung |
| --- | --- |
| Black Pro-Mist | breite Streuung (1/8-Auflösung) nur aus Lichtern über der Schwelle, mit leichter Kontrastsenkung in den Lichtern; Schwarz bleibt tief |
| Bloom | Soft-Knee-Schwelle (1,6 nach Belichtung), 13-Tap-Downsample + Tent-Upsample (Call-of-Duty-Verfahren), Firefly-Clamp |
| Chromatische Aberration | radial, quadratisch: Mitte unverändert, max. ≈0,45 % am Rand |
| Filmkorn | geglättetes Value-Noise (≈1,5 px Korn), 24 Bilder/s stabil, in Mitteltönen am stärksten |
| Vignette | elliptisch, sehr weicher Verlauf ohne Kante |
| Color Grading | Looks `gta`, `neutral`, `film`, `golden`: Black-Lift, S-Kurve, Highlight-Roll-off, Vibrance (schont Hauttöne), kühle Schatten / warme Lichter |
| Verzeichnung | leichte Tonne, tastet nie außerhalb des Bildes ab |
| Dunst | nutzt den vorhandenen Szenen-Nebel (Entfernungsfaktor pro Preset), keine Volumetrik |

## Presets

| Preset | Mist | Bloom | CA | Korn | Vignette | Grading | Verzeichnung | Dunst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GTA Cinematic | 45 % | 35 % | 25 % | 25 % | 45 % | 100 % gta | 20 % | 0,97 |
| Realistic DSLR | 20 % | 25 % | 15 % | 10 % | 30 % | 80 % neutral | 15 % | 1 |
| Analog Film | 50 % | 30 % | 20 % | 65 % | 55 % | 100 % film | 25 % | 0,95 |
| Clean Gameplay | 0 | 0 | 0 | 0 | 20 % | 60 % neutral | 0 | 1,15 |
| Golden Hour | 65 % | 55 % | 20 % | 25 % | 50 % | 100 % golden | 20 % | 0,88 |

## Performance

- Kein zusätzliches Rendern der Szene, keine Vollauflösungs-Blur: die Glow-Kette läuft auf 1/2 … 1/32 Auflösung (9 kleine Passes) und wird übersprungen, wenn Mist und Bloom auf 0 stehen.
- Alle Kamera-Effekte in **einem** Vollbild-Pass (vorher OutputPass + Grade-Pass = zwei).
- Keine Allokationen im Render-Loop; Größe und Pixel-Ratio über `EffectComposer.setSize`.
- **Performance-Modus**: ohne Glow-Kette und ohne Aberrations-Taps. Wird beim ersten Start auf Mobilgeräten / ≤ 4 Kernen / ≤ 4 GB automatisch aktiviert und schaltet sich ein, wenn das Spiel 8 s lang unter 28 FPS läuft (Hinweis im HUD, in den Einstellungen abschaltbar).
- Grafikqualität „Niedrig“ rendert weiterhin ohne Post-Processing.

## Bewusst weggelassen

- **Tiefenschärfe (DoF)**: bräuchte Tiefenpuffer und eine nicht schwellwertbasierte Blur-Kette → teuer; für Gameplay ohnehin unerwünscht. Kann später für Kamerafahrten (Menü) ergänzt werden.
- Kein SSR, keine Volumetrik; SSAO/GTAO bleibt wie bisher nur bei „Hoch“.
