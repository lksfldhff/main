import * as THREE from 'three';

export type CarType = 'sedan' | 'hatch' | 'suv' | 'van' | 'taxi' | 'police' | 'sport';

export interface CarSpec {
  type: CarType;
  length: number;
  width: number;
  /** Height of the body beltline (bottom of the windows). */
  belt: number;
  /** Roof height. */
  roof: number;
  wheelbase: number;
  wheelRadius: number;
  /** Cabin start/end as fraction of length from the rear (0) to the front (1). */
  cabin: [number, number, number, number]; // rear glass base, roof start, roof end, windshield base
  mass: number;
  enginePower: number;
  maxSpeed: number;
}

export const CAR_SPECS: Record<CarType, CarSpec> = {
  sedan: { type: 'sedan', length: 4.7, width: 1.84, belt: 0.98, roof: 1.46, wheelbase: 2.8, wheelRadius: 0.33, cabin: [0.2, 0.32, 0.6, 0.74], mass: 1450, enginePower: 7500, maxSpeed: 52 },
  hatch: { type: 'hatch', length: 4.1, width: 1.78, belt: 0.98, roof: 1.48, wheelbase: 2.6, wheelRadius: 0.31, cabin: [0.03, 0.12, 0.6, 0.74], mass: 1200, enginePower: 6000, maxSpeed: 46 },
  suv: { type: 'suv', length: 4.65, width: 1.9, belt: 1.12, roof: 1.72, wheelbase: 2.8, wheelRadius: 0.37, cabin: [0.05, 0.12, 0.62, 0.74], mass: 1900, enginePower: 9000, maxSpeed: 48 },
  van: { type: 'van', length: 5.2, width: 1.98, belt: 1.15, roof: 2.15, wheelbase: 3.25, wheelRadius: 0.34, cabin: [0.02, 0.03, 0.8, 0.86], mass: 2300, enginePower: 8500, maxSpeed: 40 },
  taxi: { type: 'taxi', length: 4.85, width: 1.85, belt: 0.98, roof: 1.48, wheelbase: 2.9, wheelRadius: 0.33, cabin: [0.2, 0.32, 0.6, 0.74], mass: 1550, enginePower: 7500, maxSpeed: 50 },
  police: { type: 'police', length: 4.75, width: 1.84, belt: 1.0, roof: 1.5, wheelbase: 2.85, wheelRadius: 0.34, cabin: [0.06, 0.14, 0.6, 0.74], mass: 1600, enginePower: 9500, maxSpeed: 58 },
  sport: { type: 'sport', length: 4.5, width: 1.92, belt: 0.82, roof: 1.25, wheelbase: 2.65, wheelRadius: 0.35, cabin: [0.24, 0.36, 0.58, 0.72], mass: 1400, enginePower: 13000, maxSpeed: 70 },
};

export const CAR_PAINTS = ['#1b1d21', '#e9eaec', '#9da3a8', '#24324d', '#6b1b20', '#3d4a3a', '#c9c3b6', '#5b6168', '#0f3b62', '#7a2c18'];

export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  /** FL, FR, RL, RR wheel pivots (steer around Y, spin around X). */
  wheels: THREE.Group[];
  brakeLights: THREE.MeshStandardMaterial;
  beacon?: THREE.MeshStandardMaterial;
}

const shared = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x141b20, metalness: 0.1, roughness: 0.05, clearcoat: 1, transparent: false }),
  trim: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.1 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.18, metalness: 1 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 0.6, roughness: 0.1 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
};

