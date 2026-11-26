"""Geometric verification of the generated Heilbronn world against independent sources.

Compares
  * LoD2 building footprints (LGL)      vs  OSM building footprints (independent survey)
  * OSM road centre lines               vs  ALKIS road/square/path areas (official cadastre)
  * OSM point features (bus stops …)    vs  LoD2 footprints (must not stand inside buildings)
  * landmark positions                  vs  both sources
and writes
  docs/verification/report.json   metrics
  docs/verification/layers.json   vector layers in game coordinates (for the map viewer)
  docs/verification/ortho.jpg     LGL orthophoto of the play area (0.5 m/px) as the real reference

Usage: python tools/geo/verify.py [raw_dir] [out_dir]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from lxml import etree
from PIL import Image
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import config
import osm as osm_mod
from build_heilbronn import NS, load_alkis, parse_ring
from dop import OrthoMosaic

MIN_E, MIN_N, MAX_E, MAX_N = config.BBOX


def local(e, n):
    return round(float(e) - config.ORIGIN_E, 2), round(-(float(n) - config.ORIGIN_N), 2)


def ring_local(coords):
    return [local(e, n) for e, n in coords]


def lod2_footprints(raw: Path):
    """2D footprints (UTM) of all LoD2 buildings in the play area, from their GroundSurfaces."""
    out = []
    tag_b = f"{{{NS['bldg']}}}Building"
    for tile in config.LOD2_TILES:
        for f in sorted((raw / "lod2" / tile).rglob("*.gml")):
            parts = f.stem.split("_")
            te, tn = int(parts[2]) * 1000, int(parts[3]) * 1000
            if te > MAX_E or te + 1000 < MIN_E or tn > MAX_N or tn + 1000 < MIN_N:
                continue
            for _, el in etree.iterparse(str(f), events=("end",), tag=tag_b):
                polys = []
                for g in el.iter(f"{{{NS['bldg']}}}GroundSurface"):
                    for pos in g.iter(f"{{{NS['gml']}}}posList"):
                        r = parse_ring(pos.text)
                        if len(r) >= 3:
                            p = Polygon(r[:, :2]).buffer(0)
                            if not p.is_empty:
                                polys.append(p)
                if polys:
                    fp = unary_union(polys)
                    c = fp.centroid
                    if MIN_E <= c.x <= MAX_E and MIN_N <= c.y <= MAX_N:
                        out.append((el.get(f"{{{NS['gml']}}}id"), fp))
                el.clear()
                while el.getprevious() is not None:
                    del el.getparent()[0]
    return out


def main() -> None:
    raw = Path(sys.argv[1] if len(sys.argv) > 1 else ".geodata")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/verification")
    out.mkdir(parents=True, exist_ok=True)

    print("LoD2 footprints …")
    lod2 = lod2_footprints(raw)
    print(f"  {len(lod2)}")
    print("ALKIS …")
    landuse, footprints, _ = load_alkis(raw)
    print("OSM …")
    osm = osm_mod.OsmData(raw / "osm" / "heilbronn.osm")

    # --- 1. Buildings: LoD2 vs OSM (IoU of best match)
    osm_buildings = []
    for _, refs, t in osm.ways:
        if "building" in t and t.get("building") not in ("roof", "no"):
            p = osm.polygon(refs)
            if p is not None and MIN_E <= p.centroid.x <= MAX_E and MIN_N <= p.centroid.y <= MAX_N:
                osm_buildings.append((t, p))
    lod2_tree = STRtree([p for _, p in lod2])
    ious, offsets = [], []
    unmatched_osm = []
    for t, p in osm_buildings:
        best, best_c = 0.0, None
        for i in lod2_tree.query(p):
            q = lod2[int(i)][1]
            inter = p.intersection(q).area
            if inter <= 0:
                continue
            iou = inter / p.union(q).area
            if iou > best:
                best, best_c = iou, q.centroid
        ious.append(best)
        if best_c is not None and best > 0.5:
            offsets.append(p.centroid.distance(best_c))
        # Really missing in LoD2 (not just split differently): less than half of the OSM
        # footprint is covered by any LoD2 building.
        covered = sum(p.intersection(lod2[int(i)][1]).area for i in lod2_tree.query(p))
        if covered < 0.5 * p.area and p.area > 25:
            unmatched_osm.append(p)
    ious = np.array(ious)
    lod2_area = unary_union([p for _, p in lod2])
    osm_area = unary_union([p for _, p in osm_buildings])
    area_iou = lod2_area.intersection(osm_area).area / lod2_area.union(osm_area).area

    # --- 2. Roads: OSM centre lines inside ALKIS traffic areas
    traffic = unary_union([g for g, rec in landuse if rec.get("nutzart") in ("Strassenverkehr", "Platz", "Weg", "Bahnverkehr")]).buffer(1.5)
    total = inside = 0.0
    road_lines = []
    for _, refs, t in osm.ways:
        hw = t.get("highway")
        if hw not in osm_mod.DRIVABLE or t.get("tunnel") or t.get("layer", "0") not in ("0",):
            continue
        line = LineString(osm.coords(refs)).intersection(Polygon([(MIN_E, MIN_N), (MAX_E, MIN_N), (MAX_E, MAX_N), (MIN_E, MAX_N)]))
        if line.is_empty:
            continue
        total += line.length
        inside += line.intersection(traffic).length
        for seg in getattr(line, "geoms", [line]):
            if seg.geom_type == "LineString":
                road_lines.append({"c": ring_local(seg.coords), "k": hw})

    # --- 3. Point features must not stand inside buildings
    feats = {"bus_stop": [], "bench": [], "traffic_signals": [], "tree": [], "street_lamp": []}
    for nid, t in osm.node_tags.items():
        e, n = osm.nodes[nid]
        if not (MIN_E <= e <= MAX_E and MIN_N <= n <= MAX_N):
            continue
        key = t.get("highway") if t.get("highway") in feats else t.get("amenity") if t.get("amenity") in feats else t.get("natural") if t.get("natural") == "tree" else None
        if key:
            feats[key].append(Point(e, n))
    inside_bld = {}
    for k, pts in feats.items():
        bad = [p for p in pts if len(lod2_tree.query(p, predicate="within"))]
        inside_bld[k] = {"total": len(pts), "insideBuilding": len(bad)}

    # --- 4. Landmarks
    landmarks = {}
    for name in ("Kilianskirche", "Götzenturm", "experimenta", "Rathaus Heilbronn", "Theater Heilbronn"):
        cands = [p for t, p in osm_buildings if t.get("name") == name]
        for tags, outers in osm.relations:
            if tags.get("name") == name:
                for wid in outers:
                    if wid in osm.way_by_id:
                        pp = osm.polygon(osm.way_by_id[wid][0])
                        if pp is not None:
                            cands.append(pp)
        if not cands:
            continue
        p = unary_union(cands)
        hits = [lod2[int(i)][1] for i in lod2_tree.query(p) if lod2[int(i)][1].intersection(p).area > 0.3 * lod2[int(i)][1].area]
        if hits:
            q = unary_union(hits)
            landmarks[name] = {
                "osmCentroid": local(p.centroid.x, p.centroid.y),
                "lod2Centroid": local(q.centroid.x, q.centroid.y),
                "offsetM": round(p.centroid.distance(q.centroid), 2),
                "iou": round(p.intersection(q).area / p.union(q).area, 3),
            }

    report = {
        "crs": "EPSG:25832 (ETRS89/UTM32N); game = UTM minus origin, z = -northing",
        "origin": {"e": config.ORIGIN_E, "n": config.ORIGIN_N},
        "buildings": {
            "lod2Count": len(lod2),
            "osmCount": len(osm_buildings),
            "medianIoU": round(float(np.median(ious)), 3),
            "shareIoUabove0_8": round(float((ious > 0.8).mean()), 3),
            "shareIoUabove0_5": round(float((ious > 0.5).mean()), 3),
            "medianCentroidOffsetM": round(float(np.median(offsets)), 2) if offsets else None,
            "builtAreaIoU": round(area_iou, 3),
            "osmWithoutLod2Match": len(unmatched_osm),
            "osmWithoutLod2AreaM2": round(sum(p.area for p in unmatched_osm)),
        },
        "roads": {
            "osmDrivableLengthM": round(total),
            "shareInsideAlkisTrafficArea": round(inside / total, 3) if total else None,
        },
        "pointFeatures": inside_bld,
        "landmarks": landmarks,
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # --- Layers for the map viewer (game coordinates, 0.1 m precision)
    def polys(geom):
        return [g for g in getattr(geom, "geoms", [geom]) if g.geom_type == "Polygon"]

    def poly_rings(p):
        return [[[round(x, 1), round(y, 1)] for x, y in ring_local(p.exterior.coords)]]

    layers = {
        "bounds": {"minX": MIN_E - config.ORIGIN_E, "maxX": MAX_E - config.ORIGIN_E, "minZ": -(MAX_N - config.ORIGIN_N), "maxZ": -(MIN_N - config.ORIGIN_N)},
        "lod2": [r for _, p in lod2 for g in polys(p) for r in poly_rings(g)],
        "osmBuildings": [r for _, p in osm_buildings for g in polys(p) for r in poly_rings(g)],
        "alkisTraffic": [r for g, rec in landuse if rec.get("nutzart") in ("Strassenverkehr", "Platz") for gg in polys(g) for r in poly_rings(gg)],
        "roads": [{"c": [[round(x, 1), round(y, 1)] for x, y in r["c"]], "k": r["k"]} for r in road_lines],
        "points": {k: [list(local(p.x, p.y)) for p in v] for k, v in feats.items()},
        "unmatched": [r for p in unmatched_osm for r in poly_rings(p)],
    }
    (out / "layers.json").write_text(json.dumps(layers, separators=(",", ":")))

    ortho = OrthoMosaic(raw)
    if ortho.available:
        Image.fromarray(ortho.img).save(out / "ortho.jpg", quality=78, optimize=True, progressive=True)
    for f in sorted(out.iterdir()):
        print(f"  {f.name:14s} {f.stat().st_size / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
