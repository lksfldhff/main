import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { damp } from '../utils/math';

interface Limb {
  pivot: THREE.Group;
}

/**
 * Stylized placeholder character built from primitives, with a procedural
 * walk/run/jump cycle. Faces -Z in local space. Will be replaced by a rigged
 * GLB model with skeletal animations in a later phase.
 */
export class PlayerAvatar {
  readonly object = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly head: THREE.Group;
  private phase = 0;
  private stride = 0;
  private airBlend = 0;
  private time = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.65 });
    const jacket = new THREE.MeshStandardMaterial({ color: 0x2f5d62, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0xe8b064, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2c3139, roughness: 0.85 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.9 });

    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    // Torso
    const torso = mesh(new THREE.CapsuleGeometry(0.21, 0.36, 6, 14), jacket, 0, 1.24, 0);
    torso.scale.set(1.08, 1, 0.72);
    this.body.add(torso);
    this.body.add(mesh(new THREE.BoxGeometry(0.16, 0.34, 0.05), shirt, 0, 1.3, -0.145));
    this.body.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.16, 14), pants, 0, 0.95, 0));

    // Head
    this.head = new THREE.Group();
    this.head.position.set(0, 1.55, 0);
    this.head.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), skin, 0, -0.02, 0));
    const skull = mesh(new THREE.SphereGeometry(0.135, 20, 16), skin, 0, 0.13, 0);
    skull.scale.set(0.95, 1.08, 1);
    this.head.add(skull);
    const hairCap = mesh(new THREE.SphereGeometry(0.145, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.16, 0.012);
    this.head.add(hairCap);
    const nose = mesh(new THREE.ConeGeometry(0.022, 0.05, 6), skin, 0, 0.12, -0.135);
    nose.rotation.x = -Math.PI / 2;
    this.head.add(nose);
    this.body.add(this.head);

    // Limbs: pivot at the joint, geometry hanging down.
    const limb = (x: number, y: number, upper: THREE.Material, lower: THREE.Material, end: THREE.Material, len: number, r: number, endGeo: THREE.BufferGeometry, endOffsetZ: number): Limb => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, len * 0.45, 4, 10), upper, 0, -len * 0.3, 0));
      pivot.add(mesh(new THREE.CapsuleGeometry(r * 0.88, len * 0.42, 4, 10), lower, 0, -len * 0.72, 0));
      pivot.add(mesh(endGeo, end, 0, -len - 0.02, endOffsetZ));
      this.body.add(pivot);
      return { pivot };
    };
    this.legL = limb(-0.1, 0.92, pants, pants, shoes, 0.86, 0.075, new THREE.BoxGeometry(0.11, 0.08, 0.25), -0.05);
    this.legR = limb(0.1, 0.92, pants, pants, shoes, 0.86, 0.075, new THREE.BoxGeometry(0.11, 0.08, 0.25), -0.05);
    this.armL = limb(-0.29, 1.42, jacket, jacket, skin, 0.62, 0.058, new THREE.SphereGeometry(0.055, 10, 8), 0);
    this.armR = limb(0.29, 1.42, jacket, jacket, skin, 0.62, 0.058, new THREE.SphereGeometry(0.055, 10, 8), 0);
    this.armL.pivot.rotation.z = -0.08;
    this.armR.pivot.rotation.z = 0.08;

    this.object.add(this.body);
    this.object.name = 'player';
  }

  /** @param speed horizontal speed (m/s) */
  update(dt: number, position: THREE.Vector3, facing: number, speed: number, grounded: boolean): void {
    this.time += dt;
    this.object.position.copy(position);
    this.object.rotation.y = facing;

    const run = CONFIG.player.runSpeed;
    const targetStride = grounded ? Math.min(speed / run, 1) : 0;
    this.stride += (targetStride - this.stride) * damp(10, dt);
    this.airBlend += ((grounded ? 0 : 1) - this.airBlend) * damp(12, dt);

    // Step frequency grows with speed; stride length grows too.
    this.phase += dt * (3 + speed * 1.25);
    const swing = Math.sin(this.phase) * (0.25 + this.stride * 0.75) * Math.min(1, speed / 1.5);

    const legAir = this.airBlend * 0.5;
    this.legL.pivot.rotation.x = swing - legAir;
    this.legR.pivot.rotation.x = -swing + legAir * 0.4;
    this.armL.pivot.rotation.x = -swing * 0.85 - this.airBlend * 0.6;
    this.armR.pivot.rotation.x = swing * 0.85 - this.airBlend * 0.6;

    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * Math.min(1, speed / 2);
    const breathe = Math.sin(this.time * 2) * 0.006;
    this.body.position.y = bob + breathe;
    this.body.rotation.x = -this.stride * 0.12; // lean into the run
    this.head.rotation.x = this.stride * 0.08;
  }
}