/** Builds a procedural, realistically proportioned car facing +Z, wheels on y = 0. */
export function createCarModel(spec: CarSpec, paintHex: string): CarModel {
  const { length: L, width: W, belt, roof, wheelbase, wheelRadius: R } = spec;
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: 0.55,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const brakeLights = new THREE.MeshStandardMaterial({ color: 0x8a0c0c, emissive: 0xff1a0a, emissiveIntensity: 0.25, roughness: 0.2 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
    return m;
  };

  // --- Lower body: side profile with wheel arches, extruded across the width with rounded edges.
  const clear = 0.26;
  const zr = -L / 2;
  const zf = L / 2;
  const front = spec.type === 'van' ? 0.1 : 0.32;
  const shape = new THREE.Shape();
  shape.moveTo(zr + 0.12, clear);
  const arch = (zc: number) => {
    shape.lineTo(zc - R - 0.12, clear);
    shape.absarc(zc, clear - 0.02, R + 0.1, Math.PI, 0, true);
  };
  arch(-wheelbase / 2);
  arch(wheelbase / 2);
  shape.lineTo(zf - 0.08, clear);
  shape.quadraticCurveTo(zf + 0.02, clear + 0.05, zf, clear + 0.3);
  shape.quadraticCurveTo(zf, belt - 0.12, zf - front, belt - 0.05);
  shape.lineTo(zr + 0.25, belt);
  shape.quadraticCurveTo(zr, belt - 0.02, zr, belt - 0.25);
  shape.lineTo(zr, clear + 0.2);
  shape.quadraticCurveTo(zr, clear, zr + 0.12, clear);
  const bevel = 0.07;
  const lower = new THREE.ExtrudeGeometry(shape, {
    depth: W - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  lower.rotateY(-Math.PI / 2);
  lower.translate((W - bevel * 2) / 2, 0, 0);
  lower.computeVertexNormals();
  add(lower, paint);

  // --- Cabin (greenhouse): glass volume plus painted pillars and roof panel.
  const [c0, c1, c2, c3] = spec.cabin.map((f) => zr + f * L);
  const gh = new THREE.Shape();
  gh.moveTo(c0, belt - 0.02);
  gh.lineTo(c1, roof - 0.04);
  gh.lineTo(c2, roof - 0.04);
  gh.lineTo(c3, belt - 0.02);
  gh.closePath();
  const gw = W * 0.86;
  const cabin = new THREE.ExtrudeGeometry(gh, { depth: gw - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  cabin.rotateY(-Math.PI / 2);
  cabin.translate((gw - 0.1) / 2, 0, 0);
  add(cabin, shared.glass);
  const roofPanel = new THREE.BoxGeometry(gw - 0.02, 0.06, c2 - c1 + 0.08);
  add(roofPanel, paint, 0, roof - 0.01, (c1 + c2) / 2);
  // B-pillars and C-pillars
  for (const side of [-1, 1]) {
    const x = side * (gw / 2 - 0.01);
    const bz = (c1 + c2) / 2 + (c2 - c1) * 0.08;
    add(new THREE.BoxGeometry(0.06, roof - belt, 0.1), paint, x, (roof + belt) / 2, bz);
    if (spec.type !== 'van') add(new THREE.BoxGeometry(0.06, roof - belt, 0.12), paint, x, (roof + belt) / 2 - 0.02, (c0 + c1) / 2);
    // Mirrors
    add(new THREE.BoxGeometry(0.16, 0.1, 0.12), paint, side * (W / 2 + 0.05), belt + 0.05, c3 - 0.1);
  }

  // --- Details: bumpers, lights, grille, plates, side skirts
  add(new THREE.BoxGeometry(W - 0.06, 0.2, 0.16), shared.trim, 0, clear + 0.12, zf - 0.02);
  add(new THREE.BoxGeometry(W - 0.06, 0.2, 0.16), shared.trim, 0, clear + 0.12, zr + 0.02);
  add(new THREE.BoxGeometry(W * 0.5, 0.14, 0.04), shared.trim, 0, clear + 0.4, zf + 0.01);
  add(new THREE.BoxGeometry(0.52, 0.12, 0.02), shared.plate, 0, clear + 0.14, zf + 0.07);
  add(new THREE.BoxGeometry(0.52, 0.12, 0.02), shared.plate, 0, clear + 0.38, zr - 0.02);
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.42, 0.1, 0.06), shared.head, side * (W / 2 - 0.3), belt - 0.22, zf - 0.04);
    add(new THREE.BoxGeometry(0.4, 0.12, 0.06), brakeLights, side * (W / 2 - 0.28), belt - 0.18, zr - 0.01);
    add(new THREE.BoxGeometry(0.04, 0.08, wheelbase - 2 * R - 0.3), shared.trim, side * (W / 2 + 0.01), clear + 0.04, 0);
    add(new THREE.BoxGeometry(0.02, 0.03, 0.22), shared.chrome, side * (W / 2 + 0.02), belt - 0.18, 0.25);
  }

  // --- Type specific
  let beacon: THREE.MeshStandardMaterial | undefined;
  if (spec.type === 'taxi') {
    const sign = new THREE.MeshStandardMaterial({ color: 0xf6d34a, emissive: 0xffd34a, emissiveIntensity: 0.35, roughness: 0.4 });
    add(new THREE.BoxGeometry(0.5, 0.14, 0.2), sign, 0, roof + 0.1, (c1 + c2) / 2);
  } else if (spec.type === 'police') {
    const blue = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.35, metalness: 0.2 });
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.18, L * 0.78), blue, side * (W / 2 + 0.075), clear + 0.35, 0);
    beacon = new THREE.MeshStandardMaterial({ color: 0x1847ff, emissive: 0x2255ff, emissiveIntensity: 1.5, roughness: 0.2 });
    add(new THREE.BoxGeometry(0.9, 0.1, 0.24), beacon, 0, roof + 0.08, (c1 + c2) / 2);
  } else if (spec.type === 'sport') {
    add(new THREE.BoxGeometry(W * 0.8, 0.04, 0.24), paint, 0, belt + 0.12, zr + 0.18);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.12, 0.05), shared.trim, side * W * 0.3, belt + 0.05, zr + 0.18);
  }

  // --- Wheels
  const wheels: THREE.Group[] = [];
  const track = W / 2 - 0.16;
  const tireGeo = new THREE.CylinderGeometry(R, R, 0.24, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.25, 18);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(R * 0.16, R * 0.16, 0.27, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.26, R * 1.15, 0.05);
  for (const [x, z] of [
    [track, wheelbase / 2],
    [-track, wheelbase / 2],
    [track, -wheelbase / 2],
    [-track, -wheelbase / 2],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    for (const [geo, mat] of [
      [tireGeo, shared.tire],
      [rimGeo, shared.rim],
      [hubGeo, shared.chrome],
    ] as const) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      spin.add(m);
    }
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(spokeGeo, shared.rim);
      s.rotation.x = (k / 3) * Math.PI;
      spin.add(s);
    }
    root.add(pivot);
    wheels.push(pivot);
  }

  return { root, body, wheels, brakeLights, beacon };
}
