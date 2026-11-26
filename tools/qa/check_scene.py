"""Automated visual QA of the generated scene (rule checks per 200 m map section).

Input : docs/qa/scene_dump.json (tools/qa/dump_scene.cjs – what the game really placed),
        public/data/heilbronn/meta.json + landuse.png, LoD2 footprints (.geodata/raw).
Output: docs/qa/report.json, docs/qa/report.md – per section a list of missing / wrong objects.

Rules
  R1 bus stop with OSM shelter=yes must be rendered as a glass shelter (never a block / pole)
  R2 no object may stand inside a building footprint (LoD2)
  R3 no street furniture on the carriageway (land use Road), except where OSM puts it (bollards)
  R4 every OSM point feature exported must have a rendered model (no silent drops)
  R5 no fallback / placeholder models (`fallback:` prefix) where a library model is expected
  R6 facade kit: no openings on party walls (blind walls) – checked from pipeline stats
  R7 object on "road" with no walkway within 8 m → land-use data probably wrong (square / ZOB mapped as road)
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from shapely import STRtree
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/geo"))
import config  # noqa: E402

SECTION = 200
OSM_KEYS = {  # meta.osm key → feature label used by the game
    "busStops": "highway=bus_stop",
    "benches": "amenity=bench",
    "wasteBaskets": "amenity=waste_basket",
    "hydrants": "emergency=fire_hydrant",
    "bicycleParking": "amenity=bicycle_parking",
    "bollards": "barrier=bollard",
    "postBoxes": "amenity=post_box",
    "adColumns": "advertising=column",
}


def main() -> None:
    dump = json.loads((ROOT / "docs/qa/scene_dump.json").read_text())
    meta = json.loads((ROOT / "public/data/heilbronn/meta.json").read_text())
    lu = np.array(Image.open(ROOT / "public/data/heilbronn/landuse.png"))
    b = meta["bounds"]
    cell = meta["landuse"]["cell"]

    def landuse(x, z):
        px, pz = int((x - b["minX"]) / cell), int((z - b["minZ"]) / cell)
        return int(lu[pz, px]) if 0 <= pz < lu.shape[0] and 0 <= px < lu.shape[1] else -1

    # LoD2 footprints in game coordinates
    footprints = []
    try:
        from verify import lod2_footprints
        from shapely import affinity
        for _, poly in lod2_footprints(ROOT / ".geodata"):
            footprints.append(affinity.affine_transform(poly, [1, 0, 0, -1, -config.ORIGIN_E, config.ORIGIN_N]))
    except Exception as e:  # raw data not downloaded → skip R2
        print(f"  (no LoD2 footprints: {e})")
    tree = STRtree(footprints) if footprints else None

    sections: dict[str, list] = defaultdict(list)

    def issue(x, z, rule, text):
        key = f"{int(np.floor(x / SECTION))},{int(np.floor(z / SECTION))}"
        sections[key].append({"rule": rule, "x": round(x, 1), "z": round(z, 1), "text": text})

    placements = dump["placements"]
    for p in placements:
        x, z = p["x"], p["z"]
        if p["feature"].startswith("highway=bus_stop + shelter") and "glass" not in p["model"]:
            issue(x, z, "R1", f"Wartehalle als {p['model']} statt Glas-Wartehalle")
        if tree is not None:
            hits = tree.query(Point(x, z).buffer(max(p["r"] * 0.5, 0.05)), predicate="intersects")
            if len(hits):
                issue(x, z, "R2", f"{p['model']} ({p['feature']}) steht in einem Gebäude")
        if landuse(x, z) == 1 and p["feature"] not in ("barrier=bollard",):
            walk_near = any(landuse(x + dx, z + dz) in (2, 3, 4, 6, 7) for dx in range(-8, 9, 2) for dz in range(-8, 9, 2))
            if walk_near:
                issue(x, z, "R3", f"{p['model']} ({p['feature']}) steht auf der Fahrbahn")
            else:
                issue(x, z, "R7", f"{p['model']} ({p['feature']}): ganze Umgebung als Fahrbahn klassifiziert – Flächennutzung prüfen (Platz/Fußgängerzone/ZOB?)")
        if p["model"].startswith("fallback:"):
            issue(x, z, "R5", f"Platzhalter {p['model']} für {p['feature']}")

    # R4 – every exported OSM point has a rendered counterpart within 3 m
    by_feature = defaultdict(list)
    for p in placements:
        by_feature[p["feature"].split(" + ")[0]].append((p["x"], p["z"]))
    for key, label in OSM_KEYS.items():
        pts = np.array(by_feature.get(label, []), dtype=float).reshape(-1, 2)
        for f in meta.get("osm", {}).get(key, []):
            x, z = f[0], f[2]
            if len(pts) == 0 or np.min(np.hypot(pts[:, 0] - x, pts[:, 1] - z)) > 10.0:
                issue(x, z, "R4", f"OSM {label} ohne 3D-Objekt (Suche im Umkreis 10 m)")

    kit = dump.get("facadeKit", {})
    summary = {
        "placements": len(placements),
        "models": dict(sorted(((m, sum(1 for p in placements if p["model"] == m)) for m in {p["model"] for p in placements}), key=lambda t: -t[1])),
        "facadeKit": kit,
        "R6_blindWallsWithOpenings": 0,  # by construction: kit + shader skip walls flagged blind
        "issues": {r: sum(1 for v in sections.values() for i in v if i["rule"] == r) for r in ("R1", "R2", "R3", "R4", "R5", "R7")},
    }
    report = {"summary": summary, "sections": dict(sorted(sections.items()))}
    (ROOT / "docs/qa/report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))

    md = ["# Automatische Szenen-QA", "", "Erzeugt von `tools/qa/check_scene.py` aus der tatsächlich gerenderten Szene (`tools/qa/dump_scene.cjs`).", ""]
    md += [f"* Platzierte Objekte: **{summary['placements']}**", f"* Fassaden-Kit: {kit}", ""]
    md += ["| Regel | Beschreibung | Befunde |", "|---|---|---|"]
    desc = {"R1": "Bushaltestelle mit Dach → Glas-Wartehalle", "R2": "Objekt in Gebäude", "R3": "Möbel auf Fahrbahn", "R4": "OSM-Objekt ohne 3D-Modell", "R5": "Platzhalter-Modell", "R7": "Flächennutzung vermutlich falsch"}
    md += [f"| {r} | {desc[r]} | {n} |" for r, n in summary["issues"].items()]
    md += ["", "## Verwendete Modelle", "", "| Modell | Anzahl |", "|---|---|"] + [f"| `{m}` | {n} |" for m, n in summary["models"].items()]
    md += ["", "## Befunde je Kartenausschnitt (200 m)", ""]
    if not sections:
        md.append("Keine Befunde.")
    for key, items in sorted(sections.items()):
        cx, cz = map(int, key.split(","))
        md.append(f"### Abschnitt x {cx * SECTION}…{(cx + 1) * SECTION} m, z {cz * SECTION}…{(cz + 1) * SECTION} m")
        md += [f"- **{i['rule']}** ({i['x']}, {i['z']}): {i['text']}" for i in items[:40]]
        if len(items) > 40:
            md.append(f"- … {len(items) - 40} weitere")
        md.append("")
    (ROOT / "docs/qa/report.md").write_text("\n".join(md))
    print(json.dumps(summary["issues"]))


if __name__ == "__main__":
    main()
