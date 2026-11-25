import type * as THREE from 'three';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MeshBatcher } from './geometry/MeshBatcher';
import type { InteractionSystem } from '../gameplay/InteractionSystem';
import type { EventBus, GameEvents } from '../core/EventBus';

/** Everything a world builder needs – passed around instead of global singletons. */
export interface WorldContext {
  scene: THREE.Scene;
  root: THREE.Group;
  materials: MaterialLibrary;
  physics: PhysicsWorld;
  /** Static geometry that casts and receives shadows (buildings, props). */
  solids: MeshBatcher;
  /** Flat ground surfaces that only receive shadows. */
  surfaces: MeshBatcher;
  interactions: InteractionSystem;
  events: EventBus<GameEvents>;
}
