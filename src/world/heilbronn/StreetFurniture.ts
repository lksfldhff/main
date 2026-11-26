import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldContext } from '../WorldContext';
import type { HeilbronnData } from './HeilbronnData';
import type { Terrain } from './Terrain';
import { LandUse } from './LandUse';
import type { AssetLibrary, Placement } from '../../assets/AssetLibrary';
import { createCanvas } from '../../rendering/textures/CanvasUtils';
import { Random } from '../../utils/random';

/**
 * Street furniture at real OSM positions: granite kerbs, glass bus shelters,
 * waste baskets, hydrants, bicycle stands, bollards, post boxes, advertising columns,
 * planters and seating on squares. Library models (CC0, tools/assets/library.py) are used
 * where available; everything else is modelled procedurally – never a placeholder block.
 */
/** Record of what was placed where – consumed by the automated visual QA (tools/qa). */
export interface QaPlacement {
  /** Real-world feature (OSM tag or generator rule). */
  feature: string;
  /** Model actually used: library asset id, `procedural:<name>` or `fallback:<name>`. */
  model: string;
  x: number;
  z: number;
  /** Footprint radius in metres (for collision / overlap checks). */
  r: number;
}

export async function buildStreetFurniture(
  ctx: WorldContext,
  data: HeilbronnData,
  terrain: Terrain,
  assets: AssetLibrary,
): Promise<{ counts: Record<string, number>; placements: QaPlacement[] }> {
  const osm = data.meta.osm ?? {};
  const counts: Record<string, number> = {};
  const placements: QaPlacement[] = [];
  const record = (feature: string, model: string, list: { x: number; z: number }[], r: number) => {
    for (const p of list) placements.push({ feature, model, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, r });
  };
  const xz = (l: { position: THREE.Vector3 }[]) => l.map((p) => p.position);
  const ground = (x: number, z: number) => terrain.heightAt(x, z);
  const classAt = createClassLookup(data);
  const facing = createRoadFacing(classAt);
  // OSM points are often mapped on the street centre-line / kerb (ALKIS road parcels include the
  // kerb zone): move furniture that would stand on the carriageway onto the nearest walkway.
  const covered = createCoverTest(ctx, ground);
  const walkable = (x: number, z: number) => WALKABLE.has(classAt(x, z)) && !covered(x, z);
  const snap = (x: number, z: number): [number, number] => {
    if (walkable(x, z)) return [x, z];
    // 8 m search; beyond that the land use is likely wrong (e.g. pedestrian zone mapped as road) → keep OSM position
    for (let r = 0.5; r <= 8; r += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const sx = x + Math.sin(a) * r;
        const sz = z + Math.cos(a) * r;
        // step a little further so the object clears the kerb
        if (walkable(sx, sz) && walkable(sx + Math.sin(a) * 0.6, sz + Math.cos(a) * 0.6)) return [sx + Math.sin(a) * 0.6, sz + Math.cos(a) * 0.6];
      }
    }
    return [x, z];
  };
  const rng = new Random(5150);

  addKerbs(ctx, data);
  counts.kerbTriangles = data.kerbs.length / 9;

  // --- Bus stops: glass shelter where OSM says shelter=yes, otherwise sign pole (+ bench)
  const shelters: { pos: THREE.Vector3; yaw: number }[] = [];
  const poles: { pos: THREE.Vector3; yaw: number }[] = [];
  const benches: Placement[] = [];
  for (const [ox, , oz, shelter = 0, bench = 0] of osm.busStops ?? []) {
    const [x, z] = shelter ? [ox, oz] : snap(ox, oz);
    const yaw = facing(x, z);
    // Shelter sits ~1.8 m behind the kerb, opening towards the road.
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (shelter) {
      // OSM stop nodes sit on the kerb or the carriageway: walk back onto the pavement first.
      let off = 0;
      while (off < 8 && classAt(x + back.x * off, z + back.z * off) === LandUse.Road) off += 0.25;
      const p = new THREE.Vector3(x, 0, z).addScaledVector(back, off + 1.35);
      p.y = ground(p.x, p.z);
      shelters.push({ pos: p, yaw });
    } else {
      poles.push({ pos: new THREE.Vector3(x, ground(x, z), z), yaw });
      if (bench) {
        const b = new THREE.Vector3(x, 0, z).addScaledVector(back, 1.4).add(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(1.8));
        b.y = ground(b.x, b.z);
        benches.push({ position: b, yaw });
      }
    }
  }
  addBusShelters(ctx, shelters);
  record('highway=bus_stop + shelter=yes', 'procedural:glass_bus_shelter', shelters.map((s) => s.pos), 2.1);
  record('highway=bus_stop', 'procedural:bus_stop_pole', poles.map((s) => s.pos), 0.3);
  addInstanced(ctx, 'busStopPole', busStopPole(), poles.map((p) => p.pos), poles.map((p) => p.yaw), true);
  for (const p of poles) ctx.physics.addStaticCylinder(p.pos.clone().setY(p.pos.y + 1.3), 1.3, 0.05);
  counts.busShelters = shelters.length;
  counts.busPoles = poles.length;

  const cylinder = (radius: number) => (p: Placement, h: number) =>
    ctx.physics.addStaticCylinder(p.position.clone().setY(p.position.y + h / 2), h / 2, radius);
  const jobs: Promise<unknown>[] = [];
  const place = (id: string, list: Placement[], radius: number, cullDistance = 160, feature?: string) => {
    if (!assets.has(id) || list.length === 0) return false;
    record(feature ?? id, id, xz(list), radius > 0 ? radius : 0.5);
    jobs.push(assets.instantiate(id, list, { cullDistance, collider: radius > 0 ? cylinder(radius) : undefined }).then((g) => ctx.root.add(g)));
    counts[id] = (counts[id] ?? 0) + list.length;
    return true;
  };
  const at = (pts: [number, number, number, ...number[]][] | undefined, yawFn: (x: number, z: number) => number = facing, onWalkway = true): Placement[] =>
    (pts ?? []).map(([ox, , oz]) => {
      const [x, z] = onWalkway ? snap(ox, oz) : [ox, oz];
      return { position: new THREE.Vector3(x, ground(x, z), z), yaw: yawFn(x, z) };
    });

  // --- OSM benches (asset), waste baskets, hydrants
  const osmBenches = [...at(osm.benches, (x, z) => facing(x, z) + Math.PI), ...benches];
  if (!place('bench_wood', osmBenches, 0, 160, 'amenity=bench')) {
    counts.benchFallback = osmBenches.length;
    record('amenity=bench', 'fallback:procedural_bench', xz(osmBenches), 0.6);
  }
  else for (const b of osmBenches) ctx.physics.addStaticBox(b.position.clone().setY(b.position.y + 0.25), new THREE.Vector3(0.6, 0.25, 0.25), b.yaw);
  place('trash_can', at(osm.wasteBaskets).map((p) => ({ ...p, scale: 0.62 })), 0.3, 160, 'amenity=waste_basket');
  place('fire_hydrant', at(osm.hydrants), 0.15, 160, 'emergency=fire_hydrant');

  // Utility cabinets: OSM street_cabinet + one traffic-signal controller per signalised junction
  // (signals within 40 m form one junction), set back onto the pavement facing the road.
  const cabinets = at(osm.streetCabinets);
  const junctions: { x: number; z: number }[] = [];
  for (const [x, , z] of osm.signals ?? []) {
    if (junctions.some((j) => Math.hypot(j.x - x, j.z - z) < 40)) continue;
    junctions.push({ x, z });
    const yaw = facing(x, z);
    const [cx, cz] = snap(x - Math.sin(yaw) * 3.5, z - Math.cos(yaw) * 3.5);
    if (WALKABLE.has(classAt(cx, cz)) && !covered(cx, cz)) cabinets.push({ position: new THREE.Vector3(cx, ground(cx, cz), cz), yaw: facing(cx, cz) });
  }
  place('utility_box', cabinets, 0.32, 160, 'man_made=street_cabinet / signal controller');
  const blocks = at(osm.barrierBlocks, facing, false);
  place('concrete_barrier', blocks, 0, 160, 'barrier=block');
  for (const b of blocks) ctx.physics.addStaticBox(b.position.clone().setY(b.position.y + 0.41), new THREE.Vector3(0.78, 0.41, 0.32), b.yaw);

  // --- Planters and modular seating on pedestrian squares (generated, clear of buildings/roads)
  const { planters, seating } = squareFurniture(data, ground, rng);
  if (place('planter_box', planters, 0.45, 160, 'generated: planter on square')) {
    addInstanced(ctx, 'planterGreen', planterGreen(), planters.map((p) => p.position), planters.map((p) => p.yaw), true);
  }
  place('street_seating', seating, 0, 160, 'generated: seating on square');
  for (const s of seating) ctx.physics.addStaticBox(s.position.clone().setY(s.position.y + 0.4), new THREE.Vector3(2.1, 0.4, 0.38), s.yaw);

  // --- Procedural furniture without a library model
  const bikes: { pos: THREE.Vector3; yaw: number }[] = [];
  for (const [bx, , bz, cap = 6] of osm.bicycleParking ?? []) {
    const [x, z] = snap(bx, bz);
    const yaw = facing(x, z);
    const n = Math.min(8, Math.max(1, Math.round(cap / 2)));
    const along = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(x, 0, z).addScaledVector(along, (i - (n - 1) / 2) * 1.0);
      p.y = ground(p.x, p.z);
      bikes.push({ pos: p, yaw });
    }
  }
  addInstanced(ctx, 'bikeStand', bikeStand(), bikes.map((b) => b.pos), bikes.map((b) => b.yaw), true);
  counts.bikeStands = bikes.length;
  record('amenity=bicycle_parking', 'procedural:bike_hoop', bikes.map((b) => b.pos), 0.45);

  const bollards = at(osm.bollards, facing, false); // bollards legitimately stand in the road space
  addInstanced(ctx, 'bollard', bollardModel(), bollards.map((b) => b.position), bollards.map(() => 0), true);
  for (const b of bollards) ctx.physics.addStaticCylinder(b.position.clone().setY(b.position.y + 0.45), 0.45, 0.08);
  counts.bollards = bollards.length;
  record('barrier=bollard', 'procedural:bollard', xz(bollards), 0.09);

  const posts = at(osm.postBoxes);
  addInstanced(ctx, 'postBox', postBox(), posts.map((b) => b.position), posts.map((b) => b.yaw), true);
  for (const b of posts) ctx.physics.addStaticBox(b.position.clone().setY(b.position.y + 0.6), new THREE.Vector3(0.3, 0.6, 0.25), b.yaw);
  counts.postBoxes = posts.length;
  record('amenity=post_box', 'procedural:post_box', xz(posts), 0.3);

  for (const c of at(osm.adColumns)) addAdColumn(ctx, c.position, rng);
  record('advertising=column', 'procedural:advertising_column', xz(at(osm.adColumns)), 0.7);
  counts.adColumns = osm.adColumns?.length ?? 0;

  await Promise.all(jobs);
  return { counts, placements };
}

