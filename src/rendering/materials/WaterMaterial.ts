import * as THREE from 'three';
import { GLSL_NOISE } from './glsl';

/** River water: deep green-blue, glossy, with animated procedural ripples reflecting the sky. */
export function createWaterMaterial(): { material: THREE.MeshStandardMaterial; update: (t: number) => void } {
  const material = new THREE.MeshStandardMaterial({ color: 0x2c4b4d, roughness: 0.06, metalness: 0.15 });
  const uniforms = { uTime: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;\n${GLSL_NOISE}`)
      .replace(
        '#include <normal_fragment_maps>',
        `
vec2 wp = vWaterPos.xz;
float e = 0.15;
vec2 flow = vec2(0.0, 0.35) * uTime;
float h0 = fbm2(wp * 0.45 + flow) + 0.5 * fbm2(wp * 1.3 - flow * 1.7);
float hx = fbm2((wp + vec2(e, 0.0)) * 0.45 + flow) + 0.5 * fbm2((wp + vec2(e, 0.0)) * 1.3 - flow * 1.7);
float hz = fbm2((wp + vec2(0.0, e)) * 0.45 + flow) + 0.5 * fbm2((wp + vec2(0.0, e)) * 1.3 - flow * 1.7);
vec3 wn = normalize(vec3(-(hx - h0) / e * 0.18, 1.0, -(hz - h0) / e * 0.18));
normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
`,
      );
  };
  material.customProgramCacheKey = () => 'water-v1';
  return { material, update: (t) => (uniforms.uTime.value = t) };
}
