import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { CineValues, LookDef } from './CinematicSettings';

/**
 * One full-screen pass for the whole camera look (replaces OutputPass + grade pass):
 *   lens distortion → chromatic aberration (3 taps, only when enabled) → bloom / Pro-Mist
 *   composite in HDR → ACES tone mapping (same curve as the renderer) → sRGB →
 *   colour grade → vignette → film grain.  Optional split-screen before/after compare.
 */
const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
    tMist: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uEnabled: { value: 1 },
    uSplit: { value: 0 },
    uUseBloom: { value: 1 },
    uMist: { value: 0 },
    uBloom: { value: 0 },
    uChroma: { value: 0 },
    uGrain: { value: 0 },
    uVignette: { value: 0 },
    uGrade: { value: 1 },
    uDistortion: { value: 0 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uLift: { value: 0 },
    uShoulder: { value: 0 },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform sampler2D tMist;
    uniform vec2 uResolution;
    uniform float uTime, uExposure, uEnabled, uSplit, uUseBloom;
    uniform float uMist, uBloom, uChroma, uGrain, uVignette, uGrade, uDistortion;
    uniform float uSat, uContrast, uLift, uShoulder;
    uniform vec3 uShadowTint, uHighlightTint;
    varying vec2 vUv;

    // --- ACES filmic (identical to three.js ACESFilmicToneMapping; exposure applied by the caller)
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color = inM * (color / 0.6);
      color = RRTAndODTFit(color);
      return clamp(outM * color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
    }
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    // Smooth value noise: grain clumps over ~1.5 px instead of per-pixel digital noise.
    float grainNoise(vec2 p, float seed) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i + seed), b = hash(i + vec2(1.0, 0.0) + seed);
      float c = hash(i + vec2(0.0, 1.0) + seed), d = hash(i + vec2(1.0, 1.0) + seed);
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main() {
      float aspect = uResolution.x / uResolution.y;
      vec2 c0 = vUv - 0.5;
      vec2 pc = c0 * vec2(aspect, 1.0);
      float r2 = dot(pc, pc) / (0.25 * (aspect * aspect + 1.0)); // 0 centre … 1 corner

      // Before/after split: left half shows the plain tone-mapped image.
      bool plain = uEnabled < 0.5 || (uSplit > 0.5 && vUv.x < 0.5);
      if (plain) {
        vec3 base = toSRGB(aces(texture2D(tDiffuse, vUv).rgb * uExposure));
        if (uSplit > 0.5 && abs(vUv.x - 0.5) * uResolution.x < 1.0) base = vec3(0.92, 0.78, 0.5);
        gl_FragColor = vec4(base, 1.0);
        return;
      }

      // Lens distortion (barrel): edges are pulled in; never samples outside the frame.
      vec2 uv = 0.5 + c0 * (1.0 - uDistortion * 0.06 * r2);

      // Chromatic aberration: radial, quadratic → invisible in the centre.
      vec3 hdr;
      if (uChroma > 0.0) {
        float ca = uChroma * 0.0045 * r2;
        vec2 d = uv - 0.5;
        hdr.r = texture2D(tDiffuse, 0.5 + d * (1.0 + ca)).r;
        hdr.g = texture2D(tDiffuse, uv).g;
        hdr.b = texture2D(tDiffuse, 0.5 + d * (1.0 - ca)).b;
      } else {
        hdr = texture2D(tDiffuse, uv).rgb;
      }
      vec3 e = hdr * uExposure;

      // Bloom (tight glow around light sources) + Black Pro-Mist (wide, soft halation that
      // slightly lowers highlight contrast while keeping blacks deep).
      if (uUseBloom > 0.5) {
        vec3 glow = texture2D(tBloom, uv).rgb;
        vec3 mist = texture2D(tMist, uv).rgb;
        e += glow * (uBloom * 0.22);
        float m = uMist * 0.4;
        e = e * (1.0 - m * 0.08) + mist * m + glow * (m * 0.25);
      }

      vec3 col = toSRGB(aces(e));

      // --- Colour grade (display space)
      vec3 g = col;
      g = g * (1.0 - uLift) + uLift;                                    // gentle black lift
      g = mix(g, smoothstep(0.0, 1.0, g), (uContrast - 1.0) * 1.6);     // S-curve contrast
      g -= uShoulder * 0.12 * pow(max(g - 0.72, 0.0) / 0.28, vec3(2.0)); // highlight roll-off
      float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
      float chroma = max(g.r, max(g.g, g.b)) - min(g.r, min(g.g, g.b));
      g = mix(vec3(l), g, 1.0 + (uSat - 1.0) * (1.0 - chroma));          // vibrance: protects skin
      g *= mix(uShadowTint, uHighlightTint, smoothstep(0.08, 0.85, l));   // cool shadows, warm highlights
      col = mix(col, clamp(g, 0.0, 1.0), uGrade);

      // Vignette: elliptical, very soft roll-off, no visible edge.
      col *= 1.0 - uVignette * 0.5 * pow(smoothstep(0.15, 1.2, r2), 1.4);

      // Film grain: 24 fps stable, luminance-weighted (strongest in mid-tones), monochrome.
      if (uGrain > 0.0) {
        float frame = floor(uTime * 24.0);
        vec2 gp = gl_FragCoord.xy / 1.5;
        float n = grainNoise(gp, frame * 7.13) * 0.65 + grainNoise(gp * 2.1, frame * 3.71 + 11.0) * 0.35 - 0.5;
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col += n * uGrain * 0.07 * (1.0 - pow(abs(lum * 2.0 - 1.0), 2.0) * 0.7);
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class CinematicPass extends ShaderPass {
  constructor() {
    super(CinematicShader);
  }

  setTextures(bloom: THREE.Texture | null, mist: THREE.Texture | null): void {
    this.uniforms.tBloom.value = bloom;
    this.uniforms.tMist.value = mist;
    this.uniforms.uUseBloom.value = bloom && mist ? 1 : 0;
  }

  apply(values: CineValues, look: LookDef, enabled: boolean, split: boolean): void {
    const u = this.uniforms;
    u.uEnabled.value = enabled ? 1 : 0;
    u.uSplit.value = split ? 1 : 0;
    u.uMist.value = values.mist;
    u.uBloom.value = values.bloom;
    u.uChroma.value = values.chroma;
    u.uGrain.value = values.grain;
    u.uVignette.value = values.vignette;
    u.uGrade.value = values.grade;
    u.uDistortion.value = values.distortion;
    u.uSat.value = look.saturation;
    u.uContrast.value = look.contrast;
    u.uLift.value = look.lift;
    u.uShoulder.value = look.shoulder;
    u.uShadowTint.value.set(...look.shadowTint);
    u.uHighlightTint.value.set(...look.highlightTint);
  }

  setFrame(time: number, exposure: number, width: number, height: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uExposure.value = exposure;
    this.uniforms.uResolution.value.set(width, height);
  }
}
