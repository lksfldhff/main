# GTA Heilbronn – Open-World-Browserspiel (Prototyp)

Ein eigenständiges 3D-Open-World-Spiel im Browser, gebaut auf **echten Geodaten von Heilbronn**.
Alle Modelle, Shader und UI-Elemente sind selbst erstellt. Fremde Spiel-Assets, Logos oder
Sounds werden nicht verwendet.

> **Stand: Phase 3 – Fahrzeuge & Datenabgleich.** Begehbare und befahrbare Innenstadt mit
> Autos, OSM-Details (Markierungen, Ampeln, Überwege, echte Bäume) und echten Dachfarben aus Luftbildern.
>
> Phase 2 – Echtes Heilbronn: Die Innenstadt mit Marktplatz, Rathaus,
> Kilianskirche, Neckar und Experimenta ist begehbar: 1.684 reale Gebäude (amtliche
> 3D-Gebäudemodelle), echtes Gelände und amtliche Flächennutzung.
> Das prozedurale Testviertel aus Phase 1 lässt sich weiterhin über `?world=test` aufrufen.

---

## Schnellstart

Voraussetzung: **Node.js ≥ 20** und ein aktueller Desktop-Browser mit Hardwarebeschleunigung.

```bash
npm install
npm run dev        # → http://localhost:5173
```

