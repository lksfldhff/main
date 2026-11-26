# Automatische Szenen-QA

Erzeugt von `tools/qa/check_scene.py` aus der tatsächlich gerenderten Szene (`tools/qa/dump_scene.cjs`).

* Platzierte Objekte: **1696**
* Fassaden-Kit: {'walls': 17255, 'kitWalls': 2487, 'blind': 4058, 'windows': 18464, 'shops': 3083, 'doors': 230, 'balconies': 1949, 'chimneys': 1248, 'partyWalls': 4058}

| Regel | Beschreibung | Befunde |
|---|---|---|
| R1 | Bushaltestelle mit Dach → Glas-Wartehalle | 0 |
| R2 | Objekt in Gebäude | 28 |
| R3 | Möbel auf Fahrbahn | 24 |
| R4 | OSM-Objekt ohne 3D-Modell | 0 |
| R5 | Platzhalter-Modell | 0 |
| R7 | Flächennutzung vermutlich falsch | 41 |

## Verwendete Modelle

| Modell | Anzahl |
|---|---|
| `street_lamp_classic` | 997 |
| `procedural:bike_hoop` | 382 |
| `bench_wood` | 135 |
| `procedural:bollard` | 45 |
| `trash_can` | 42 |
| `planter_box` | 42 |
| `procedural:bus_stop_pole` | 21 |
| `procedural:post_box` | 16 |
| `procedural:glass_bus_shelter` | 9 |
| `fire_hydrant` | 3 |
| `street_seating` | 2 |
| `procedural:advertising_column` | 2 |

## Befunde je Kartenausschnitt (200 m)

### Abschnitt x -200…0 m, z -400…-200 m
- **R2** (-122.0, -398.0): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude

### Abschnitt x -200…0 m, z -600…-400 m
- **R2** (-90.2, -573.5): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-45.0, -573.5): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-73.8, -459.2): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x -200…0 m, z 0…200 m
- **R2** (-73.3, 106.4): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-72.3, 106.4): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-71.3, 106.4): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R3** (-134.8, 81.1): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn
- **R3** (-134.8, 80.1): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn
- **R2** (-169.0, 35.2): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-168.1, 35.8): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-167.2, 36.2): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-80.2, 2.2): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x -200…0 m, z 200…400 m
- **R7** (-189.0, 344.7): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-172.8, 343.5): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R2** (-5.9, 297.2): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-5.4, 298.1): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (-112.2, 315.2): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x -400…-200 m, z -200…0 m
- **R2** (-360.9, -42.5): procedural:glass_bus_shelter (highway=bus_stop + shelter=yes) steht in einem Gebäude
- **R7** (-363.7, -59.5): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-382.9, -63): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-371.2, -61.1): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (-380.5, -73.3): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R7** (-360.1, -69.5): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-383.6, -63.0): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)

### Abschnitt x -400…-200 m, z 0…200 m
- **R3** (-332.9, 120.8): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (-357.5, 178.9): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (-363.4, 191.6): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (-353.4, 167.9): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (-364.2, 193.8): bench_wood (amenity=bench) steht auf der Fahrbahn

### Abschnitt x -400…-200 m, z 200…400 m
- **R7** (-295.3, 238.4): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R2** (-309.6, 251.7): procedural:bollard (barrier=bollard) steht in einem Gebäude
- **R2** (-367.4, 225.8): procedural:bollard (barrier=bollard) steht in einem Gebäude

### Abschnitt x -600…-400 m, z -200…0 m
- **R7** (-456.1, -146.5): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-457.7, -149.2): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-464.8, -143.6): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-465.5, -146.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-448.9, -149.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-450.2, -153.1): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-453.6, -160.8): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (-455.2, -163.8): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)

### Abschnitt x -600…-400 m, z -600…-400 m
- **R2** (-561.2, -549.8): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x -600…-400 m, z -800…-600 m
- **R2** (-484.8, -606.2): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x 0…200 m, z -200…0 m
- **R3** (56.3, -102.0): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn
- **R2** (130.6, -68.4): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude

### Abschnitt x 0…200 m, z -600…-400 m
- **R2** (134.9, -464.0): procedural:glass_bus_shelter (highway=bus_stop + shelter=yes) steht in einem Gebäude

### Abschnitt x 0…200 m, z -800…-600 m
- **R7** (194.7, -771.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (194.5, -773.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (196.1, -793.9): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (196.5, -796.9): bench_wood (amenity=bench) steht auf der Fahrbahn

### Abschnitt x 0…200 m, z -1000…-800 m
- **R3** (196.7, -801.3): trash_can (amenity=waste_basket) steht auf der Fahrbahn

### Abschnitt x 0…200 m, z 200…400 m
- **R7** (128.7, 267.5): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (129.5, 276.0): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (130.4, 302.5): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (129.9, 284.6): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (130.1, 293.8): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (133.2, 308.8): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (145.8, 378.1): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (147.1, 376.6): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (144.7, 376.2): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (136.3, 372.8): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (138.6, 362.9): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (196.2, 207.3): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (197.6, 205.3): trash_can (amenity=waste_basket) steht auf der Fahrbahn
- **R2** (35.1, 340.6): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (88.5, 357.7): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
- **R2** (185.1, 240.6): procedural:post_box (amenity=post_box) steht in einem Gebäude

### Abschnitt x 200…400 m, z -200…0 m
- **R7** (282.2, -86.9): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (278.5, -12.8): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R7** (278.2, -39.6): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (284.6, -77.7): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R7** (282.8, -71.2): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (276.8, -32.5): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (279.6, -197.3): fire_hydrant (emergency=fire_hydrant): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (268.6, -146.9): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn
- **R3** (268.7, -147.9): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn
- **R3** (268.8, -148.9): procedural:bike_hoop (amenity=bicycle_parking) steht auf der Fahrbahn

### Abschnitt x 200…400 m, z -400…-200 m
- **R3** (320.6, -316.3): procedural:bus_stop_pole (highway=bus_stop) steht auf der Fahrbahn
- **R3** (298.8, -317.0): procedural:bus_stop_pole (highway=bus_stop) steht auf der Fahrbahn
- **R2** (231.2, -280.2): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x 200…400 m, z -600…-400 m
- **R7** (231.2, -471.7): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (234.3, -471.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (216.1, -473.4): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (249.1, -470.0): bench_wood (amenity=bench): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (224.3, -472.4): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R7** (262.5, -468.5): trash_can (amenity=waste_basket): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R2** (336.8, -567.8): street_lamp_classic (generated: street lamp at kerb) steht in einem Gebäude

### Abschnitt x 200…400 m, z 0…200 m
- **R7** (267.7, 0.9): procedural:bus_stop_pole (highway=bus_stop): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)
- **R3** (204.1, 197.6): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R3** (202.7, 199.5): trash_can (amenity=waste_basket) steht auf der Fahrbahn

### Abschnitt x 200…400 m, z 200…400 m
- **R2** (210.7, 208.0): procedural:glass_bus_shelter (highway=bus_stop + shelter=yes) steht in einem Gebäude
- **R3** (200.2, 202.6): bench_wood (amenity=bench) steht auf der Fahrbahn
- **R2** (201.0, 246.0): procedural:bike_hoop (amenity=bicycle_parking) steht in einem Gebäude
