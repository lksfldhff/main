# Abnahmebericht: Fassaden-Baukasten, Straßenraum, Asset-Bibliothek, QA (Teile von P2–P4, P7, P8)

Stand 26.11.2026. Umgesetzt nach den Entscheidungen E1–E5 aus `UMSETZUNGSPLAN.md`,
**nicht destruktiv**: Alle bisherigen Funktionen bleiben erhalten und dienen als Rückfallebene
(z. B. prozedurale Laternen/Bänke, wenn `public/assets/library.json` fehlt; gemalte Fenster,
wenn `kit.bin` fehlt).

## Was umgesetzt ist

### Gebäude 2.0 (P3, Teil 1)
| Baustein | Umsetzung |
| --- | --- |
| Wandklassifikation | `tools/geo/facades.py`: Brandwände (Rücken an Rücken mit Nachbarwand ≤ 0,5 m) → **keine Öffnungen**; Straßen- vs. Hoffassade über die Flächennutzung 3 m vor der Wand |
| Raster | Fenster/Achsen/Geschosse mit **derselben Formel** in Python und im Fassaden-Shader, gemeinsame Stiltabelle `src/world/heilbronn/facadeStyles.json` |
| Fassaden-Baukasten | `src/world/heilbronn/FacadeKit.ts`: instanzierte 3D-Module – Fenster (Laibung, Rahmen, Sprossen, Glas, Sohlbank, Sturz, Rollladen), Schaufenster (Rahmen, Glas, Markise), Haustüren (Steinportal, Türblatt, Oberlicht, Stufe), Balkone (Platte, Geländer, Balkontür), Schornsteine. „9-Slice“-Geometrie: Rahmen und Bänke behalten ihre echte Stärke bei jeder Fenstergröße |
| Nur wo es passt | Module nur an Wänden, deren **alle** Öffnungen vollständig im echten Wandpolygon liegen (2.487 Wände); Giebel/unregelmäßige Wände behalten gemalte Fenster |
| Eingänge | 230 Haustüren an den **amtlichen Hausnummern** (ALKIS), jeweils an der nächsten Straßenwand ≤ 9 m |
| LOD | ≤ 150 m (Qualität hoch) bzw. 110 m: 3D-Module, die Fassade schneidet dort ihre Öffnung aus (Loch-Radius 4 m kleiner als Modul-Radius → nie ein Loch ohne Modul); darüber gemalte Fenster. Schornsteine stadtweit |
| Kennzahlen | 18.464 Fenster, 3.083 Schaufenster, 230 Türen, 1.949 Balkone, 1.248 Schornsteine, 4.058 Brandwände |

### Straßenraum (P2, Teil 1)
- Gehwege, Plätze, Wege, Grün sind im Gelände um **12 cm erhöht** (`tools/geo/streets.py`).
- **Bordsteine** aus Granit entlang aller Fahrbahn/Gehweg-Kanten (marching squares auf dem 0,5-m-Raster,
  31.000 Dreiecke), an Fußgängerüberwegen **abgesenkt**. Shader: Granitkörnung, 1-m-Steine mit Fugen.
- **Glas-Wartehallen** an allen 9 Haltestellen mit OSM `shelter=yes`: dunkler Metallrahmen, klare Glasscheiben
  (Rück- und Seitenwand), Glasdach, Bank, Fahrplanvitrine, beleuchtete Werbevitrine, „H“-Schild.
  Öffnung automatisch zur Fahrbahn, Position automatisch hinter den Bordstein. Kein Quader-Ersatz möglich:
  die QA-Regel R1 prüft das.
- Übrige Haltestellen: Haltestellenmast mit „H“-Schild und Fahrplan, Bank wenn OSM `bench=yes`.
- Neue OSM-Objekte: Abfallbehälter (42), Briefkästen (16), Fahrradbügel (87 Anlagen, 382 Bügel),
  Poller (45), Hydranten (3), Litfaßsäulen (2). Stadtmöbel auf der Fahrbahn werden automatisch auf den
  nächsten Gehweg (≤ 8 m) verschoben, nie in Gebäude (Prüfung per Strahl gegen die Gebäudekollision).
- Pflanzkübel und Sitzelemente auf Fußgängerplätzen (≥ 3,5 m Abstand zu Fahrbahn und Gebäuden).

### Asset-Bibliothek (P4, Teil 1)
- `tools/assets/library.py`: Quelle → **Lizenzprüfung** (nur CC0 zugelassen) → Download → `gltf-transform`
  (Vereinfachung, WebP, Meshopt) → LOD0/LOD1 → `public/assets/library.json` mit Quelle, Autor, Lizenz, Datum,
  Dreiecken, Größe. Quellen steckbar (Poly Haven aktiv, Sketchfab vorbereitet – braucht Token).
