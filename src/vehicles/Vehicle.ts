import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createCarModel, type CarModel, type CarSpec } from './CarModel';
import { damp } from '../utils/math';

export interface DriveInput {
  throttle: number; // -1..1 (W/S)
  steer: number; // -1..1 (A = +1 / D = -1)
  handbrake: boolean;
}

const NO_INPUT: DriveInput = { throttle: 0, steer: 0, handbrake: false };
const SUSPENSION_REST = 0.32;
/** Typical loaded suspension length; aligns the visual model with the physics body. */
const L0 = 0.2;
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * A drivable car: Rapier dynamic rigid body + ray-cast vehicle controller (suspension,
 * tyre friction, engine, brakes, steering), arcade assists (speed-sensitive steering,
 * downforce, drag, flip recovery, handbrake drift) and an interpolated visual model.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly model: CarModel;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private steerAngle = 0;
  private wheelSpin = [0, 0, 0, 0];
  private upsideDownTime = 0;
  private beaconTime = 0;

  /** Interpolated render transform. */
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();

  driven = false;

  constructor(
    physics: PhysicsWorld,
    readonly spec: CarSpec,
    paint: string,
    position: THREE.Vector3,
    yaw: number,
  ) {
    const R = physics.rapier;
    this.model = createCarModel(spec, paint);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const spawnY = position.y + spec.wheelRadius + L0 + 0.05;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, spawnY, position.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCanSleep(true),
    );
    // Chassis box sits above the wheels; a low centre of mass keeps the car planted.
    const halfH = (spec.belt - 0.26) / 2 + 0.06;
    const volume = spec.width * spec.length * halfH * 2;
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(spec.width / 2, halfH, spec.length / 2)
        .setTranslation(0, 0.26 + halfH - spec.wheelRadius - L0, 0)
        .setDensity(spec.mass / volume)
        .setFriction(0.4),
      this.body,
    );
    this.body.setAdditionalMassProperties(0, { x: 0, y: -0.35, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, true);

    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const track = spec.width / 2 - 0.16;
    const wb = spec.wheelbase / 2;
    for (const [x, z] of [
      [track, wb],
      [-track, wb],
      [track, -wb],
      [-track, -wb],
    ]) {
      this.controller.addWheel({ x, y: 0, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, spec.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, 28);
      this.controller.setWheelSuspensionCompression(i, 2.6);
      this.controller.setWheelSuspensionRelaxation(i, 3.2);
      this.controller.setWheelMaxSuspensionTravel(i, 0.25);
      this.controller.setWheelFrictionSlip(i, 2.4);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
      this.controller.setWheelMaxSuspensionForce(i, spec.mass * 40);
    }
    this.syncState();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  /** Speed along the car's forward axis in m/s. */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  get heading(): number {
    _v.set(0, 0, 1).applyQuaternion(this.currRot);
    return Math.atan2(_v.x, _v.z);
  }

  /** Driver door position (left side, German left-hand drive), in world space. */
  driverDoor(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(this.spec.width / 2 + 1.1, 0, 0.35).applyQuaternion(this.currRot).add(this.currPos);
  }

  /** Driver hip point in model space (relative to `model.body`, ground at y = 0, forward +Z). */
  driverSeat(target = new THREE.Vector3()): THREE.Vector3 {
    const s = this.spec;
    if (s.seat) return target.fromArray(s.seat);
    const windshieldBase = -s.length / 2 + s.cabin[3] * s.length;
    return target.set(s.width * 0.22, s.belt - 0.42, windshieldBase - 1.2);
  }

  fixedUpdate(dt: number, input: DriveInput | null): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const sleeping = this.body.isSleeping();
    if (sleeping && !input) return;

    const i = input ?? NO_INPUT;
    const speed = this.speed;
    const abs = Math.abs(speed);
    const { enginePower, maxSpeed, mass } = this.spec;

    // Engine / brakes / reverse
    let engine = 0;
    let brake = 0;
    if (i.throttle > 0) {
      if (speed < -1) brake = mass * 0.012;
      else engine = enginePower * i.throttle * Math.max(0, 1 - abs / maxSpeed) * (abs < 4 ? 1.25 : 1);
    } else if (i.throttle < 0) {
      if (speed > 1) brake = mass * 0.012;
      else engine = enginePower * 0.5 * i.throttle * Math.max(0, 1 - abs / 12);
    } else if (!input) {
      brake = mass * 0.02; // parked: handbrake on
    } else {
      brake = mass * 0.0015; // engine braking
    }
    for (let w = 0; w < 4; w++) {
      this.controller.setWheelEngineForce(w, w >= 2 ? engine / 2 : 0);
      this.controller.setWheelBrake(w, brake);
    }
    if (i.handbrake && input) {
      this.controller.setWheelBrake(2, mass * 0.03);
      this.controller.setWheelBrake(3, mass * 0.03);
    }
    // Handbrake loosens rear grip → controllable drifts.
    const rearGrip = i.handbrake ? 1.1 : 2.4;
    this.controller.setWheelFrictionSlip(2, rearGrip);
    this.controller.setWheelFrictionSlip(3, rearGrip);

    // Speed-sensitive steering
    const maxSteer = 0.62 / (1 + abs * 0.045);
    this.steerAngle += (i.steer * maxSteer - this.steerAngle) * damp(8, dt);
    this.controller.setWheelSteering(0, this.steerAngle);
    this.controller.setWheelSteering(1, this.steerAngle);

    this.controller.updateVehicle(dt);

    // Aerodynamic drag + downforce
    const lv = this.body.linvel();
    const v2 = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z;
    if (v2 > 1) {
      const k = 0.42 * dt;
      this.body.applyImpulse({ x: -lv.x * Math.sqrt(v2) * k, y: -v2 * 0.9 * dt, z: -lv.z * Math.sqrt(v2) * k }, true);
    }

    this.recoverIfFlipped(dt);
  }

  /** Called after the physics step. */
  postStep(): void {
    this.syncState();
  }

  /** Visual update (interpolation, wheel spin/steer, lights). */
  render(alpha: number, dt: number, braking: boolean): void {
    this.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    // Body origin = wheel attachment height; the model's ground plane is R + L0 below it.
    _v.set(0, -this.spec.wheelRadius - L0, 0).applyQuaternion(this.quaternion);
    this.model.root.position.copy(this.position).add(_v);
    this.model.root.quaternion.copy(this.quaternion);

    for (let w = 0; w < 4; w++) {
      const pivot = this.model.wheels[w];
      const len = this.controller.wheelSuspensionLength(w) ?? SUSPENSION_REST;
      pivot.position.y = this.spec.wheelRadius + (L0 - len);
      pivot.rotation.y = w < 2 ? this.steerAngle : 0;
      this.wheelSpin[w] += (this.speed / this.spec.wheelRadius) * dt;
      pivot.children[0].rotation.x = this.wheelSpin[w];
    }
    this.model.brakeLights.emissiveIntensity = braking ? 2.2 : this.driven ? 0.6 : 0.15;
    if (this.model.beacon && this.driven) {
      this.beaconTime += dt;
      this.model.beacon.emissiveIntensity = Math.sin(this.beaconTime * 14) > 0 ? 2.5 : 0.3;
    }
  }

  private syncState(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  private recoverIfFlipped(dt: number): void {
    _v.set(0, 1, 0).applyQuaternion(this.currRot);
    if (_v.y < 0.3 && Math.abs(this.speed) < 2) this.upsideDownTime += dt;
    else this.upsideDownTime = 0;
    if (this.upsideDownTime > 2) {
      const yaw = this.heading;
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const t = this.body.translation();
      this.body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
      this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.upsideDownTime = 0;
    }
  }
}
