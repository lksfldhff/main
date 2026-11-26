import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { InteractionSystem, Interactable } from '../gameplay/InteractionSystem';
import { Vehicle, type DriveInput } from './Vehicle';
import { CAR_PAINTS, CAR_SPECS, type CarType } from './CarModel';
import { CAR_MODEL_FILES, applyCarTemplate, loadCarTemplate } from './CarModelGltf';
import { Random } from '../utils/random';

/** Parked vehicles farther than this from the camera are hidden (m). */
const HIDE_DISTANCE = 300;

export interface VehicleSpawn {
  position: THREE.Vector3;
  yaw: number;
  type?: CarType;
  paint?: string;
}

/** Owns all cars: spawning, physics stepping, rendering and enter/exit interactions. */
export class VehicleManager {
  readonly vehicles: Vehicle[] = [];
  private readonly interactables = new Map<Vehicle, Interactable>();
  private active: Vehicle | null = null;
  private readonly rng = new Random(2025);
  private featuredPlaced = false;
  private readonly viewer = new THREE.Vector3();
  private viewerKnown = false;
  /** Set by the game when the player presses "enter" next to a car. */
  onEnterRequest: ((v: Vehicle) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly interactions: InteractionSystem,
  ) {
    // The render camera is only known to the renderer: remember its position each frame for the
    // distance culling below (Scene.onBeforeRender runs before frustum culling).
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (...args: Parameters<THREE.Scene['onBeforeRender']>) => {
      prev.apply(scene, args);
      args[2].getWorldPosition(this.viewer);
      this.viewerKnown = true;
    };
  }

  get current(): Vehicle | null {
    return this.active;
  }

  spawn(s: VehicleSpawn): Vehicle {
    const types: CarType[] = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv_model', 'van', 'taxi', 'sedan', 'suv_model', 'hatch', 'police'];
    // Spawns arrive sorted by distance to the player spawn (the first one is the starter car):
    // the nearest car without a fixed type becomes the detailed City SUV, so it is easy to find.
    let type = s.type;
    let paint = s.paint;
    if (!type && !this.featuredPlaced) {
      this.featuredPlaced = true;
      type = 'suv_model';
      paint ??= '#1f3550';
    }
    type ??= this.rng.pick(types);
    paint ??= type === 'taxi' ? '#efe6cf' : type === 'police' ? '#d6d9dc' : this.rng.pick(CAR_PAINTS);
    const v = new Vehicle(this.physics, CAR_SPECS[type], paint, s.position, s.yaw);
    this.scene.add(v.model.root);
    if (CAR_MODEL_FILES[type]) {
      // Detailed GLB model: swapped in asynchronously, the procedural model stays as fallback.
      const carPaint = paint;
      void loadCarTemplate(type).then((tpl) => {
        if (tpl) applyCarTemplate(v.model, tpl, v.spec, carPaint);
      });
    }
    this.vehicles.push(v);
    const item: Interactable = {
      position: new THREE.Vector3(),
      radius: 2.6,
      prompt: 'Einsteigen',
      onInteract: () => this.onEnterRequest?.(v),
    };
    this.interactables.set(v, item);
    this.interactions.register(item);
    return v;
  }

  setActive(v: Vehicle | null): void {
    if (this.active) this.active.driven = false;
    this.active = v;
    if (v) {
      v.driven = true;
      v.body.wakeUp();
    }
    for (const item of this.interactables.values()) item.radius = v ? 0 : 2.6;
  }

  fixedUpdate(dt: number, input: DriveInput | null): void {
    for (const v of this.vehicles) v.fixedUpdate(dt, v === this.active ? input : null);
  }

  postStep(): void {
    for (const v of this.vehicles) v.postStep();
  }

  render(alpha: number, dt: number, braking: boolean): void {
    const far2 = HIDE_DISTANCE * HIDE_DISTANCE;
    for (const v of this.vehicles) {
      v.render(alpha, dt, v === this.active && braking);
      // Parked cars far from the camera are not drawn.
      v.model.root.visible = v === this.active || !this.viewerKnown || v.position.distanceToSquared(this.viewer) < far2;
      const item = this.interactables.get(v);
      if (item) {
        v.driverDoor(item.position);
        item.position.y = v.position.y - 0.6;
      }
    }
  }
}