/**
 * True when a building (roof / passage) is above (x, z): vertical ray from 80 m down, hit more than
 * 2.5 m above the ground. Used to keep generated furniture out of LoD2 footprints.
 */
export function createCoverTest(ctx: WorldContext, ground: (x: number, z: number) => number): (x: number, z: number) => boolean {
  ctx.physics.refreshQueries();
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  return (x, z) => {
    const g = ground(x, z);
    const hit = ctx.physics.castRay(o.set(x, g + 80, z), down, 77.5);
    return hit !== null;
  };
}

/** Lamp placements are produced by the district; the library lamp replaces the procedural one. */
export async function placeLibraryLamps(ctx: WorldContext, assets: AssetLibrary, lamps: Placement[], qa?: QaPlacement[]): Promise<boolean> {
  if (!assets.has('street_lamp_classic')) return false;
  for (const l of lamps) qa?.push({ feature: 'generated: street lamp at kerb', model: 'street_lamp_classic', x: l.position.x, z: l.position.z, r: 0.15 });
  const g = await assets.instantiate('street_lamp_classic', lamps, {
    cullDistance: 300,
    collider: (p, h) => ctx.physics.addStaticCylinder(p.position.clone().setY(p.position.y + h / 2), h / 2, 0.13),
  });
  ctx.root.add(g);
  return true;
}

