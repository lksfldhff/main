import * as THREE from 'three';
import { CONFIG } from './config';
import { GameLoop } from './GameLoop';
import { SettingsStore, type GameSettings } from './Settings';
import { EventBus, type GameEvents } from './EventBus';
import { Renderer } from '../rendering/Renderer';
import { Environment } from '../rendering/Environment';
import { PostProcessing } from '../rendering/PostProcessing';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { InputManager } from '../input/InputManager';
import { World, type DistrictId } from '../world/World';
import { PlayerController } from '../player/PlayerController';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { RiggedAvatar } from '../player/RiggedAvatar';
import type { Avatar } from '../player/Avatar';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { InteractionSystem } from '../gameplay/InteractionSystem';
import { UIManager } from '../ui/UIManager';

type GameState = 'loading' | 'menu' | 'playing' | 'paused';

interface Runtime {
  physics: PhysicsWorld;
  world: World;
  player: PlayerController;
  avatar: Avatar;
  followCam: ThirdPersonCamera;
}

/**
 * Composition root: creates all systems, wires them together and runs the game state machine.
 * Systems never reference each other globally – everything is passed in here.
 */
export class Game {
  private readonly settings = new SettingsStore();
  private readonly events = new EventBus<GameEvents>();
  private readonly renderer: Renderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly environment: Environment;
  private readonly post: PostProcessing;
  private readonly input: InputManager;
  private readonly interactions = new InteractionSystem();
  private readonly ui: UIManager;
  private readonly loop: GameLoop;

