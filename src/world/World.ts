import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { EventBus, GameEvents } from '../core/EventBus';
import type { InteractionSystem } from '../gameplay/InteractionSystem';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MaterialLibrary } from '../rendering/MaterialLibrary';
import { MeshBatcher } from './geometry/MeshBatcher';
import type { WorldContext } from './WorldContext';
import type { District } from './District';
import { buildTestDistrict } from './districts/TestDistrict';
import { buildHeilbronnDistrict } from './heilbronn/HeilbronnDistrict';

export type DistrictId = 'heilbronn' | 'test';

/**
 * Owns all static world content. The district is selectable (URL `?world=test` loads the
 * procedural Phase 1 test grid); the default is the real Heilbronn city centre.
 */
export class World {
  private constructor(
    readonly district: District,
    readonly root: THREE.Group,
  ) {}

  static async create(
    id: DistrictId,
    scene: THREE.Scene,
    materials: MaterialLibrary,
    physics: PhysicsWorld,
    interactions: InteractionSystem,
    events: EventBus<GameEvents>,
    onProgress?: (text: string) => void,
    textureSize = 1024,
  ): Promise<World> {
    const root = new THREE.Group();
    root.name = 'world';
    scene.add(root);
    const ctx: WorldContext = {
      scene,
      root,
      materials,
      physics,
      interactions,
      events,
      solids: new MeshBatcher(CONFIG.world.chunkSize),
      surfaces: new MeshBatcher(CONFIG.world.chunkSize),
    };

    const district = id === 'test' ? buildTestDistrict(ctx) : await buildHeilbronnDistrict(ctx, onProgress, textureSize);

    root.add(ctx.solids.build({ castShadow: true, receiveShadow: true }));
    root.add(ctx.surfaces.build({ castShadow: false, receiveShadow: true }));
    physics.refreshQueries();

    return new World(district, root);
  }
}
