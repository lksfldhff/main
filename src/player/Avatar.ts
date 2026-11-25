import type * as THREE from 'three';

/** Visual representation of the player (procedural placeholder or rigged model). */
export interface Avatar {
  readonly object: THREE.Object3D;
  /** @param speed horizontal speed in m/s */
  update(dt: number, position: THREE.Vector3, facing: number, speed: number, grounded: boolean): void;
}
