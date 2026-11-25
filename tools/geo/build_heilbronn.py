"""Builds the game's Heilbronn world data from raw LGL open data.

Inputs  (see fetch_lgl.py):  LoD2 CityGML buildings, DGM1 terrain, ALKIS land use.
Outputs (public/data/heilbronn/):
  meta.json      – origin, extents, chunk index, POIs, attribution
  terrain.bin    – Uint16 heightfield (cm above meta.terrain.minHeight), row-major north→south
  buildings.bin  – Float32 vertex streams per chunk (walls + roofs), already triangulated
  landuse.png    – 8-bit class raster (see LANDUSE_* below), north-up
  water.bin      – Float32 triangles of water surfaces

Usage:  python tools/geo/build_heilbronn.py [raw_dir] [out_dir]
"""
from __future__ import annotations

import json
import math
import sys
import zlib
from collections import defaultdict
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import shapefile
from lxml import etree
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely import STRtree
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

import config
import osm as osm_mod
from dop import OrthoMosaic

MIN_E, MIN_N, MAX_E, MAX_N = config.BBOX
NS = {
    "gml": "http://www.opengis.net/gml",
    "bldg": "http://www.opengis.net/citygml/building/1.0",
}

# ----------------------------------------------------------------------------- styles
# Must match src/world/heilbronn/BuildingStyles.ts
STYLE_ALTBAU, STYLE_POSTWAR, STYLE_MODERN, STYLE_GLASS, STYLE_SANDSTONE = 0, 1, 2, 3, 4
STYLE_INDUSTRIAL, STYLE_SMALL, STYLE_BRICK, STYLE_BRIDGE, STYLE_HISTORIC = 5, 6, 7, 8, 9

# Named landmarks with historic sandstone facades.
HISTORIC_NAMES = ("rathaus", "fleisch", "deutschhof", "käthchen", "schießhaus", "museum im deutschhof")
ROOF_FLAT, ROOF_TILES, ROOF_SLATE, ROOF_METAL, ROOF_COPPER = 0, 1, 2, 3, 4

# Land-use classes. Must match src/world/heilbronn/LandUse.ts
LANDUSE_NONE, LANDUSE_ROAD, LANDUSE_SIDEWALK, LANDUSE_PLAZA, LANDUSE_PATH = 0, 1, 2, 3, 4
LANDUSE_WATER, LANDUSE_GREEN, LANDUSE_URBAN, LANDUSE_RAIL = 5, 6, 7, 8

NUTZART_CLASS = {
    "Strassenverkehr": LANDUSE_ROAD,
    "Platz": LANDUSE_PLAZA,
    "Weg": LANDUSE_PATH,
    "Fliessgewaesser": LANDUSE_WATER,
    "Hafenbecken": LANDUSE_WATER,
    "Stehendes Gewaesser": LANDUSE_WATER,
    "Sport Freizeit Und Erholungsflaeche": LANDUSE_GREEN,
    "Landwirtschaft": LANDUSE_GREEN,
    "Wald": LANDUSE_GREEN,
    "Gehoelz": LANDUSE_GREEN,
    "Friedhof": LANDUSE_GREEN,
    "Bahnverkehr": LANDUSE_RAIL,
}


def to_local(e: np.ndarray, n: np.ndarray, h: np.ndarray, h0: float):
    """UTM → game coordinates (x east, y up, z south)."""
    return e - config.ORIGIN_E, h - h0, -(n - config.ORIGIN_N)


def stable_hash(text: str) -> int:
    return zlib.crc32(text.encode()) & 0xFFFFFFFF


