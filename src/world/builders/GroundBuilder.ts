import * as THREE from 'three';
import { GeometryWriter } from '../geometry/GeometryWriter';
import { writeCap, writeSides, prismCollider } from '../geometry/Extrude';
import { rect, type Polygon } from '../geometry/Polygon';
import type { SurfaceName } from '../../rendering/MaterialLibrary';
import type { WorldContext } from '../WorldContext';

/** Flat horizontal surface (no collider). */
export function addFlatSurface(ctx: WorldContext, poly: Polygon, y: number, surface: SurfaceName): void {
  const w = new GeometryWriter();
  writeCap(w, poly, y);
  ctx.surfaces.add(w.build(), ctx.materials.surface(surface));
}

/** Large rectangular ground area split into chunk-sized tiles (better culling) with a box collider. */
export function addGroundArea(
  ctx: WorldContext,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  surface: SurfaceName,
  tile = 64,
): void {
  for (let x = x0; x < x1; x += tile) {
    for (let z = z0; z < z1; z += tile) {
      addFlatSurface(ctx, rect(x, z, Math.min(x + tile, x1), Math.min(z + tile, z1)), y, surface);
    }
  }
  const depth = 2;
  ctx.physics.addStaticBox(
    new THREE.Vector3((x0 + x1) / 2, y - depth / 2, (z0 + z1) / 2),
    new THREE.Vector3((x1 - x0) / 2, depth / 2, (z1 - z0) / 2),
  );
}

/**
 * Raised slab (sidewalk block, plaza, promenade): paved top, curb sides, trimesh collider.
 * The player's character controller auto-steps onto curbs.
 */
export function addRaisedSlab(
  ctx: WorldContext,
  poly: Polygon,
  height: number,
  top: SurfaceName,
  side: SurfaceName = 'curb',
): void {
  const topW = new GeometryWriter();
  writeCap(topW, poly, height);
  ctx.surfaces.add(topW.build(), ctx.materials.surface(top));
  const sideW = new GeometryWriter();
  writeSides(sideW, poly, -0.05, height);
  ctx.surfaces.add(sideW.build(), ctx.materials.surface(side));
  const col = prismCollider(poly, -0.05, height);
  ctx.physics.addStaticTrimesh(col.vertices, col.indices);
}

/** Vertical wall face (quay walls etc.), visual only. */
export function addWall(ctx: WorldContext, poly: Polygon, y0: number, y1: number, surface: SurfaceName, inward = false): void {
  const w = new GeometryWriter();
  writeSides(w, poly, y0, y1, inward);
  ctx.surfaces.add(w.build(), ctx.materials.surface(surface));
}

/** Vertical quay/embankment wall along X = const, facing `facingX` (+1 east / -1 west). */
export function addQuayWall(ctx: WorldContext, x: number, z0: number, z1: number, y0: number, y1: number, facingX: 1 | -1): void {
  const w = new GeometryWriter();
  w.quad(
    new THREE.Vector3(x, y0, z0),
    new THREE.Vector3(x, y0, z1),
    new THREE.Vector3(x, y1, z1),
    new THREE.Vector3(x, y1, z0),
    new THREE.Vector2(z0, y0),
    new THREE.Vector2(z1, y0),
    new THREE.Vector2(z1, y1),
    new THREE.Vector2(z0, y1),
    new THREE.Vector3(facingX, 0, 0),
  );
  ctx.surfaces.add(w.build(), ctx.materials.surface('quayStone'));
}
