import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

export type GraphicsQuality = 'low' | 'medium' | 'high';

/** Colour grade applied after tone mapping: saturation, contrast, split toning, vignette. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.07 },
    uShadowTint: { value: new THREE.Vector3(0.95, 1.0, 1.05) },
    uHighlightTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c *= mix(uShadowTint, uHighlightTint, smoothstep(0.05, 0.9, l));
      float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.25, 1.0)));
      c *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }`,
};

/**
 * Post-processing chain: Render → GTAO (high) → Tone mapping/sRGB → Grade → FXAA.
 * "high" additionally renders with 4× MSAA.
 */
export class PostProcessing {
  private composer: EffectComposer | null = null;
  private quality: GraphicsQuality = 'medium';
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;

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

  render(dt: number): void {
    if (this.quality === 'low' || !this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }

  private rebuild(): void {
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
    // Bloom is intentionally omitted for daytime: the HDR sky exceeds any useful threshold and
    // veils the whole image. It returns with the day/night cycle (lit windows, street lamps).
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    if (this.quality !== 'high') composer.addPass(new FXAAPass());
    this.composer = composer;
  }
}