# ----------------------------------------------------------------------------- terrain
def build_terrain(raw: Path):
    cell = config.TERRAIN_CELL
    cols = int(round((MAX_E - MIN_E) / cell)) + 1
    rows = int(round((MAX_N - MIN_N) / cell)) + 1
    # 1 m source grid covering the bbox
    e0, n0 = math.floor(MIN_E), math.floor(MIN_N)
    w, h = int(math.ceil(MAX_E)) - e0 + 1, int(math.ceil(MAX_N)) - n0 + 1
    grid = np.full((h, w), np.nan, dtype=np.float32)
    for tile in config.DGM_TILES:
        for f in sorted((raw / "dgm" / tile).rglob("*.xyz")):
            parts = f.stem.split("_")  # dgm1_32_515_5442_1_bw_2024
            te, tn = int(parts[2]) * 1000, int(parts[3]) * 1000
            if te > MAX_E or te + 1000 < MIN_E or tn > MAX_N or tn + 1000 < MIN_N:
                continue
            data = np.fromfile(f, sep=" ", dtype=np.float64).reshape(-1, 3)
            ix = np.floor(data[:, 0]).astype(int) - e0
            iy = np.floor(data[:, 1]).astype(int) - n0
            ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
            grid[iy[ok], ix[ok]] = data[ok, 2]
            print(f"  terrain tile {f.name}")
    if np.isnan(grid).any():
        # fill gaps (should not happen inside the bbox) with nearest values
        idx = ndimage.distance_transform_edt(np.isnan(grid), return_distances=False, return_indices=True)
        grid = grid[tuple(idx)]

    def sample(e: np.ndarray, n: np.ndarray) -> np.ndarray:
        ix = np.clip(np.floor(e).astype(int) - e0, 0, w - 1)
        iy = np.clip(np.floor(n).astype(int) - n0, 0, h - 1)
        return grid[iy, ix]

    es = MIN_E + np.arange(cols) * cell
    ns = MAX_N - np.arange(rows) * cell  # row 0 = north
    E, N = np.meshgrid(es, ns)
    heights = sample(E, N).astype(np.float64)
    return heights, sample, (cols, rows)


# ----------------------------------------------------------------------------- ALKIS
def load_alkis(raw: Path):
    base = raw / "alkis" / "heilbronn"
    bbox_poly = box(MIN_E, MIN_N, MAX_E, MAX_N)

    def shapes(name: str):
        r = shapefile.Reader(str(base / name), encoding="cp1252")
        for sr in r.iterShapeRecords():
            b = sr.shape.bbox
            if b[2] < MIN_E or b[0] > MAX_E or b[3] < MIN_N or b[1] > MAX_N:
                continue
            pts = sr.shape.points
            parts = list(sr.shape.parts) + [len(pts)]
            rings = [pts[parts[i] : parts[i + 1]] for i in range(len(parts) - 1)]
            if not rings or len(rings[0]) < 4:
                continue
            try:
                poly = Polygon(rings[0], [r for r in rings[1:] if len(r) >= 4]).buffer(0)
            except Exception:
                continue
            if poly.is_empty:
                continue
            yield poly, sr.record.as_dict()

    landuse = [(p.intersection(bbox_poly), rec) for p, rec in shapes("nutzung")]
    landuse = [(p, rec) for p, rec in landuse if not p.is_empty]
    footprints = list(shapes("gebaeudeBauwerke"))
    print(f"  ALKIS: {len(landuse)} land-use parcels, {len(footprints)} building footprints")

    labels = []
    r = shapefile.Reader(str(base / "praesentation"), encoding="cp1252")
    for sr in r.iterShapeRecords():
        rec = sr.record.as_dict()
        text = (rec.get("schriftinh") or "").strip()
        if not text or not sr.shape.points:
            continue
        e, n = sr.shape.points[0]
        if not (MIN_E <= e <= MAX_E and MIN_N <= n <= MAX_N):
            continue
        # Street names only – skip house numbers and other short codes.
        if len(text) < 4 or any(ch.isdigit() for ch in text[:2]):
            continue
        if "Lagebezeichnung" in (rec.get("dientZurDa") or "") or "Strassenverkehr" in (rec.get("dientZurDa") or ""):
            labels.append((text, e, n))
    return landuse, footprints, labels


