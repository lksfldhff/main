"""Radiance .hdr tools: downscale an HDRI and find its sun direction.

  python tools/assets/hdri.py in.hdr out.hdr --width 1024     # box-filtered downscale, flat RGBE output
  python tools/assets/hdri.py in.hdr --sun                    # prints sun azimuth/elevation (degrees)
"""
from __future__ import annotations

import argparse
import json
import math
import re

import numpy as np


def read_hdr(path: str) -> np.ndarray:
    data = open(path, "rb").read()
    end = data.index(b"\n\n") + 2
    m = re.match(rb"([-+]Y) (\d+) ([-+]X) (\d+)\n", data[end:])
    h, w = int(m.group(2)), int(m.group(4))
    pos = end + m.end()
    out = np.zeros((h, w, 4), np.uint8)
    buf = np.frombuffer(data, np.uint8)
    for y in range(h):
        if buf[pos] == 2 and buf[pos + 1] == 2 and w >= 8:  # new RLE
            pos += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = int(buf[pos]); pos += 1
                    if n > 128:
                        n -= 128
                        out[y, x:x + n, c] = buf[pos]; pos += 1
                    else:
                        out[y, x:x + n, c] = buf[pos:pos + n]; pos += n
                    x += n
        else:  # flat
            out[y] = buf[pos:pos + w * 4].reshape(w, 4); pos += w * 4
    e = out[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return out[..., :3].astype(np.float32) * scale[..., None]


def write_hdr(path: str, img: np.ndarray) -> None:
    h, w, _ = img.shape
    v = img.max(axis=2)
    mant, ex = np.frexp(v)
    scale = np.where(v > 1e-32, mant * 256.0 / np.maximum(v, 1e-32), 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(img * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(v > 1e-32, ex + 128, 0).astype(np.uint8)
    with open(path, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n" + f"-Y {h} +X {w}\n".encode())
        f.write(rgbe.tobytes())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst", nargs="?")
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--sun", action="store_true")
    a = ap.parse_args()
    img = read_hdr(a.src)
    if a.sun:
        lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        y, x = np.unravel_index(np.argmax(lum), lum.shape)
        h, w = lum.shape
        u, v = (x + 0.5) / w, (y + 0.5) / h
        # three.js equirect: u = atan2(dir.z, dir.x) / 2π + 0.5, v = asin(dir.y)/π + 0.5 (v up)
        elev = math.degrees((0.5 - v) * math.pi)
        print(json.dumps({"u": round(u, 4), "v": round(v, 4), "elevation": round(elev, 1), "peak": float(lum.max())}))
    if a.dst:
        f = img.shape[1] // a.width
        h, w = img.shape[0] // f, img.shape[1] // f
        small = img[: h * f, : w * f].reshape(h, f, w, f, 3).mean(axis=(1, 3))
        write_hdr(a.dst, small.astype(np.float32))
        print(f"{a.dst}: {w}x{h}")


if __name__ == "__main__":
    main()