// ---------------------------------------------------------------------------------------------

const WALKABLE = new Set<number>([LandUse.Sidewalk, LandUse.Plaza, LandUse.Path, LandUse.Green, LandUse.Urban]);

function createClassLookup(data: HeilbronnData): (x: number, z: number) => number {
  const { meta, landuse } = data;
  const W = meta.landuse.width;
  const H = meta.landuse.height;
  const cell = meta.landuse.cell;
  return (x, z) => {
    const px = Math.floor((x - meta.bounds.minX) / cell);
    const pz = Math.floor((z - meta.bounds.minZ) / cell);
    return px < 0 || pz < 0 || px >= W || pz >= H ? -1 : landuse[pz * W + px];
  };
}

/** Returns the yaw that turns a model's +Z (front) towards the nearest carriageway. */
function createRoadFacing(cls: (x: number, z: number) => number): (x: number, z: number) => number {
  return (x, z) => {
    for (const r of [2, 4, 7, 11]) {
      let dx = 0;
      let dz = 0;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        if (cls(x + Math.sin(a) * r, z + Math.cos(a) * r) === LandUse.Road) {
          dx += Math.sin(a);
          dz += Math.cos(a);
        }
      }
      if (dx * dx + dz * dz > 0.01) return Math.atan2(dx, dz);
    }
    return 0;
  };
}