# ----------------------------------------------------------------------------- buildings
def classify(function: str, name: str, roof_type: str, height: float, lod2_function: str, seed: int):
    f = function or ""
    nm = (name or "").lower()
    shop = 0
    if lod2_function.startswith("53001") or lod2_function.startswith("52003"):
        return STYLE_BRIDGE, 0, ROOF_FLAT
    if "experimenta" in nm:
        return STYLE_GLASS, 0, ROOF_FLAT
    if "Kirche" in f or "Turm" in f or "münster" in nm or "Kapelle" in f:
        return STYLE_SANDSTONE, 0, ROOF_SLATE if seed % 3 else ROOF_COPPER
    if any(k in nm for k in HISTORIC_NAMES) or f == "Rathaus":
        return STYLE_HISTORIC, 0, ROOF_TILES
    industrial = ("Industrie", "Lager", "Werkstatt", "Fabrik", "Parkhaus", "Betrieb", "Umformer",
                  "Kraftwerk", "Heizwerk", "Silo", "Tank", "Scheune", "Halle", "Wirtschaft oder Gewerbe")
    if height < 4.0 or ("Garage" in f and height < 5):
        return STYLE_SMALL, 0, ROOF_FLAT if roof_type == "1000" else ROOF_METAL
    if any(k in f for k in industrial):
        return STYLE_INDUSTRIAL, 0, ROOF_METAL if roof_type != "1000" else ROOF_FLAT
    if any(k in f for k in ("Geschäft", "Kaufhaus", "Gaststätte", "Hotel", "Bank", "Handel", "Restaurant")):
        shop = 1
    flat = roof_type == "1000"
    officeish = any(k in f for k in ("Büro", "Verwaltung", "Hochschul", "Bank", "Kaufhaus", "Gericht", "Hotel", "Veranstaltung"))
    if flat and (height >= 17 or (officeish and height >= 10)):
        return STYLE_MODERN, shop, ROOF_FLAT
    if flat:
        return STYLE_POSTWAR, shop, ROOF_FLAT
    if seed % 7 == 0:
        return STYLE_BRICK, shop, ROOF_TILES
    return STYLE_ALTBAU, shop, ROOF_TILES if seed % 5 else ROOF_SLATE


def parse_ring(pos_list: str) -> np.ndarray:
    v = np.array(pos_list.split(), dtype=np.float64).reshape(-1, 3)
    if len(v) > 1 and np.allclose(v[0], v[-1]):
        v = v[:-1]
    return v


def newell_normal(pts: np.ndarray) -> np.ndarray:
    n = np.zeros(3)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    ln = np.linalg.norm(n)
    return n / ln if ln > 1e-12 else n


def triangulate(rings: list[np.ndarray], normal: np.ndarray) -> np.ndarray:
    """Triangulates a planar 3D polygon (with holes). Returns (k,3,3) triangles, wound like `normal`."""
    axis = int(np.argmax(np.abs(normal)))
    keep = [i for i in range(3) if i != axis]
    verts3 = np.concatenate(rings)
    verts2 = verts3[:, keep]
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    try:
        idx = earcut.triangulate_float64(verts2, ends)
    except Exception:
        return np.zeros((0, 3, 3))
    tris = verts3[np.asarray(idx).reshape(-1, 3)]
    if len(tris) == 0:
        return tris
    tn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    flip = (tn @ normal) < 0
    tris[flip] = tris[flip][:, [0, 2, 1]]
    area = np.linalg.norm(tn, axis=1)
    return tris[area > 1e-6]


