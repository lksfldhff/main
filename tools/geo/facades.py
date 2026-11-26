"""Facade analysis and modular facade-kit layout for LoD2 walls.

For every wall the pipeline decides
  * blind   – party wall / fire wall (coincides with a neighbour's wall) → no openings
  * street  – faces a road, square or footway (else: courtyard)
  * kit     – all openings fit completely inside the real wall polygon → 3D modules are placed
and emits module instances (windows, shop fronts, doors, balconies, chimneys).

The opening layout is the SAME formula as the facade shader (src/rendering/materials/
FacadeMaterial.ts) and reads the same style table (src/world/heilbronn/facadeStyles.json),
so painted windows (far LOD) and 3D modules (near LOD) always coincide.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon

STYLES = json.loads((Path(__file__).resolve().parents[2] / "src/world/heilbronn/facadeStyles.json").read_text())

KIT_STYLES = {0, 1, 7, 9}  # classic punched-window facades get 3D modules
BALCONY_STYLES = {0, 1}

M_WINDOW, M_SHOP, M_DOOR, M_BALCONY, M_CHIMNEY = 0, 1, 2, 3, 4

BIT_BLIND = 1 << 16
BIT_KIT = 1 << 17


def hex_rgb(h: str) -> int:
    return int(h.lstrip("#"), 16)


class Wall:
    __slots__ = ("bid", "style", "shop", "variant", "ng", "t", "c", "umin", "umax", "base", "poly_uh",
                 "blind", "street", "kit", "ck", "rings_local", "seg")

    def __init__(self, bid, style, shop, variant, ring_local: np.ndarray, ng: np.ndarray, base_local: float, ck):
        self.bid, self.style, self.shop, self.variant, self.ck = bid, style, shop, variant, ck
        self.ng = ng
        t = np.array([ng[2], 0.0, -ng[0]])
        self.t = t / max(np.linalg.norm(t), 1e-9)
        n2 = np.array([ng[0], ng[2]]) / max(math.hypot(ng[0], ng[2]), 1e-9)
        us = ring_local @ self.t
        self.umin, self.umax = float(us.min()), float(us.max())
        self.c = float(np.mean(ring_local[:, 0] * n2[0] + ring_local[:, 2] * n2[1]))
        self.base = base_local
        hs = ring_local[:, 1] - base_local
        self.poly_uh = Polygon(np.stack([us - self.umin, hs], axis=1)).buffer(0)
        self.blind = False
        self.street = False
        self.kit = False
        p0 = self.point(0.0, 0.0)
        p1 = self.point(self.umax - self.umin, 0.0)
        self.seg = LineString([(p0[0], p0[2]), (p1[0], p1[2])])

    @property
    def length(self) -> float:
        return self.umax - self.umin

    def n2(self):
        v = np.array([self.ng[0], self.ng[2]])
        return v / max(np.linalg.norm(v), 1e-9)

    def point(self, u: float, h: float, out: float = 0.0) -> np.ndarray:
        """Game-space point on the wall plane at wall coordinate (u, h), `out` metres in front of it."""
        n2 = self.n2()
        xz = np.array([self.t[0], self.t[2]]) * (u + self.umin) + n2 * (self.c + out)
        return np.array([xz[0], self.base + h, xz[1]])


def detect_party_walls(walls: list[Wall]) -> int:
    """A wall is blind when a wall of another building/part lies back-to-back within 0.5 m."""
    segs = [w.seg for w in walls]
    tree = STRtree(segs)
    count = 0
    for i, w in enumerate(walls):
        if w.length < 1.0:
            continue
        for j in tree.query(w.seg.buffer(0.5)):
            j = int(j)
            if j == i:
                continue
            o = walls[j]
            if float(np.dot(w.n2(), o.n2())) > -0.9:
                continue
            if abs(w.c + o.c) > 0.5:
                continue
            # overlap along w's tangent
            a = sorted([(o.seg.coords[0][0] * w.t[0] + o.seg.coords[0][1] * w.t[2]),
                        (o.seg.coords[1][0] * w.t[0] + o.seg.coords[1][1] * w.t[2])])
            ov = min(a[1], w.umax) - max(a[0], w.umin)
            if ov > max(0.4 * w.length, 1.5):
                w.blind = True
                count += 1
                break
    return count


def classify_street(walls: list[Wall], landuse_at) -> None:
    """Street facade if the ground 3 m in front of the wall centre is road/sidewalk/square/path."""
    for w in walls:
        p = w.point(w.length / 2, 0.0, 3.0)
        w.street = landuse_at(p[0], p[2]) in (1, 2, 3, 4)


def _openings(w: Wall):
    """Opening rectangles (u0, u1, h0, h1, type, bay, floor) exactly as the facade shader lays them out."""
    s = w.style
    win = STYLES["window"][s]
    if win[1] <= 0 or w.length <= 1.6:
        return []
    bay_w, floor_h, ground_h = STYLES["bayWidth"][s], STYLES["floorHeight"][s], STYLES["groundHeight"][s]
    bays = max(1, math.floor(w.length / bay_w + 0.5))
    bw = w.length / bays
    top = w.poly_uh.bounds[3]
    out = []
    for i in range(bays):
        uc = (i + 0.5) * bw
        # ground floor
        if w.shop:
            ww, sill, wh, kind = bw - 0.35, 0.35, ground_h - 1.25, M_SHOP
        else:
            ww, sill, wh, kind = min(win[0], bw - 0.45), 1.0, min(win[1], ground_h - 1.7), M_WINDOW
        if ww > 0.3 and wh > 0.3:
            out.append((uc - ww / 2, uc + ww / 2, sill, sill + wh, kind, i, 0))
        k = 1
        while True:
            h0 = ground_h + (k - 1) * floor_h + win[2]
            h1 = h0 + win[1]
            if h0 > top:
                break
            ww = min(win[0], bw - 0.45)
            if ww > 0.3:
                out.append((uc - ww / 2, uc + ww / 2, h0, h1, M_WINDOW, i, k))
            k += 1
    return out


def layout_kit(walls: list[Wall], house_numbers: list[tuple[float, float]], rng_seed: int = 7):
    """Returns module instances: list of (x, y, z, nx, nz, w, h, type, rand, rgb)."""
    inst = []
    rng = np.random.default_rng(rng_seed)
    stats = {"walls": len(walls), "kitWalls": 0, "blind": 0, "windows": 0, "shops": 0, "doors": 0, "balconies": 0}

    # Pass 1: openings per wall; a wall gets the kit only if every opening fits the real polygon.
    plan: dict[int, list] = {}
    for idx, w in enumerate(walls):
        if w.blind:
            stats["blind"] += 1
            continue
        if w.style not in KIT_STYLES:
            continue
        ops = _openings(w)
        if not ops:
            continue
        inner = w.poly_uh.buffer(-0.05)
        if inner.is_empty or not all(inner.contains(Polygon([(u0, h0), (u1, h0), (u1, h1), (u0, h1)])) for u0, u1, h0, h1, *_ in ops):
            continue  # gable / irregular wall → painted facade only
        w.kit = True
        plan[idx] = ops
        stats["kitWalls"] += 1

    # Pass 2: each official house number gets an entrance on the nearest street wall (≤ 9 m).
    doors: dict[int, set] = {}
    street_idx = [i for i in plan if walls[i].street]
    if street_idx and house_numbers:
        tree = STRtree([walls[i].seg for i in street_idx])
        for x, z in house_numbers:
            p = Point(x, z)
            j = tree.query_nearest(p, max_distance=9.0)
            if len(j) == 0:
                continue
            wi = street_idx[int(j[0])]
            w = walls[wi]
            u = float(x * w.t[0] + z * w.t[2]) - w.umin
            ground = [o for o in plan[wi] if o[6] == 0 and o[4] == M_WINDOW]
            if ground:
                best = min(ground, key=lambda o: abs((o[0] + o[1]) / 2 - u))
                doors.setdefault(wi, set()).add(best[5])

    # Pass 3: emit modules.
    for wi, ops in plan.items():
        w = walls[wi]
        tint = hex_rgb(STYLES["palette"][w.style][int(w.variant) % 8])
        door_bays = doors.get(wi, set())
        n_bays = len({o[5] for o in ops})
        balcony_side = (not w.street) and w.style in BALCONY_STYLES and w.length > 6 and int(w.variant) % 3 != 0
        max_floor = max(o[6] for o in ops)
        for u0, u1, h0, h1, kind, bay, floor in ops:
            uc, hc = (u0 + u1) / 2, (h0 + h1) / 2
            ww, wh = u1 - u0, h1 - h0
            r = float(rng.random())
            if floor == 0 and bay in door_bays and kind == M_WINDOW:
                ground_h = STYLES["groundHeight"][w.style]
                dh = min(max(2.6, h1 + 0.1), ground_h - 0.25)
                dw = min(max(ww + 0.25, 1.2), w.length / max(1, n_bays) - 0.2)
                p = w.point(uc, dh / 2)
                inst.append((*p, *w.n2(), dw, dh, M_DOOR, r, tint))
                stats["doors"] += 1
                continue
            if balcony_side and 1 <= floor < max_floor + 1 and (bay + int(w.variant)) % 2 == 0:
                dh = h1 - (h0 - STYLES["window"][w.style][2]) + 0.05  # from floor level to window top
                p = w.point(uc, h1 - dh / 2)
                inst.append((*p, *w.n2(), ww + 0.1, dh, M_BALCONY, r, tint))
                stats["balconies"] += 1
                continue
            p = w.point(uc, hc)
            inst.append((*p, *w.n2(), ww, wh, kind, r, tint))
            stats["shops" if kind == M_SHOP else "windows"] += 1
    return inst, stats


def chimneys(roof_tris_local: np.ndarray, footprint_area: float, seed: int):
    """Chimney positions on pitched roofs: near the ridge, 1–3 per building."""
    if len(roof_tris_local) == 0:
        return []
    pts = roof_tris_local.reshape(-1, 3)
    ymax = pts[:, 1].max()
    ridge = pts[pts[:, 1] > ymax - 0.4]
    if len(ridge) < 2:
        return []
    rng = np.random.default_rng(seed)
    n = int(min(3, 1 + footprint_area // 160))
    out = []
    for _ in range(n):
        a, b = ridge[rng.integers(len(ridge))], ridge[rng.integers(len(ridge))]
        p = a + (b - a) * rng.uniform(0.2, 0.8)
        out.append((float(p[0]), float(p[1] - 0.35), float(p[2])))
    return out