function addKerbs(ctx: WorldContext, data: HeilbronnData): void {
  if (data.kerbs.length === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.kerbs, 3));
  geo.computeVertexNormals(); // non-indexed → flat faces: crisp kerb edge
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x77756f, roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // Granite speckle + individual kerbstones (1 m) with darker joints, without a texture fetch.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKerbW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKerbW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKerbW;\nfloat kh(vec2 p){return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);}')
      .replace(
        '#include <map_fragment>',
        `float speck = kh(floor(vKerbW.xz * 40.0) + floor(vKerbW.y * 40.0));
float stone = kh(floor(vKerbW.xz * 1.0));
float joint = step(0.985, fract(vKerbW.x + vKerbW.z));
diffuseColor.rgb *= (0.86 + 0.16 * speck) * (0.92 + 0.1 * stone) * (1.0 - 0.35 * joint);`,
      );
  };
  mat.customProgramCacheKey = () => 'kerb-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'kerbs';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  ctx.root.add(mesh);
}

function addInstanced(
  ctx: WorldContext,
  name: string,
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[],
  positions: THREE.Vector3[],
  yaws: number[],
  castShadow: boolean,
): void {
  if (positions.length === 0) return;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  for (const part of parts) {
    const mesh = new THREE.InstancedMesh(part.geo, part.mat, positions.length);
    positions.forEach((p, i) => mesh.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(up, yaws[i]), one)));
    mesh.castShadow = castShadow && !(part.mat as THREE.MeshPhysicalMaterial).transparent;
    mesh.receiveShadow = true;
    mesh.name = `furniture:${name}`;
    mesh.computeBoundingSphere();
    ctx.root.add(mesh);
  }
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos.map((g) => g.toNonIndexed()))!;

const metalDark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.42, metalness: 0.75 });
const steel = new THREE.MeshStandardMaterial({ color: 0x9da3a6, roughness: 0.32, metalness: 0.9 });

/**
 * Glass bus shelter (Wartehalle): dark anodised frame, clear glass back and side panes,
 * glass roof, bench, timetable case and an illuminated advertising panel; "H" stop sign.
 * Opening (+Z) faces the road.
 */
