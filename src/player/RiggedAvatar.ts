import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from '../core/config';
import type { Avatar } from './Avatar';

type ClipName = 'idle' | 'walk' | 'run' | 'sprint' | 'jump' | 'fall' | 'land' | 'drive' | 'sit';

const TARGET_HEIGHT = 1.8;
const CLIP_NAMES: ClipName[] = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'drive', 'sit'];
/** Fallback name patterns for GLBs that do not use the exact clip names. */
const CLIP_PATTERNS: Record<ClipName, RegExp> = {
  idle: /idle|stand|breath/i,
  walk: /walk/i,
  run: /run|jog/i,
  sprint: /sprint/i,
  jump: /jump/i,
  fall: /fall|air/i,
  land: /land/i,
  drive: /driv/i,
  sit: /sit/i,
};
/** Transition clips that must not be picked as a looping locomotion state by the fallback patterns. */
const TRANSITION = /start|stop|strafe|turn|crouch|to_/i;
const ONE_SHOT = new Set<ClipName>(['jump', 'fall', 'land']);

/**
 * Rigged, skinned character with animation blending (idle / walk / run / sprint / jump / fall /
 * land) and a seated pose for vehicles.
 *
 * Supported inputs in public/models/player/:
 *  - player.glb  (one file, model + animation clips; built by tools/assets/build_player.sh – exact
 *                 clip names idle, walk, run, sprint, jump, fall, land, drive, sit; other GLBs work
 *                 if their clip names contain idle/walk/run/jump)
 *  - character.fbx + idle.fbx, walk.fbx, run.fbx, jump.fbx   (Mixamo downloads, "In Place" animations)
 */
export class RiggedAvatar implements Avatar {
  readonly object = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  /** Natural ground speed of the locomotion clips (m/s at the normalised size). */
  private readonly speeds: Record<'walk' | 'run' | 'sprint', number>;
  private readonly runThreshold: number;
  private readonly hips: THREE.Object3D | null;
  private current: ClipName | null = null;
  private airTime = 0;
  private landTimer = 0;
  private lastY = 0;
  private seated = false;
  private lastTick = 0;

