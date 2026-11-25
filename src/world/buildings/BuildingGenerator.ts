import * as THREE from 'three';
import { GeometryWriter, UP, v2, v3 } from '../geometry/GeometryWriter';
import { writeCap, prismCollider } from '../geometry/Extrude';
import { edgeOutwardNormal, normalizePolygon, offsetPolygon, centroid, type Polygon } from '../geometry/Polygon';
import type { FacadeStyle } from './FacadeStyles';

/**
 * Input format for one building. Deliberately close to what an OSM building way provides
 * (footprint polygon + building:levels + roof:shape), so the Phase 2 importer can feed it directly.
 */
export interface BuildingSpec {
  footprint: Polygon;
  levels: number;
  style: FacadeStyle;
  roof?: 'flat' | 'gable';
  baseY?: number;
}

export interface BuildingGeometry {
  ground: THREE.BufferGeometry;
  upper: THREE.BufferGeometry;
  plain: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  collider: { vertices: Float32Array; indices: Uint32Array };
  height: number;
}

const PARAPET_HEIGHT = 0.6;
const CORNICE_OUT = 0.22;
const EAVE_OVERHANG = 0.45;
const ROOF_PITCH = THREE.MathUtils.degToRad(42);

/** Generates stylized building geometry from a footprint polygon. */
export function generateBuilding(spec: BuildingSpec): BuildingGeometry {
  const poly = normalizePolygon(spec.footprint);
  const style = spec.style;
  const baseY = spec.baseY ?? 0;
  const levels = Math.max(1, Math.round(spec.levels));
  const groundTop = baseY + style.groundHeight;
  const wallTop = groundTop + (levels - 1) * style.floorHeight;

  const ground = new GeometryWriter();
  const upper = new GeometryWriter();
  const plain = new GeometryWriter();
  const trim = new GeometryWriter();
  const roof = new GeometryWriter();

  // --- Facade walls: UVs count window bays (u) and floors (v) so windows fit each wall exactly.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = a.distanceTo(b);
    const n = edgeOutwardNormal(poly, i);
    const facing = v3(n.x, 0, n.y);
    const bays = Math.max(1, Math.round(len / style.bayWidth));
    const narrow = len < style.bayWidth * 0.6;
    const wallQuad = (w: GeometryWriter, y0: number, y1: number, v0: number, v1: number) =>
      w.quad(
        v3(a.x, y0, a.y),
        v3(b.x, y0, b.y),
        v3(b.x, y1, b.y),
        v3(a.x, y1, a.y),
        v2(0, v0),
        v2(bays, v0),
        v2(bays, v1),
        v2(0, v1),
        facing,
      );
    if (narrow) {
      wallQuad(plain, baseY, wallTop, 0, 1);
      continue;
    }
    wallQuad(ground, baseY, groundTop, 0, 1);
    if (levels > 1) wallQuad(upper, groundTop, wallTop, 0, levels - 1);
    // Storey band between ground floor and upper floors
    writeBand(trim, a, b, facing, groundTop - 0.12, groundTop + 0.12, 0.08);
  }

  const useGable = (spec.roof ?? style.roofType) === 'gable' && poly.length === 4;
  let height: number;
  if (useGable) {
    height = writeGableRoof(poly, wallTop, plain, trim, roof);
  } else {
    writeFlatRoof(poly, wallTop, trim, roof);
    height = wallTop + PARAPET_HEIGHT;
    if (poly.length === 4 && levels >= 3) writeRooftopBox(poly, wallTop, trim);
  }

  return {
    ground: ground.build(),
    upper: upper.build(),
    plain: plain.build(),
    trim: trim.build(),
    roof: roof.build(),
    collider: prismCollider(poly, baseY, wallTop),
    height: height - baseY,
  };
}