function addBusShelters(ctx: WorldContext, list: { pos: THREE.Vector3; yaw: number }[]): void {
  if (list.length === 0) return;
  const L = 4.2;
  const D = 1.5;
  const Hh = 2.45;
  const post = 0.07;
  const frame: THREE.BufferGeometry[] = [];
  for (const x of [-L / 2, 0, L / 2]) for (const z of [-D / 2, D / 2]) frame.push(box(post, Hh, post, x, Hh / 2, z));
  frame.push(box(L + 0.1, 0.12, post, 0, Hh, -D / 2), box(L + 0.1, 0.12, post, 0, Hh, D / 2));
  for (const x of [-L / 2, L / 2]) frame.push(box(post, 0.12, D, x, Hh, 0));
  frame.push(box(L, 0.05, post * 0.8, 0, 0.12, -D / 2)); // bottom rail
  // bench: slats on two brackets
  const bench: THREE.BufferGeometry[] = [box(1.8, 0.04, 0.38, 0.6, 0.46, -D / 2 + 0.3)];
  for (const x of [-0.25, 1.45]) bench.push(box(0.05, 0.44, 0.3, x, 0.22, -D / 2 + 0.25));
  const glass: THREE.BufferGeometry[] = [
    box(L - 0.1, Hh - 0.3, 0.012, 0, (Hh - 0.3) / 2 + 0.15, -D / 2), // back wall
    box(0.012, Hh - 0.3, D - 0.1, -L / 2, (Hh - 0.3) / 2 + 0.15, 0), // side wall
    box(L + 0.2, 0.02, D + 0.25, 0, Hh + 0.07, 0.05).rotateX(-0.04), // roof
  ];
  // Illuminated ad panel on the closed side (right end) + timetable case
  const ad = [box(0.06, 1.75, 1.18, L / 2, 1.1, 0)];
  const timetable = [box(0.6, 0.85, 0.04, -1.2, 1.4, -D / 2 + 0.03)];
  const sign = [new THREE.CylinderGeometry(0.035, 0.035, 2.9, 10).translate(-L / 2 - 0.5, 1.45, D / 2), new THREE.CylinderGeometry(0.24, 0.24, 0.03, 32).rotateX(Math.PI / 2).translate(-L / 2 - 0.5, 2.75, D / 2)];

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe9ec,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.4,
    specularIntensity: 1,
    ior: 1.5,
  });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x8e9599, roughness: 0.4, metalness: 0.8 });
  const adMat = new THREE.MeshStandardMaterial({ map: posterTexture(new Random(11), 256, 384), emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.25 });
  adMat.emissiveMap = adMat.map;
  const ttMat = new THREE.MeshStandardMaterial({ color: 0xe9ecee, roughness: 0.3 });

  addInstanced(ctx, 'busShelter', [
    { geo: merge(frame), mat: metalDark },
    { geo: merge(bench), mat: benchMat },
    { geo: merge(ad), mat: adMat },
    { geo: merge(timetable), mat: ttMat },
    { geo: merge([sign[0]]), mat: steel },
    { geo: merge([sign[1]]), mat: busSignMaterial() },
    { geo: merge(glass), mat: glassMat },
  ], list.map((s) => s.pos), list.map((s) => s.yaw), true);

  for (const s of list) {
    const rot = (x: number, z: number) => new THREE.Vector3(x * Math.cos(s.yaw) + z * Math.sin(s.yaw), 0, -x * Math.sin(s.yaw) + z * Math.cos(s.yaw)).add(s.pos);
    ctx.physics.addStaticBox(rot(0, -D / 2).setY(s.pos.y + Hh / 2), new THREE.Vector3(L / 2, Hh / 2, 0.04), s.yaw);
    ctx.physics.addStaticBox(rot(-L / 2, 0).setY(s.pos.y + Hh / 2), new THREE.Vector3(0.04, Hh / 2, D / 2), s.yaw);
    ctx.physics.addStaticBox(rot(L / 2, 0).setY(s.pos.y + Hh / 2), new THREE.Vector3(0.05, Hh / 2, 0.6), s.yaw);
  }
}

