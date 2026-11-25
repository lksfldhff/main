import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { InteractionSystem, Interactable } from '../gameplay/InteractionSystem';
import { Vehicle, type DriveInput } from './Vehicle';
import { CAR_PAINTS, CAR_SPECS, type CarType } from './CarModel';
import { Random } from '../utils/random';

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
  /** Set by the game when the player presses "enter" next to a car. */
  onEnterRequest: ((v: Vehicle) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly interactions: InteractionSystem,
  ) {}

  get current(): Vehicle | null {
    return this.active;
  }

  spawn(s: VehicleSpawn): Vehicle {
    const types: CarType[] = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'van', 'taxi', 'sedan', 'hatch', 'police'];
    const type = s.type ?? this.rng.pick(types);
    const paint = s.paint ?? (type === 'taxi' ? '#efe6cf' : type === 'police' ? '#d6d9dc' : this.rng.pick(CAR_PAINTS));
    const v = new Vehicle(this.physics, CAR_SPECS[type], paint, s.position, s.yaw);
    this.scene.add(v.model.root);
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
    for (const v of this.vehicles) {
      v.render(alpha, dt, v === this.active && braking);
      const item = this.interactables.get(v);
      if (item) {
        v.driverDoor(item.position);
        item.position.y = v.position.y - 0.6;
      }
    }
  }
}
