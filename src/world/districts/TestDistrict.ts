import * as THREE from 'three';
import { Random } from '../../utils/random';
import type { WorldContext } from '../WorldContext';
import { FACADE_STYLES, getFacadeStyle, type FacadeStyle } from '../buildings/FacadeStyles';
import type { BuildingSpec } from '../buildings/BuildingGenerator';
import { addBuilding } from '../builders/BuildingBuilder';
import { addGroundArea, addRaisedSlab, addFlatSurface, addQuayWall } from '../builders/GroundBuilder';
import { addLaneMarkings, addZebraCrossing } from '../builders/RoadBuilder';
import { rect, normalizePolygon, type Polygon } from '../geometry/Polygon';
import { PropInstancer } from '../props/PropInstancer';
import * as Models from '../props/PropModels';
import { addClockTower, addFountain, addPosterColumn } from '../props/Landmarks';

/**
 * Phase 1 test district: a hand-designed grid that exercises every system
 * (roads, curbs, perimeter blocks, concave footprints, plaza, river quay, props).
 * It is NOT geographically accurate – Phase 2 replaces it with OSM data.
 */

const ROAD_WIDTH = 12;
const CURB_HEIGHT = 0.15;
const SIDEWALK = 4;
/** Road centre lines. */
const ROADS_X = [-136, -50, 50, 136];
const ROADS_Z = [-126, -45, 45, 126];
const RIVER = { quayX: -152, farBankX: -262, waterY: -1.6, bedY: -4 };
const WORLD_EDGE = 640;

import type { District } from '../District';

interface Block {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function buildTestDistrict(ctx: WorldContext): District {
  const rng = new Random(1977);
  const props = createPropInstancer(ctx);

  buildGround(ctx);
  buildRoadMarkings(ctx);

  const blocks = computeBlocks();
  for (const block of blocks) {
    const isPlaza = block.x0 === -44 && block.z0 === -39;
    addRaisedSlab(ctx, rect(block.x0, block.z0, block.x1, block.z1), CURB_HEIGHT, isPlaza ? 'cobblestone' : 'paving');
    placeStreetFurniture(block, props, rng, isPlaza);

    if (isPlaza) {
      buildPlaza(ctx, block, props, rng);
    } else if (block.x0 === 56 && block.z0 === -39) {
      buildOfficeBlock(ctx, block, props, rng);
    } else {
      for (const spec of perimeterBlock(block, rng)) addBuilding(ctx, spec);
      planCourtyardTrees(block, props, rng);
    }
  }

  buildRiverside(ctx, props);
  buildParks(props, rng);
  props.build(ctx);