function busStopPole(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  return [
    { geo: new THREE.CylinderGeometry(0.035, 0.04, 2.9, 10).translate(0, 1.45, 0), mat: steel },
    { geo: new THREE.CylinderGeometry(0.24, 0.24, 0.03, 32).rotateX(Math.PI / 2).translate(0, 2.7, 0), mat: busSignMaterial() },
    { geo: box(0.42, 0.55, 0.05, 0, 1.6, 0.05), mat: new THREE.MeshStandardMaterial({ color: 0xe6e9eb, roughness: 0.35 }) },
  ];
}

/** "Kreuzberger Bügel": galvanised steel hoop, 0.8 m high. */
function bikeStand(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const r = 0.2;
  path.add(new THREE.LineCurve3(new THREE.Vector3(-0.4, 0, 0), new THREE.Vector3(-0.4, 0.8 - r, 0)));
  path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.4, 0.8 - r, 0), new THREE.Vector3(-0.4, 0.8, 0), new THREE.Vector3(-0.4 + r, 0.8, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(-0.4 + r, 0.8, 0), new THREE.Vector3(0.4 - r, 0.8, 0)));
  path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0.4 - r, 0.8, 0), new THREE.Vector3(0.4, 0.8, 0), new THREE.Vector3(0.4, 0.8 - r, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(0.4, 0.8 - r, 0), new THREE.Vector3(0.4, 0, 0)));
  // Hoop stands across the kerb direction: rotate so its plane is the local YZ plane.
  return [{ geo: new THREE.TubeGeometry(path, 14, 0.024, 6).rotateY(Math.PI / 2), mat: steel }];
}

/** Boxwood and flowers filling a planter (planter_box scaled ×1.8 → ~0.76 m high, 1.64 × 0.74 m). */
function planterGreen(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const rng = new Random(31);
  const leaves: THREE.BufferGeometry[] = [];
  const flowers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(0.26 + rng.next() * 0.08, 3);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const f = 0.85 + rng.next() * 0.3;
      pos.setXYZ(k, pos.getX(k) * f, pos.getY(k) * f * 0.8, pos.getZ(k) * f);
    }
    g.computeVertexNormals();
    leaves.push(g.translate(-0.6 + i * 0.3, 0.78 + rng.next() * 0.05, (rng.next() - 0.5) * 0.25));
  }
  for (let i = 0; i < 14; i++) {
    flowers.push(new THREE.SphereGeometry(0.03, 6, 4).translate(-0.7 + rng.next() * 1.4, 0.95 + rng.next() * 0.12, (rng.next() - 0.5) * 0.55));
  }
  return [
    { geo: merge(leaves), mat: new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.85 }) },
    { geo: merge(flowers), mat: new THREE.MeshStandardMaterial({ color: 0xd8475a, roughness: 0.7 }) },
  ];
}

function bollardModel(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const body = new THREE.CylinderGeometry(0.075, 0.085, 0.9, 14).translate(0, 0.45, 0);
  const cap = new THREE.SphereGeometry(0.075, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0);
  const band = new THREE.CylinderGeometry(0.078, 0.078, 0.06, 14).translate(0, 0.78, 0);
  return [
    { geo: merge([body, cap]), mat: new THREE.MeshStandardMaterial({ color: 0x3a3d3f, roughness: 0.5, metalness: 0.6 }) },
    { geo: merge([band]), mat: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.25, emissive: 0x222222 }) },
  ];
}

/** Yellow letter box on a post (generic, no logo). */
function postBox(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  return [
    { geo: merge([box(0.5, 0.62, 0.36, 0, 0.98, 0), new THREE.CylinderGeometry(0.25, 0.25, 0.36, 18, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.29, 0)]), mat: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.45 }) },
    { geo: merge([box(0.08, 0.67, 0.08, 0, 0.33, 0), box(0.36, 0.025, 0.02, 0, 1.12, 0.185)]), mat: metalDark },
  ];
}

