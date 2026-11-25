import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';

interface PropType {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  castShadow: boolean;
  collider?: PropCollider;
}

/** Called once per placed instance to create its physics collider. */
export type PropCollider = (position: THREE.Vector3, scale: number) => void;

/**
 * Collects prop placements and turns each prop type into one InstancedMesh
 * (one draw call per material slot regardless of how many lamps/trees exist).
 */
export class PropInstancer {
  private types = new Map<string, PropType>();

  define(name: string, geometry: THREE.BufferGeometry, materials: THREE.Material[], collider?: PropCollider): void {
    this.types.set(name, { geometry, materials, matrices: [], colors: [], castShadow: true, collider });
  }

  place(name: string, position: THREE.Vector3, rotationY = 0, scale = 1, color?: THREE.Color): void {
    const type = this.types.get(name);
    if (!type) throw new Error(`Unknown prop type ${name}`);
    const m = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
      new THREE.Vector3(scale, scale, scale),
    );
    type.matrices.push(m);
    type.colors.push(color ?? new THREE.Color(1, 1, 1));
    type.collider?.(position, scale);
  }

  build(ctx: WorldContext): void {
    for (const [name, type] of this.types) {
      if (type.matrices.length === 0) continue;
      const mesh = new THREE.InstancedMesh(type.geometry, type.materials, type.matrices.length);
      mesh.name = `props:${name}`;
      type.matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, type.colors[i]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = type.castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      ctx.root.add(mesh);
    }
  }
}
