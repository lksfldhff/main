import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { InteractionSystem } from '../gameplay/InteractionSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import { MeshBatcher } from './geometry/MeshBatcher';
import type { WorldContext } from './WorldContext';
import { buildTestDistrict, type DistrictInfo } from './districts/TestDistrict';

/**
 * Owns all static world content. Phase 1 builds the procedural test district;
 * Phase 2 swaps in an OSM-based district loader behind the same interface.
 */
export class World {
  readonly root = new THREE.Group();
  readonly info: DistrictInfo;

  constructor(
    scene: THREE.Scene,
    materials: MaterialLibrary,
    physics: PhysicsWorld,
    interactions: InteractionSystem,
    events: EventBus<GameEvents>,
  ) {
    this.root.name = 'world';
    scene.add(this.root);

    const ctx: WorldContext = {
      scene,
      root: this.root,
      materials,
      physics,
      interactions,
      events,
      solids: new MeshBatcher(CONFIG.world.chunkSize),
      surfaces: new MeshBatcher(CONFIG.world.chunkSize),
    };

    this.info = buildTestDistrict(ctx);

    this.root.add(ctx.solids.build({ castShadow: true, receiveShadow: true }));
    this.root.add(ctx.surfaces.build({ castShadow: false, receiveShadow: true }));
    physics.refreshQueries();
  }
}