def build_buildings(raw: Path, h0: float, footprints, osm_lookup=None, roof_color=None):
    """osm_lookup(e, n) -> {material, roof, name} | None;  roof_color(E, N) -> packed RGB (0 = unknown)."""
    tree = STRtree([p for p, _ in footprints])
    walls_for_index = []  # (E, N, y_center, y_top, nx, nz, width) of large walls, for wall-mounted features
    chunks: dict[tuple[int, int], dict[str, list[np.ndarray]]] = defaultdict(lambda: {"walls": [], "roofs": []})
    count = 0
    stats = defaultdict(int)
    files = []
    for tile in config.LOD2_TILES:
        for f in sorted((raw / "lod2" / tile).rglob("*.gml")):
            parts = f.stem.split("_")  # LoD2_32_515_5443_1_BW
            te, tn = int(parts[2]) * 1000, int(parts[3]) * 1000
            if te > MAX_E or te + 1000 < MIN_E or tn > MAX_N or tn + 1000 < MIN_N:
                continue
            files.append(f)

    tag_b = f"{{{NS['bldg']}}}Building"
    for f in files:
        print(f"  buildings {f.name}")
        for _, el in etree.iterparse(str(f), events=("end",), tag=tag_b):
            surfaces = []  # (kind, rings)
            for kind in ("WallSurface", "RoofSurface", "ClosureSurface", "GroundSurface"):
                for s in el.iter(f"{{{NS['bldg']}}}{kind}"):
                    for poly in s.iter(f"{{{NS['gml']}}}Polygon"):
                        rings = []
                        ext = poly.find("gml:exterior//gml:posList", NS)
                        if ext is None or not ext.text:
                            continue
                        rings.append(parse_ring(ext.text))
                        for hole in poly.findall("gml:interior//gml:posList", NS):
                            if hole.text:
                                rings.append(parse_ring(hole.text))
                        if len(rings[0]) >= 3:
                            surfaces.append((kind, rings))
            if not surfaces:
                el.clear()
                continue
            allv = np.concatenate([r[0] for _, r in surfaces])
            ce, cn = allv[:, 0].mean(), allv[:, 1].mean()
            if not (MIN_E <= ce <= MAX_E and MIN_N <= cn <= MAX_N):
                el.clear()
                continue

            gid = el.get(f"{{{NS['gml']}}}id") or str(count)
            seed = stable_hash(gid)
            roof_type = el.findtext(".//bldg:roofType", default="", namespaces=NS)
            lod2_function = el.findtext("bldg:function", default="", namespaces=NS)
            base = allv[:, 2].min()
            height = allv[:, 2].max() - base
            fn, name = "", ""
            hits = tree.query(Point(ce, cn), predicate="within")
            if len(hits) == 0:
                near = tree.query_nearest(Point(ce, cn), max_distance=6)
                hits = near
            if len(hits):
                rec = footprints[int(hits[0])][1]
                fn, name = rec.get("funktion") or "", rec.get("name") or ""
            osm = osm_lookup(ce, cn) if osm_lookup else None
            if osm and not name:
                name = osm["name"]
            style, shop, roof_kind = classify(fn, name, roof_type, height, lod2_function, seed)
            material = osm["material"] if osm else 0
            if osm and osm["roof"] == "copper":
                roof_kind = ROOF_COPPER
            stats[style] += 1
            variant = (seed >> 8) & 0xFF
            wall_code = float(style | (shop << 4) | (variant << 5) | (material << 13))
            roof_code = float(roof_kind | (variant << 3))
            # Real roof colour (from the orthophoto), one robust value per building.
            roof_pts = [r[0] for k, r in surfaces if k == "RoofSurface"]
            rgb = 0.0
            if roof_color and roof_pts:
                rp = np.concatenate(roof_pts)
                rgb = float(roof_color(rp[:, 0], rp[:, 1]))

            ck = (int(math.floor((ce - config.ORIGIN_E) / config.CHUNK)), int(math.floor(-(cn - config.ORIGIN_N) / config.CHUNK)))
            for kind, rings in surfaces:
                if kind == "GroundSurface" and style != STYLE_BRIDGE:
                    continue
                normal = newell_normal(rings[0])
                tris = triangulate(rings, normal)
                if len(tris) == 0:
                    continue
                flat = tris.reshape(-1, 3)
                x, y, z = to_local(flat[:, 0], flat[:, 1], flat[:, 2], h0)
                pos = np.stack([x, y, z], axis=1)
                # normal in game space: (e, h, -n)
                ng = np.array([normal[0], normal[2], -normal[1]])
                if kind in ("WallSurface", "ClosureSurface") or (kind == "GroundSurface"):
                    t = np.array([ng[2], 0.0, -ng[0]])  # horizontal tangent = up × n (points right when facing the wall)
                    tl = np.linalg.norm(t)
                    t = t / tl if tl > 1e-6 else np.array([1.0, 0.0, 0.0])
                    ring_local = np.stack(to_local(rings[0][:, 0], rings[0][:, 1], rings[0][:, 2], h0), axis=1)
                    us_ring = ring_local @ t
                    umin, umax = us_ring.min(), us_ring.max()
                    u = pos @ t - umin
                    hgt = y - (base - h0)
                    wl = np.full_like(u, umax - umin)
                    code = np.full_like(u, wall_code if kind != "ClosureSurface" else float(STYLE_SMALL | (variant << 5)))
                    chunks[ck]["walls"].append(np.stack([x, y, z, u, hgt, wl, code], axis=1))
                    if kind == "WallSurface" and umax - umin > 6 and abs(ng[1]) < 0.2:
                        cE, cN = rings[0][:, 0].mean(), rings[0][:, 1].mean()
                        walls_for_index.append((cE, cN, float(y.mean()), float(y.max()), float(ng[0]), float(ng[2]), float(umax - umin)))
                else:  # roof
                    if ng[1] > 0.985:
                        u, v = x, z
                        rc = float(ROOF_FLAT | (variant << 3)) if roof_kind != ROOF_COPPER else roof_code
                    else:
                        t = np.array([ng[2], 0.0, -ng[0]])
                        t /= max(np.linalg.norm(t), 1e-6)
                        b = np.cross(ng, t)
                        if b[1] < 0:
                            b = -b  # v increases up the slope
                        u, v = pos @ t, pos @ b
                        rc = roof_code if roof_kind != ROOF_FLAT else float(ROOF_METAL | (variant << 3))
                    chunks[ck]["roofs"].append(np.stack([x, y, z, u, v, np.full_like(u, rc), np.full_like(u, rgb)], axis=1))
            count += 1
            el.clear()
            while el.getprevious() is not None:
                del el.getparent()[0]
    print(f"  {count} buildings, styles: {dict(stats)}")

    wall_arr = np.array(walls_for_index) if walls_for_index else np.zeros((0, 7))

    def walls_index(e: float, n: float):
        """Nearest large wall within 6 m of (e, n): position/orientation for a wall-mounted object."""
        if len(wall_arr) == 0:
            return None
        d = np.hypot(wall_arr[:, 0] - e, wall_arr[:, 1] - n)
        i = int(np.argmin(d))
        if d[i] > 8:
            return None
        cE, cN, yc, ytop, nx, nz, w = wall_arr[i]
        # project the node onto the wall plane, slightly in front of it
        px = e - config.ORIGIN_E
        pz = -(n - config.ORIGIN_N)
        wx, wz = cE - config.ORIGIN_E, -(cN - config.ORIGIN_N)
        dist = (px - wx) * nx + (pz - wz) * nz
        return {"x": round(px - nx * dist + nx * 0.12, 2), "y": round(min(ytop - 2.5, yc + 3.5), 2), "z": round(pz - nz * dist + nz * 0.12, 2), "nx": round(nx, 3), "nz": round(nz, 3)}

    return chunks, count, walls_index


