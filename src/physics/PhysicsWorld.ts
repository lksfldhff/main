import RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';

export type RapierModule = typeof RAPIER;

export interface RayHit {
  distance: number;
  collider: RAPIER.Collider;
}

/**
 * Thin wrapper around the Rapier world. Keeps all physics-engine specifics in one place
 * so gameplay code only deals with simple helper calls.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  /** A single fixed body that owns all static level geometry colliders. */
  private readonly staticBody: RAPIER.RigidBody;

  private constructor(readonly rapier: RapierModule, gravityY: number) {
    this.world = new rapier.World({ x: 0, y: gravityY, z: 0 });
    this.staticBody = this.world.createRigidBody(rapier.RigidBodyDesc.fixed());
  }

  /** Loads the WASM module (inlined by the -compat package) and creates the world. */
  static async create(gravityY: number): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(RAPIER, gravityY);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Recomputes query acceleration structures after bulk-adding colliders (before the first step). */
  refreshQueries(): void {
    // A regular (empty) step updates the broad phase used by scene queries.
    this.step(1 / 60);
  }

  addStaticBox(center: Vector3, halfExtents: Vector3, rotationY = 0): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setTranslation(
      center.x,
      center.y,
      center.z,
    );
    if (rotationY !== 0) {
      const s = Math.sin(rotationY / 2);
      desc.setRotation({ x: 0, y: s, z: 0, w: Math.cos(rotationY / 2) });
    }
    return this.world.createCollider(desc, this.staticBody);
  }

  addStaticCylinder(center: Vector3, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.cylinder(halfHeight, radius).setTranslation(center.x, center.y, center.z);
    return this.world.createCollider(desc, this.staticBody);
  }

  addStaticTrimesh(vertices: Float32Array, indices: Uint32Array): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.trimesh(vertices, indices);
    return this.world.createCollider(desc, this.staticBody);
  }

  /** Casts a ray and returns the closest hit within `maxDistance`, optionally ignoring one collider. */
  castRay(origin: Vector3, direction: Vector3, maxDistance: number, exclude?: RAPIER.Collider): RayHit | null {
    const ray = new this.rapier.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, exclude);
    return hit ? { distance: hit.timeOfImpact, collider: hit.collider } : null;
  }
}
