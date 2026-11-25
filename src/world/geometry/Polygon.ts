import * as THREE from 'three';

/** 2D polygon in the ground plane: Vector2.x = world X, Vector2.y = world Z. */
export type Polygon = THREE.Vector2[];

/** Shoelace area in (x, z). Positive = counter-clockwise in math orientation. */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Returns a copy with consistent (positive-area) winding and without a duplicated closing point. */
export function normalizePolygon(poly: Polygon): Polygon {
  let pts = poly.map((p) => p.clone());
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  if (signedArea(pts) < 0) pts = pts.reverse();
  return pts;
}

/** Outward unit normal of edge i (for a normalized polygon). */
export function edgeOutwardNormal(poly: Polygon, i: number): THREE.Vector2 {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  return new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
}

/** Offsets a normalized polygon outward by `distance` (mitered, clamped for sharp corners). */
export function offsetPolygon(poly: Polygon, distance: number): Polygon {
  const n = poly.length;
  return poly.map((p, i) => {
    const n0 = edgeOutwardNormal(poly, (i - 1 + n) % n);
    const n1 = edgeOutwardNormal(poly, i);
    const bis = n0.clone().add(n1);
    if (bis.lengthSq() < 1e-8) return p.clone().addScaledVector(n1, distance);
    bis.normalize();
    const cos = Math.max(bis.dot(n1), 0.35);
    return p.clone().addScaledVector(bis, distance / cos);
  });
}

export function centroid(poly: Polygon): THREE.Vector2 {
  const c = new THREE.Vector2();
  poly.forEach((p) => c.add(p));
  return c.divideScalar(poly.length);
}

export function rect(x0: number, z0: number, x1: number, z1: number): Polygon {
  return normalizePolygon([
    new THREE.Vector2(x0, z0),
    new THREE.Vector2(x1, z0),
    new THREE.Vector2(x1, z1),
    new THREE.Vector2(x0, z1),
  ]);
}