# ----------------------------------------------------------------------------- land use
def build_landuse(landuse, pedestrian=()):
    cell = config.LANDUSE_CELL
    w = int(round((MAX_E - MIN_E) / cell))
    h = int(round((MAX_N - MIN_N) / cell))
    img = Image.new("L", (w, h), LANDUSE_URBAN)
    draw = ImageDraw.Draw(img)

    def px(coords):
        return [((e - MIN_E) / cell, (MAX_N - n) / cell) for e, n in coords]

    def polys(geom):
        return list(geom.geoms) if hasattr(geom, "geoms") else [geom]

    # Large parcels first so smaller ones (drawn later) win at shared borders.
    for geom, rec in sorted(landuse, key=lambda pr: -pr[0].area):
        cls = NUTZART_CLASS.get(rec.get("nutzart", ""), LANDUSE_URBAN)
        for p in polys(geom):
            if p.geom_type != "Polygon" or p.is_empty:
                continue
            draw.polygon(px(p.exterior.coords), fill=cls)
    arr = np.array(img)

    # Pedestrian zones from OSM: road pixels become paving (e.g. Fleiner/Sülmer Straße).
    if pedestrian:
        ped = Image.new("L", (w, h), 0)
        pd = ImageDraw.Draw(ped)
        for shape in pedestrian:
            for p in polys(shape):
                if p.geom_type == "Polygon" and not p.is_empty:
                    pd.polygon(px(p.exterior.coords), fill=1)
        mask = np.array(ped) > 0
        arr[mask & (arr == LANDUSE_ROAD)] = LANDUSE_PLAZA

    # Derive sidewalks: road pixels within 2.5 m of urban/plaza/path/green land.
    road = arr == LANDUSE_ROAD
    edge_src = np.isin(arr, [LANDUSE_URBAN, LANDUSE_PLAZA, LANDUSE_PATH, LANDUSE_GREEN, LANDUSE_NONE])
    dist = ndimage.distance_transform_edt(~edge_src) * cell
    arr[road & (dist <= 2.6)] = LANDUSE_SIDEWALK
    return arr


