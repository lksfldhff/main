import * as THREE from 'three';
import type { District } from '../District';
import type { WorldContext } from '../WorldContext';
import { loadHeilbronnData, type HeilbronnData } from './HeilbronnData';
import { Terrain } from './Terrain';
import { buildBuildingMeshes } from './BuildingMeshes';
import { GROUND_TEXTURES, LANDUSE_TO_LAYER, LandUse } from './LandUse';
import { ROOF_TEXTURES, WALL_TEXTURES } from './BuildingStyles';
import { loadTextureArray, textureUrls } from '../../rendering/TextureArrayLoader';
import { createTerrainMaterial } from '../../rendering/materials/TerrainMaterial';
import { createFacadeMaterial } from '../../rendering/materials/FacadeMaterial';
import { createRoofMaterial } from '../../rendering/materials/RoofMaterial';
import { createWaterMaterial } from '../../rendering/materials/WaterMaterial';
import { PropInstancer } from '../props/PropInstancer';
import { buildStreetDetails } from './StreetDetails';
import * as Models from '../props/PropModels';
import { Random } from '../../utils/random';
import type { VehicleSpawn } from '../../vehicles/VehicleManager';

/**
 * The real Heilbronn city centre (Marktplatz, Kilianskirche, Neckar, Experimenta)
 * built from LGL open data: LoD2 buildings, DGM1 terrain and ALKIS land use.
 */
export async function buildHeilbronnDistrict(
  ctx: WorldContext,
  onProgress?: (text: string) => void,
  textureSize = 1024,
): Promise<District> {
  const base = `${import.meta.env.BASE_URL}data/heilbronn`;
  const anisotropy = ctx.materials.anisotropy;
  const [data, groundDiff, groundNrm, wallDiff, wallNrm, roofDiff, roofNrm] = await Promise.all([
    loadHeilbronnData(base, onProgress),
    loadTextureArray(textureUrls(GROUND_TEXTURES, 'diff'), textureSize, { srgb: true, anisotropy }),
    loadTextureArray(textureUrls(GROUND_TEXTURES, 'nrm'), textureSize / 2, { srgb: false, anisotropy }),
    loadTextureArray(textureUrls(WALL_TEXTURES, 'diff'), textureSize, { srgb: true, anisotropy }),
    loadTextureArray(textureUrls(WALL_TEXTURES, 'nrm'), textureSize / 2, { srgb: false, anisotropy }),
    // Roofs are mostly seen from a distance: half resolution is plenty.
    loadTextureArray(textureUrls(ROOF_TEXTURES, 'diff'), textureSize / 2, { srgb: true, anisotropy }),
    loadTextureArray(textureUrls(ROOF_TEXTURES, 'nrm'), textureSize / 2, { srgb: false, anisotropy }),
  ]);
  onProgress?.('Stadt wird aufgebaut …');
  const { meta } = data;

  // --- Terrain
  const terrainMaterial = createTerrainMaterial({
    landuse: data.landuse,
    landuseSize: { width: meta.landuse.width, height: meta.landuse.height },
    landuseRect: new THREE.Vector4(
      meta.bounds.minX,
      meta.bounds.minZ,
      meta.landuse.width * meta.landuse.cell,
      meta.landuse.height * meta.landuse.cell,
    ),
    classToLayer: LANDUSE_TO_LAYER,
    diffuse: groundDiff,
    normal: groundNrm,
    //          asphalt sidewalk plaza path grass urban rail
    layerTile: [7, 2.5, 3.5, 4, 5, 3, 3],
    layerRoughness: [0.82, 0.9, 0.75, 0.95, 0.97, 0.88, 0.95],
    roadLayer: 0,
    sidewalkLayer: 1,
  });
  const terrain = new Terrain(meta, data.heights, terrainMaterial, ctx.physics);
  ctx.root.add(terrain.group);

  // --- Buildings
  const facade = createFacadeMaterial(wallDiff, wallNrm);
  const roof = createRoofMaterial(roofDiff, roofNrm);
  ctx.root.add(buildBuildingMeshes(meta, data.buildings, facade, roof, ctx.physics));

  // --- Water
  const water = createWaterMaterial();
  const waterLevel = addWater(ctx, data, water.material);

  // --- Props: OSM street details + generated park trees and lamps
  buildStreetDetails(ctx, data, terrain);
  placeProps(ctx, data, terrain);

  const landuseAt = (x: number, z: number): number => {
    const px = Math.floor((x - meta.bounds.minX) / meta.landuse.cell);
    const pz = Math.floor((z - meta.bounds.minZ) / meta.landuse.cell);
    if (px < 0 || pz < 0 || px >= meta.landuse.width || pz >= meta.landuse.height) return LandUse.None;
    return data.landuse[pz * meta.landuse.width + px];
  };

  const marktplatz = meta.streets.find((s) => s.name === 'Marktplatz') ?? { x: 0, z: 0 };
  const spawn = new THREE.Vector3(marktplatz.x, 0, marktplatz.z);
  spawn.y = terrain.heightAt(spawn.x, spawn.z) + 0.05;
  const kilian = meta.pois.find((p) => p.name === 'Kilianskirche');
  const vehicleSpawns = findParkingSpots(data, terrain, spawn);

  return {
    name: 'Heilbronn · Innenstadt',
    spawn,
    spawnYaw: 0,
    showcaseCenter: new THREE.Vector3(kilian?.x ?? 0, terrain.heightAt(kilian?.x ?? 0, kilian?.z ?? 0), kilian?.z ?? 0),
    showcaseRadius: 150,
    attribution: meta.attribution,
    vehicleSpawns,
    update: (t) => water.update(t),
    locate: createLocator(data),
    groundHeight: (x, z) => terrain.heightAt(x, z),
    isInDeepWater: (p) => waterLevel !== null && landuseAt(p.x, p.z) === LandUse.Water && p.y < waterLevel - 1.1,
  };
}

