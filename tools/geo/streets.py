"""Street surface geometry: raised walkways and kerbstones.

* Walkable land-use (sidewalk, square, path, courtyard, green) is lifted by KERB_HEIGHT in the
  terrain heightfield, so pavements are physically higher than the carriageway.
* Kerbstones are traced along the road/walkway boundary of the 0.5 m land-use raster
  (marching squares), simplified, and extruded as a 15 cm wide granite kerb with a vertical
  face towards the road. At crossings (OSM) the kerb is lowered (omitted).
"""
from __future__ import annotations

import numpy as np
from shapely.geometry import LineString
from skimage import measure

import config

KERB_HEIGHT = 0.12
KERB_WIDTH = 0.16
ROAD = 1
WALKABLE = (2, 3, 4, 6, 7)


def raise_walkways(heights: np.ndarray, landuse: np.ndarray) -> np.ndarray:
    """heights: terrain grid (rows north→south, TERRAIN_CELL spacing); landuse: 0.5 m class raster."""
    rows, cols = heights.shape
    step = config.TERRAIN_CELL / config.LANDUSE_CELL
    ry = np.clip((np.arange(rows) * step).astype(int), 0, landuse.shape[0] - 1)
    cx = np.clip((np.arange(cols) * step).astype(int), 0, landuse.shape[1] - 1)
    cls = landuse[np.ix_(ry, cx)]
    out = heights.copy()
    out[np.isin(cls, WALKABLE)] += KERB_HEIGHT
    return out


def build_kerbs(landuse: np.ndarray, sample, h0: float, crossings_local: list[tuple[float, float]]) -> np.ndarray:
    """Returns Float32 triangles (x, y, z) of kerbstones in game coordinates."""
    cell = config.LANDUSE_CELL
    min_e, max_n = config.BBOX[0], config.BBOX[3]
    road = (landuse == ROAD).astype(np.float32)
    walk = np.isin(landuse, WALKABLE)
    H, W = landuse.shape
    crossings = np.array(crossings_local) if crossings_local else np.zeros((0, 2))

    def cls_at(x: float, z: float) -> int:
        """Land-use class at game coords."""
        e = x + config.ORIGIN_E
        n = config.ORIGIN_N - z
        c = int((e - min_e) / cell)
        r = int((max_n - n) / cell)
        if 0 <= r < H and 0 <= c < W:
            return int(landuse[r, c])
        return -1

    tris: list[list[float]] = []
    for contour in measure.find_contours(road, 0.5):
        if len(contour) < 4:
            continue
        # pixel (row, col) → game coords (x east, z south)
        xs = min_e + (contour[:, 1] + 0.5) * cell - config.ORIGIN_E
        zs = -((max_n - (contour[:, 0] + 0.5) * cell) - config.ORIGIN_N)
        line = LineString(np.stack([xs, zs], axis=1)).simplify(0.35)
        pts = np.array(line.coords)
        for a, b in zip(pts[:-1], pts[1:]):
            seg = b - a
            ln = float(np.linalg.norm(seg))
            if ln < 0.05:
                continue
            d = seg / ln
            nrm = np.array([-d[1], d[0]])
            mid = (a + b) / 2
            # Which side is the road? Keep only road↔walkway edges.
            s1, s2 = cls_at(*(mid + nrm * 0.9)), cls_at(*(mid - nrm * 0.9))
            if s1 == ROAD and s2 in WALKABLE:
                to_walk = -nrm
            elif s2 == ROAD and s1 in WALKABLE:
                to_walk = nrm
            else:
                continue
            if len(crossings) and np.min(np.hypot(*(crossings - mid).T)) < 3.0:
                continue  # lowered kerb at crossings
            # heights from the (unraised) terrain on the road side
            def road_h(p):
                e = p[0] + config.ORIGIN_E
                n = config.ORIGIN_N - p[1]
                return float(sample(np.array([e]), np.array([n]))[0]) - h0

            ha, hb = road_h(a - to_walk * 0.4), road_h(b - to_walk * 0.4)
            top = KERB_HEIGHT + 0.015
            a_in, b_in = a + to_walk * KERB_WIDTH, b + to_walk * KERB_WIDTH
            # top face
            q = [(a, ha + top), (b, hb + top), (b_in, hb + top), (a_in, ha + top)]
            # road-facing vertical face
            f = [(a, ha - 0.03), (b, hb - 0.03), (b, hb + top), (a, ha + top)]
            for quad, up in ((q, True), (f, False)):
                (p0, y0), (p1, y1), (p2, y2), (p3, y3) = quad
                v = [[p0[0], y0, p0[1]], [p1[0], y1, p1[1]], [p2[0], y2, p2[1]], [p3[0], y3, p3[1]]]
                for i, j, k in ((0, 1, 2), (0, 2, 3)):
                    tri = [v[i], v[j], v[k]]
                    # orient: top faces up, vertical face towards the road
                    n = np.cross(np.subtract(tri[1], tri[0]), np.subtract(tri[2], tri[0]))
                    want = np.array([0, 1, 0]) if up else np.array([-to_walk[0], 0, -to_walk[1]])
                    if float(n @ want) < 0:
                        tri = [tri[0], tri[2], tri[1]]
                    tris.extend(tri)
    return np.array(tris, dtype=np.float32).reshape(-1, 3) if tris else np.zeros((0, 3), np.float32)
