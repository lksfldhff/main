import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config';
import type { Avatar } from './Avatar';

type MotionState = 'idle' | 'walk' | 'run' | 'jump';

const TARGET_HEIGHT = 1.8;
const STATE_PATTERNS: Record<MotionState, RegExp> = {
  idle: /idle|stand|breath/i,
  walk: /walk/i,
  run: /run|jog|sprint/i,
  jump: /jump|fall|air/i,
};

/**
 * Rigged, skinned character with animation blending (idle / walk / run / jump).
 *
 * Supported inputs in public/models/player/:
 *  - player.glb            (one file, model + animation clips; clip names should contain idle/walk/run/jump)
 *  - character.fbx + idle.fbx, walk.fbx, run.fbx, jump.fbx   (Mixamo downloads, "In Place" animations)
 */
export class RiggedAvatar implements Avatar {
  readonly object = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<MotionState, THREE.AnimationAction>();
  private current: MotionState | null = null;

  private constructor(model: THREE.Object3D, clips: Map<MotionState, THREE.AnimationClip>) {
    // Normalise size: scale so the model is TARGET_HEIGHT tall, feet at y = 0.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y || 1;
    const s = TARGET_HEIGHT / height;
    model.scale.multiplyScalar(s);
    model.position.y -= box.min.y * s;
    // glTF/Mixamo characters face +Z; our avatars face −Z.
    model.rotation.y = Math.PI;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // skinned bounds are unreliable
      }
    });
    this.object.add(model);
    this.object.name = 'player';

    this.mixer = new THREE.AnimationMixer(model);
    for (const [state, clip] of clips) {
      stripRootMotion(clip);
      const action = this.mixer.clipAction(clip);
      if (state === 'jump') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }
  }

  /** Tries to load a rigged player model; resolves to null when none is installed. */
  static async load(baseUrl: string): Promise<RiggedAvatar | null> {
    const glb = await tryLoad(() => new GLTFLoader().loadAsync(`${baseUrl}/player.glb`));
    if (glb) {
      const clips = new Map<MotionState, THREE.AnimationClip>();
      for (const state of Object.keys(STATE_PATTERNS) as MotionState[]) {
        const clip = glb.animations.find((c) => STATE_PATTERNS[state].test(c.name));
        if (clip) clips.set(state, clip);
      }
      if (!clips.has('idle') && glb.animations[0]) clips.set('idle', glb.animations[0]);
      return new RiggedAvatar(cloneSkinned(glb.scene), clips);
    }

    const fbx = new FBXLoader();
    const character = await tryLoad(() => fbx.loadAsync(`${baseUrl}/character.fbx`));
    if (!character) return null;
    const clips = new Map<MotionState, THREE.AnimationClip>();
    await Promise.all(
      (['idle', 'walk', 'run', 'jump'] as MotionState[]).map(async (state) => {
        const anim = await tryLoad(() => fbx.loadAsync(`${baseUrl}/${state}.fbx`));
        if (anim?.animations[0]) clips.set(state, anim.animations[0]);
      }),
    );
    if (!clips.has('idle') && character.animations[0]) clips.set('idle', character.animations[0]);
    return new RiggedAvatar(character, clips);
  }

  update(dt: number, position: THREE.Vector3, facing: number, speed: number, grounded: boolean): void {
    this.object.position.copy(position);
    this.object.rotation.y = facing;

    let state: MotionState = 'idle';
    if (!grounded && this.actions.has('jump')) state = 'jump';
    else if (speed > CONFIG.player.walkSpeed + 0.8 && this.actions.has('run')) state = 'run';
    else if (speed > 0.4 && this.actions.has('walk')) state = 'walk';
    this.play(state);

    // Match animation playback speed to the actual movement speed (reduces foot sliding).
    const walk = this.actions.get('walk');
    if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / CONFIG.player.walkSpeed, 0.6, 1.4);
    const run = this.actions.get('run');
    if (run) run.timeScale = THREE.MathUtils.clamp(speed / CONFIG.player.runSpeed, 0.7, 1.3);

    this.mixer.update(dt);
  }

  private play(state: MotionState): void {
    if (state === this.current) return;
    const next = this.actions.get(state);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset().setEffectiveWeight(1).fadeIn(state === 'jump' ? 0.12 : 0.25).play();
    prev?.fadeOut(state === 'jump' ? 0.12 : 0.25);
    this.current = state;
  }
}

async function tryLoad<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** Removes horizontal root translation so movement comes only from the physics controller. */
function stripRootMotion(clip: THREE.AnimationClip): void {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const bone = track.name.split('.')[0].toLowerCase();
    if (!/hips|root|pelvis/.test(bone)) continue;
    const v = track.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}