/** A thin horizontal band protruding `depth` from the wall (cornices, storey bands). */
function writeBand(
  w: GeometryWriter,
  a: THREE.Vector2,
  b: THREE.Vector2,
  facing: THREE.Vector3,
  y0: number,
  y1: number,
  depth: number,
): void {
  const dx = facing.x * depth;
  const dz = facing.z * depth;
  const ao = v3(a.x + dx, 0, a.y + dz);
  const bo = v3(b.x + dx, 0, b.y + dz);
  const len = a.distanceTo(b);
  w.quad(
    v3(ao.x, y0, ao.z),
    v3(bo.x, y0, bo.z),
    v3(bo.x, y1, bo.z),
    v3(ao.x, y1, ao.z),
    v2(0, y0),
    v2(len, y0),
    v2(len, y1),
    v2(0, y1),
    facing,
  );
  w.quad(v3(a.x, y1, a.y), v3(b.x, y1, b.y), v3(bo.x, y1, bo.z), v3(ao.x, y1, ao.z), v2(0, 0), v2(len, 0), v2(len, depth), v2(0, depth), UP);
  w.quad(
    v3(a.x, y0, a.y),
    v3(b.x, y0, b.y),
    v3(bo.x, y0, bo.z),
    v3(ao.x, y0, ao.z),
    v2(0, 0),
    v2(len, 0),
    v2(len, depth),
    v2(0, depth),
    v3(0, -1, 0),
  );
}

/** Flat roof with a parapet and a protruding cornice. */
function writeFlatRoof(poly: Polygon, wallTop: number, trim: GeometryWriter, roof: GeometryWriter): void {
  const outer = offsetPolygon(poly, CORNICE_OUT);
  const yBottom = wallTop - 0.15;
  const yTop = wallTop + PARAPET_HEIGHT;
  const yRoof = wallTop + 0.15;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const n = edgeOutwardNormal(poly, i);
    const out = v3(n.x, 0, n.y);
    const pa = poly[i];
    const pb = poly[j];
    const oa = outer[i];
    const ob = outer[j];
    const len = oa.distanceTo(ob);
    // outside face
    trim.quad(v3(oa.x, yBottom, oa.y), v3(ob.x, yBottom, ob.y), v3(ob.x, yTop, ob.y), v3(oa.x, yTop, oa.y), v2(0, 0), v2(len, 0), v2(len, 1), v2(0, 1), out);
    // underside
    trim.quad(v3(pa.x, yBottom, pa.y), v3(pb.x, yBottom, pb.y), v3(ob.x, yBottom, ob.y), v3(oa.x, yBottom, oa.y), v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1), v3(0, -1, 0));
    // parapet top
    trim.quad(v3(pa.x, yTop, pa.y), v3(pb.x, yTop, pb.y), v3(ob.x, yTop, ob.y), v3(oa.x, yTop, oa.y), v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1), UP);
    // inner parapet face
    trim.quad(v3(pa.x, yRoof, pa.y), v3(pb.x, yRoof, pb.y), v3(pb.x, yTop, pb.y), v3(pa.x, yTop, pa.y), v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1), out.clone().negate());
  }
  writeCap(roof, poly, yRoof);
}

/** Small stairwell/technical box on large flat roofs for a more believable roofscape. */
function writeRooftopBox(poly: Polygon, wallTop: number, trim: GeometryWriter): void {
  const c = centroid(poly);
  const e0 = poly[1].clone().sub(poly[0]);
  const e1 = poly[2].clone().sub(poly[1]);
  if (e0.length() < 8 || e1.length() < 8) return;
  const ax = e0.clone().normalize();
  const az = e1.clone().normalize();
  const hx = Math.min(2.2, e0.length() * 0.18);
  const hz = Math.min(1.8, e1.length() * 0.18);
  const corners = [
    c.clone().addScaledVector(ax, -hx).addScaledVector(az, -hz),
    c.clone().addScaledVector(ax, hx).addScaledVector(az, -hz),
    c.clone().addScaledVector(ax, hx).addScaledVector(az, hz),
    c.clone().addScaledVector(ax, -hx).addScaledVector(az, hz),
  ];
  const box = normalizePolygon(corners);
  const y0 = wallTop + 0.15;
  const y1 = y0 + 2.3;
  for (let i = 0; i < 4; i++) {
    const a = box[i];
    const b = box[(i + 1) % 4];
    const n = edgeOutwardNormal(box, i);
    trim.quad(v3(a.x, y0, a.y), v3(b.x, y0, b.y), v3(b.x, y1, b.y), v3(a.x, y1, a.y), v2(0, 0), v2(1, 0), v2(1, 1), v2(0, 1), v3(n.x, 0, n.y));
  }
  writeCap(trim, box, y1);
}