/** Litfaßsäule: column with paper posters and a dark dome cap. */
function addAdColumn(ctx: WorldContext, p: THREE.Vector3, rng: Random): void {
  const tex = posterTexture(rng, 1024, 256, true);
  tex.wrapS = THREE.RepeatWrapping;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.6, 36, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  col.position.set(p.x, p.y + 0.3 + 1.3, p.z);
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.7, 0.3, 36), metalDark);
  baseRing.position.set(p.x, p.y + 0.15, p.z);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.72, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2), metalDark);
  cap.scale.y = 0.45;
  cap.position.set(p.x, p.y + 2.9, p.z);
  for (const m of [col, baseRing, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
    ctx.root.add(m);
  }
  ctx.physics.addStaticCylinder(new THREE.Vector3(p.x, p.y + 1.5, p.z), 1.5, 0.68);
}

/** Abstract posters (colour fields + text bars) – no real brands. */
function posterTexture(rng: Random, w: number, h: number, sheets = false): THREE.CanvasTexture {
  const [canvas, g] = createCanvas(w, h);
  const palette = ['#d8413a', '#f2b632', '#2f6fb3', '#1f8a6e', '#f4efe4', '#262a33', '#e57a3c', '#7a4fa0'];
  const n = sheets ? 5 : 1;
  for (let i = 0; i < n; i++) {
    const x0 = (i / n) * w;
    const sw = w / n;
    g.fillStyle = palette[Math.floor(rng.next() * palette.length)];
    g.fillRect(x0, 0, sw, h);
    g.fillStyle = palette[Math.floor(rng.next() * palette.length)];
    g.beginPath();
    g.arc(x0 + sw * (0.3 + rng.next() * 0.4), h * (0.3 + rng.next() * 0.3), Math.min(sw, h) * (0.15 + rng.next() * 0.2), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 3; k++) g.fillRect(x0 + sw * 0.12, h * (0.68 + k * 0.08), sw * (0.4 + rng.next() * 0.4), h * 0.035);
    if (sheets) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x0 + sw - 2, 0, 2, h);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function busSignMaterial(): THREE.MeshStandardMaterial {
  const [canvas, g] = createCanvas(128, 128);
  g.fillStyle = '#f4c400';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1d6b3a';
  g.lineWidth = 7;
  g.stroke();
  g.fillStyle = '#1d6b3a';
  g.font = 'bold 76px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
}

/** Planters and seating on pedestrian squares, ≥ 3 m away from anything that is not square. */
function squareFurniture(data: HeilbronnData, ground: (x: number, z: number) => number, rng: Random): { planters: Placement[]; seating: Placement[] } {
  const { meta, landuse } = data;
  const W = meta.landuse.width;
  const H = meta.landuse.height;
  const cell = meta.landuse.cell;
  const cls = (x: number, z: number) => {
    const px = Math.floor((x - meta.bounds.minX) / cell);
    const pz = Math.floor((z - meta.bounds.minZ) / cell);
    return px < 0 || pz < 0 || px >= W || pz >= H ? -1 : landuse[pz * W + px];
  };
  const clear = (x: number, z: number, r: number) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (cls(x + Math.sin(a) * r, z + Math.cos(a) * r) !== LandUse.Plaza) return false;
    }
    return cls(x, z) === LandUse.Plaza;
  };
  const planters: Placement[] = [];
  const seating: Placement[] = [];
  const b = meta.bounds;
  for (let z = b.minZ; z < b.maxZ; z += 16) {
    for (let x = b.minX; x < b.maxX; x += 16) {
      const px = x + rng.range(2, 14);
      const pz = z + rng.range(2, 14);
      if (!clear(px, pz, 3.5)) continue;
      const roll = rng.next();
      if (roll < 0.22) {
        // a pair of planters
        const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
        for (const o of [-0.9, 0.9]) {
          const q = new THREE.Vector3(px + Math.cos(yaw) * o, 0, pz - Math.sin(yaw) * o);
          q.y = ground(q.x, q.z);
          planters.push({ position: q, yaw, scale: 1.8 });
        }
      } else if (roll < 0.3 && clear(px, pz, 5)) {
        seating.push({ position: new THREE.Vector3(px, ground(px, pz), pz), yaw: rng.chance(0.5) ? 0 : Math.PI / 2 });
      }
    }
  }
  return { planters, seating };
}