  return {
    name: 'Testviertel',
    spawn: new THREE.Vector3(0, CURB_HEIGHT + 0.05, 28),
    spawnYaw: 0,
    showcaseCenter: new THREE.Vector3(0, 0, 0),
    showcaseRadius: 95,
  };
}

// ---------------------------------------------------------------- ground & roads

function buildGround(ctx: WorldContext): void {
  const tx0 = ROADS_X[0] - ROAD_WIDTH / 2;
  const tx1 = ROADS_X[3] + ROAD_WIDTH / 2;
  const tz0 = ROADS_Z[0] - ROAD_WIDTH / 2;
  const tz1 = ROADS_Z[3] + ROAD_WIDTH / 2;
  const q = RIVER.quayX;

  // Asphalt street level for the whole town grid; blocks are raised slabs on top of it.
  addGroundArea(ctx, tx0, tz0, tx1, tz1, 0, 'asphalt');
  // Surrounding meadows
  addGroundArea(ctx, q, -WORLD_EDGE, WORLD_EDGE, tz0, 0, 'grass', 128);
  addGroundArea(ctx, q, tz1, WORLD_EDGE, WORLD_EDGE, 0, 'grass', 128);
  addGroundArea(ctx, tx1, tz0, WORLD_EDGE, tz1, 0, 'grass', 128);
  // Neckar-style river with stone quays on both banks
  addGroundArea(ctx, RIVER.farBankX, -WORLD_EDGE, q, WORLD_EDGE, RIVER.bedY, 'quayStone', 128);
  addGroundArea(ctx, -WORLD_EDGE, -WORLD_EDGE, RIVER.farBankX, WORLD_EDGE, 0, 'grass', 128);
  addQuayWall(ctx, q, -WORLD_EDGE, WORLD_EDGE, RIVER.bedY, CURB_HEIGHT, -1);
  addQuayWall(ctx, RIVER.farBankX, -WORLD_EDGE, WORLD_EDGE, RIVER.bedY, 0, 1);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(q - RIVER.farBankX, WORLD_EDGE * 2),
    new THREE.MeshStandardMaterial({ color: 0x2f6f7a, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.88 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((q + RIVER.farBankX) / 2, RIVER.waterY, 0);
  water.receiveShadow = true;
  water.name = 'river';
  ctx.root.add(water);

  // Promenade along the quay ("Neckarmeile"-style)
  addRaisedSlab(ctx, rect(q, tz0, tx0, tz1), CURB_HEIGHT, 'paving');
}

function buildRoadMarkings(ctx: WorldContext): void {
  const clear = ROAD_WIDTH / 2 + 4.5; // keep intersections + zebra crossings free
  const segment = (a: THREE.Vector2, b: THREE.Vector2) => {
    const dir = b.clone().sub(a).normalize();
    const from = a.clone().addScaledVector(dir, clear);
    const to = b.clone().addScaledVector(dir, -clear);
    if (from.distanceTo(a) < to.distanceTo(a)) addLaneMarkings(ctx, from, to, ROAD_WIDTH);
  };
  for (const x of ROADS_X)
    for (let i = 0; i < ROADS_Z.length - 1; i++) segment(new THREE.Vector2(x, ROADS_Z[i]), new THREE.Vector2(x, ROADS_Z[i + 1]));
  for (const z of ROADS_Z)
    for (let i = 0; i < ROADS_X.length - 1; i++) segment(new THREE.Vector2(ROADS_X[i], z), new THREE.Vector2(ROADS_X[i + 1], z));

  // Zebra crossings around the central intersections
  const off = ROAD_WIDTH / 2 + 2.2;
  for (const x of [-50, 50]) {
    for (const z of [-45, 45]) {
      addZebraCrossing(ctx, new THREE.Vector2(x, z - off), new THREE.Vector2(0, 1), ROAD_WIDTH);
      addZebraCrossing(ctx, new THREE.Vector2(x, z + off), new THREE.Vector2(0, 1), ROAD_WIDTH);
      addZebraCrossing(ctx, new THREE.Vector2(x - off, z), new THREE.Vector2(1, 0), ROAD_WIDTH);
      addZebraCrossing(ctx, new THREE.Vector2(x + off, z), new THREE.Vector2(1, 0), ROAD_WIDTH);
    }
  }
}

function computeBlocks(): Block[] {
  const blocks: Block[] = [];
  const h = ROAD_WIDTH / 2;
  for (let i = 0; i < ROADS_X.length - 1; i++) {
    for (let j = 0; j < ROADS_Z.length - 1; j++) {
      blocks.push({ x0: ROADS_X[i] + h, x1: ROADS_X[i + 1] - h, z0: ROADS_Z[j] + h, z1: ROADS_Z[j + 1] - h });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------- buildings

const STREET_STYLES = FACADE_STYLES.filter((s) => s.id !== 'buero-glas');

function pickStyle(rng: Random): FacadeStyle {
  // Post-war plaster dominates, as in Heilbronn's rebuilt centre.
  if (rng.chance(0.3)) return getFacadeStyle(rng.chance(0.5) ? 'nachkrieg-creme' : 'fuenfziger-weiss');
  return rng.pick(STREET_STYLES);
}

/** Perimeter block development: rows of buildings along all four streets around a courtyard. */
function perimeterBlock(block: Block, rng: Random): BuildingSpec[] {
  const specs: BuildingSpec[] = [];
  const bx0 = block.x0 + SIDEWALK;
  const bx1 = block.x1 - SIDEWALK;
  const bz0 = block.z0 + SIDEWALK;
  const bz1 = block.z1 - SIDEWALK;
  const depth = rng.range(11, 14);

  const row = (
    start: number,
    end: number,
    make: (a: number, b: number) => Polygon,
    gateway: boolean,
  ) => {
    let pos = start;
    const gateAt = gateway ? start + (end - start) * rng.range(0.35, 0.65) : Infinity;
    let gatePlaced = false;
    while (end - pos > 0.5) {
      let width = rng.range(9, 17);
      if (end - pos - width < 7) width = end - pos;
      if (!gatePlaced && pos + width > gateAt) {
        // 5 m passage into the courtyard
        gatePlaced = true;
        pos += 5;
        continue;
      }
      const style = pickStyle(rng);
      const levels = style.ribbon ? rng.int(4, 6) : rng.int(3, 5);
      specs.push({ footprint: make(pos, pos + width), levels, style });
      pos += width;
    }
  };

  row(bx0, bx1, (a, b) => rect(a, bz0, b, bz0 + depth), true); // north row
  row(bx0, bx1, (a, b) => rect(a, bz1 - depth, b, bz1), true); // south row
  row(bz0 + depth, bz1 - depth, (a, b) => rect(bx0, a, bx0 + depth, b), false); // west row
  row(bz0 + depth, bz1 - depth, (a, b) => rect(bx1 - depth, a, bx1, b), false); // east row
  return specs;
}

/** Modern office block with an L-shaped (concave) footprint – tests the generic polygon path. */
function buildOfficeBlock(ctx: WorldContext, block: Block, props: PropInstancer, rng: Random): void {
  const x0 = block.x0 + SIDEWALK + 2;
  const z0 = block.z0 + SIDEWALK + 2;
  const x1 = block.x1 - SIDEWALK - 2;
  const z1 = block.z1 - SIDEWALK - 2;
  const L = normalizePolygon(
    [
      [x0, z0],
      [x1, z0],
      [x1, z0 + 22],
      [x0 + 24, z0 + 22],
      [x0 + 24, z1],
      [x0, z1],
    ].map(([x, z]) => new THREE.Vector2(x, z)),
  );
  addBuilding(ctx, { footprint: L, levels: 9, style: getFacadeStyle('buero-glas') });
  // Small pocket park in the inner corner
  addFlatSurface(ctx, rect(x0 + 28, z0 + 26, x1, z1), CURB_HEIGHT + 0.01, 'grass');
  for (let i = 0; i < 6; i++) {
    props.place('tree', new THREE.Vector3(rng.range(x0 + 31, x1 - 3), CURB_HEIGHT, rng.range(z0 + 29, z1 - 3)), rng.range(0, 6.28), rng.range(0.85, 1.2), foliage(rng));
  }
  props.place('bench', new THREE.Vector3(x0 + 32, CURB_HEIGHT, z1 - 1.5), Math.PI);
  props.place('bench', new THREE.Vector3(x0 + 38, CURB_HEIGHT, z1 - 1.5), Math.PI);
}

// ---------------------------------------------------------------- plaza

function buildPlaza(ctx: WorldContext, block: Block, props: PropInstancer, rng: Random): void {
  addClockTower(ctx, block.x1 - 16, block.z0 + 15);
  addFountain(ctx, -6, -2);
  addPosterColumn(ctx, 7, 20);

  // Ring of trees with benches facing the fountain
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const r = 17;
    const x = -6 + Math.cos(a) * r;
    const z = -2 + Math.sin(a) * r;
    if (x > block.x1 - 26 && z < block.z0 + 26) continue; // keep the tower forecourt open
    props.place('tree', new THREE.Vector3(x, CURB_HEIGHT, z), rng.range(0, 6.28), rng.range(0.9, 1.15), foliage(rng));
    const ba = a + Math.PI / 10;
    const bx = -6 + Math.cos(ba) * (r - 1);
    const bz = -2 + Math.sin(ba) * (r - 1);
    // Bench front faces +Z locally; rotate to face the fountain.
    props.place('bench', new THREE.Vector3(bx, CURB_HEIGHT, bz), Math.atan2(-6 - bx, -2 - bz));
  }
  // Bollards along the plaza edges
  for (let x = block.x0 + 3; x <= block.x1 - 3; x += 6) {
    props.place('bollard', new THREE.Vector3(x, CURB_HEIGHT, block.z0 + 0.6));
    props.place('bollard', new THREE.Vector3(x, CURB_HEIGHT, block.z1 - 0.6));
  }
}

// ---------------------------------------------------------------- props

function createPropInstancer(ctx: WorldContext): PropInstancer {
  const m = ctx.materials;
  const phys = ctx.physics;
  const cylinder = (height: number, radius: number) => (pos: THREE.Vector3, scale: number) =>
    phys.addStaticCylinder(pos.clone().setY(pos.y + (height * scale) / 2), (height * scale) / 2, radius * scale);
  const props = new PropInstancer();
  props.define('lamp', Models.streetLamp(), [m.color('#2e3437', 0.45, 0.6), m.color('#fff4da', 0.3)], cylinder(5.6, 0.13));
  props.define('tree', Models.tree(42), [m.color('#5b4636', 0.9), m.color('#5d8a3c', 0.85)], cylinder(3.2, 0.25));
  props.define('bench', Models.bench(), [m.color('#2e3437', 0.5, 0.5), m.color('#9a6a43', 0.7)]);
  props.define('bollard', Models.bollard(), [m.color('#3a4246', 0.45, 0.6)], cylinder(0.9, 0.1));
  return props;
}

function foliage(rng: Random): THREE.Color {
  // Subtle per-tree variation; multiplies the foliage (and barely the trunk) colour.
  return new THREE.Color().setHSL(0.24 + rng.range(-0.04, 0.05), 0.35 + rng.range(0, 0.3), 0.75 + rng.range(-0.08, 0.12));
}

/** The two inner east–west streets are tree-lined avenues. */
function isAvenue(roadZ: number): boolean {
  return roadZ === ROADS_Z[1] || roadZ === ROADS_Z[2];
}

/** Lamps every ~24 m along each curb, street trees on the main east–west streets. */
function placeStreetFurniture(block: Block, props: PropInstancer, rng: Random, isPlaza: boolean): void {
  const inset = 0.9;
  const edges: { a: THREE.Vector2; b: THREE.Vector2; toRoad: THREE.Vector2; avenue: boolean }[] = [
    { a: new THREE.Vector2(block.x0, block.z0), b: new THREE.Vector2(block.x1, block.z0), toRoad: new THREE.Vector2(0, -1), avenue: isAvenue(block.z0 - ROAD_WIDTH / 2) },
    { a: new THREE.Vector2(block.x0, block.z1), b: new THREE.Vector2(block.x1, block.z1), toRoad: new THREE.Vector2(0, 1), avenue: isAvenue(block.z1 + ROAD_WIDTH / 2) },
    { a: new THREE.Vector2(block.x0, block.z0), b: new THREE.Vector2(block.x0, block.z1), toRoad: new THREE.Vector2(-1, 0), avenue: false },
    { a: new THREE.Vector2(block.x1, block.z0), b: new THREE.Vector2(block.x1, block.z1), toRoad: new THREE.Vector2(1, 0), avenue: false },
  ];
  for (const e of edges) {
    const len = e.a.distanceTo(e.b);
    const dir = e.b.clone().sub(e.a).normalize();
    const n = Math.max(1, Math.round((len - 16) / 24));
    const step = (len - 16) / n;
    const rotY = Math.atan2(e.toRoad.x, e.toRoad.y);
    for (let i = 0; i <= n; i++) {
      const p = e.a.clone().addScaledVector(dir, 8 + i * step).addScaledVector(e.toRoad, -inset);
      props.place('lamp', new THREE.Vector3(p.x, CURB_HEIGHT, p.y), rotY);
      if (e.avenue && !isPlaza && i < n) {
        const t = e.a.clone().addScaledVector(dir, 8 + (i + 0.5) * step).addScaledVector(e.toRoad, -1.8);
        props.place('tree', new THREE.Vector3(t.x, CURB_HEIGHT, t.y), rng.range(0, 6.28), rng.range(0.75, 0.95), foliage(rng));
      }
    }
  }
}

function planCourtyardTrees(block: Block, props: PropInstancer, rng: Random): void {
  const cx = (block.x0 + block.x1) / 2;
  const cz = (block.z0 + block.z1) / 2;
  const count = rng.int(2, 4);
  for (let i = 0; i < count; i++) {
    props.place('tree', new THREE.Vector3(cx + rng.range(-10, 10), CURB_HEIGHT, cz + rng.range(-6, 6)), rng.range(0, 6.28), rng.range(0.9, 1.25), foliage(rng));
  }
}

function buildRiverside(ctx: WorldContext, props: PropInstancer): void {
  const tz0 = ROADS_Z[0] - ROAD_WIDTH / 2;
  const tz1 = ROADS_Z[3] + ROAD_WIDTH / 2;
  const x = RIVER.quayX + 0.35;
  // Railing: posts (instanced) + continuous rail; invisible collider keeps the player out of the river.
  const metal = ctx.materials.color('#2e3437', 0.45, 0.6);
  const railLen = WORLD_EDGE * 2;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, railLen), metal);
  rail.position.set(x, CURB_HEIGHT + 1.05, 0);
  rail.castShadow = true;
  ctx.root.add(rail);
  const rail2 = rail.clone();
  rail2.position.y = CURB_HEIGHT + 0.55;
  ctx.root.add(rail2);
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 1.1, 0.07), metal, Math.floor(railLen / 2.5));
  const m = new THREE.Matrix4();
  for (let i = 0; i < post.count; i++) post.setMatrixAt(i, m.makeTranslation(x, CURB_HEIGHT + 0.55, -WORLD_EDGE + i * 2.5));
  post.castShadow = true;
  ctx.root.add(post);
  ctx.physics.addStaticBox(new THREE.Vector3(x, 1.2, 0), new THREE.Vector3(0.15, 1.2, WORLD_EDGE));

  for (let z = tz0 + 6; z < tz1; z += 18) {
    props.place('lamp', new THREE.Vector3(RIVER.quayX + 1.2, CURB_HEIGHT, z), -Math.PI / 2);
    props.place('bench', new THREE.Vector3(RIVER.quayX + 2.2, CURB_HEIGHT, z + 9), -Math.PI / 2);
  }
}

function buildParks(props: PropInstancer, rng: Random): void {
  const placeCluster = (cx: number, cz: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      props.place('tree', new THREE.Vector3(cx + rng.range(-spread, spread), 0, cz + rng.range(-spread, spread)), rng.range(0, 6.28), rng.range(1, 1.6), foliage(rng));
    }
  };
  for (let i = 0; i < 18; i++) {
    const side = i % 3;
    const cx = side === 0 ? rng.range(160, 380) : rng.range(-130, 300);
    const cz = side === 1 ? rng.range(-380, -150) : side === 2 ? rng.range(150, 380) : rng.range(-120, 120);
    placeCluster(cx, cz, rng.int(4, 9), 16);
  }
  // Far bank tree line
  for (let z = -400; z < 400; z += 14) {
    props.place('tree', new THREE.Vector3(RIVER.farBankX - 8 - rng.range(0, 10), 0, z + rng.range(-4, 4)), rng.range(0, 6.28), rng.range(1.1, 1.6), foliage(rng));
  }
}