| Befehl              | Zweck                                                      |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Entwicklungsserver mit Hot Reload                          |
| `npm run typecheck` | TypeScript-Prüfung                                         |
| `npm run build`     | Typecheck + Produktions-Build nach `dist/`                 |
| `npm run preview`   | Produktions-Build lokal ausliefern (http://localhost:4173) |

`dist/` lässt sich auf jeden normalen Webserver kopieren, auch in einen Unterordner.
Alle Karten- und Texturdaten liegen vorverarbeitet im Projekt (`public/`). Das Spiel ruft
**zur Laufzeit keine externen APIs** auf.

URL-Parameter: `?world=test` lädt das Phase-1-Testviertel statt Heilbronn.

## Steuerung

| Taste           | Aktion                                  |
| --------------- | --------------------------------------- |
| `W` `A` `S` `D` | Bewegen (relativ zur Kamera)            |
| Maus / Mausrad  | Kamera drehen / Abstand                 |
| `Shift`         | Rennen                                  |
| `Leertaste`     | Springen                                |
| `E` / `F`       | Interagieren · ins Auto ein-/aussteigen |
| `Esc`           | Pause-Menü                              |
| `F3`            | Leistungsanzeige                        |

## Was Phase 3 bringt

**Fahrzeuge**
- Etwa 70 geparkte Autos stehen am echten Straßenrand: Limousine, Kompaktwagen, SUV,
  Transporter, Heilbronner Taxi in Elfenbein, Polizei in Blau-Silber. Direkt neben dem
  Startpunkt parkt ein roter Sportwagen.
- Alle Modelle sind prozedural und realistisch proportioniert, mit Klarlack-Glanz, getöntem
  Glas, Felgen, Licht und Bremslichtern. Bei der Polizei blinkt das Blaulicht.
- Die Fahrphysik nutzt Rapiers Raycast-Fahrzeug: Federung, Reifenhaftung, Hinterradantrieb,
  geschwindigkeitsabhängige Lenkung, Abtrieb und Luftwiderstand. Die Handbremse
  (`Leertaste`) lässt das Heck ausbrechen, für Drifts. Kippt das Auto um, wird es nach
  zwei Sekunden wieder aufgerichtet.
- Steuerung im Auto: `W`/`S` Gas, Bremse und Rückwärtsgang, `A`/`D` lenken, `E` aussteigen.
- Die Verfolgerkamera schwingt in Kurven mit, das Sichtfeld weitet sich mit dem Tempo, und
  die Maus kann frei um das Auto kreisen. Ein runder Tacho zeigt km/h und Gang.

**Abgleich mit weiteren Kartendaten**
- **OpenStreetMap** (ODbL) ergänzt die Landesdaten:
  - Fahrbahnmarkierungen nach Spuranzahl (Leitlinien 3 m Strich / 6 m Lücke,
    Doppellinie bei vier Spuren)
  - Stadtbahngleise in der Kaiserstraße
  - Fußgängerzonen als Pflaster: Kaiserstraße, Fleiner und Sülmer Straße
  - 87 Zebrastreifen und Ampelfurten, 68 Ampeln, 183 echte Baumstandorte, 134 Bänke,
    30 Bushaltestellen mit H-Schild und 8 Brunnen
  - Fassadenmaterial aus OSM: Sandstein, Klinker, Beton, Metall
  - Kupferdächer und die **historische Rathausuhr** an ihrer echten Position
- **Luftbilder (DOP20, 20 cm)** des LGL liefern für jedes Dach seine echte Farbe (Median der
  Dachfläche). Kupfer, Schiefer, Ziegel und Kies stehen dort, wo sie wirklich sind.
- Die Experimenta hat jetzt eine helle Glasfassade. Spiegelungen kommen aus einem Himmel mit
  hellem Horizont statt aus der HDR-Aufnahme mit schwarzem Boden.

**Grafik:** Die Texturen liegen jetzt in 2K vor (Normal-Maps 1K). Auf Qualitätsstufe „Hoch“
werden sie voll genutzt, darunter mit 1K. Die Bäume haben eine detailliertere Krone mit Ästen.

## Was Phase 2 bringt

**Echte Stadt**

- **Gebäude:** LoD2-3D-Gebäudemodelle des Landesamts für Geoinformation (LGL). Sie enthalten
  echte Grundrisse, Höhen und Dachformen (Sattel-, Walm-, Pult-, Flachdächer). Gotische
  Kirchendächer, das Rathaus, die Experimenta und die Neckarbrücken sind enthalten.
- **Gelände:** Das digitale Geländemodell DGM1 (1-m-Raster, im Spiel 2 m) bildet die
  Neckarufer, Rampen und Höhenunterschiede ab. Die Physik nutzt dasselbe Gelände als
  Heightfield.
- **Flächen:** Die amtliche ALKIS-Nutzung liefert Straßen, Plätze, Wege, Grünflächen, Gleise und
  den Neckar. Daraus werden zusätzlich Gehwege mit Bordsteinkante abgeleitet.
- **Orte:** Straßen- und Platznamen aus ALKIS erscheinen unten rechts im HUD,
  zum Beispiel „Marktplatz · Heilbronn Innenstadt“.
- Bäume in Grünflächen und Straßenlaternen entlang der Gehwege werden automatisch platziert.

**Grafik**

- Ein **Fassaden-Shader** passt Fensterachsen und Stockwerke exakt an jede echte Wand an.
  Dazu kommen Rahmen, Fensterbänke, Laibungsschatten, Ladenfronten mit farbigen Schildern,
  Sockel, Gesimse, Vorhänge, einzelne beleuchtete Räume und spiegelndes Glas. Kirchen bekommen
  gotische Spitzbogenfenster mit Buntglas.
- **Zehn Gebäudestile** werden automatisch aus Gebäudefunktion, Dachform und Höhe abgeleitet:
  Altbau, Nachkriegsbau, Moderne, Glas, Sandstein-Kirche, Gewerbe, Garage, Klinker, Brücke
  und historisch (Rathaus).
- **Echte PBR-Texturen** (CC0 von Poly Haven): Putz, Klinker, roter Sandstein, Beton,
  Wellblech, Dachziegel, Schiefer, Asphalt, Gehwegplatten, Sandsteinpflaster, Rasen, Kies.
- Das **Umgebungslicht** stammt aus einer echten HDR-Himmelsaufnahme, mit dynamischen Schatten.
- **Postprocessing:** Ambient Occlusion (GTAO), Farbgrading (warme Lichter, kühle Schatten,
  Vignette), 4×-MSAA bzw. FXAA. Die Stufe ist einstellbar unter *Einstellungen → Effekte*.
- Der Neckar hat animierte Wellen. Fällt man hinein, wird man ans Ufer zurückgesetzt.
- **Performance:** Gebäude werden in 200-m-Chunks gebündelt (2 Draw Calls pro Chunk). Das
  Gelände hat drei Detailstufen (LOD) mit Randschürzen. Feine Fensterdetails werden in der
  Ferne ausgeblendet, damit nichts flimmert.

**Spielfigur:** Eigene Modelle lassen sich jetzt einbinden (siehe unten). Ohne eigenes Modell
wird die Platzhalter-Figur genutzt.

## Eigene 3D-Modelle

### Spielfigur (empfohlen: Mixamo)

1. Auf [mixamo.com](https://www.mixamo.com) (kostenloses Adobe-Konto) eine Figur auswählen.
2. Die Figur als **FBX, „With Skin“** herunterladen und als `character.fbx` speichern.
3. Animationen **Idle**, **Walking**, **Running** und **Jump** jeweils als FBX,
   **„Without Skin“** und mit **„In Place“** laden. Speichern als `idle.fbx`, `walk.fbx`,
   `run.fbx` und `jump.fbx`.
4. Alles nach `public/models/player/` legen und das Spiel neu laden.

Alternativ geht eine einzelne `public/models/player/player.glb` mit Animationen, deren Namen
`idle`, `walk`, `run` bzw. `jump` enthalten. Die Größe wird automatisch auf 1,80 m normiert.
Die Animationsgeschwindigkeit passt sich dem Lauftempo an, und zwischen Animationen wird weich
überblendet.

### Wahrzeichen (geplant)

Die LoD2-Daten zeigen Gebäude mit korrekter Form, aber ohne Fassadendetails. Für Kilianskirche,
Rathaus (mit astronomischer Uhr), Götzenturm und Experimenta kann man später detaillierte
GLB-Modelle aus Blender oder Sketchfab (Lizenz beachten) einsetzen. Sie ersetzen dann das
jeweilige LoD2-Gebäude. Das Format: GLB, Meter-Maßstab, Ursprung am Boden.

## Datenpipeline (Geodaten neu erzeugen)

Die fertigen Spieldaten liegen in `public/data/heilbronn/` (rund 6 MB). Neu erzeugen muss man
sie nur, wenn sich Gebiet oder Logik ändern:

```bash
pip install -r tools/geo/requirements.txt
python tools/geo/fetch_lgl.py          # lädt LGL-Daten, Luftbilder und OSM nach .geodata/ (~600 MB, nicht im Git)
python tools/geo/build_heilbronn.py    # erzeugt public/data/heilbronn/ (~20 s)
python tools/assets/fetch_textures.py  # nur bei Änderungen an der Texturliste
```

- Gebiet, Ursprung und Auflösungen stehen in `tools/geo/config.py`. Aktuell sind es
  1,1 × 1,4 km zwischen Neckar/Experimenta und Kilianskirche. Der Ursprung (0, 0, 0) liegt am
  Marktplatz.
- Ausgabe: `meta.json` (Index, Orte, Lizenz), `terrain.bin` (Höhen), `buildings.bin`
  (triangulierte Wände und Dächer mit Fassaden-Attributen), `landuse.png` (Flächenklassen im
  0,5-m-Raster), `water.bin`.
- Koordinaten: Rohdaten in ETRS89/UTM32 (EPSG:25832), im Spiel lokale Meter
  (`+X` Ost, `+Y` oben, `−Z` Nord).

## Architektur

```
src/
├── core/            Game (Zustandsautomat), GameLoop, Settings, EventBus, config
├── rendering/       Renderer, Environment (Himmel/Sonne/HDRI), PostProcessing,
│   ├── materials/   Fassaden-, Dach-, Gelände- und Wasser-Shader
│   └── textures/    prozedurale Canvas-Texturen (Testviertel)
├── physics/         PhysicsWorld (Rapier: Trimesh, Heightfield, Raycasts)
├── input/           InputManager, KeyBindings
├── player/          PlayerController (Physik), Avatar-Interface,
│                    PlayerAvatar (Platzhalter), RiggedAvatar (GLB/FBX + Animationen)
├── camera/          ThirdPersonCamera
├── gameplay/        InteractionSystem
├── geo/             GeoProjection
├── world/
│   ├── World.ts     lädt einen District (Heilbronn oder Testviertel)
│   ├── heilbronn/   Datenlader, Terrain, Gebäude-Meshes, Stile, Flächenklassen
│   ├── districts/   TestDistrict (Phase 1)
│   └── …            Geometrie-Helfer, Requisiten, Gebäude-Generator
└── ui/              Startbildschirm, Pause, Einstellungen, HUD (inkl. Ortsanzeige)
tools/
├── geo/             Python-Pipeline: LGL-Rohdaten → Spieldaten
└── assets/          Textur-Download (Poly Haven)
```

## Bekannte Einschränkungen

- **Kein Verkehr und keine Fußgänger.** Die Autos parken nur. KI-Verkehr ist der nächste Schritt.
- **Fahrzeugschäden fehlen noch.**
- **Bordsteine sind nur optisch** (Shader-Kante). Gehwege sind nicht erhöht.
- **Wahrzeichen sind vereinfacht** (LoD2): Dachformen stimmen, Turmspitzen und Ornamente fehlen.
- **Die Spielfigur** bleibt ein Platzhalter, bis ein Mixamo- oder GLB-Modell hinterlegt ist.
- **Schwimmen gibt es noch nicht.** Wer in den Neckar fällt, wird ans Ufer gesetzt.
- **Kein Tag-Nacht-Zyklus und kein Bloom.** Bloom wird erst bei Nacht sinnvoll.
- **Bundle:** etwa 5 MB JS (1,9 MB gzip, davon etwa 3 MB Physik-WASM), dazu etwa 12 MB Daten
  und Texturen.
- **Hardware:** Empfohlen ist eine dedizierte oder aktuelle integrierte GPU. Für schwächere
  Rechner gibt es in den Einstellungen *Effekte: Aus*, *Schatten: Mittel* und eine reduzierte
  Renderauflösung.
- **Name:** „GTA“ ist eine Marke von Take-Two/Rockstar. Vor einer Veröffentlichung sollte ein
  eigener Titel gewählt werden (`src/core/config.ts`).

## Lizenzen und Quellen

- **Geodaten:** © Landesamt für Geoinformation und Landentwicklung Baden-Württemberg (LGL),
  [www.lgl-bw.de](https://www.lgl-bw.de), Lizenz
  [Datenlizenz Deutschland – Namensnennung – 2.0](https://www.govdata.de/dl-de/by-2-0).
  Verwendet werden das 3D-Gebäudemodell LoD2, das DGM1 und ALKIS. Der Quellenhinweis steht
  auch auf dem Startbildschirm.
- **OpenStreetMap:** Kartendaten © OpenStreetMap-Mitwirkende, [ODbL](https://www.openstreetmap.org/copyright).
- **Luftbilder (DOP20):** © LGL, dl-de/by-2-0. Sie dienen nur zur Ermittlung der Dachfarben
  und werden nicht mitgeliefert.
- **Texturen und HDRI:** [Poly Haven](https://polyhaven.com), CC0 (Liste in
  `public/assets/CREDITS.txt`).
- **Bibliotheken:** Three.js (MIT), Rapier (Apache-2.0), Vite (MIT).
