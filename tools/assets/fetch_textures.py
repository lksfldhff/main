"""Downloads the CC0 PBR textures + HDRI used by the game from Poly Haven (polyhaven.com, CC0).

The files are committed to public/assets/, so this only needs to run when the list changes.
Usage: python tools/assets/fetch_textures.py
"""
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path("public/assets")
API = "https://api.polyhaven.com/files/"

# game name -> Poly Haven asset id. Order inside each group = texture-array layer index.
TEXTURES = {
    # ground layers (must match src/world/heilbronn/LandUse.ts)
    "ground_asphalt": "asphalt_02",
    "ground_sidewalk": "concrete_pavement",
    "ground_plaza": "red_sandstone_pavement",
    "ground_path": "gravel_concrete",
    "ground_grass": "leafy_grass",
    "ground_urban": "rectangular_paving",
    "ground_rail": "gravel_floor",
    # wall layers (must match src/world/heilbronn/BuildingStyles.ts)
    "wall_plaster": "painted_plaster_wall",
    "wall_brick": "red_brick_03",
    "wall_sandstone": "red_sandstone_wall",
    "wall_concrete": "concrete_wall_008",
    "wall_metal": "corrugated_iron_02",
    # roof layers
    "roof_clay": "clay_roof_tiles_02",
    "roof_slate": "roof_slates_03",
    "roof_metal": "corrugated_iron",
    "roof_flat": "gravel_concrete_03",
}
HDRI = ("sky_partly_cloudy", "kloofendal_48d_partly_cloudy_puresky")

DIFF_SIZE = 2048
NORMAL_SIZE = 1024


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "heilbronn-game-asset-fetcher/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def save_jpg(data: bytes, path: Path, size: int, quality: int) -> None:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if img.size != (size, size):
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=True)


def main() -> None:
    (OUT / "textures").mkdir(parents=True, exist_ok=True)
    (OUT / "hdri").mkdir(parents=True, exist_ok=True)
    credits = []
    for name, asset in TEXTURES.items():
        files = json.loads(get(API + asset))
        diff = (files.get("Diffuse") or files.get("diffuse"))["2k"]["jpg"]["url"]
        nor = files["nor_gl"]["1k"]["jpg"]["url"]
        save_jpg(get(diff), OUT / "textures" / f"{name}_diff.jpg", DIFF_SIZE, 82)
        save_jpg(get(nor), OUT / "textures" / f"{name}_nrm.jpg", NORMAL_SIZE, 90)
        credits.append(f"{name}: https://polyhaven.com/a/{asset}")
        print("✓", name, "←", asset)
    name, asset = HDRI
    files = json.loads(get(API + asset))
    (OUT / "hdri" / f"{name}.hdr").write_bytes(get(files["hdri"]["1k"]["hdr"]["url"]))
    credits.append(f"{name}: https://polyhaven.com/a/{asset}")
    print("✓", name)
    (OUT / "CREDITS.txt").write_text(
        "Textures and HDRI from Poly Haven (https://polyhaven.com), licensed CC0 1.0 (public domain).\n\n"
        + "\n".join(credits) + "\n"
    )


if __name__ == "__main__":
    main()