- `src/assets/AssetLibrary.ts`: lädt GLB bei Bedarf, Cache, Teile je Material zusammengeführt, Instancing
  in 100-m-Zellen, 3 LOD-Stufen (nah / fern ohne Schattenwurf / ausgeblendet).
- Im Einsatz: Laterne, Bank, Sitzelement, Abfallbehälter, Hydrant, Pflanzkübel (alle CC0, Poly Haven).

### Performance (P7, Teil 1)
- Leistungsanzeige (F3): FPS mit schlechtestem Frame, Draw Calls, Dreiecke, Geometrien/Texturen/Shader
  auf der GPU, JS-Heap, Fassadenmodule, geladene Assets (Anzahl, MB, Instanzen), Stadtmöbel.
- Props in 250-m-Zellen (Frustum-Culling auch im Schattenpass), ferne Asset-Stufe ohne Schatten,
  leichtere LODs. Messung an der Innenstadtszene (Kaiserstraße, gleiche Kamera):
  **Draw Calls 2.946 → 918, Dreiecke 8,06 M → 3,97 M** (inkl. Schatten- und AO-Pass).
- Größter verbleibender Posten: ~2.800 Einzelmeshes der prozeduralen Autos (wird zusammengeführt).

### Visuelle QA (P8, Teil 1)
- `tools/qa/dump_scene.cjs` lädt das Spiel headless und exportiert, **was tatsächlich platziert wurde**
  (Merkmal, verwendetes Modell, Position).
- `tools/qa/check_scene.py` prüft je 200-m-Kartenausschnitt und schreibt `docs/qa/report.md` / `report.json`:

| Regel | Prüfung |
| --- | --- |
| R1 | Haltestelle mit Dach → Glas-Wartehalle (nie Quader/Mast) |
| R2 | kein Objekt in einem LoD2-Gebäude |
| R3 | keine Stadtmöbel auf der Fahrbahn |
| R4 | jedes exportierte OSM-Objekt hat ein 3D-Modell |
| R5 | keine Platzhalter-/Ersatzmodelle |
| R7 | Objekt auf „Fahrbahn“ ohne Gehweg im Umkreis → Flächennutzung vermutlich falsch |

Mapillary-Vergleich: vorbereitet im Plan (E5), braucht einen Mapillary-Zugangstoken.

## Geänderte / neue Dateien
- neu: `src/world/heilbronn/FacadeKit.ts`, `StreetFurniture.ts`, `facadeStyles.json`, `src/assets/AssetLibrary.ts`,
  `tools/geo/facades.py`, `tools/geo/streets.py`, `tools/assets/library.py`, `tools/assets/stats.mjs`,
  `tools/qa/dump_scene.cjs`, `tools/qa/check_scene.py`, `public/assets/library.json`, `public/assets/models/*`,
  `public/data/heilbronn/kit.bin`, `kerbs.bin`
- geändert: `FacadeMaterial.ts` (Brandwände, Kit-Ausschnitt), `HeilbronnData.ts`, `HeilbronnDistrict.ts`,
  `StreetDetails.ts` (Optionen statt Entfernen), `PropInstancer.ts` (Zellen), `District.ts`, `Game.ts`,
  `DebugOverlay.ts`, `tools/geo/build_heilbronn.py`, `tools/geo/osm.py`
- Abhängigkeiten: `@gltf-transform/cli` (dev), Python `scikit-image`

## Lokal testen
```bash
npm install
npm run dev                         # http://localhost:5173, F3 = Leistungsanzeige
python tools/geo/build_heilbronn.py # Geodaten neu erzeugen (≈ 1 min)
python tools/assets/library.py      # Asset-Bibliothek neu bauen
node tools/qa/dump_scene.cjs && (cd tools/geo && python ../qa/check_scene.py)   # QA-Bericht
```

## Offene Punkte
- QA-Befunde (siehe `docs/qa/report.md`): u. a. ZOB Kurt-Schumacher-Platz und Teile der Badstraße sind im
  Kataster komplett als „Straßenverkehr“ erfasst → dort fehlen Gehwegflächen (R7). Fix: OSM-Fußgängerflächen
  und `area:highway` stärker gewichten.
- Kachel-Streaming (P1) steht noch aus; Fassaden-Kit ist bereits chunkweise organisiert.
- Sträucher aus Poly Haven sind Sammel-Szenen (mehrere Pflanzen in einem Modell) → nicht platziert.
- Echte Radwege, Parkstreifen, Gullys/Schachtdeckel (P2, Teil 2).
