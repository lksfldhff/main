import * as THREE from 'three';
import { GeometryWriter, UP, v2, v3 } from './GeometryWriter';
import { edgeOutwardNormal, type Polygon } from './Polygon';

/** Writes the horizontal cap of a polygon at height y. UVs in world metres. */
export function writeCap(writer: GeometryWriter, poly: Polygon, y: number, facing: THREE.Vector3 = UP): void {
  const tris = THREE.ShapeUtils.triangulateShape(poly, []);
  for (const [i, j, k] of tris) {
    const a = poly[i];
    const b = poly[j];
    const c = poly[k];
    writer.triangle(v3(a.x, y, a.y), v3(b.x, y, b.y), v3(c.x, y, c.y), v2(a.x, a.y), v2(b.x, b.y), v2(c.x, c.y), facing);
  }
}

/** Writes vertical side walls between y0 and y1. UVs: u = metres along perimeter, v = metres up. */
export function writeSides(
  writer: GeometryWriter,
  poly: Polygon,
  y0: number,
  y1: number,
  inward = false,
): void {
  let u = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = a.distanceTo(b);
    const n = edgeOutwardNormal(poly, i);
    const facing = v3(n.x, 0, n.y).multiplyScalar(inward ? -1 : 1);
    writer.quad(
      v3(a.x, y0, a.y),
      v3(b.x, y0, b.y),
      v3(b.x, y1, b.y),
      v3(a.x, y1, a.y),
      v2(u, y0),
      v2(u + len, y0),
      v2(u + len, y1),
      v2(u, y1),
      facing,
    );
    u += len;
  }
}

/** Collider data for a vertical prism (closed top, open bottom). */
export function prismCollider(poly: Polygon, y0: number, y1: number): { vertices: Float32Array; indices: Uint32Array } {
  const writer = new GeometryWriter();
  writeSides(writer, poly, y0, y1);
  writeCap(writer, poly, y1);
  const geo = writer.build();
  const vertices = new Float32Array(geo.getAttribute('position').array);
  geo.dispose();
  const indices = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { vertices, indices };
}
