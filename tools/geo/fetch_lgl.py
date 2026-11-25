"""Downloads the raw LGL datasets needed by build_heilbronn.py (one-time, ~90 MB zipped).

Usage:  python tools/geo/fetch_lgl.py [raw_dir]      (default raw_dir: .geodata)
"""
import sys
import urllib.request
import zipfile
from pathlib import Path

import config

BASE = "https://opengeodata.lgl-bw.de/data"


def fetch(url: str, target: Path) -> None:
    if target.exists():
        print(f"✓ {target.name} (cached)")
        return
    print(f"↓ {url}")
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(target)


def unzip(path: Path, dest: Path) -> None:
    if dest.exists():
        return
    with zipfile.ZipFile(path) as z:
        z.extractall(dest)


def main() -> None:
    raw = Path(sys.argv[1] if len(sys.argv) > 1 else ".geodata")
    for t in config.LOD2_TILES:
        name = f"LoD2_32_{t}_2_bw.zip"
        fetch(f"{BASE}/lod2/{name}", raw / "lod2" / name)
        unzip(raw / "lod2" / name, raw / "lod2" / t)
    for t in config.DGM_TILES:
        name = f"dgm1_32_{t}_2_bw.zip"
        fetch(f"{BASE}/dgm/{name}", raw / "dgm" / name)
        unzip(raw / "dgm" / name, raw / "dgm" / t)
    name = config.ALKIS_GEMARKUNG_FILE
    fetch(f"{BASE}/alkis/{name}", raw / "alkis" / name)
    unzip(raw / "alkis" / name, raw / "alkis" / "heilbronn")
    for t in config.DGM_TILES:  # orthophotos for real roof colours (~250 MB per tile)
        name = f"dop20rgb_32_{t}_2_bw.zip"
        fetch(f"{BASE}/dop20/{name}", raw / "dop" / name)
        unzip(raw / "dop" / name, raw / "dop" / t)
    # OpenStreetMap extract of the play area via the official API (one request).
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)
    lo = tr.transform(config.BBOX[0], config.BBOX[1])
    hi = tr.transform(config.BBOX[2], config.BBOX[3])
    bbox = f"{lo[0] - 0.0005:.5f},{lo[1] - 0.0005:.5f},{hi[0] + 0.0005:.5f},{hi[1] + 0.0005:.5f}"
    req = urllib.request.Request(f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}", headers={"User-Agent": "heilbronn-game-data-import/1.0"})
    osm_file = raw / "osm" / "heilbronn.osm"
    if not osm_file.exists():
        osm_file.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(req, timeout=300) as r:
            osm_file.write_bytes(r.read())
    print("done →", raw.resolve())


if __name__ == "__main__":
    main()
