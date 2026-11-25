"""Shared configuration for the Heilbronn geodata pipeline.

All raw data comes from the LGL Baden-Württemberg Open GeoData portal
(https://opengeodata.lgl-bw.de), licence: Datenlizenz Deutschland – Namensnennung – 2.0.
Coordinates of the raw data: ETRS89 / UTM zone 32N (EPSG:25832), heights DHHN2016.
"""

# Playable area (UTM32, metres): Neckar + Experimenta in the west/north-west,
# Marktplatz / Kilianskirche in the east. The Hauptbahnhof lies just outside.
BBOX = (515250.0, 5442850.0, 516350.0, 5444250.0)  # minE, minN, maxE, maxN

# Local origin = Heilbronn Marktplatz. Game axes: x = east, y = up, z = south (−north).
ORIGIN_E = 515962.0
ORIGIN_N = 5443270.0

# Terrain sampling resolution (m) and land-use raster resolution (m/pixel).
TERRAIN_CELL = 2.0
LANDUSE_CELL = 0.5

# Chunk size for batching buildings (m).
CHUNK = 200.0

LOD2_TILES = ["515_5442", "515_5444"]
DGM_TILES = ["515_5442", "515_5444"]
ALKIS_GEMARKUNG_FILE = "ALKIS-oE_080910_Heilbronn_shp.zip"

ATTRIBUTION = "Geodaten © Landesamt für Geoinformation und Landentwicklung Baden-Württemberg (LGL), www.lgl-bw.de, dl-de/by-2-0"
