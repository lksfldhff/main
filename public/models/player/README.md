# Eigene Spielfigur (und Fahrzeugmodelle)

Lege hier ein animiertes Modell ab – das Spiel lädt es automatisch beim Start.
Ohne Dateien wird die eingebaute Platzhalter-Figur verwendet (bzw. die prozeduralen Autos).

> **Lizenz:** Mixamo- und Envato-Elements-Dateien sind für den Nutzer lizenziert und dürfen
> **nicht** ins (öffentliche) Repository. `public/models/player/*.glb|*.fbx` und
> `public/models/vehicles/` stehen deshalb in `.gitignore` und müssen lokal erzeugt werden.

**Variante A – fertige GLB (empfohlen):** `player.glb` aus Mixamo-Downloads bauen
(X Bot + Animationen; braucht Blenders Python-Modul `bpy`):

```bash
tools/assets/build_player.sh <ordner-mit-den-fbx-dateien>                 # Mixamo X Bot
tools/assets/build_player.sh <ordner-mit-den-fbx-dateien> ich_rigged.glb  # eigene Figur
```

Mit zweitem Argument werden die Mixamo-Animationen auf eine eigene geriggte Figur übertragen
(z. B. ein Image-to-3D-Scan von dir selbst mit 24-Knochen-Rig: Hips, Spine02, Spine01, Spine,
neck, Head, Arme/Beine wie bei Mixamo). Das Retargeting berücksichtigt die unterschiedliche
Ruhepose (T- vs. A-Pose). Scans haben Arme/Hände oft mit dem Körper verschmolzen (Hände in den
Hosentaschen): `--free-hands` schneidet Unterarme und Hände frei, schließt die Löcher in
Shirt/Hose und baut saubere Unterarme mit Händen (Hautfarbe aus der Scan-Textur), sodass die
Arme voll mitschwingen; `--pocket-fix` hängt Hosen-Vertices von den Arm- an die Beinknochen.
Bei Sprung/Fall laufen die Arme gedämpft mit (`~0.5` hinter dem Clip), damit die Ärmel nicht reißen.
Ein Scan ist ein **persönliches Abbild** – nie committen oder hochladen.

Das Skript (`tools/assets/convert_mixamo.py`) importiert Figur und Animationen, macht die
Laufzyklen „in place“ (die Geschwindigkeit steckt danach in den glTF-Extras `clipSpeeds`),
benennt die Clips `idle, walk, run, sprint, jump, fall, land, start_walk, stop_walk,
turn_left, turn_right, strafe_left, strafe_right, drive, sit` und komprimiert mit meshopt.
Eigene GLBs funktionieren auch: Clip-Namen sollten `idle`, `walk`, `run`, `jump` enthalten.

**Variante B – Mixamo-FBX direkt:** `character.fbx` (Figur, „With Skin“) + `idle.fbx`,
`walk.fbx`, `run.fbx`, `jump.fbx` (Animationen „Without Skin“, Option **In Place**).

**Fahrzeug „City SUV“:** `public/models/vehicles/city_suv.glb` aus dem Envato-Modell bauen:

```bash
tools/assets/build_city_suv.sh "<pfad>/City SUV.blend"
```

(`tools/assets/convert_vehicle.py`: Modifier anwenden, Materialien vereinfachen, Räder als
`wheel_fl/fr/rl/rr` trennen, auf ~56k Dreiecke reduzieren.) Fehlt die Datei, fährt der
Fahrzeugtyp `suv_model` mit dem prozeduralen SUV-Modell.

Details: siehe Abschnitt „Eigene 3D-Modelle“ in der Haupt-README.
