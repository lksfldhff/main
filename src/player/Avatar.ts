import type * as THREE from 'three';

/** Visual representation of the player (procedural placeholder or rigged model). */
export interface Avatar {
  readonly object: THREE.Object3D;
  /** @param speed horizontal speed in m/s */
  update(dt: number, position: THREE.Vector3, facing: number, speed: number, grounded: boolean): void;
  /**
   * Optional: shows the avatar sitting in a vehicle. Attaches `object` to `parent` so that the
   * hips end up at `hipPoint` (parent space), facing the parent's +Z. Returns false when the
   * avatar has no seated pose (the caller hides it instead).
   */
  sitIn?(parent: THREE.Object3D, hipPoint: THREE.Vector3): boolean;
  /** Optional: undoes sitIn and re-attaches the avatar to `world`. */
  standUp?(world: THREE.Object3D): void;
}
