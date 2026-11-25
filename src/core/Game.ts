import * as THREE from 'three';
import { CONFIG } from './config';
import { GameLoop } from './GameLoop';
import { SettingsStore, type GameSettings } from './Settings';
import { EventBus, type GameEvents } from './EventBus';
import { Renderer } from '../rendering/Renderer';
import { Environment } from '../rendering/Environment';
import { MaterialLibrary } from '../rendering/MaterialLibrary';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { InputManager } from '../input/InputManager';
import { World } from '../world/World';
import { PlayerController } from '../player/PlayerController';
import { PlayerAvatar } from '../player/PlayerAvatar';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { InteractionSystem } from '../gameplay/InteractionSystem';
import { UIManager } from '../ui/UIManager';

type GameState = 'loading' | 'menu' | 'playing' | 'paused';

interface Runtime {
  physics: PhysicsWorld;
  world: World;
  player: PlayerController;
  avatar: PlayerAvatar;
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
  private readonly input: InputManager;
  private readonly interactions = new InteractionSystem();
  private readonly ui: UIManager;
  private readonly loop: GameLoop;

  private state: GameState = 'loading';
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
      const physics = await PhysicsWorld.create(CONFIG.physics.gravity);
      // Yield one frame so the loading UI paints before the (synchronous) world build.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const materials = new MaterialLibrary(this.renderer.maxAnisotropy);
      const world = new World(this.scene, materials, physics, this.interactions, this.events);

      const player = new PlayerController(physics, world.info.spawn, world.info.spawnYaw);
      const avatar = new PlayerAvatar();
      this.scene.add(avatar.object);
      const followCam = new ThirdPersonCamera(this.camera, physics);
      followCam.setBaseFov(this.settings.values.fov);

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
    followCam.snapTo(player.feetPosition, world.info.spawnYaw);
    this.enterPlaying();
    this.ui.hud.notify('Testviertel', 'Erkunde das Viertel – an der Litfaßsäule auf dem Platz gibt es etwas zu lesen.');
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

  /** Development helper (only exposed in dev builds, see main.ts). */
  debugTeleport(x: number, z: number, y = 0.5): void {
    this.runtime?.player.teleport(x, y, z);
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
        followCam.updateShowcase(this.elapsed, world.info.showcaseCenter);
        this.environment.updateShadowFocus(world.info.showcaseCenter);
      } else {
        followCam.update(dt, player.renderPosition, player.sprinting && this.state === 'playing', player.collider);
        this.environment.updateShadowFocus(player.renderPosition);
      }

      if (this.state === 'playing') {
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
    this.renderer.render(this.scene, this.camera);
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
