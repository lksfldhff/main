import { generateBuilding, type BuildingSpec } from '../buildings/BuildingGenerator';
import type { WorldContext } from '../WorldContext';

/** Generates a building and registers its meshes (batched) and collider. */
export function addBuilding(ctx: WorldContext, spec: BuildingSpec): number {
  const geo = generateBuilding(spec);
  const mats = ctx.materials.facade(spec.style);
  geo.ground.computeBoundingBox();
  const anchor = geo.ground.boundingBox!.getCenter(geo.ground.boundingBox!.min.clone());
  ctx.solids.add(geo.ground, mats.ground, anchor);
  ctx.solids.add(geo.upper, mats.upper, anchor);
  ctx.solids.add(geo.plain, mats.plain, anchor);
  ctx.solids.add(geo.trim, mats.trim, anchor);
  ctx.solids.add(geo.roof, mats.roof, anchor);
  ctx.physics.addStaticTrimesh(geo.collider.vertices, geo.collider.indices);
  return geo.height;
}
