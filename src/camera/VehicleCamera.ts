import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { clamp, damp, angleDelta } from '../utils/math';

/**
 * Chase camera for driving: follows behind the car with a little lag, swings into turns,
 * pulls back and widens the FOV with speed. The mouse can orbit; after a short pause the
 * camera returns behind the car.
 */
export class VehicleCamera {
  private yaw = 0;
  private pitch = 0.18;
  private orbitYaw = 0;
  private idle = 0;
  private distance = 6.8;
  private readonly target = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
  ) {}

  reset(heading: number, target: THREE.Vector3): void {
    this.yaw = heading;
    this.orbitYaw = 0;
    this.target.copy(target);
    this.initialized = true;
  }

  applyLook(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    if (dx !== 0 || dy !== 0) this.idle = 0;
    this.orbitYaw -= dx * 0.0022 * sensitivity;
    this.pitch = clamp(this.pitch + dy * 0.0022 * sensitivity * (invertY ? -1 : 1), -0.1, 0.9);
  }

  update(dt: number, carPos: THREE.Vector3, heading: number, speed: number, baseFov: number, exclude?: RAPIER.Collider): void {
    if (!this.initialized) this.reset(heading, carPos);
    this.idle += dt;
    if (this.idle > 1.5) {
      this.orbitYaw += angleDelta(this.orbitYaw, 0) * damp(2.5, dt);
      this.pitch += (0.18 - this.pitch) * damp(1.5, dt);
    }
    // Follow the car heading (reverse: keep looking forward).
    this.yaw += angleDelta(this.yaw, heading) * damp(speed < -2 ? 1 : 4.5, dt);
    this.target.lerp(carPos, damp(14, dt));

    const abs = Math.abs(speed);
    const wantDist = 6.6 + Math.min(abs, 40) * 0.045;
    this.distance += (wantDist - this.distance) * damp(2, dt);

    const yaw = this.yaw + this.orbitYaw + Math.PI;
    const cp = Math.cos(this.pitch);
    // Car forward is +Z at heading 0, so "behind" = heading + π.
    this.dir.set(Math.sin(yaw) * cp, Math.sin(this.pitch), Math.cos(yaw) * cp).normalize();
    const pivot = this.target.clone().setY(this.target.y + 1.3);
    let dist = this.distance;
    const hit = this.physics.castRay(pivot, this.dir, dist + 0.3, exclude);
    if (hit) dist = Math.max(1.5, hit.distance - 0.3);
    this.camera.position.copy(pivot).addScaledVector(this.dir, dist);
    this.camera.lookAt(pivot.x, pivot.y + 0.3, pivot.z);

    const fov = baseFov + Math.min(abs, 45) * 0.28;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * damp(3, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
