import * as THREE from 'three';
import { GLSL_NOISE, GLSL_PERTURB } from './glsl';

export interface TerrainMaterialOptions {
  landuse: Uint8Array;
  landuseSize: { width: number; height: number };
  /** World-space rectangle covered by the land-use raster: minX, minZ, sizeX, sizeZ. */
  landuseRect: THREE.Vector4;
  classToLayer: number[];
  diffuse: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  /** Metres per texture repeat for each layer. */
  layerTile: number[];
  layerRoughness: number[];
  roadLayer: number;
  sidewalkLayer: number;
}

/**
 * Ground material: blends ground textures per land-use class (bilinear between the
 * four nearest raster cells → smooth 0.5 m borders), adds a curb line where sidewalk
 * meets road, and breaks up texture tiling with low-frequency variation.
 */
export function createTerrainMaterial(o: TerrainMaterialOptions): THREE.MeshStandardMaterial {
  const landuseTex = new THREE.DataTexture(o.landuse, o.landuseSize.width, o.landuseSize.height, THREE.RedFormat, THREE.UnsignedByteType);
  landuseTex.magFilter = landuseTex.minFilter = THREE.NearestFilter;
  landuseTex.generateMipmaps = false;
  landuseTex.flipY = false;
  landuseTex.needsUpdate = true;

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const uniforms = {
    uLanduse: { value: landuseTex },
    uLanduseRect: { value: o.landuseRect },
    uLanduseDims: { value: new THREE.Vector2(o.landuseSize.width, o.landuseSize.height) },
    uGroundDiff: { value: o.diffuse },
    uGroundNrm: { value: o.normal },
    uClassToLayer: { value: o.classToLayer.map((v) => v) },
    uLayerTile: { value: o.layerTile },
    uLayerRough: { value: o.layerRoughness },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2D uLanduse;
uniform vec4 uLanduseRect;
uniform vec2 uLanduseDims;
uniform sampler2DArray uGroundDiff;
uniform sampler2DArray uGroundNrm;
uniform float uClassToLayer[9];
uniform float uLayerTile[7];
uniform float uLayerRough[7];
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
${GLSL_NOISE}
${GLSL_PERTURB}
float groundClass(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uLanduseDims) - 1);
  return floor(texelFetch(uLanduse, p, 0).r * 255.0 + 0.5);
}
int layerOf(float cls) {
  int c = int(cls);
  float l = 4.0;
  for (int i = 0; i < 9; i++) if (i == c) l = uClassToLayer[i];
  return int(l);
}
float tileOf(int layer) { float t = 4.0; for (int i = 0; i < 7; i++) if (i == layer) t = uLayerTile[i]; return t; }
float roughOf(int layer) { float r = 0.9; for (int i = 0; i < 7; i++) if (i == layer) r = uLayerRough[i]; return r; }
`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec2 gp = (vGroundPos.xz - uLanduseRect.xy) / uLanduseRect.zw * uLanduseDims - 0.5;
ivec2 g0 = ivec2(floor(gp));
vec2 gf = fract(gp);
float c00 = groundClass(g0);
float c10 = groundClass(g0 + ivec2(1, 0));
float c01 = groundClass(g0 + ivec2(0, 1));
float c11 = groundClass(g0 + ivec2(1, 1));
vec4 w = vec4((1.0 - gf.x) * (1.0 - gf.y), gf.x * (1.0 - gf.y), (1.0 - gf.x) * gf.y, gf.x * gf.y);
vec3 groundCol = vec3(0.0);
vec3 groundNrmSample = vec3(0.0);
float groundRough = 0.0;
float roadW = 0.0;
float walkW = 0.0;
for (int k = 0; k < 4; k++) {
  float cls = k == 0 ? c00 : k == 1 ? c10 : k == 2 ? c01 : c11;
  float wk = k == 0 ? w.x : k == 1 ? w.y : k == 2 ? w.z : w.w;
  if (wk < 0.001) continue;
  int layer = layerOf(cls);
  vec2 uv = vGroundPos.xz / tileOf(layer);
  groundCol += texture(uGroundDiff, vec3(uv, float(layer))).rgb * wk;
  groundNrmSample += texture(uGroundNrm, vec3(uv, float(layer))).rgb * wk;
  groundRough += roughOf(layer) * wk;
  if (cls == 1.0) roadW += wk;
  if (cls == 2.0 || cls == 3.0 || cls == 7.0) walkW += wk;
}
// Steep slopes (quay walls, embankments): vertical stone projection instead of stretched ground.
float steep = smoothstep(0.75, 0.55, normalize(vGroundNormal).y);
if (steep > 0.0) {
  vec3 sn = normalize(vGroundNormal);
  vec2 wallUv = vec2(abs(sn.x) > abs(sn.z) ? vGroundPos.z : vGroundPos.x, vGroundPos.y) / 3.5;
  vec3 stone = texture(uGroundDiff, vec3(wallUv, 2.0)).rgb * vec3(0.95, 0.9, 0.85);
  groundCol = mix(groundCol, stone, steep);
  groundNrmSample = mix(groundNrmSample, vec3(0.5, 0.5, 1.0), steep);
  groundRough = mix(groundRough, 0.85, steep);
}
// Large-scale variation hides texture repetition.
float macro = fbm2(vGroundPos.xz * 0.035);
groundCol *= 0.86 + 0.26 * macro;
// Curb stones where walkable areas meet the road.
float curb = smoothstep(0.18, 0.25, min(roadW, walkW));
groundCol = mix(groundCol, vec3(0.62, 0.61, 0.58), curb * 0.85);
// Slight darkening of asphalt near curbs (dirt/water run-off).
groundCol *= 1.0 - 0.18 * smoothstep(0.0, 0.2, roadW * walkW * 4.0) * (1.0 - curb);
diffuseColor.rgb *= groundCol;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * groundRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `
vec3 gN = normalize(vGroundNormal);
vec3 gT = normalize(cross(vec3(0.0, 0.0, 1.0), gN)); // +X on flat ground (u = x)
vec3 gB = normalize(cross(gT, gN));                   // +Z on flat ground (v = z)
vec3 nW = perturbWorldNormal(gN, gT, gB, groundNrmSample, 0.9);
normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-landuse-v2';
  return material;
}
