import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { CarModel, CarSpec, CarType } from './CarModel';
import { loadGltf } from '../assets/loadGltf';

/**
 * Optional detailed car models (GLB, built by tools/assets/convert_vehicle.py). Not part of the
 * repository (licensed assets); when a file is missing the procedural model simply stays.
 *
 * Expected GLB layout: node "body" plus wheel nodes "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"
 * (origin at the hub), forward = +Z, left = +X, ground at y = 0, metres. Material names used by
 * the game: "paint" (recoloured per car), "taillight" (brake lights), "headlight", "glass".
 */
export const CAR_MODEL_FILES: Partial<Record<CarType, string>> = {
  suv_model: 'models/vehicles/city_suv.glb',
};

/** Optional low-detail variants (same node layout) shown beyond LOD1_DISTANCE. */
export const CAR_MODEL_LOD1_FILES: Partial<Record<CarType, string>> = {
  suv_model: 'models/vehicles/city_suv_lod1.glb',
};
const LOD1_DISTANCE = 30;

export interface CarTemplate {
  body: THREE.Object3D;
  /** FL, FR, RL, RR (same order as CarModel.wheels). */
  wheels: THREE.Object3D[];
  wheelbase: number;
  wheelRadius: number;
}

const WHEEL_NODES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const cache = new Map<string, Promise<CarTemplate | null>>();
let loader: GLTFLoader | null = null;

/** Loads (once) and caches a car template; resolves to null when the file is missing or invalid. */
export function loadCarTemplate(type: CarType, lod: 0 | 1 = 0): Promise<CarTemplate | null> {
  const file = (lod === 1 ? CAR_MODEL_LOD1_FILES : CAR_MODEL_FILES)[type];
  if (!file) return Promise.resolve(null);
  const url = `${import.meta.env.BASE_URL}${file}`;
  let p = cache.get(url);
  if (!p) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    p = loadGltf(loader, url)
      .then((gltf) => toTemplate(gltf.scene))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

function toTemplate(scene: THREE.Object3D): CarTemplate | null {
  const body = scene.getObjectByName('body');
  const wheels = WHEEL_NODES.map((n) => scene.getObjectByName(n));
  if (!body || wheels.some((w) => !w)) {
    console.warn('Car model: expected nodes body + wheel_fl/fr/rl/rr – using the procedural car');
    return null;
  }
  const [fl, fr, rl, rr] = wheels as THREE.Object3D[];
  const wheelbase = (fl.position.z + fr.position.z - rl.position.z - rr.position.z) / 2;
  const box = new THREE.Box3().setFromObject(fl);
  const wheelRadius = (box.max.y - box.min.y) / 2;
  if (!(wheelbase > 0.5) || !(wheelRadius > 0.1)) return null;
  return { body, wheels: wheels as THREE.Object3D[], wheelbase, wheelRadius };
}

/**
 * Replaces the procedural meshes of `model` with the template's (scaled so the wheelbase matches
 * the physics spec). Keeps the model's groups, so the vehicle code and anything attached to the
 * body (e.g. the seated player) are unaffected.
 */
export function applyCarTemplate(model: CarModel, tpl: CarTemplate, spec: CarSpec, paintHex: string, far: CarTemplate | null = null): void {
  const s = spec.wheelbase / tpl.wheelbase;

  // --- Body
  for (const child of [...model.body.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    model.body.remove(mesh);
    mesh.geometry.dispose();
  }
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  let taillight: THREE.MeshStandardMaterial | null = null;
  const prepare = (src: THREE.Object3D, scale: number, shadows: boolean): THREE.Object3D => {
    const obj = src.clone(true);
    obj.scale.multiplyScalar(scale);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const name = mat.name ?? '';
      if (name === 'paint') mesh.material = paint;
      else if (name === 'taillight') {
        taillight ??= Object.assign(mat.clone(), { emissive: new THREE.Color(1, 0.05, 0.02) });
        mesh.material = taillight;
      } else if (name === 'headlight') {
        mat.emissiveIntensity = 2;
      }
      const transparent = (mesh.material as THREE.Material).transparent;
      mesh.castShadow = shadows && !transparent;
      mesh.receiveShadow = !transparent;
    });
    return obj;
  };
  const withLod = (near: THREE.Object3D, farObj: THREE.Object3D | null): THREE.Object3D => {
    if (!farObj) return near;
    const lod = new THREE.LOD();
    lod.addLevel(near, 0);
    lod.addLevel(farObj, LOD1_DISTANCE);
    return lod;
  };
  const sFar = far ? spec.wheelbase / far.wheelbase : 1;
  model.body.add(withLod(prepare(tpl.body, s, true), far ? prepare(far.body, sFar, true) : null));
  if (taillight) model.brakeLights = taillight;

  // --- Wheels: keep the pivot (steer) / spin groups, swap their meshes.
  const ws = spec.wheelRadius / tpl.wheelRadius;
  tpl.wheels.forEach((src, i) => {
    const pivot = model.wheels[i];
    const spin = pivot.children[0];
    if (!pivot || !spin) return;
    for (const child of [...spin.children]) {
      spin.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    const wheel = prepare(src, ws, true);
    wheel.position.set(0, 0, 0);
    let farWheel: THREE.Object3D | null = null;
    if (far) {
      farWheel = prepare(far.wheels[i], spec.wheelRadius / far.wheelRadius, false);
      farWheel.position.set(0, 0, 0);
    }
    spin.add(withLod(wheel, farWheel));
    pivot.position.x = src.position.x * s;
    pivot.position.z = src.position.z * s;
  });
}
