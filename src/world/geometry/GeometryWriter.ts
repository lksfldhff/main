import * as THREE from 'three';

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Accumulates flat-shaded, non-indexed triangles. Every triangle is given an expected
 * facing direction and is flipped automatically if needed, which keeps procedural
 * generators free of winding-order bugs.
 */
export class GeometryWriter {
  private positions: number[] = [];
  private uvs: number[] = [];

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  triangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ua: THREE.Vector2,
    ub: THREE.Vector2,
    uc: THREE.Vector2,
    facing: THREE.Vector3,
  ): void {
    _ab.subVectors(b, a);
    _ac.subVectors(c, a);
    _n.crossVectors(_ab, _ac);
    if (_n.lengthSq() < 1e-12) return; // degenerate
    if (_n.dot(facing) < 0) {
      [b, c] = [c, b];
      [ub, uc] = [uc, ub];
    }
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.uvs.push(ua.x, ua.y, ub.x, ub.y, uc.x, uc.y);
  }

  /** Quad a-b-c-d (in order around the perimeter). */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    ua: THREE.Vector2,
    ub: THREE.Vector2,
    uc: THREE.Vector2,
    ud: THREE.Vector2,
    facing: THREE.Vector3,
  ): void {
    this.triangle(a, b, c, ua, ub, uc, facing);
    this.triangle(a, c, d, ua, uc, ud, facing);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.computeVertexNormals();
    return geo;
  }
}

export const UP = new THREE.Vector3(0, 1, 0);
export const DOWN = new THREE.Vector3(0, -1, 0);

export function v3(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

export function v2(x: number, y: number): THREE.Vector2 {
  return new THREE.Vector2(x, y);
}
