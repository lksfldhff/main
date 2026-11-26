"""OpenStreetMap enrichment for the Heilbronn world (© OpenStreetMap contributors, ODbL).

Cross-checks and complements the LGL data with details the official datasets lack:
lane markings, tram tracks, pedestrian zones, crossings, traffic lights, real tree
positions, benches, bus stops, facade/roof materials and wall-mounted clocks.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon

import config

MARKED_ROADS = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link"}
DRIVABLE = MARKED_ROADS | {"residential", "unclassified", "living_street", "service"}
LANE_WIDTH = 3.25
MARK_SOLID, MARK_DASHED, MARK_RAIL = 0, 1, 2

MATERIAL_CODES = {"plaster": 1, "sandstone": 2, "stone": 2, "brick": 3, "glass": 4, "concrete": 5, "metal": 6}


class OsmData:
    def __init__(self, path: Path):
        root = ET.parse(path).getroot()
        tr = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
        self.nodes: dict[str, tuple[float, float]] = {}
        self.node_tags: dict[str, dict] = {}
        for n in root.iter("node"):
            e, nn = tr.transform(float(n.get("lon")), float(n.get("lat")))
            self.nodes[n.get("id")] = (e, nn)
            tags = {t.get("k"): t.get("v") for t in n.iter("tag")}
            if tags:
                self.node_tags[n.get("id")] = tags
        self.ways = []
        for w in root.iter("way"):
            refs = [nd.get("ref") for nd in w.iter("nd") if nd.get("ref") in self.nodes]
            tags = {t.get("k"): t.get("v") for t in w.iter("tag")}
            if len(refs) >= 2:
                self.ways.append((w.get("id"), refs, tags))
        self.way_by_id = {wid: (refs, tags) for wid, refs, tags in self.ways}
        self.relations = []
        for r in root.iter("relation"):
            tags = {t.get("k"): t.get("v") for t in r.iter("tag")}
            outers = [m.get("ref") for m in r.iter("member") if m.get("type") == "way" and m.get("role") in ("outer", "")]
            self.relations.append((tags, outers))

    def coords(self, refs):
        return [self.nodes[r] for r in refs]

    def polygon(self, refs):
        if len(refs) < 4 or refs[0] != refs[-1]:
            return None
        try:
            p = Polygon(self.coords(refs)).buffer(0)
            return None if p.is_empty else p
        except Exception:
            return None


def in_bbox(e: float, n: float, margin: float = 0.0) -> bool:
    return config.BBOX[0] - margin <= e <= config.BBOX[2] + margin and config.BBOX[1] - margin <= n <= config.BBOX[3] + margin


def lanes_of(tags: dict) -> int:
    try:
        return max(1, int(float(tags.get("lanes", "").split(";")[0])))
    except ValueError:
        return 1 if tags.get("oneway") == "yes" else 2


# ----------------------------------------------------------------------------- pedestrian areas
def pedestrian_shapes(osm: OsmData):
    """Pedestrian zones / squares as polygons (UTM) to repaint road pixels as paving."""
    shapes = []
    for _, refs, t in osm.ways:
        hw = t.get("highway")
        if hw in ("pedestrian",) or (hw == "footway" and t.get("area") == "yes") or t.get("place") == "square":
            poly = osm.polygon(refs) if t.get("area") == "yes" or refs[0] == refs[-1] else None
            if poly is not None:
                shapes.append(poly)
            elif hw == "pedestrian":
                width = float(t.get("width", "8").split()[0]) if t.get("width", "").replace(".", "", 1).isdigit() else 8.0
                shapes.append(LineString(osm.coords(refs)).buffer(width / 2, cap_style=2))
    return shapes


# ----------------------------------------------------------------------------- markings
def _junction_nodes(osm: OsmData) -> set[str]:
    use = defaultdict(int)
    for _, refs, t in osm.ways:
        if t.get("highway") in DRIVABLE:
            for r in set(refs):
                use[r] += 1
    return {r for r, c in use.items() if c >= 2}


def _densify(pts: np.ndarray, step: float) -> tuple[np.ndarray, np.ndarray]:
    out = [pts[0]]
    dist = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        seg = np.linalg.norm(b - a)
        k = max(1, int(math.ceil(seg / step)))
        for i in range(1, k + 1):
            out.append(a + (b - a) * (i / k))
            dist.append(dist[-1] + seg / k)
    return np.array(out), np.array(dist)


def build_markings(osm: OsmData, sample, h0: float):
    """Returns Float32 triangle data: x, y, z, along (m), type – draped on the terrain."""
    junctions = _junction_nodes(osm)
    crossing_nodes = {nid for nid, t in osm.node_tags.items() if t.get("highway") == "crossing"}
    tris: list[np.ndarray] = []

    def ribbon(pts: np.ndarray, offset: float, width: float, kind: int, keep_mask: np.ndarray, along0: np.ndarray):
        d = np.gradient(pts, axis=0)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
        nrm = np.stack([-d[:, 1], d[:, 0]], axis=1)
        center = pts + nrm * offset
        left = center + nrm * (width / 2)
        right = center - nrm * (width / 2)
        for i in range(len(pts) - 1):
            if not (keep_mask[i] and keep_mask[i + 1]):
                continue
            quad = [left[i], right[i], right[i + 1], left[i + 1]]
            al = [along0[i], along0[i], along0[i + 1], along0[i + 1]]
            for a, b, c in ((0, 1, 2), (0, 2, 3)):
                for k in (a, b, c):
                    e, n = quad[k]
                    tris.append(np.array([e, n, al[k], kind], dtype=np.float64))

    for _, refs, t in osm.ways:
        hw = t.get("highway")
        is_tram = t.get("railway") == "tram"
        if hw not in MARKED_ROADS and not is_tram:
            continue
        if t.get("bridge") in ("yes", "viaduct") or t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0") not in ("0",):
            continue
        pts = np.array(osm.coords(refs))
        if not any(in_bbox(e, n, 50) for e, n in pts):
            continue
        dense, along = _densify(pts, 2.0)
        keep = np.ones(len(dense), bool)
        for i, r in enumerate(refs):
            e, n = osm.nodes[r]
            radius = 9.0 if r in junctions else 3.2 if r in crossing_nodes else 0.0
            if radius == 0.0 or is_tram:
                continue
            keep &= np.hypot(dense[:, 0] - e, dense[:, 1] - n) > radius
        if is_tram:
            ribbon(dense, 0.7175, 0.09, MARK_RAIL, keep, along)
            ribbon(dense, -0.7175, 0.09, MARK_RAIL, keep, along)
            continue
        lanes = lanes_of(t)
        oneway = t.get("oneway") == "yes" or hw.endswith("_link")
        if oneway:
            for k in range(1, lanes):
                ribbon(dense, (k - lanes / 2) * LANE_WIDTH, 0.12, MARK_DASHED, keep, along)
        else:
            if lanes >= 4:
                ribbon(dense, 0.12, 0.12, MARK_SOLID, keep, along)
                ribbon(dense, -0.12, 0.12, MARK_SOLID, keep, along)
                per_side = lanes // 2
                for k in range(1, per_side):
                    ribbon(dense, k * LANE_WIDTH, 0.12, MARK_DASHED, keep, along)
                    ribbon(dense, -k * LANE_WIDTH, 0.12, MARK_DASHED, keep, along)
            elif lanes >= 2:
                ribbon(dense, 0.0, 0.13, MARK_DASHED, keep, along)
    if not tris:
        return np.zeros((0, 5), np.float32)
    arr = np.array(tris)
    h = sample(arr[:, 0], arr[:, 1]) - h0 + 0.035
    x = arr[:, 0] - config.ORIGIN_E
    z = -(arr[:, 1] - config.ORIGIN_N)
    return np.stack([x, h, z, arr[:, 2], arr[:, 3]], axis=1).astype(np.float32)


# ----------------------------------------------------------------------------- point features
def _way_direction_at(osm: OsmData, node_id: str, kinds=DRIVABLE):
    for _, refs, t in osm.ways:
        if t.get("highway") not in kinds or node_id not in refs:
            continue
        i = refs.index(node_id)
        a = osm.nodes[refs[max(i - 1, 0)]]
        b = osm.nodes[refs[min(i + 1, len(refs) - 1)]]
        d = np.array(b) - np.array(a)
        ln = np.linalg.norm(d)
        if ln > 1e-6:
            width = lanes_of(t) * LANE_WIDTH + 0.8
            return d / ln, width, t
    return None, None, None


def _local(e: float, n: float, sample, h0: float):
    return (
        round(e - config.ORIGIN_E, 2),
        round(float(sample(np.array([e]), np.array([n]))[0]) - h0, 2),
        round(-(n - config.ORIGIN_N), 2),
    )


def build_points(osm: OsmData, sample, h0: float, walls_index):
    out = {"trees": [], "crossings": [], "signals": [], "benches": [], "busStops": [], "fountains": [], "clocks": [],
           "wasteBaskets": [], "postBoxes": [], "bicycleParking": [], "bollards": [], "hydrants": [], "adColumns": [],
           "streetCabinets": [], "barrierBlocks": []}
    for nid, t in osm.node_tags.items():
        e, n = osm.nodes[nid]
        if not in_bbox(e, n):
            continue
        x, y, z = _local(e, n, sample, h0)
        if t.get("natural") == "tree":
            out["trees"].append([x, y, z])
        elif t.get("highway") == "crossing":
            d, width, _ = _way_direction_at(osm, nid)
            if d is None:
                continue
            kind = 1 if t.get("crossing") == "traffic_signals" else 0
            if t.get("crossing") == "unmarked":
                continue
            # game-space direction (x east, z south)
            out["crossings"].append([x, y, z, round(float(d[0]), 3), round(float(-d[1]), 3), round(min(max(width, 5.5), 16), 1), kind])
        elif t.get("highway") == "traffic_signals":
            d, width, _ = _way_direction_at(osm, nid)
            if d is None:
                continue
            out["signals"].append([x, y, z, round(float(d[0]), 3), round(float(-d[1]), 3), round(min(max(width, 5.5), 16), 1)])
        elif t.get("amenity") == "bench":
            out["benches"].append([x, y, z])
        elif t.get("highway") == "bus_stop" or (t.get("public_transport") == "platform" and t.get("bus") == "yes"):
            # x, y, z, shelter (OSM shelter=yes → glass shelter), bench
            shelter = 1 if t.get("shelter") == "yes" else 0
            bench = 1 if t.get("bench") == "yes" else 0
            if any(abs(b[0] - x) < 4 and abs(b[2] - z) < 4 for b in out["busStops"]):
                continue  # stop_position + platform duplicates
            out["busStops"].append([x, y, z, shelter, bench])
        elif t.get("amenity") == "waste_basket":
            out["wasteBaskets"].append([x, y, z])
        elif t.get("amenity") == "post_box":
            out["postBoxes"].append([x, y, z])
        elif t.get("amenity") == "bicycle_parking":
            out["bicycleParking"].append([x, y, z, int(t.get("capacity", "6")) if t.get("capacity", "").isdigit() else 6])
        elif t.get("barrier") == "bollard":
            out["bollards"].append([x, y, z])
        elif t.get("emergency") == "fire_hydrant" and t.get("fire_hydrant:type", "pillar") == "pillar":
            out["hydrants"].append([x, y, z])
        elif t.get("man_made") == "street_cabinet":
            out["streetCabinets"].append([x, y, z])
        elif t.get("barrier") in ("block", "jersey_barrier"):
            out["barrierBlocks"].append([x, y, z])
        elif t.get("advertising") == "column":
            out["adColumns"].append([x, y, z])
        elif t.get("amenity") == "fountain":
            out["fountains"].append([x, y, z])
        elif t.get("amenity") == "clock" and t.get("support") != "pole" and t.get("display") != "digital":
            hit = walls_index(e, n)
            if hit:
                out["clocks"].append({"name": t.get("name", ""), **hit})
    for _, refs, t in osm.ways:
        if t.get("natural") == "tree_row":
            line = LineString(osm.coords(refs))
            for k in range(int(line.length // 9) + 1):
                p = line.interpolate(k * 9)
                if in_bbox(p.x, p.y):
                    out["trees"].append(list(_local(p.x, p.y, sample, h0)))
    return out


# ----------------------------------------------------------------------------- building attributes
def building_materials(osm: OsmData):
    """STRtree over OSM buildings with facade/roof material hints and names."""
    polys, attrs = [], []

    def add(poly, t):
        mat = MATERIAL_CODES.get(t.get("building:material", ""), 0)
        roof = t.get("roof:material", "")
        if mat or roof or t.get("name"):
            polys.append(poly)
            attrs.append({"material": mat, "roof": roof, "name": t.get("name", "")})

    for _, refs, t in osm.ways:
        if "building" in t or "building:part" in t:
            poly = osm.polygon(refs)
            if poly is not None:
                add(poly, t)
    for t, outers in osm.relations:
        if "building" in t and t.get("type") == "multipolygon":
            for wid in outers:
                if wid in osm.way_by_id:
                    poly = osm.polygon(osm.way_by_id[wid][0])
                    if poly is not None:
                        add(poly, t)
    tree = STRtree(polys) if polys else None

    def lookup(e: float, n: float):
        if tree is None:
            return None
        hits = tree.query(Point(e, n), predicate="within")
        return attrs[int(hits[0])] if len(hits) else None

    return lookup
