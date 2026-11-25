import * as THREE from 'three';
import { GLSL_NOISE, GLSL_PERTURB } from './glsl';
import { ROOFS } from '../../world/heilbronn/BuildingStyles';

/**
 * Roof shader. Per vertex: roof = (u along the eaves, v up the slope (metres), code = kind | variant << 3).
 * Kinds: flat gravel, clay tiles, slate, metal, copper (green patina).
 */
export function createRoofMaterial(diffuse: THREE.DataArrayTexture, normal: THREE.DataArrayTexture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  // Closed LoD2 solids: render back faces into the shadow map → no self-shadowing acne on lit walls.
  material.shadowSide = THREE.BackSide;
  const uniforms = {
    uRoofDiff: { value: diffuse },
    uRoofNrm: { value: normal },
    uRoofLayer: { value: ROOFS.layer },
    uRoofTile: { value: ROOFS.tile },
    uRoofRough: { value: ROOFS.roughness },
    uRoofMetal: { value: ROOFS.metalness },
    uRoofPalette: { value: ROOFS.palette.flat().map((c) => new THREE.Color(c)) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 roof;\nattribute float roofRgb;\nvarying vec2 vRoof;\nflat varying int vRoofCode;\nflat varying vec3 vRoofReal;\nvarying vec3 vRoofNormalW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoof = roof.xy;\nvRoofCode = int(roof.z + 0.5);\nint rgbi = int(roofRgb + 0.5);\nvRoofReal = rgbi > 0 ? vec3(float((rgbi >> 16) & 255), float((rgbi >> 8) & 255), float(rgbi & 255)) / 255.0 : vec3(-1.0);\nvRoofNormalW = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uRoofDiff;
uniform sampler2DArray uRoofNrm;
uniform float uRoofLayer[5];
uniform float uRoofTile[5];
uniform float uRoofRough[5];
uniform float uRoofMetal[5];
uniform vec3 uRoofPalette[20];
varying vec2 vRoof;
flat varying int vRoofCode;
flat varying vec3 vRoofReal;
varying vec3 vRoofNormalW;
${GLSL_NOISE}
${GLSL_PERTURB}
vec3 rNrmSample;
int roofKind;
`,
      )
      .replace(
        '#include <map_fragment>',
        `
roofKind = min(vRoofCode & 7, 4);
float roofVariant = float(vRoofCode >> 3);
vec2 ruv = vRoof.xy / uRoofTile[roofKind];
float rl = uRoofLayer[roofKind];
vec3 rTex = texture(uRoofDiff, vec3(ruv, rl)).rgb;
vec3 rc = rTex * uRoofPalette[roofKind * 4 + int(mod(roofVariant, 4.0))];
if (vRoofReal.r >= 0.0) {
  // Real roof colour from the orthophoto (sRGB → linear), texture keeps the detail.
  vec3 real = pow(vRoofReal, vec3(2.2)) * 1.15;
  float lum = dot(rTex, vec3(0.299, 0.587, 0.114));
  float avg = roofKind == 1 ? 0.2 : 0.3;
  rc = real * clamp(lum / avg, 0.55, 1.5);
}
rc *= 0.85 + 0.25 * fbm2(vRoof.xy * 0.08 + roofVariant);
rNrmSample = texture(uRoofNrm, vec3(ruv, rl)).rgb;
diffuseColor.rgb *= rc;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uRoofRough[roofKind];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uRoofMetal[roofKind];')
      .replace(
        '#include <normal_fragment_maps>',
        `
vec3 rN = normalize(vRoofNormalW) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 rT = cross(vec3(0.0, 1.0, 0.0), rN);
rT = length(rT) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(rT);
vec3 rB = normalize(cross(rN, rT));
if (rB.y < 0.0) rB = -rB;
normal = normalize((viewMatrix * vec4(perturbWorldNormal(rN, rT, rB, rNrmSample, 1.0), 0.0)).xyz);
`,
      );
  };
  material.customProgramCacheKey = () => 'roof-v3';
  return material;
}