  private constructor(model: THREE.Object3D, clips: Map<ClipName, THREE.AnimationClip>, clipSpeeds: Partial<Record<ClipName, number>> | null) {
    model.updateMatrixWorld(true);
    this.hips = findHips(model);
    // Clips without measured speeds still carry root motion → remove the horizontal drift.
    if (!clipSpeeds) for (const clip of clips.values()) stripRootMotion(clip, model);

    // Normalise size: feet at y = 0; models in plausible metres (e.g. a scan of the player, 1.5–2.1 m)
    // keep their real height, anything else is scaled to TARGET_HEIGHT.
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y || 1;
    const s = height > 1.5 && height < 2.1 ? 1 : TARGET_HEIGHT / height;
    model.scale.multiplyScalar(s);
    model.position.y -= box.min.y * s;
    // glTF/Mixamo characters face +Z; our avatars face −Z.
    model.rotation.y = Math.PI;

    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // skinned bounds are unreliable
      meshes.push(mesh);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) restyleMixamo(m);
    });
    // While seated in a car the game does not call update(); the mixer is ticked from the render
    // callback instead so the driving animation keeps playing.
    if (meshes[0]) meshes[0].onBeforeRender = () => this.tickSeated();
    this.object.add(model);
    this.object.name = 'player';

    const P = CONFIG.player;
    const sp = (n: ClipName, fallback: number) => (clipSpeeds?.[n] && clipSpeeds[n]! > 0.3 ? clipSpeeds[n]! * s : fallback);
    this.speeds = { walk: sp('walk', P.walkSpeed), run: sp('run', P.runSpeed), sprint: sp('sprint', P.runSpeed) };
    this.runThreshold = clipSpeeds ? (this.speeds.walk + this.speeds.run) / 2 : P.walkSpeed + 0.8;

    this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of clips) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(name, action);
    }
  }

  /** Tries to load a rigged player model; resolves to null when none is installed. */
  static async load(baseUrl: string): Promise<RiggedAvatar | null> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const glb = await tryLoad(() => loader.loadAsync(`${baseUrl}/player.glb`));
    if (glb) {
      const clips = pickClips(glb.animations);
      if (!clips.has('idle') && glb.animations[0]) clips.set('idle', glb.animations[0]);
      let speeds: Partial<Record<ClipName, number>> | null = null;
      glb.scene.traverse((o) => {
        const raw = o.userData?.clipSpeeds;
        if (typeof raw === 'string' && !speeds) {
          try {
            speeds = JSON.parse(raw);
          } catch {
            /* ignore malformed extras */
          }
        }
      });
      return new RiggedAvatar(cloneSkinned(glb.scene), clips, speeds);
    }

    const fbx = new FBXLoader();
    const character = await tryLoad(() => fbx.loadAsync(`${baseUrl}/character.fbx`));
    if (!character) return null;
    const clips = new Map<ClipName, THREE.AnimationClip>();
    await Promise.all(
      (['idle', 'walk', 'run', 'jump'] as ClipName[]).map(async (state) => {
        const anim = await tryLoad(() => fbx.loadAsync(`${baseUrl}/${state}.fbx`));
        if (anim?.animations[0]) clips.set(state, anim.animations[0]);
      }),
    );
    if (!clips.has('idle') && character.animations[0]) clips.set('idle', character.animations[0]);
    return new RiggedAvatar(character, clips, null);
  }

  update(dt: number, position: THREE.Vector3, facing: number, speed: number, grounded: boolean): void {
    if (this.seated) return;
    this.object.position.copy(position);
    this.object.rotation.y = facing;
    const vy = dt > 0 ? (position.y - this.lastY) / dt : 0;
    this.lastY = position.y;

    if (grounded) {
      if (this.airTime > 0.45 && this.actions.has('land')) this.landTimer = this.actions.get('land')!.getClip().duration * 0.75;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }
    this.landTimer = Math.max(0, this.landTimer - dt);

    const ground = this.groundState(speed);
    let state: ClipName = ground;
    if (!grounded && (this.airTime > 0.12 || vy > 1.5)) {
      const jump = this.actions.get('jump');
      const jumping = jump && (this.current === 'jump' ? jump.time < jump.getClip().duration * 0.98 : vy > 0.5 && this.airTime < 0.3);
      if (jumping) state = 'jump';
      else if (this.actions.has('fall')) state = 'fall';
      else if (jump) state = 'jump';
    } else if (grounded && this.landTimer > 0 && speed < 1.5) {
      state = 'land';
    }
    this.play(state);

    // Match animation playback speed to the actual movement speed (avoids foot sliding).
    const set = (n: 'walk' | 'run' | 'sprint', min: number, max: number) => {
      const a = this.actions.get(n);
      if (a) a.timeScale = THREE.MathUtils.clamp(speed / this.speeds[n], min, max);
    };
    set('walk', 0.5, 1.8);
    set('run', 0.7, 1.5);
    set('sprint', 0.8, 1.5);

    this.mixer.update(dt);
  }

  sitIn(parent: THREE.Object3D, hipPoint: THREE.Vector3): boolean {
    const pose = this.actions.get('drive') ?? this.actions.get('sit');
    if (!pose || !this.hips) return false;
    this.mixer.stopAllAction();
    pose.reset().setEffectiveWeight(1).play();
    this.current = this.actions.get('drive') ? 'drive' : 'sit';
    this.mixer.update(0);

    // Hip position in avatar space for this pose, measured at the origin.
    this.object.removeFromParent();
    this.object.position.set(0, 0, 0);
    this.object.rotation.set(0, 0, 0);
    this.object.updateMatrixWorld(true);
    const o = this.object.worldToLocal(this.hips.getWorldPosition(new THREE.Vector3()));

    parent.add(this.object);
    // Avatars face −Z, vehicles drive towards +Z → turn around; (x, z) of the offset flip too.
    this.object.rotation.set(0, Math.PI, 0);
    this.object.position.set(hipPoint.x + o.x, hipPoint.y - o.y, hipPoint.z + o.z);
    this.object.visible = true;
    this.seated = true;
    this.lastTick = performance.now();
    return true;
  }

  standUp(world: THREE.Object3D): void {
    if (!this.seated) return;
    this.seated = false;
    world.add(this.object);
    this.object.rotation.set(0, 0, 0);
    this.mixer.stopAllAction();
    this.current = null;
    this.airTime = 0;
    this.landTimer = 0;
  }

  private tickSeated(): void {
    if (!this.seated) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (dt > 0) this.mixer.update(dt);
  }

  private groundState(speed: number): ClipName {
    if (speed < 0.3 || !this.actions.has('walk')) return 'idle';
    if (speed < this.runThreshold || !this.actions.has('run')) return 'walk';
    const sprintAt = (CONFIG.player.walkSpeed + CONFIG.player.runSpeed) / 2;
    if (speed > sprintAt && this.actions.has('sprint')) return 'sprint';
    return 'run';
  }

  private play(state: ClipName): void {
    if (state === this.current) return;
    const next = this.actions.get(state);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    const fade = state === 'jump' || state === 'land' ? 0.12 : state === 'fall' ? 0.3 : 0.25;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    // Start locomotion cycles in phase with the previous cycle → smoother walk/run transitions.
    if (prev && !ONE_SHOT.has(state) && this.current && ['walk', 'run', 'sprint'].includes(this.current) && ['walk', 'run', 'sprint'].includes(state)) {
      next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    }
    prev?.fadeOut(fade);
    this.current = state;
  }
}

