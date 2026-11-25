"""Real roof colours from the LGL digital orthophotos (DOP20, 20 cm, dl-de/by-2-0).

The photos are resampled to a 0.5 m mosaic of the play area. For every building the
median colour of its roof area (shrunk inwards to avoid walls and shadows at the
eaves) becomes the roof tint – so copper, slate, red tiles, gravel or solar panels
appear where they really are.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import MultiPoint, Point, Polygon

import config

Image.MAX_IMAGE_PIXELS = None
CELL = 0.5


class OrthoMosaic:
    def __init__(self, raw: Path):
        minE, minN, maxE, maxN = config.BBOX
        self.w = int((maxE - minE) / CELL)
        self.h = int((maxN - minN) / CELL)
        self.img = np.zeros((self.h, self.w, 3), np.uint8)
        self.valid = np.zeros((self.h, self.w), bool)
        files = [f for f in (raw / "dop").rglob("*") if f.suffix.lower() in (".tif", ".tiff", ".jpg", ".jp2", ".png")]
        for f in sorted(files):
            m = re.search(r"_32_(\d{3})_(\d{4})_", f.name)
            if not m:
                continue
            te, tn = int(m.group(1)) * 1000, int(m.group(2)) * 1000
            if te > maxE or te + 1000 < minE or tn > maxN or tn + 1000 < minN:
                continue
            with Image.open(f) as im:
                size_m = 1000.0
                px = int(size_m / CELL)
                tile = np.asarray(im.convert("RGB").resize((px, px), Image.Resampling.BOX))
            # tile covers E [te, te+1000], N [tn, tn+1000]; row 0 = north
            x0 = int(round((te - minE) / CELL))
            y0 = int(round((maxN - (tn + size_m)) / CELL))
            sx0, sy0 = max(0, -x0), max(0, -y0)
            dx0, dy0 = max(0, x0), max(0, y0)
            wcopy = min(px - sx0, self.w - dx0)
            hcopy = min(px - sy0, self.h - dy0)
            if wcopy > 0 and hcopy > 0:
                self.img[dy0:dy0 + hcopy, dx0:dx0 + wcopy] = tile[sy0:sy0 + hcopy, sx0:sx0 + wcopy]
                self.valid[dy0:dy0 + hcopy, dx0:dx0 + wcopy] = True
            print(f"  orthophoto {f.name}")
        self.available = bool(self.valid.any())

    def roof_color(self, es: np.ndarray, ns: np.ndarray) -> int:
        """Packed 0xRRGGBB median colour inside the roof outline, 0 if unknown."""
        if not self.available or len(es) < 3:
            return 0
        hull = MultiPoint(list(zip(es, ns))).convex_hull
        inner = hull.buffer(-0.8)
        area = inner if not inner.is_empty and inner.area > 4 else hull
        if area.geom_type not in ("Polygon", "MultiPolygon"):
            return 0
        minx, miny, maxx, maxy = area.bounds
        xs = np.arange(minx, maxx, 1.0)
        ys = np.arange(miny, maxy, 1.0)
        samples = []
        for yy in ys:
            for xx in xs:
                if area.contains(Point(xx, yy)):
                    c = int((xx - config.BBOX[0]) / CELL)
                    r = int((config.BBOX[3] - yy) / CELL)
                    if 0 <= r < self.h and 0 <= c < self.w and self.valid[r, c]:
                        samples.append(self.img[r, c])
        if len(samples) < 4:
            return 0
        arr = np.array(samples, np.float32)
        # Ignore the darkest quarter (shadowed roof parts) before taking the median.
        lum = arr @ np.array([0.299, 0.587, 0.114])
        keep = arr[lum >= np.percentile(lum, 25)]
        r, g, b = np.median(keep, axis=0).astype(int)
        return int(r) << 16 | int(g) << 8 | int(b) or 1
