"""Asset pipeline: search → licence check → download → convert/optimise → LODs → library.

Usage:
  python tools/assets/library.py                # build every catalogue entry
  python tools/assets/library.py --only bench   # rebuild one category / id

Output:
  public/assets/models/<id>/lod0.glb, lod1.glb     (meshopt geometry, WebP textures)
  public/assets/library.json                        (central library: category, source, licence, author, LODs, size)

Sources are pluggable (`SOURCES`). Poly Haven (CC0) is implemented; Sketchfab needs an OAuth token
(env SKETCHFAB_TOKEN) and is skipped without it. Only licences on ALLOWED_LICENSES are accepted.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / ".assets-raw" / "library"
OUT = ROOT / "public" / "assets" / "models"
LIBRARY = ROOT / "public" / "assets" / "library.json"
UA = {"User-Agent": "heilbronn-game-asset-fetcher/1.0"}
ALLOWED_LICENSES = {"CC0"}  # CC-BY may be added once attribution display is in place

# id, category, source, source id, target height (m), lod0 simplify ratio, lod1 ratio, texture size
CATALOGUE = [
    ("street_lamp_classic", "street/lamp", "polyhaven", "street_lamp_01", 5.2, 0.3, 0.012, 512),
    ("bench_wood", "street/bench", "polyhaven", "painted_wooden_bench", 0.5, 1.0, 0.5, 512),
    ("street_seating", "street/bench", "polyhaven", "modular_street_seating", 0.77, 0.6, 0.12, 512),
    ("trash_can", "street/waste_basket", "polyhaven", "metal_trash_can", 0.92, 0.5, 0.04, 512),
    ("fire_hydrant", "street/fire_hydrant", "polyhaven", "fire_hydrant", 0.8, 0.15, 0.015, 512),
    ("planter_box", "street/planter", "polyhaven", "planter_box_01", 0.42, 0.6, 0.15, 512),
    ("shrub_a", "vegetation/shrub", "polyhaven", "shrub_01", 0.9, 0.08, 0.015, 512),
    ("shrub_b", "vegetation/shrub", "polyhaven", "shrub_02", 0.9, 0.08, 0.015, 512),
]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


class PolyHaven:
    licence = "CC0"

    def info(self, sid: str) -> dict:
        d = json.loads(get(f"https://api.polyhaven.com/info/{sid}"))
        return {"title": d.get("name", sid), "author": ", ".join(d.get("authors", {}).keys()), "url": f"https://polyhaven.com/a/{sid}", "license": "CC0"}

    def download(self, sid: str, dest: Path) -> Path:
        files = json.loads(get(f"https://api.polyhaven.com/files/{sid}"))
        g = files["gltf"]["1k"]["gltf"]
        dest.mkdir(parents=True, exist_ok=True)
        main = dest / f"{sid}.gltf"
        if not main.exists():
            main.write_bytes(get(g["url"]))
            for rel, meta in g.get("include", {}).items():
                p = dest / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(get(meta["url"]))
        return main


class Sketchfab:
    """CC-licensed downloads via the official Download API (needs SKETCHFAB_TOKEN)."""
    licence = "per model"

    def available(self) -> bool:
        return bool(os.environ.get("SKETCHFAB_TOKEN"))


SOURCES = {"polyhaven": PolyHaven(), "sketchfab": Sketchfab()}


def gltf_transform(*args: str) -> None:
    cmd = ["npx", "--no-install", "gltf-transform", *args]
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def glb_stats(glb: Path) -> dict:
    """Triangle count and bounds via gltf-transform (tools/assets/stats.mjs)."""
    out = subprocess.run(["node", str(ROOT / "tools/assets/stats.mjs"), str(glb)], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def build(entry, library: dict) -> None:
    aid, category, source, sid, height, r0, r1, tex = entry
    src = SOURCES[source]
    meta = src.info(sid)
    if meta["license"] not in ALLOWED_LICENSES:
        print(f"✗ {aid}: licence {meta['license']} not allowed")
        return
    raw = src.download(sid, RAW / sid)
    out = OUT / aid
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / "_tmp.glb"
    files = {}
    for lod, ratio in (("lod0", r0), ("lod1", r1)):
        target = out / f"{lod}.glb"
        gltf_transform("copy", str(raw), str(tmp))
        if ratio < 1.0:
            gltf_transform("simplify", str(tmp), str(tmp), "--ratio", str(ratio), "--error", "0.02" if lod == "lod1" else "0.004")
        size = tex if lod == "lod0" else tex // 2
        gltf_transform("resize", str(tmp), str(tmp), "--width", str(size), "--height", str(size))
        gltf_transform("webp", str(tmp), str(tmp))
        gltf_transform("meshopt", str(tmp), str(target))
        st = glb_stats(target)
        files[lod] = {"file": f"models/{aid}/{lod}.glb", "bytes": target.stat().st_size, "triangles": st["triangles"], "bounds": st["bounds"]}
    tmp.unlink(missing_ok=True)
    library["assets"][aid] = {
        "id": aid,
        "category": category,
        "title": meta["title"],
        "source": source,
        "sourceUrl": meta["url"],
        "author": meta["author"],
        "license": meta["license"],
        "attribution": f"{meta['title']} by {meta['author']} ({meta['url']}), {meta['license']}",
        "downloaded": date.today().isoformat(),
        "targetHeight": height,
        "lodDistances": [0, 45],
        "lods": files,
    }
    print(f"✓ {aid:20s} {category:22s} lod0 {files['lod0']['triangles']:>7} tris {files['lod0']['bytes'] / 1e3:7.0f} kB · lod1 {files['lod1']['triangles']:>6} tris")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    if not shutil.which("npx"):
        sys.exit("npx (Node.js) is required for gltf-transform")
    library = json.loads(LIBRARY.read_text()) if LIBRARY.exists() else {"version": 1, "assets": {}}
    for entry in CATALOGUE:
        if args.only and args.only not in (entry[0], entry[1]):
            continue
        try:
            build(entry, library)
        except Exception as e:  # keep going; report at the end
            print(f"✗ {entry[0]}: {e}")
    library["generated"] = date.today().isoformat()
    LIBRARY.write_text(json.dumps(library, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