function pickClips(animations: THREE.AnimationClip[]): Map<ClipName, THREE.AnimationClip> {
  const clips = new Map<ClipName, THREE.AnimationClip>();
  const used = new Set<THREE.AnimationClip>();
  // 1) exact names (as produced by tools/assets/convert_mixamo.py)
  for (const name of CLIP_NAMES) {
    const clip = animations.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().endsWith(`|${name}`));
    if (clip) {
      clips.set(name, clip);
      used.add(clip);
    }
  }
  // 2) loose name patterns for other GLBs
  for (const name of CLIP_NAMES) {
    if (clips.has(name)) continue;
    const clip = animations.find((c) => !used.has(c) && CLIP_PATTERNS[name].test(c.name) && (name === 'jump' || !TRANSITION.test(c.name)));
    if (clip) {
      clips.set(name, clip);
      used.add(clip);
    }
  }
  if (!clips.has('run') && clips.has('sprint')) clips.set('run', clips.get('sprint')!);
  return clips;
}

async function tryLoad<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function findHips(model: THREE.Object3D): THREE.Object3D | null {
  const bones: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o);
  });
  return bones.find((b) => /hips|pelvis/i.test(b.name)) ?? bones[0] ?? null;
}

/**
 * Removes the horizontal root drift of a clip (root motion) while keeping the in-cycle hip sway,
 * so movement comes only from the physics controller. The vertical axis is taken from the hip
 * bone's parent space, which differs between exporters (FBX: Y, Blender glTF armatures: often Z).
 */
function stripRootMotion(clip: THREE.AnimationClip, model: THREE.Object3D): void {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const boneName = track.name.slice(0, -'.position'.length);
    if (!/hips|root|pelvis/i.test(boneName)) continue;
    const bone = model.getObjectByName(boneName);
    let vertical = 1;
    if (bone?.parent) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
      const a = [Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)];
      vertical = a.indexOf(Math.max(...a));
    }
    const v = track.values;
    const n = v.length / 3;
    if (n < 2) continue;
    for (let axis = 0; axis < 3; axis++) {
      if (axis === vertical) continue;
      const drift = v[(n - 1) * 3 + axis] - v[axis];
      for (let i = 0; i < n; i++) v[i * 3 + axis] -= (drift * i) / (n - 1);
    }
  }
}

/** Mixamo's X/Y Bot ships with plain grey materials – give it street clothes colours. */
function restyleMixamo(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial) return;
  if (/Beta_Joints|Alpha_Joints/i.test(m.name)) {
    m.color.set(0x24272c);
    m.roughness = 0.55;
    m.metalness = 0.15;
  } else if (/Beta_HighLimbs|Beta_Surface|Alpha_Body/i.test(m.name)) {
    m.color.set(0x2f5d62);
    m.roughness = 0.7;
    m.metalness = 0.05;
  }
}
