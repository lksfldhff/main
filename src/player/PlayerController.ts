import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { InputManager } from '../input/InputManager';
import { angleDelta, damp } from '../utils/math';

const P = CONFIG.player;
const FOOT_OFFSET = P.halfHeight + P.radius; // capsule centre → feet

/**
 * Kinematic character controller (Rapier): walking, sprinting, jumping, gravity,
 * stair/curb stepping, slope limits and sliding along walls.
 * Exposes an interpolated render position so motion stays smooth at any frame rate.
 */
export class PlayerController {
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private readonly controller: RAPIER.KinematicCharacterController;

  readonly velocity = new THREE.Vector3();
  grounded = false;
  /** Character facing (radians around Y, 0 = facing -Z/north). */
  facing = 0;
  sprinting = false;

  private readonly prevFeet = new THREE.Vector3();
  private readonly currFeet = new THREE.Vector3();
  readonly renderPosition = new THREE.Vector3();
  private renderFacing = 0;
  private prevFacing = 0;

  private readonly wish = new THREE.Vector3();
  private readonly spawn: THREE.Vector3;
  private justJumped = false;

  constructor(physics: PhysicsWorld, spawn: THREE.Vector3, spawnYaw: number) {
    const R = physics.rapier;
    this.spawn = spawn.clone();
    const c = spawn.clone().setY(spawn.y + FOOT_OFFSET);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(P.halfHeight, P.radius), this.body);

    this.controller = physics.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(P.maxSlopeDeg));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(P.maxSlopeDeg + 5));
    this.controller.enableAutostep(P.stepHeight, 0.15, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.facing = this.prevFacing = this.renderFacing = spawnYaw;
    this.currFeet.copy(spawn);
    this.prevFeet.copy(spawn);
    this.renderPosition.copy(spawn);
  }

  get feetPosition(): THREE.Vector3 {
    return this.currFeet;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get visualFacing(): number {
    return this.renderFacing;
  }

  fixedUpdate(dt: number, input: InputManager, cameraYaw: number): void {
    this.prevFeet.copy(this.currFeet);
    this.prevFacing = this.facing;

    // --- Desired horizontal velocity relative to the camera
    const axis = input.moveAxis();
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    this.wish.set(-sin * axis.y + cos * axis.x, 0, -cos * axis.y - sin * axis.x);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    this.sprinting = input.enabled && input.isDown('sprint') && axis.y >= 0 && this.wish.lengthSq() > 0.01;
    const targetSpeed = this.sprinting ? P.runSpeed : P.walkSpeed;
    const accel = this.grounded ? P.groundAcceleration : P.airAcceleration;
    const k = damp(accel, dt);
    this.velocity.x += (this.wish.x * targetSpeed - this.velocity.x) * k;
    this.velocity.z += (this.wish.z * targetSpeed - this.velocity.z) * k;

    // --- Vertical
    const jump = input.enabled && input.consumePress('jump');
    if (this.grounded) {
      this.velocity.y = Math.max(this.velocity.y, -2);
      if (jump) {
        this.velocity.y = P.jumpVelocity;
        this.justJumped = true;
      }
    }
    this.velocity.y += CONFIG.physics.gravity * dt;

    // --- Collide & slide
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    if (this.justJumped) this.controller.disableSnapToGround();
    this.controller.computeColliderMovement(this.collider, desired);
    if (this.justJumped) {
      this.controller.enableSnapToGround(0.3);
      this.justJumped = false;
    }
    const move = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    // Hit a ceiling or landed: cancel vertical velocity
    if (desired.y > 0 && move.y < desired.y * 0.5) this.velocity.y = 0;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    // Blocked horizontally (wall): bleed off velocity so we don't "stick" with full speed
    if (dt > 0) {
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, move.x / dt, 0.5);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, move.z / dt, 0.5);
    }

    const t = this.body.translation();
    const next = { x: t.x + move.x, y: t.y + move.y, z: t.z + move.z };
    this.body.setNextKinematicTranslation(next);
    this.currFeet.set(next.x, next.y - FOOT_OFFSET, next.z);

    // --- Facing follows movement direction
    if (this.wish.lengthSq() > 0.01) {
      const target = Math.atan2(-this.wish.x, -this.wish.z);
      this.facing += angleDelta(this.facing, target) * damp(P.turnSharpness, dt);
    }

    if (this.currFeet.y < P.respawnBelowY) this.respawn();
  }

  /** Interpolates between the last two physics states for rendering. */
  interpolate(alpha: number): void {
    this.renderPosition.lerpVectors(this.prevFeet, this.currFeet, alpha);
    this.renderFacing = this.prevFacing + angleDelta(this.prevFacing, this.facing) * alpha;
  }

  respawn(): void {
    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y: y + FOOT_OFFSET, z }, true);
    this.velocity.set(0, 0, 0);
    this.currFeet.set(x, y, z);
    this.prevFeet.copy(this.currFeet);
  }
}
