import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { clamp, damp } from '../utils/math';

const C = CONFIG.camera;

/**
 * Over-the-shoulder orbit camera:
 *  - mouse controls yaw/pitch, wheel controls distance
 *  - target smoothing (tight horizontally, softer vertically for jumps/steps)
 *  - collision: a ray from the pivot pulls the camera in front of walls
 *  - sprint FOV kick
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.22;
  private distance: number = C.distance;
  private currentDistance: number = C.distance;
  private readonly smoothed = new THREE.Vector3();
  private initialized = false;
  private baseFov: number = C.fov;
  private fovBoost = 0;

  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
  ) {}

  get debugInfo(): string {
    return `yaw ${this.yaw.toFixed(2)} · pitch ${this.pitch.toFixed(2)} · dist ${this.currentDistance.toFixed(1)}`;
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  applyLook(dx: number, dy: number, wheel: number, sensitivity: number, invertY: boolean): void {
    const s = C.baseSensitivity * sensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch + dy * s * (invertY ? -1 : 1), C.minPitch, C.maxPitch);
    if (wheel !== 0) this.distance = clamp(this.distance + wheel * 0.8, C.minDistance, C.maxDistance);
  }

  snapTo(target: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.smoothed.copy(target);
    this.currentDistance = this.distance;
    this.initialized = true;
  }

  update(dt: number, target: THREE.Vector3, sprinting: boolean, exclude?: RAPIER.Collider): void {
    if (!this.initialized) this.snapTo(target, this.yaw);

    const kh = damp(C.horizontalFollowSharpness, dt);
    const kv = damp(C.verticalFollowSharpness, dt);
    this.smoothed.x += (target.x - this.smoothed.x) * kh;
    this.smoothed.z += (target.z - this.smoothed.z) * kh;
    this.smoothed.y += (target.y - this.smoothed.y) * kv;

    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Shoulder offset shrinks when the camera is pulled in close.
    const shoulder = C.shoulderOffset * clamp(this.currentDistance / C.distance, 0.3, 1);
    this.pivot.copy(this.smoothed).setY(this.smoothed.y + C.pivotHeight).addScaledVector(this.right, shoulder);

    // Offset from pivot to camera (behind the character, raised by pitch). When looking up,
    // the camera slides along the floor instead of digging into it.
    const horizontal = Math.cos(this.pitch) * this.distance;
    let vertical = Math.sin(this.pitch) * this.distance;
    vertical = Math.max(vertical, this.smoothed.y + C.floorClearance - this.pivot.y);
    this.dir.set(Math.sin(this.yaw) * horizontal, vertical, Math.cos(this.yaw) * horizontal);
    const wanted = this.dir.length();
    this.dir.divideScalar(wanted);

    // Collision: keep the camera in front of obstacles.
    let allowed = wanted;
    const hit = this.physics.castRay(this.pivot, this.dir, wanted + C.collisionPadding, exclude);
    if (hit) allowed = Math.max(0.6, hit.distance - C.collisionPadding);
    // Pull in instantly, ease back out slowly.
    this.currentDistance = allowed < this.currentDistance ? allowed : this.currentDistance + (allowed - this.currentDistance) * damp(4, dt);

    this.desired.copy(this.pivot).addScaledVector(this.dir, this.currentDistance);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.pivot);

    this.fovBoost += ((sprinting ? C.sprintFovBoost : 0) - this.fovBoost) * damp(4, dt);
    const fov = this.baseFov + this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow cinematic orbit used behind the main menu. */
  updateShowcase(elapsed: number, center: THREE.Vector3, radius = 95): void {
    const a = elapsed * 0.035 + 0.6;
    this.camera.position.set(center.x + Math.sin(a) * radius, center.y + radius * 0.42, center.z + Math.cos(a) * radius);
    this.camera.lookAt(center.x, center.y + 12, center.z);
    this.initialized = false;
  }
}