function addWater(ctx: WorldContext, data: HeilbronnData, material: THREE.Material): number | null {
  if (data.water.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.water, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'water';
  ctx.root.add(mesh);
  let level = -Infinity;
  for (let i = 1; i < data.water.length; i += 3) level = Math.max(level, data.water[i]);
  return level;
}

/**
 * Kerbside parking spots from the land-use raster: road pixels ~1.2 m from the kerb,
 * oriented along the kerb, clear of crossings/junctions. The spot nearest to the player
 * spawn gets a sports car.
 */
function findParkingSpots(data: HeilbronnData, terrain: Terrain, spawn: THREE.Vector3): VehicleSpawn[] {
  const { meta, landuse } = data;
  const W = meta.landuse.width;
  const H = meta.landuse.height;
  const cell = meta.landuse.cell;
  const rng = new Random(9182);
  const classAt = (x: number, z: number) => {
    const px = Math.floor((x - meta.bounds.minX) / cell);
    const pz = Math.floor((z - meta.bounds.minZ) / cell);
    return px < 0 || pz < 0 || px >= W || pz >= H ? -1 : landuse[pz * W + px];
  };
  const isRoad = (x: number, z: number) => classAt(x, z) === LandUse.Road;
  const avoid = [...(meta.osm?.crossings ?? []), ...(meta.osm?.signals ?? [])].map((c) => new THREE.Vector2(c[0], c[2]));
  const spots: VehicleSpawn[] = [];
  const step = 30;
  const b = meta.bounds;
  for (let gz = b.minZ; gz < b.maxZ; gz += step) {
    for (let gx = b.minX; gx < b.maxX; gx += step) {
      if (!rng.chance(0.6)) continue;
      for (let tries = 0; tries < 30; tries++) {
        const x = gx + rng.next() * step;
        const z = gz + rng.next() * step;
        if (!isRoad(x, z)) continue;
        // Kerb normal: mean direction of nearby non-road samples.
        let nx = 0;
        let nz = 0;
        let hits = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const c = classAt(x + Math.cos(a) * 1.6, z + Math.sin(a) * 1.6);
          if (c === LandUse.Sidewalk) {
            nx += Math.cos(a);
            nz += Math.sin(a);
            hits++;
          }
        }
        if (hits < 3 || hits > 7) continue;
        const n = new THREE.Vector2(nx, nz).normalize();
        const along = new THREE.Vector2(-n.y, n.x);
        // Car centre 1.15 m from the kerb, road must be clear for the car length and wide behind it.
        const c = new THREE.Vector2(x, z);
        let ok = true;
        for (const t of [-2.6, -1.3, 0, 1.3, 2.6]) {
          const p = c.clone().addScaledVector(along, t);
          if (!isRoad(p.x, p.y) || !isRoad(p.x - n.x * 4, p.y - n.y * 4) || classAt(p.x + n.x * 1.6, p.y + n.y * 1.6) !== LandUse.Sidewalk) ok = false;
        }
        if (!ok || avoid.some((a) => a.distanceTo(c) < 14) || spots.some((s) => Math.hypot(s.position.x - x, s.position.z - z) < 9)) continue;
        const yaw = Math.atan2(along.x, along.y) + (rng.chance(0.5) ? Math.PI : 0);
        spots.push({ position: new THREE.Vector3(x, terrain.heightAt(x, z), z), yaw });
        break;
      }
    }
  }
  // Starter car closest to the spawn point.
  spots.sort((a, bb) => a.position.distanceTo(spawn) - bb.position.distanceTo(spawn));
  if (spots[0]) {
    spots[0].type = 'sport';
    spots[0].paint = '#b3121b';
  }
  return spots.slice(0, 70);
}

