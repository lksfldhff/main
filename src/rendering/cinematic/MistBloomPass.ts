import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/**
 * 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty"): stable,
 * flicker-free, cheap. The first level applies a soft luminance threshold (knee) and a
 * firefly clamp so single bright pixels don't sparkle.
 */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;
uniform float uExposure;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tInput, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = s(vec2(-2.0, -2.0)), b = s(vec2(0.0, -2.0)), c = s(vec2(2.0, -2.0));
  vec3 d = s(vec2(-1.0, -1.0)), e = s(vec2(1.0, -1.0));
  vec3 f = s(vec2(-2.0, 0.0)), g = s(vec2(0.0, 0.0)), h = s(vec2(2.0, 0.0));
  vec3 i = s(vec2(-1.0, 1.0)), j = s(vec2(1.0, 1.0));
  vec3 k = s(vec2(-2.0, 2.0)), l = s(vec2(0.0, 2.0)), m = s(vec2(2.0, 2.0));
  vec3 col = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
  if (uPrefilter > 0.5) {
    col *= uExposure;
    float br = max(col.r, max(col.g, col.b));
    // soft knee threshold
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1e-5);
    col *= max(rq, br - uThreshold) / max(br, 1e-5);
    col = min(col, vec3(24.0)); // firefly clamp
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** 9-tap tent upsample, added onto the next finer level. */
const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 c = texture2D(tLow, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb
         + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb + texture2D(tLow, vUv + vec2(t.x, t.y)).rgb;
  c += 2.0 * (texture2D(tLow, vUv + vec2(t.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(-t.x, 0.0)).rgb
            + texture2D(tLow, vUv + vec2(0.0, t.y)).rgb + texture2D(tLow, vUv + vec2(0.0, -t.y)).rgb);
  c += 4.0 * texture2D(tLow, vUv).rgb;
  gl_FragColor = vec4(c / 16.0 + texture2D(tHigh, vUv).rgb, 1.0);
}`;

const LEVELS = 5; // 1/2 … 1/32 resolution

/**
 * Lightweight bloom / Pro-Mist source: progressive downsample + tent upsample in half-float
 * render targets at 1/2…1/32 resolution (no full-resolution blur). It does not touch the
 * main image; the cinematic pass reads `bloomTexture` (tight + wide glow combined, 1/2 res)
 * and `mistTexture` (very wide, 1/8 res) and composites them before tone mapping.
 */
export class MistBloomPass extends Pass {
  threshold = 1.6;
  knee = 0.5;
  exposure = 1;
  private readonly down: THREE.WebGLRenderTarget[] = [];
  private readonly up: THREE.WebGLRenderTarget[] = [];
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor() {
    super();
    this.needsSwap = false;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter };
    for (let i = 0; i < LEVELS; i++) {
      this.down.push(new THREE.WebGLRenderTarget(1, 1, opts));
      if (i < LEVELS - 1) this.up.push(new THREE.WebGLRenderTarget(1, 1, opts));
    }
    this.downMat = new THREE.ShaderMaterial({
      uniforms: {
        tInput: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uPrefilter: { value: 0 },
        uThreshold: { value: 1 },
        uKnee: { value: 0.5 },
        uExposure: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: DOWN_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: UP_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.downMat);
  }

  /** Combined multi-scale glow at 1/2 resolution. */
  get bloomTexture(): THREE.Texture {
    return this.up[0].texture;
  }

  /** Very wide, soft scatter (Pro-Mist halation) at 1/8 resolution. */
  get mistTexture(): THREE.Texture {
    return this.up[2].texture;
  }

  override setSize(width: number, height: number): void {
    let w = width;
    let h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      this.down[i].setSize(w, h);
      if (i < LEVELS - 1) this.up[i].setSize(w, h);
    }
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const du = this.downMat.uniforms;
    this.quad.material = this.downMat;
    let src: THREE.Texture = readBuffer.texture;
    let srcW = readBuffer.width;
    let srcH = readBuffer.height;
    for (let i = 0; i < LEVELS; i++) {
      du.tInput.value = src;
      du.uTexel.value.set(1 / srcW, 1 / srcH);
      du.uPrefilter.value = i === 0 ? 1 : 0;
      du.uThreshold.value = this.threshold;
      du.uKnee.value = this.knee;
      du.uExposure.value = this.exposure;
      renderer.setRenderTarget(this.down[i]);
      this.quad.render(renderer);
      src = this.down[i].texture;
      srcW = this.down[i].width;
      srcH = this.down[i].height;
    }
    const uu = this.upMat.uniforms;
    this.quad.material = this.upMat;
    let low: THREE.WebGLRenderTarget = this.down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      uu.tLow.value = low.texture;
      uu.tHigh.value = this.down[i].texture;
      uu.uTexel.value.set(1 / low.width, 1 / low.height);
      renderer.setRenderTarget(this.up[i]);
      this.quad.render(renderer);
      low = this.up[i];
    }
  }

  override dispose(): void {
    [...this.down, ...this.up].forEach((t) => t.dispose());
    this.downMat.dispose();
    this.upMat.dispose();
    this.quad.dispose();
  }
}
