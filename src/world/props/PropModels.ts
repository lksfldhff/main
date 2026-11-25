import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random } from '../../utils/random';

/**
 * Low-poly prop geometries, built once and drawn via instancing.
 * Each model is a single geometry with material groups (index = material slot).
 */

function part(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  geo.rotateX(rx);
  geo.rotateY(ry);
  geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo.index ? geo.toNonIndexed() : geo;
}

function merge(groups: THREE.BufferGeometry[][]): THREE.BufferGeometry {
  const perMaterial = groups.map((parts) => mergeGeometries(parts.map((g) => stripAttributes(g)), false)!);
  const merged = mergeGeometries(perMaterial, true)!;
  merged.computeBoundingSphere();
  return merged;
}

function stripAttributes(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  return g;
}

/** Street lamp, ~5.6 m. Slots: 0 = metal, 1 = lamp glass. Arm points to +Z (towards the road). */
export function streetLamp(): THREE.BufferGeometry {
  const metal = [
    part(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 10), 0, 0.25, 0),
    part(new THREE.CylinderGeometry(0.06, 0.08, 5.4, 10), 0, 2.9, 0),
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), 0, 5.55, 0.5, Math.PI / 2),
    part(new THREE.BoxGeometry(0.42, 0.12, 0.7), 0, 5.55, 1.05),
  ];
  const glass = [part(new THREE.BoxGeometry(0.34, 0.06, 0.58), 0, 5.47, 1.05)];
  return merge([metal, glass]);
}

/** Deciduous tree. Slots: 0 = trunk, 1 = foliage (instance colour varies). */
export function tree(seed: number): THREE.BufferGeometry {
  const rng = new Random(seed);
  const trunk = [
    part(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 8), 0, 1.6, 0),
    part(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 6), 0.35, 3.3, 0, 0, 0, -0.5),
  ];
  const crowns: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 4.6, 0, 1.9],
    [0.9, 4.1, 0.5, 1.35],
    [-0.8, 4.3, -0.4, 1.4],
    [0.2, 5.6, -0.3, 1.25],
  ];
  for (const [x, y, z, r] of blobs) {
    // Welded sphere with lumpy displacement + smooth normals → soft, painterly canopy.
    const ico = new THREE.IcosahedronGeometry(r * (0.9 + rng.next() * 0.2), 1);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const g = mergeVertices(ico);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const s = 0.85 + rng.next() * 0.25;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.88, pos.getZ(i) * s);
    }
    g.computeVertexNormals();
    const flat = g.toNonIndexed();
    flat.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(flat.getAttribute('position').count * 2), 2));
    crowns.push(part(flat, x, y, z));
  }
  return merge([trunk, crowns]);
}

/** Park bench, 1.8 m. Slots: 0 = metal frame, 1 = wood. */
export function bench(): THREE.BufferGeometry {
  const metal = [
    part(new THREE.BoxGeometry(0.06, 0.45, 0.5), -0.75, 0.225, 0),
    part(new THREE.BoxGeometry(0.06, 0.45, 0.5), 0.75, 0.225, 0),
    part(new THREE.BoxGeometry(0.06, 0.5, 0.06), -0.75, 0.7, -0.22),
    part(new THREE.BoxGeometry(0.06, 0.5, 0.06), 0.75, 0.7, -0.22),
  ];
  const wood: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) wood.push(part(new THREE.BoxGeometry(1.8, 0.04, 0.13), 0, 0.47, -0.16 + i * 0.16));
  for (let i = 0; i < 2; i++) wood.push(part(new THREE.BoxGeometry(1.8, 0.11, 0.035), 0, 0.68 + i * 0.16, -0.25, -0.15));
  return merge([metal, wood]);
}

/** Short bollard. Slots: 0 = metal. */
export function bollard(): THREE.BufferGeometry {
  return merge([[part(new THREE.CylinderGeometry(0.09, 0.1, 0.9, 10), 0, 0.45, 0), part(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.9, 0)]]);
}
