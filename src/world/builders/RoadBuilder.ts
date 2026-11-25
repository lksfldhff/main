import * as THREE from 'three';
import { GeometryWriter, UP, v2, v3 } from '../geometry/GeometryWriter';
import type { WorldContext } from '../WorldContext';

const MARKING_Y = 0.015;

/**
 * Writes a flat ribbon along a polyline. u runs across (0..1), v along the road in metres.
 * Used for lane markings now; in Phase 2 the same routine renders OSM road ways.
 */
export function ribbon(points: THREE.Vector2[], width: number, y: number): THREE.BufferGeometry {
  const w = new GeometryWriter();
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(width / 2);
    w.quad(
      v3(a.x - side.x, y, a.y - side.y),
      v3(a.x + side.x, y, a.y + side.y),
      v3(b.x + side.x, y, b.y + side.y),
      v3(b.x - side.x, y, b.y - side.y),
      v2(0, dist),
      v2(1, dist),
      v2(1, dist + len),
      v2(0, dist + len),
      UP,
    );
    dist += len;
  }
  return w.build();
}

/** Lane markings (edge lines + dashed centre line) between two points. */
export function addLaneMarkings(ctx: WorldContext, from: THREE.Vector2, to: THREE.Vector2, roadWidth: number): void {
  const geo = ribbon([from, to], roadWidth - 0.6, MARKING_Y);
  ctx.surfaces.add(geo, ctx.materials.surface('markings'));
}

/** Zebra crossing across a road. `along` = road direction. */
export function addZebraCrossing(
  ctx: WorldContext,
  center: THREE.Vector2,
  along: THREE.Vector2,
  roadWidth: number,
  depth = 4,
): void {
  const across = new THREE.Vector2(-along.y, along.x).normalize();
  const a = center.clone().addScaledVector(across, -(roadWidth / 2 - 0.4));
  const b = center.clone().addScaledVector(across, roadWidth / 2 - 0.4);
  const geo = ribbon([a, b], depth, MARKING_Y + 0.002);
  // Stripes repeat across the road: 0.5 m stripe + 0.5 m gap → texture repeats every metre along the ribbon.
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  ctx.surfaces.add(geo, ctx.materials.surface('zebra'));
}
