/** Shared GLSL helpers injected into custom materials. */
export const GLSL_NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  return valueNoise(p) * 0.65 + valueNoise(p * 2.7 + 13.1) * 0.35;
}
`;

/** Turns a tangent-space normal-map sample into a world normal (T, B, N in world space). */
export const GLSL_PERTURB = /* glsl */ `
vec3 perturbWorldNormal(vec3 N, vec3 T, vec3 B, vec3 mapN, float strength) {
  mapN = mapN * 2.0 - 1.0;
  mapN.xy *= strength;
  return normalize(T * mapN.x + B * mapN.y + N * mapN.z);
}
`;