/** Nearest street / square name within reach, for the HUD location display. */
function createLocator(data: HeilbronnData): (p: THREE.Vector3) => string | null {
  const labels = [
    ...data.meta.streets.map((s) => ({ ...s, range: 70 })),
    ...data.meta.pois.filter((p) => p.kind === 'area').map((p) => ({ ...p, range: 90 })),
    ...data.meta.pois.filter((p) => p.kind === 'building').map((p) => ({ ...p, range: 35 })),
  ];
  return (p) => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const l of labels) {
      const d = Math.hypot(l.x - p.x, l.z - p.z);
      if (d < l.range && d < bestD) {
        bestD = d;
        best = l.name;
      }
    }
    return best;
  };
}

/** Trees in parks and green strips, street lamps along sidewalks. */
function placeProps(ctx: WorldContext, data: HeilbronnData, terrain: Terrain): void {
  const { meta, landuse } = data;
  const m = ctx.materials;
  const rng = new Random(4242);
  const props = new PropInstancer();
  const cyl = (height: number, radius: number) => (pos: THREE.Vector3, scale: number) =>
    ctx.physics.addStaticCylinder(pos.clone().setY(pos.y + (height * scale) / 2), (height * scale) / 2, radius * scale);
  props.define('tree', Models.tree(7), [m.color('#5b4636', 0.9), m.color('#5d8a3c', 0.85)], cyl(3.2, 0.25));
  props.define('lamp', Models.streetLamp(), [m.color('#2e3437', 0.45, 0.6), m.color('#fff4da', 0.3)], cyl(5.6, 0.13));

  const W = meta.landuse.width;
  const H = meta.landuse.height;
  const cell = meta.landuse.cell;
  const at = (px: number, pz: number) => (px < 0 || pz < 0 || px >= W || pz >= H ? -1 : landuse[pz * W + px]);
  const toWorld = (px: number, pz: number) => new THREE.Vector3(meta.bounds.minX + (px + 0.5) * cell, 0, meta.bounds.minZ + (pz + 0.5) * cell);

  // Trees: jittered grid over green land, keeping clear of other classes.
  const treeStep = Math.round(11 / cell);
  for (let pz = 0; pz < H; pz += treeStep) {
    for (let px = 0; px < W; px += treeStep) {
      const jx = px + Math.floor(rng.range(-0.4, 0.4) * treeStep);
      const jz = pz + Math.floor(rng.range(-0.4, 0.4) * treeStep);
      if (at(jx, jz) !== LandUse.Green || !rng.chance(0.75)) continue;
      const r = Math.round(3 / cell);
      if (at(jx + r, jz) !== LandUse.Green || at(jx - r, jz) !== LandUse.Green || at(jx, jz + r) !== LandUse.Green || at(jx, jz - r) !== LandUse.Green) continue;
      const p = toWorld(jx, jz);
      p.y = terrain.heightAt(p.x, p.z);
      const color = new THREE.Color().setHSL(0.24 + rng.range(-0.04, 0.05), 0.35 + rng.range(0, 0.3), 0.75 + rng.range(-0.08, 0.12));
      props.place('tree', p, rng.range(0, Math.PI * 2), rng.range(0.9, 1.5), color);
    }
  }

  // Street lamps: one per 26 m cell on a sidewalk pixel that borders the road, arm towards the road.
  const lampStep = Math.round(26 / cell);
  const look = Math.round(3 / cell);
  for (let gz = 0; gz < H; gz += lampStep) {
    for (let gx = 0; gx < W; gx += lampStep) {
      let placed = false;
      for (let tries = 0; tries < 40 && !placed; tries++) {
        const px = gx + Math.floor(rng.next() * lampStep);
        const pz = gz + Math.floor(rng.next() * lampStep);
        if (at(px, pz) !== LandUse.Sidewalk) continue;
        // Direction to the nearest road pixel
        const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dz] of dirs) {
          if (at(px + dx * look, pz + dz * look) === LandUse.Road && at(px - dx * 2, pz - dz * 2) !== LandUse.Road) {
            const p = toWorld(px, pz);
            p.y = terrain.heightAt(p.x, p.z);
            props.place('lamp', p, Math.atan2(dx, dz));
            placed = true;
            break;
          }
        }
      }
    }
  }
  props.build(ctx);
}
