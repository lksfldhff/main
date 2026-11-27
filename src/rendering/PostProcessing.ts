import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { MistBloomPass } from './cinematic/MistBloomPass';
import { CinematicPass } from './cinematic/CinematicPass';
import { CINE_PRESETS, LOOKS, performanceValues, type CinePreset, type CineValues } from './cinematic/CinematicSettings';

export interface CinematicConfig {
  enabled: boolean;
  preset: CinePreset;
  values: CineValues;
  /** Performance mode: no bloom / Pro-Mist chain, no chromatic aberration taps. */
  performance: boolean;
  /** Split-screen before/after comparison. */
  compare: boolean;
}

export type GraphicsQuality = 'low' | 'medium' | 'high';

/**
 * Post-processing chain:
 *   Render (HDR, half float) → GTAO (high) → Mist/Bloom mip chain (1/2…1/32 res, optional) →
 *   Cinematic pass (lens, CA, bloom + Pro-Mist, ACES tone mapping, grade, vignette, grain) → FXAA.
 * "high" renders with 4× MSAA instead of FXAA. "low" renders directly (no post-processing).
 */
export class PostProcessing {
  private composer: EffectComposer | null = null;
  private quality: GraphicsQuality = 'medium';
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;
  private bloomPass: MistBloomPass | null = null;
  private cinePass: CinematicPass | null = null;
  private time = 0;
  private cine: CinematicConfig = { enabled: true, preset: 'gta', values: CINE_PRESETS.gta.values, performance: false, compare: false };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  setQuality(quality: GraphicsQuality): void {
    if (this.composer && quality === this.quality) return;
    this.quality = quality;
    this.rebuild();
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.size.set(width, height);
    this.pixelRatio = pixelRatio;
    if (this.composer) {
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);
    }
  }

  /** Applies the camera look in real time (uniform updates only, no rebuild). */
  setCinematic(config: CinematicConfig): void {
    this.cine = config;
    this.applyCinematic();
  }

  private applyCinematic(): void {
    const c = this.cine;
    const values = c.performance ? performanceValues(c.values) : c.values;
    const def = CINE_PRESETS[c.preset] ?? CINE_PRESETS.gta;
    this.cinePass?.apply(values, LOOKS[def.look], c.enabled, c.compare);
    // The mip chain only runs when glow / diffusion is actually visible.
    const needBloom = c.enabled && !c.performance && (values.bloom > 0.001 || values.mist > 0.001);
    if (this.bloomPass) this.bloomPass.enabled = needBloom;
    this.cinePass?.setTextures(needBloom ? this.bloomPass!.bloomTexture : null, needBloom ? this.bloomPass!.mistTexture : null);
  }

  render(dt: number): void {
    if (this.quality === 'low' || !this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += dt;
    const exposure = this.renderer.toneMappingExposure;
    if (this.bloomPass) this.bloomPass.exposure = exposure;
    this.cinePass?.setFrame(this.time % 1000, exposure, this.size.x * this.pixelRatio, this.size.y * this.pixelRatio);
    this.composer.render(dt);
  }

  private rebuild(): void {
    this.bloomPass?.dispose();
    this.cinePass?.dispose();
    this.bloomPass = null;
    this.cinePass = null;
    this.composer?.dispose();
    this.composer = null;
    if (this.quality === 'low') return;

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 0,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(this.size.x, this.size.y);

    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high') {
      const gtao = new GTAOPass(this.scene, this.camera, this.size.x, this.size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: 12 });
      composer.addPass(gtao);
    }
    // Glow / Pro-Mist source (reads the HDR image, writes only its own small targets).
    this.bloomPass = new MistBloomPass();
    composer.addPass(this.bloomPass);
    // Tone mapping (ACES, renderer exposure), sRGB and the whole camera look in one pass.
    this.cinePass = new CinematicPass();
    composer.addPass(this.cinePass);
    if (this.quality !== 'high') composer.addPass(new FXAAPass());
    this.applyCinematic();
    this.composer = composer;
  }
}
