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

/** Deciduous tree (lime/plane-tree silhouette). Slots: 0 = trunk/branches, 1 = foliage (instance colour varies). */
export function tree(seed: number): THREE.BufferGeometry {
  const rng = new Random(seed);
  const trunk = [part(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 9), 0, 1.8, 0)];
  // A few main branches
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.next();
    const tilt = 0.55 + rng.next() * 0.3;
    trunk.push(part(new THREE.CylinderGeometry(0.05, 0.1, 2.2, 6), Math.sin(a) * 0.55, 4.2, Math.cos(a) * 0.55, Math.cos(a) * tilt, 0, -Math.sin(a) * tilt));
  }
  // Many small, lumpy leaf clusters in an ellipsoid → soft, detailed canopy silhouette.
  const crowns: THREE.BufferGeometry[] = [];
  const count = 13;
  for (let i = 0; i < count; i++) {
    const u = rng.next() * Math.PI * 2;
    const v = Math.acos(rng.range(-0.55, 1));
    const rr = 1.0 + rng.next() * 1.3;
    const x = Math.sin(v) * Math.cos(u) * rr * 1.25;
    const z = Math.sin(v) * Math.sin(u) * rr * 1.25;
    const y = 5.2 + Math.cos(v) * rr * 0.95;
    const ico = new THREE.IcosahedronGeometry(0.85 + rng.next() * 0.55, 1);
    ico.deleteAttribute('normal');
    ico.deleteAttribute('uv');
    const g = mergeVertices(ico);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const sc = 0.8 + rng.next() * 0.35;
      pos.setXYZ(k, pos.getX(k) * sc, pos.getY(k) * sc * 0.85, pos.getZ(k) * sc);
    }
    g.computeVertexNormals();
    // Bend normals outward from the crown centre for soft, volumetric lighting.
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let k = 0; k < nrm.count; k++) {
      const n = new THREE.Vector3(nrm.getX(k), nrm.getY(k), nrm.getZ(k));
      const o = new THREE.Vector3(pos.getX(k) + x, pos.getY(k) + y - 5.2, pos.getZ(k) + z).normalize();
      n.lerp(o, 0.6).normalize();
      nrm.setXYZ(k, n.x, n.y, n.z);
    }
    const flat = g.toNonIndexed();
    flat.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(flat.getAttribute('position').count * 2), 2));
    flat.translate(x, y, z);
    crowns.push(flat);
  }
  return merge([trunk, crowns]);
}

/** German traffic light on a pole. Slots: 0 = pole, 1 = housing, 2 = red lens (lit), 3 = dark lenses. Faces +Z. */
export function trafficLight(): THREE.BufferGeometry {
  const pole = [part(new THREE.CylinderGeometry(0.06, 0.07, 3.3, 10), 0, 1.65, 0)];
  const housing = [
    part(new THREE.BoxGeometry(0.32, 0.95, 0.24), 0, 2.85, 0.12),
    part(new THREE.BoxGeometry(0.5, 1.1, 0.03), 0, 2.85, -0.01),
  ];
  const red = [part(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), 0, 3.15, 0.25, Math.PI / 2)];
  const dark = [
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), 0, 2.85, 0.25, Math.PI / 2),
    part(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), 0, 2.55, 0.25, Math.PI / 2),
  ];
  return merge([pole, housing, red, dark]);
}

/** Bus stop pole with the round German "H" sign. Slots: 0 = pole, 1 = sign (textured). */
export function busStop(): THREE.BufferGeometry {
  const pole = [part(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), 0, 1.3, 0)];
  const sign = new THREE.CylinderGeometry(0.28, 0.28, 0.03, 24);
  sign.rotateX(Math.PI / 2);
  sign.translate(0, 2.5, 0.03);
  return merge([pole, [sign.index ? sign.toNonIndexed() : sign]]);
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
