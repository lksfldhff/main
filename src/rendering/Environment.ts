import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { ShadowQuality, TimeOfDay } from '../core/Settings';
import { setNight } from './TimeOfDay';

const SHADOW_EXTENT = 70; // half-size of the shadow frustum around the player (metres)

/**
 * Sky, sun, ambient light, fog and image-based lighting.
 * The sun's shadow camera follows a focus point (the player) so shadows stay sharp
 * without covering the whole city.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly sky: Sky;
  private readonly sunDirection = new THREE.Vector3();
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private proceduralEnv: THREE.Texture | null = null;
  private hdris: { dayEnv: THREE.Texture; dayBackground: THREE.Texture; nightEnv: THREE.Texture } | null = null;
  private timeOfDay: TimeOfDay = 'day';
  private readonly dayExposure: number;
  /** Sun direction of the day HDRI (so shadows match the photographed sky). */
  private readonly hdriSun = new THREE.Vector3();
  private readonly defaultSun = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.dayExposure = renderer.toneMappingExposure;
    // Afternoon sun from the south-west: warm light, readable shadows, streets mostly lit.
    // (azimuth measured from +Z/south towards +X/east)
    const elevation = THREE.MathUtils.degToRad(44);
    const azimuth = THREE.MathUtils.degToRad(320);
    this.sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    this.defaultSun.copy(this.sunDirection);

    this.sky = new Sky();
    this.sky.scale.setScalar(4000); // must stay inside the camera far plane
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.4;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.0025;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.35;
    u.showSunDisc.value = 0; // the HDR sun disc would bloom over half the screen
    u.sunPosition.value.copy(this.sunDirection);
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xc4d8f2, 0x6a6255, 0.45);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffeedd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.045;
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 400;
    scene.add(this.sun, this.sun.target);

    scene.fog = new THREE.Fog(0xc4d3de, 260, 1500);
    scene.background = null;

    this.buildEnvironmentMap(renderer);
    this.updateLightBasis();
  }

  private updateLightBasis(): void {
    // Basis of the light's view plane (used for texel snapping).
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDirection).normalize();
    this.lightUp.crossVectors(this.sunDirection, this.lightRight).normalize();
  }

  private setSunDirection(dir: THREE.Vector3): void {
    this.sunDirection.copy(dir).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDirection);
    this.updateLightBasis();
  }

  /**
   * Loads the real HDRIs (Poly Haven, CC0): `german_town_street` lights the city and is what glass,
   * paint and wet surfaces reflect; `hausdorf_clear_sky` is the visible sky (its sun position drives
   * the sun light so shadows match); `cobblestone_street_night` lights the night mode.
   */
  async loadHdris(baseUrl: string, timeOfDay: TimeOfDay): Promise<void> {
    const [env, sky, night] = await Promise.all(
      ['german_town_street_1k', 'hausdorf_clear_sky_1k', 'cobblestone_street_night_1k'].map((n) => loadHdrTexture(`${baseUrl}${n}.hdr`)),
    );
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const dayEnv = pmrem.fromEquirectangular(env).texture;
    const nightEnv = pmrem.fromEquirectangular(night).texture;
    pmrem.dispose();
    env.dispose();
    night.dispose();
    sky.mapping = THREE.EquirectangularReflectionMapping;
    // Sun of the sky photo (brightest texel, tools/assets/hdri.py --sun): u 0.600, elevation 22°.
    // three.js equirect lookup: u = atan2(z, x) / 2π + 0.5.
    const phi = (0.6003 - 0.5) * Math.PI * 2;
    const el = THREE.MathUtils.degToRad(22.4);
    this.hdriSun.set(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi));
    this.hdris = { dayEnv, dayBackground: sky, nightEnv };
    this.setTimeOfDay(timeOfDay, true);
  }

  /** Day: photographed sky + street reflections. Night: dark sky, moonlight, lit windows and lamps. */
  setTimeOfDay(t: TimeOfDay, force = false): void {
    if (t === this.timeOfDay && !force) return;
    this.timeOfDay = t;
    const night = t === 'night';
    setNight(night ? 1 : 0);
    const fog = this.scene.fog as THREE.Fog;
    const u = this.sky.material.uniforms;
    if (night) {
      this.setSunDirection(new THREE.Vector3(-0.35, 0.75, 0.55)); // moon
      u.sunPosition.value.set(0.3, -0.2, 0.9); // sun below the horizon → dark night sky
      this.sun.color.set(0x9db4ff);
      this.sun.intensity = 0.45;
      this.hemi.color.set(0x2a3450);
      this.hemi.groundColor.set(0x141210);
      this.hemi.intensity = 0.25;
      fog.color.set(0x0b0f16);
      fog.near = 120;
      fog.far = 900;
      this.sky.visible = true;
      this.scene.background = null;
      this.scene.environment = this.hdris?.nightEnv ?? this.proceduralEnv;
      this.scene.environmentIntensity = this.hdris ? 0.16 : 0.05;
      this.renderer.toneMappingExposure = this.dayExposure * 1.1;
    } else {
      this.sun.color.set(0xffeedd);
      this.sun.intensity = 3.2;
      this.hemi.color.set(0xc4d8f2);
      this.hemi.groundColor.set(0x6a6255);
      this.hemi.intensity = 0.45;
      fog.near = 260;
      fog.far = 1500;
      this.renderer.toneMappingExposure = this.dayExposure;
      if (this.hdris) {
        this.setSunDirection(this.hdriSun);
        this.sky.visible = false;
        this.scene.background = this.hdris.dayBackground;
        this.scene.backgroundIntensity = 1.0;
        this.scene.environment = this.hdris.dayEnv;
        this.scene.environmentIntensity = 0.55;
        fog.color.set(0xc9d4dc);
      } else {
        this.setSunDirection(this.defaultSun);
        this.sky.visible = true;
        this.scene.background = null;
        this.scene.environment = this.proceduralEnv;
        this.scene.environmentIntensity = 0.3;
        fog.color.set(0xc4d3de);
      }
    }
  }

  /**
   * Replaces the procedural-sky environment map with a real HDR sky (Poly Haven, CC0) for
   * more natural ambient light and reflections. The visible sky stays procedural.
   */
  async loadHdri(url: string, renderer: THREE.WebGLRenderer): Promise<void> {
    const hdr = await new HDRLoader().loadAsync(url);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    // Rotate so the HDRI's bright sky region roughly matches our sun azimuth.
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(120), 0);
  }

  setShadowQuality(quality: ShadowQuality): void {
    const size = quality === 'high' ? 4096 : 2048;
    this.sun.castShadow = quality !== 'off';
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Centers the shadow frustum on `focus`, snapped to shadow-map texels to avoid shimmering. */
  updateShadowFocus(focus: THREE.Vector3): void {
    const texel = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const r = Math.round(focus.dot(this.lightRight) / texel) * texel;
    const up = Math.round(focus.dot(this.lightUp) / texel) * texel;
    const d = focus.dot(this.sunDirection);
    const snapped = new THREE.Vector3()
      .addScaledVector(this.lightRight, r)
      .addScaledVector(this.lightUp, up)
      .addScaledVector(this.sunDirection, d);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDirection, 200);
    this.sun.target.updateMatrixWorld();
  }

  update(elapsed: number): void {
    this.sky.material.uniforms.time.value = elapsed;
  }

  private buildEnvironmentMap(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(1000);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDirection);
    envSky.material.uniforms.turbidity.value = 3.2;
    envSky.material.uniforms.rayleigh.value = 1.4;
    envSky.material.uniforms.cloudCoverage.value = 0;
    envScene.add(envSky);
    // Ground bounce: a warm grey lower hemisphere instead of black, so walls and glass
    // reflect a plausible street level.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5f5b54, side: THREE.BackSide }),
    );
    envScene.add(ground);
    this.proceduralEnv = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.proceduralEnv;
    this.scene.environmentIntensity = 0.3;
    pmrem.dispose();
  }
}

/**
 * Loads a Radiance HDR. Sandboxed preview hosts may refuse raw binaries; then a base64 copy
 * (`<name>.b64.txt`) next to it is used.
 */
async function loadHdrTexture(url: string): Promise<THREE.DataTexture> {
  const loader = new HDRLoader();
  try {
    const res = await fetch(url);
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && !type.includes('text/html')) {
      const blobUrl = URL.createObjectURL(await res.blob());
      try {
        return await loader.loadAsync(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  } catch {
    /* try the base64 copy */
  }
  const res = await fetch(`${url}.b64.txt`);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blobUrl = URL.createObjectURL(new Blob([bytes]));
  try {
    return await loader.loadAsync(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