def build_water(landuse, sample, h0):
    tris_out = []
    water_polys = []
    for geom, rec in landuse:
        if NUTZART_CLASS.get(rec.get("nutzart", "")) != LANDUSE_WATER:
            continue
        water_polys.extend(list(geom.geoms) if hasattr(geom, "geoms") else [geom])
    merged = unary_union([p for p in water_polys if p.geom_type == "Polygon"])
    polys = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    levels = []
    for p in polys:
        if p.is_empty or p.area < 20:
            continue
        inner = p.buffer(-3)
        probe = inner if not inner.is_empty else p
        minx, miny, maxx, maxy = probe.bounds
        xs, ys = np.meshgrid(np.arange(minx, maxx, 4.0), np.arange(miny, maxy, 4.0))
        pts = [(x, y) for x, y in zip(xs.ravel(), ys.ravel()) if probe.contains(Point(x, y))]
        if not pts:
            continue
        hs = sample(np.array([q[0] for q in pts]), np.array([q[1] for q in pts]))
        level = float(np.percentile(hs, 30))
        levels.append(level)
        rings = [np.array(p.exterior.coords)[:-1]] + [np.array(i.coords)[:-1] for i in p.interiors]
        verts2 = np.concatenate(rings)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        idx = np.asarray(earcut.triangulate_float64(verts2, ends)).reshape(-1, 3)
        tri = verts2[idx]  # (k,3,2)
        x, y, z = to_local(tri[..., 0], tri[..., 1], np.full(tri.shape[:2], level), h0)
        tris_out.append(np.stack([x, y, z], axis=-1).reshape(-1, 3))
    data = np.concatenate(tris_out).astype(np.float32) if tris_out else np.zeros((0, 3), np.float32)
    # Ensure upward winding
    t = data.reshape(-1, 3, 3)
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    flip = n[:, 1] < 0
    t[flip] = t[flip][:, [0, 2, 1]]
    return t.reshape(-1, 3), merged, levels


def carve_riverbed(heights: np.ndarray, water_geom, levels, depth=2.5):
    """Lowers the terrain under water so the water surface sits above a visible riverbed."""
    cell = config.TERRAIN_CELL
    rows, cols = heights.shape
    img = Image.new("L", (cols, rows), 0)
    draw = ImageDraw.Draw(img)
    geoms = list(water_geom.geoms) if hasattr(water_geom, "geoms") else [water_geom]
    for p in geoms:
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        draw.polygon([((e - MIN_E) / cell, (MAX_N - n) / cell) for e, n in p.exterior.coords], fill=255)
    mask = np.array(img) > 0
    if levels:
        floor = min(levels) - depth
        heights[mask] = np.minimum(heights[mask], floor)
    return heights


