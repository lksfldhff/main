import * as THREE from 'three';
import { GLSL_NOISE } from './glsl';

/** Marking types (must match tools/geo/osm.py). */
export const Mark = { Solid: 0, Dashed: 1, Rail: 2 } as const;

/**
 * Road paint and tram rails, draped as thin ribbons on the terrain.
 * Per vertex: mark = (distance along the line in metres, type).
 * Dashes follow the German urban standard (3 m line, 6 m gap); paint is slightly worn.
 */
export function createMarkingsMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 mark;\nvarying vec2 vMark;\nvarying vec3 vMarkPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMark = mark;\nvMarkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vMark;\nvarying vec3 vMarkPos;\n${GLSL_NOISE}\nfloat mkMetal;\nfloat mkRough;`)
      .replace(
        '#include <map_fragment>',
        `
int mkType = int(vMark.y + 0.5);
if (mkType == 1 && fract(vMark.x / 9.0) > 0.333) discard;
float wear = fbm2(vMarkPos.xz * 3.0);
vec3 paint = vec3(0.92, 0.92, 0.88) * (0.78 + 0.22 * wear);
mkMetal = 0.0;
mkRough = 0.6;
if (mkType == 2) { paint = vec3(0.48, 0.47, 0.45); mkMetal = 0.85; mkRough = 0.35; }
diffuseColor.rgb *= paint;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mkRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mkMetal;');
  };
  material.customProgramCacheKey = () => 'markings-v1';
  return material;
}