/**
 * Gabled roof for 4-sided footprints. The ridge runs parallel to the longer sides; eaves
 * overhang the walls; gable ends are closed with plain wall pentagons.
 */
function writeGableRoof(
  input: Polygon,
  wallTop: number,
  plain: GeometryWriter,
  trim: GeometryWriter,
  roof: GeometryWriter,
): number {
  let p = input;
  const len = (i: number) => p[i].distanceTo(p[(i + 1) % 4]);
  if (len(0) + len(2) < len(1) + len(3)) p = [p[1], p[2], p[3], p[0]];
  // Edges 0 (p0→p1) and 2 (p2→p3) are the eaves; edges 1 and 3 are the gables.
  const o = offsetPolygon(p, EAVE_OVERHANG);
  const halfSpan = (len(1) + len(3)) / 4;
  const H = (halfSpan + EAVE_OVERHANG) * Math.tan(ROOF_PITCH);
  const ridgeY = wallTop + H;
  const ra = o[3].clone().add(o[0]).multiplyScalar(0.5);
  const rb = o[1].clone().add(o[2]).multiplyScalar(0.5);
  const ridgeDir = rb.clone().sub(ra).normalize();
  const slopeLen = Math.hypot(halfSpan + EAVE_OVERHANG, H);

  const slope = (e0: THREE.Vector2, e1: THREE.Vector2, r0: THREE.Vector2, r1: THREE.Vector2, edge: number) => {
    const n = edgeOutwardNormal(p, edge);
    const facing = v3(n.x, 1, n.y);
    const A = v3(e0.x, wallTop, e0.y);
    const B = v3(e1.x, wallTop, e1.y);
    const C = v3(r1.x, ridgeY, r1.y);
    const D = v3(r0.x, ridgeY, r0.y);
    const u = (q: THREE.Vector2) => q.dot(ridgeDir);
    const uvA = v2(u(e0), 0);
    const uvB = v2(u(e1), 0);
    const uvC = v2(u(r1), slopeLen);
    const uvD = v2(u(r0), slopeLen);
    roof.quad(A, B, C, D, uvA, uvB, uvC, uvD, facing);
    trim.quad(A, B, C, D, uvA, uvB, uvC, uvD, facing.clone().negate()); // soffit
  };
  slope(o[0], o[1], ra, rb, 0);
  slope(o[2], o[3], rb, ra, 2);

  // Height of the roof plane directly above the walls (eaves overhang the walls).
  const yAtWall = wallTop + H * (EAVE_OVERHANG / (halfSpan + EAVE_OVERHANG));

  // Gable pentagons on edges 1 and 3
  for (const edge of [1, 3]) {
    const a = p[edge];
    const b = p[(edge + 1) % 4];
    const m = a.clone().add(b).multiplyScalar(0.5);
    const n = edgeOutwardNormal(p, edge);
    const f = v3(n.x, 0, n.y);
    const A0 = v3(a.x, wallTop, a.y);
    const B0 = v3(b.x, wallTop, b.y);
    const B1 = v3(b.x, yAtWall, b.y);
    const A1 = v3(a.x, yAtWall, a.y);
    const apex = v3(m.x, ridgeY - 0.05, m.y);
    const uv = v2(0, 0);
    plain.triangle(A0, B0, B1, uv, uv, uv, f);
    plain.triangle(A0, B1, apex, uv, uv, uv, f);
    plain.triangle(A0, apex, A1, uv, uv, uv, f);
  }
  // Frieze on the eave sides closes the gap between wall top and roof underside.
  for (const edge of [0, 2]) {
    const a = p[edge];
    const b = p[(edge + 1) % 4];
    const n = edgeOutwardNormal(p, edge);
    const uv = v2(0, 0);
    plain.quad(v3(a.x, wallTop, a.y), v3(b.x, wallTop, b.y), v3(b.x, yAtWall, b.y), v3(a.x, yAtWall, a.y), uv, uv, uv, uv, v3(n.x, 0, n.y));
  }
  return ridgeY;
}