# ----------------------------------------------------------------------------- POIs
def build_pois(footprints, labels, landuse, h0, sample):
    pois = []
    seen = set()
    for poly, rec in footprints:
        name = (rec.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        c = poly.representative_point()
        x, _, z = to_local(np.array(c.x), np.array(c.y), np.array(0.0), h0)
        pois.append({"name": name, "kind": "building", "x": round(float(x), 1), "z": round(float(z), 1)})
    for poly, rec in landuse:
        name = (rec.get("name") or "").strip()
        if rec.get("nutzart") == "Platz" or name:
            if not name:
                continue
            c = poly.representative_point()
            x, _, z = to_local(np.array(c.x), np.array(c.y), np.array(0.0), h0)
            pois.append({"name": name, "kind": "area", "x": round(float(x), 1), "z": round(float(z), 1)})
    streets = []
    for text, e, n in labels:
        x, _, z = to_local(np.array(e), np.array(n), np.array(0.0), h0)
        streets.append({"name": text, "x": round(float(x), 1), "z": round(float(z), 1)})
    return pois, streets


# ----------------------------------------------------------------------------- main
def main() -> None:
    raw = Path(sys.argv[1] if len(sys.argv) > 1 else ".geodata")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data/heilbronn")
    out.mkdir(parents=True, exist_ok=True)

    print("Terrain …")
    heights, sample, (cols, rows) = build_terrain(raw)
    h0 = float(sample(np.array([config.ORIGIN_E]), np.array([config.ORIGIN_N]))[0])
    print(f"  {cols}×{rows} samples, origin height {h0:.2f} m")

    print("ALKIS …")
    landuse, footprints, labels = load_alkis(raw)

    print("Water …")
    water, water_geom, levels = build_water(landuse, sample, h0)
    heights = carve_riverbed(heights, water_geom, levels)

    osm_path = raw / "osm" / "heilbronn.osm"
    osm = osm_mod.OsmData(osm_path) if osm_path.exists() else None
    print(f"OSM: {'loaded' if osm else 'not found – skipping'}")

    print("Orthophotos …")
    ortho = OrthoMosaic(raw)
    print(f"  roof colours: {'on' if ortho.available else 'off (no DOP files)'}")

    print("Buildings …")
    chunks, count, walls_index = build_buildings(
        raw, h0, footprints,
        osm_lookup=osm_mod.building_materials(osm) if osm else None,
        roof_color=ortho.roof_color if ortho.available else None,
    )

    print("Land use …")
    lu = build_landuse(landuse, osm_mod.pedestrian_shapes(osm) if osm else ())

    markings = np.zeros((0, 5), np.float32)
    points = {}
    if osm:
        print("OSM details …")
        markings = osm_mod.build_markings(osm, sample, h0)
        points = osm_mod.build_points(osm, sample, h0, walls_index)
        print(f"  markings: {len(markings) // 3} triangles, " + ", ".join(f"{k}: {len(v)}" for k, v in points.items()))
    markings.astype("<f4").tofile(out / "markings.bin")
    Image.fromarray(lu, mode="L").save(out / "landuse.png", optimize=True)

    # --- write binaries
    min_h = float(heights.min()) - 1.0
    (np.round((heights - min_h) * 100).clip(0, 65535).astype("<u2")).tofile(out / "terrain.bin")
    water.astype("<f4").tofile(out / "water.bin")

    chunk_index = []
    offset = 0
    with open(out / "buildings.bin", "wb") as fb:
        for (cx, cz), data in sorted(chunks.items()):
            entry = {"cx": cx, "cz": cz}
            for key in ("walls", "roofs"):
                arr = np.concatenate(data[key]).astype("<f4") if data[key] else np.zeros((0, 7), "<f4")
                fb.write(arr.tobytes())
                entry[key] = {"offset": offset, "vertices": int(arr.shape[0])}
                offset += arr.nbytes
            chunk_index.append(entry)

    pois, streets = build_pois(footprints, labels, landuse, h0, sample)
    meta = {
        "version": 1,
        "attribution": config.ATTRIBUTION + " · Kartendaten © OpenStreetMap-Mitwirkende (ODbL)",
        "origin": {"e": config.ORIGIN_E, "n": config.ORIGIN_N, "height": h0, "crs": "EPSG:25832"},
        "bounds": {
            "minX": MIN_E - config.ORIGIN_E,
            "maxX": MAX_E - config.ORIGIN_E,
            "minZ": -(MAX_N - config.ORIGIN_N),
            "maxZ": -(MIN_N - config.ORIGIN_N),
        },
        "terrain": {"cols": cols, "rows": rows, "cell": config.TERRAIN_CELL, "minHeight": min_h - h0, "scale": 0.01},
        "landuse": {"width": int(lu.shape[1]), "height": int(lu.shape[0]), "cell": config.LANDUSE_CELL},
        "water": {"vertices": int(water.shape[0])},
        "markings": {"vertices": int(markings.shape[0]), "stride": 5},
        "osm": points,
        "buildings": {"count": count, "chunkSize": config.CHUNK, "wallStride": 7, "roofStride": 7, "chunks": chunk_index},
        "pois": pois,
        "streets": streets,
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    for f in sorted(out.iterdir()):
        print(f"  {f.name:16s} {f.stat().st_size / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