  private state: GameState = 'loading';
  private readonly lastSafe = new THREE.Vector3();
  private locationTimer = 0;
  private runtime: Runtime | null = null;
  private elapsed = 0;
  private simMs = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, CONFIG.camera.near, CONFIG.camera.far);
    this.camera.position.set(80, 45, 90);
    this.camera.lookAt(0, 0, 0);
    this.renderer.onResize((w, h) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });

    this.environment = new Environment(this.scene, this.renderer.renderer);
    this.post = new PostProcessing(this.renderer.renderer, this.scene, this.camera);
    this.renderer.onResize((w, h) => this.post.setSize(w, h, this.renderer.renderer.getPixelRatio()));
    this.input = new InputManager(canvas);

    this.ui = new UIManager(uiRoot, this.settings, {
      onStart: () => this.startPlaying(),
      onResume: () => this.resume(),
      onRespawn: () => {
        this.runtime?.player.respawn();
        this.resume();
      },
      onMainMenu: () => this.toMainMenu(),
    });

    this.events.on('notify', ({ title, text }) => this.ui.hud.notify(title, text));
    this.input.onPointerLock((locked) => {
      if (!locked && this.state === 'playing') this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && !this.ui.settingsOpen) this.resume();
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) void this.input.requestPointerLock();
    });

    this.applySettings(this.settings.values);
    this.settings.subscribe((s) => this.applySettings(s));

    this.loop = new GameLoop(CONFIG.physics.fixedDt, CONFIG.physics.maxSubSteps, this.fixedStep, this.frame);
    this.loop.start();
  }

  /** Loads physics (WASM) and builds the world. */
  async init(): Promise<void> {
    try {
      const progress = (text: string) => this.ui.startScreen.setProgress(text);
      progress('Physik wird gestartet …');
      const hdri = this.environment
        .loadHdri(`${import.meta.env.BASE_URL}assets/hdri/sky_partly_cloudy.hdr`, this.renderer.renderer)
        .catch((e) => console.warn('HDRI not loaded, using procedural sky lighting', e));
      const physics = await PhysicsWorld.create(CONFIG.physics.gravity);
      // Yield one frame so the loading UI paints before the (synchronous) world build.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const materials = new MaterialLibrary(this.renderer.maxAnisotropy);
      const districtId: DistrictId = new URLSearchParams(location.search).get('world') === 'test' ? 'test' : 'heilbronn';
      const world = await World.create(districtId, this.scene, materials, physics, this.interactions, this.events, progress);
      const district = world.district;
      if (district.attribution) this.ui.startScreen.setAttribution(district.attribution);

      const player = new PlayerController(physics, district.spawn, district.spawnYaw);
      progress('Spielfigur …');
      const avatar: Avatar = (await RiggedAvatar.load(`${import.meta.env.BASE_URL}models/player`)) ?? new PlayerAvatar();
      this.scene.add(avatar.object);
      const followCam = new ThirdPersonCamera(this.camera, physics);
      followCam.setBaseFov(this.settings.values.fov);

      await hdri;
      this.runtime = { physics, world, player, avatar, followCam };
      this.renderer.renderer.compile(this.scene, this.camera);
      this.state = 'menu';
      this.ui.startScreen.setReady();
    } catch (err) {
      console.error(err);
      this.ui.startScreen.setError('Die Welt konnte nicht geladen werden. Details in der Browser-Konsole.');
    }
  }

  // ------------------------------------------------------------------ state machine

  private async startPlaying(): Promise<void> {
    if (!this.runtime || this.state === 'loading') return;
    const { followCam, player, world } = this.runtime;
    followCam.snapTo(player.feetPosition, world.district.spawnYaw);
    this.enterPlaying();
    this.ui.hud.notify(world.district.name, 'Willkommen! Erkunde die Stadt – Marktplatz, Kilianskirche, Neckar und Experimenta warten.');
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.enterPlaying();
  }

  private enterPlaying(): void {
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.loop.simulate = true;
    this.ui.showScreen('none');
    // Pointer lock may be refused (e.g. right after leaving it); clicking the canvas retries.
    void this.input.requestPointerLock();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.loop.simulate = false;
    this.input.exitPointerLock();
    this.ui.hud.setPrompt(null);
    this.ui.showScreen('pause');
  }

  private toMainMenu(): void {
    this.state = 'menu';
    this.input.enabled = false;
    this.loop.simulate = false;
    this.input.exitPointerLock();
    this.runtime?.player.respawn();
    this.ui.showScreen('start');
  }

  private applySettings(s: Readonly<GameSettings>): void {
    this.renderer.setRenderScale(s.renderScale);
    this.post.setQuality(s.graphicsQuality);
    this.environment.setShadowQuality(s.shadowQuality);
    this.runtime?.followCam.setBaseFov(s.fov);
    this.ui.debug.setVisible(s.showDebug);
  }

  // ------------------------------------------------------------------ loop callbacks

  private fixedStep = (dt: number): void => {
    const rt = this.runtime;
    if (!rt) return;
    const t0 = performance.now();
    rt.player.fixedUpdate(dt, this.input, rt.followCam.yaw);
    rt.physics.step(dt);
    this.simMs += performance.now() - t0;
  };

  private updateLocation(dt: number, position: THREE.Vector3): void {
    this.locationTimer -= dt;
    if (this.locationTimer > 0 || !this.runtime) return;
    this.locationTimer = 0.5;
    this.ui.hud.setLocation(this.runtime.world.district.locate?.(position) ?? null, this.runtime.world.district.name);
  }

  private rescueFromWater(): void {
    const rt = this.runtime;
    if (!rt) return;
    const p = this.lastSafe.lengthSq() > 0 ? this.lastSafe : rt.world.district.spawn;
    rt.player.teleport(p.x, p.y + 0.3, p.z);
    this.ui.hud.notify('Neckar', 'Schwimmen kommt in einer späteren Phase – zurück ans Ufer!');
  }

  /** Development helper (only exposed in dev builds, see main.ts). */
  debugTeleport(x: number, z: number, y?: number): void {
    const ground = this.runtime?.world.district.groundHeight?.(x, z) ?? 0;
    this.runtime?.player.teleport(x, y ?? ground + 1.5, z);
  }

  debugGroundHeight(x: number, z: number): number | null {
    return this.runtime?.world.district.groundHeight?.(x, z) ?? null;
  }

  private frame = (dt: number, alpha: number): void => {
    this.elapsed += dt;
    const rt = this.runtime;

    if (this.input.consumePress('toggleDebug')) this.settings.update({ showDebug: !this.settings.values.showDebug });

    if (rt) {
      const { player, avatar, followCam, world } = rt;
      if (this.state === 'playing') {
        const m = this.input.consumeMouseDelta();
        const s = this.settings.values;
        followCam.applyLook(m.x, m.y, this.input.consumeWheel(), s.mouseSensitivity, s.invertY);
      }

      player.interpolate(alpha);
      avatar.update(dt, player.renderPosition, player.visualFacing, this.state === 'playing' ? player.horizontalSpeed : 0, player.grounded);

      if (this.state === 'menu') {
        followCam.updateShowcase(this.elapsed, world.district.showcaseCenter, world.district.showcaseRadius);
        this.environment.updateShadowFocus(world.district.showcaseCenter);
      } else {
        followCam.update(dt, player.renderPosition, player.sprinting && this.state === 'playing', player.collider);
        this.environment.updateShadowFocus(player.renderPosition);
      }

      world.district.update?.(this.elapsed);
      if (this.state === 'playing') {
        this.updateLocation(dt, player.feetPosition);
        if (world.district.isInDeepWater?.(player.feetPosition)) this.rescueFromWater();
        else if (player.grounded) this.lastSafe.copy(player.feetPosition);
        const focused = this.interactions.update(player.feetPosition);
        this.ui.hud.setPrompt(focused?.prompt ?? null);
        if (this.input.consumePress('interact')) this.interactions.interact();
      }
    } else {
      // Loading: slow drift of the default camera.
      this.camera.position.set(Math.sin(this.elapsed * 0.05) * 110, 45, Math.cos(this.elapsed * 0.05) * 110);
      this.camera.lookAt(0, 6, 0);
    }

    this.environment.update(this.elapsed);
    const r0 = performance.now();
    this.post.render(dt);
    const renderMs = performance.now() - r0;
    this.ui.debug.update(
      dt,
      this.renderer.renderer,
      rt?.player.feetPosition ?? this.camera.position,
      `CPU        Sim ${this.simMs.toFixed(1)} ms · Render ${renderMs.toFixed(1)} ms\nKamera     ${rt?.followCam.debugInfo ?? '-'}\nZustand    ${this.state}\n`,
    );
    this.simMs = 0;
  };
}
