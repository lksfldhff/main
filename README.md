# GTA Heilbronn – Open-World-Browserspiel (Prototyp)

Ein eigenständiges, stilisiertes 3D-Open-World-Spiel, das direkt im Browser läuft und
langfristig auf den echten Geodaten von Heilbronn (OpenStreetMap) basiert.
Alle Modelle, Texturen und UI-Elemente sind selbst erzeugt – es werden keine
fremden Spiel-Assets, Logos oder Sounds verwendet.

> **Stand: Phase 1 – Technische Grundlage.** Spielbar ist ein prozedurales
> *Testviertel* (kein echtes Heilbronn), das alle Kernsysteme abdeckt. Der Import der
> echten Kartendaten folgt in Phase 2.

---

## Schnellstart

Voraussetzung: **Node.js ≥ 20** (getestet mit Node 22) und ein aktueller Desktop-Browser
(Chrome, Edge, Firefox, Safari) mit aktivierter Hardwarebeschleunigung.

```bash
npm install        # Abhängigkeiten installieren
npm run dev        # Entwicklungsserver → http://localhost:5173
```

Weitere Befehle:

| Befehl              | Zweck                                                          |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Entwicklungsserver mit Hot Reload                              |
| `npm run typecheck` | TypeScript-Prüfung ohne Build                                  |
| `npm run build`     | Typecheck + Produktions-Build nach `dist/`                     |
| `npm run preview`   | Produktions-Build lokal ausliefern (http://localhost:4173)     |

Der Inhalt von `dist/` kann auf jeden normalen Webserver (auch in einen Unterordner)
kopiert werden – es gibt keine Server-Abhängigkeiten und keine externen API-Aufrufe.

## Steuerung

| Taste            | Aktion                                   |
| ---------------- | ---------------------------------------- |
| `W` `A` `S` `D`  | Bewegen (relativ zur Kamera)             |
| Maus             | Kamera drehen (Pointer Lock)             |
| Mausrad          | Kamera-Abstand                           |
| `Shift`          | Rennen                                   |
| `Leertaste`      | Springen                                 |
| `E`              | Interagieren (z. B. Litfaßsäule am Platz) |
| `Esc`            | Pause-Menü                               |
| `F3`             | Leistungsanzeige (FPS, Draw Calls …)     |

Tasten werden über `KeyboardEvent.code` gelesen und funktionieren daher auf QWERTZ- und
QWERTY-Tastaturen gleich. Falls der Browser Pointer Lock verweigert, kann die Kamera mit
gedrückter linker Maustaste gedreht werden. Ein Klick ins Bild holt den Pointer Lock zurück.

## Was in Phase 1 enthalten ist

- **Projekt-Setup:** Vite 8, TypeScript 7 (strict), Three.js r187, Rapier 0.21 (WASM-Physik).
- **Game-Loop:** feste Physik-Schrittweite (60 Hz) mit interpolierter Darstellung, also flüssig
  bei jeder Bildwiederholrate.
- **Rendering:** physikalisch basierte Materialien, ACES-Tonemapping, atmosphärischer Himmel mit
  Wolken, Image Based Lighting aus dem Himmel, Nebel und eine Sonne mit dynamischen Schatten.
  Der Schattenbereich folgt dem Spieler und ist auf Texel gerastert, damit nichts flimmert.
- **Prozedurale Texturen** (zur Laufzeit per Canvas erzeugt, keine Bilddateien): Fassaden mit
  Fenstern in 8 Stilen inklusive Roughness-Maps (glänzendes Glas, matter Putz), Asphalt,
  Gehwegplatten, Kopfsteinpflaster, Dachziegel, Sandstein-Kaimauer und Rasen. Einige Oberflächen
  haben zusätzlich Normal-Maps.
- **Gebäude-Generator:** baut Gebäude aus beliebigen Grundriss-Polygonen, also exakt dem
  Format, das OSM liefert. Er erzeugt ein Erdgeschoss (Laden, Sockel oder Glas),
  Obergeschosse mit Fensterraster, Gesimse und Geschossbänder, Flachdach mit Attika und
  Dachaufbauten sowie Satteldächer mit Dachüberstand. Konkave Grundrisse (L-Form) werden
  unterstützt.
- **Testviertel:** 4×4-Straßenraster mit Fahrbahnmarkierungen und Zebrastreifen, erhöhten
  Gehwegen mit Bordsteinen und Blockrandbebauung mit Innenhöfen und Durchgängen. Dazu ein
  Platz mit Uhrturm, Brunnen, Bänken und Baumring, ein Bürogebäude mit L-Grundriss und
  Pocket-Park sowie ein Fluss mit Kaimauer, Promenade und Geländer.
- **Spielfigur:** Kinematic Character Controller von Rapier. Er bietet Kollision, automatisches
  Hochsteigen von Bordsteinen und Stufen bis 35 cm, Steigungsgrenze, Gleiten an Wänden, Springen
  und Schwerkraft. Die stilisierte Figur hat eine prozedurale Lauf-, Renn- und Sprunganimation.
- **Third-Person-Kamera:** Über-die-Schulter-Ansicht mit weicher Verfolgung, Kamera-Kollision
  (die Kamera bleibt vor Wänden) und Gleiten am Boden beim Hochschauen. Beim Rennen weitet
  sich das Sichtfeld leicht.
- **Interaktionssystem:** generisch, damit später Fahrzeuge, Türen und Missionen andocken können.
  Die erste Interaktion ist die Litfaßsäule auf dem Platz.
- **UI:** Startbildschirm mit Ladezustand und Steuerungsübersicht, Pause-Menü, Einstellungen
  (Mausempfindlichkeit, Y-Invertierung, Schattenqualität, Renderauflösung, Sichtfeld,
  Leistungsanzeige; gespeichert in `localStorage`), Interaktionshinweise, Benachrichtigungen
  und ein Debug-Overlay.
- **Performance-Grundlagen:** Statische Geometrie wird pro Chunk (128 m) und Material zu wenigen
  großen Meshes zusammengefasst. Das spart Draw Calls und erhält trotzdem das Frustum Culling.
  Requisiten wie Laternen, Bäume, Bänke und Poller werden instanziert. Materialien und
  Texturen werden geteilt, die Schattenqualität ist begrenzt und einstellbar.
- **Geo-Basis:** `GeoProjection` rechnet WGS84 (lat/lon) in lokale Meter um, mit Ursprung am
  Heilbronner Marktplatz. Bereit für Phase 2.

## Architektur

```
src/
├── main.ts                    Einstiegspunkt
├── core/                      Game (Composition Root + Zustandsautomat), GameLoop,
│                              Settings, EventBus, config (alle Tuning-Werte)
├── rendering/                 Renderer, Environment (Himmel/Licht/Schatten),
│   └── textures/              MaterialLibrary, prozedurale Canvas-Texturen
├── physics/                   PhysicsWorld – Wrapper um Rapier
├── input/                     InputManager, KeyBindings (Aktionen → Tasten)
├── player/                    PlayerController (Physik/Bewegung), PlayerAvatar (Optik/Animation)
├── camera/                    ThirdPersonCamera
├── gameplay/                  InteractionSystem
├── geo/                       GeoProjection (lat/lon → lokale Meter)
├── world/
│   ├── World.ts               lädt einen „District“ und baut die Batches
│   ├── districts/             TestDistrict (Phase 1), später: OSM-District
│   ├── buildings/             BuildingGenerator, FacadeStyles
│   ├── builders/              Gebäude, Boden/Gehwege, Straßenmarkierungen
│   ├── geometry/              Polygon-Utils, GeometryWriter, Extrude, MeshBatcher
│   └── props/                 Requisiten-Modelle, Instancing, Landmarken
├── ui/                        UIManager, Screens, HUD, styles.css (ohne Framework)
└── utils/                     Mathe-Helfer, deterministischer Zufall
```

Grundprinzipien:

- **Keine globalen Singletons.** `core/Game.ts` erzeugt alle Systeme und reicht Abhängigkeiten
  explizit weiter. Welt-Builder bekommen einen `WorldContext`.
- **Physik und Darstellung sind getrennt.** `PlayerController` kennt kein Mesh, `PlayerAvatar`
  keine Physik. Dadurch lässt sich die Figur später durch ein GLB-Modell mit Skelettanimation
  ersetzen, ohne die Steuerung anzufassen.
- **Die UI ist reines DOM/CSS** und spricht nur über Callbacks bzw. den `EventBus` mit dem Spiel.
- **Deterministische Generierung** über einen festen Seed: Die Welt sieht bei jedem Start gleich aus.

Koordinatensystem: **1 Einheit = 1 Meter**, `+X` = Osten, `−Z` = Norden, `+Y` = oben.

## Abhängigkeiten

| Paket                         | Zweck                                                    |
| ----------------------------- | -------------------------------------------------------- |
| `three`                       | 3D-Rendering (WebGL)                                     |
| `@dimforge/rapier3d-compat`   | Physik (WASM, im Bundle eingebettet → kein Server-Setup) |
| `vite` *(dev)*                | Entwicklungsserver und Bundler                           |
| `typescript` *(dev)*          | Typprüfung                                               |
| `@types/three` *(dev)*        | Typdefinitionen für Three.js                             |

## Bekannte Einschränkungen / offene Punkte

- **Das Testviertel ist nicht Heilbronn.** Straßen und Gebäude sind ein Platzhalter-Raster.
  Uhrturm und Fluss stehen nur stellvertretend für Kilianskirche und Neckar.
- **Bundle-Größe:** Rapier bettet sein WASM als Base64 ein, dadurch ist das JS-Bundle ca. 5 MB
  groß (≈ 1,8 MB gzip). Später sinnvoll: Physik in einen eigenen Chunk auslagern und die
  WASM-Datei separat ausliefern.
- **Die Spielfigur** ist ein Platzhalter aus Grundkörpern mit prozeduraler Animation, das finale
  Modell soll ein GLB mit Rig werden.
- **Noch kein LOD und kein Chunk-Streaming.** Das Batching ist bereits chunk-basiert, Laden und
  Entladen kommt mit den echten Kartendaten (Phase 2/3).
- **Sonne, Tageszeit und Wetter sind fest eingestellt** (später Tag-Nacht-Zyklus mit
  beleuchteten Fenstern).
- **Keine Audio-Ausgabe.**
- **Namenshinweis:** „GTA“ ist eine Marke von Take-Two/Rockstar. Für eine öffentliche
  Veröffentlichung sollte ein eigener Name gewählt werden. Der Titel ist zentral in
  `src/core/config.ts` hinterlegt und lässt sich dort mit einer Zeile ändern.

## Ausblick

1. **Phase 2 – Echte Kartendaten:** Ein Offline-Importskript (Node) holt einmalig einen
   OSM-Ausschnitt der Innenstadt (Overpass-Export oder `.osm.pbf`) und erzeugt ein kompaktes,
   vorverarbeitetes GeoJSON bzw. Binärformat in `public/data/`. Das Spiel lädt nur diese Datei
   und hängt zur Laufzeit von keiner externen API ab. Gebäude laufen durch den vorhandenen
   `BuildingGenerator`, Straßen werden zu Fahrbahn-Meshes.
2. Phase 3: Chunk-Streaming, LOD, Minimap.
3. Phase 4: Fahrzeuge (Rapier `DynamicRayCastVehicleController`), Ein- und Aussteigen über das
   `InteractionSystem`, Fahrzeugkamera, Tacho.
4. Danach: NPCs, Verkehr, Missionen.

## Lizenzhinweise

- Ab Phase 2 enthält das Spiel Kartendaten von **OpenStreetMap**:
  © OpenStreetMap-Mitwirkende, lizenziert unter der
  [Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
  Der Quellenhinweis wird dann im Startbildschirm und in dieser README angezeigt.
- Three.js (MIT), Rapier (Apache-2.0), Vite (MIT).
