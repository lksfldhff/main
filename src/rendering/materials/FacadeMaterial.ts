import * as THREE from 'three';
import { GLSL_NOISE, GLSL_PERTURB } from './glsl';
import { SHOP_ACCENTS, STYLES } from '../../world/heilbronn/BuildingStyles';

/**
 * Procedural facade shader for real LoD2 wall polygons.
 * Per vertex: facade = (u: metres along the wall, h: metres above the building's ground,
 * wallLength, packed code = style | shop << 4 | variant << 5).
 * The shader lays out window bays and floors so they always fit the real wall, draws frames,
 * sills, recess shadows, shop fronts, plinths and floor bands, and gives glass a reflective
 * PBR response (sky reflections via the environment map) with a few lit interiors.
 */
export function createFacadeMaterial(
  diffuse: THREE.DataArrayTexture,
  normal: THREE.DataArrayTexture,
  /** Distance up to which 3D facade modules (FacadeKit) replace painted openings on kit walls. */
  kitDistance: { value: number } = { value: 0 },
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  // Closed LoD2 solids: render back faces into the shadow map → no self-shadowing acne on lit walls.
  material.shadowSide = THREE.BackSide;
  const palette = STYLES.palette.flat().map((c) => new THREE.Color(c));
  const uniforms = {
    uWallDiff: { value: diffuse },
    uWallNrm: { value: normal },
    uWallLayer: { value: STYLES.wallLayer },
    uWallTile: { value: STYLES.wallTile },
    uFloorH: { value: STYLES.floorHeight },
    uGroundH: { value: STYLES.groundHeight },
    uBayW: { value: STYLES.bayWidth },
    uWindow: { value: STYLES.window.map((w) => new THREE.Vector3(...w)) },
    uFrameDark: { value: STYLES.frameDark },
    uPalette: { value: palette },
    uAccents: { value: SHOP_ACCENTS.map((c) => new THREE.Color(c)) },
    uKitDist: kitDistance,
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 facade;\nvarying vec3 vFacade;\nflat varying int vFacadeCode;\nvarying vec3 vWallNormalW;\nvarying vec3 vFacadeWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade.xyz;\nvFacadeCode = int(facade.w + 0.5);\nvWallNormalW = normalize(mat3(modelMatrix) * objectNormal);\nvFacadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uWallDiff;
uniform sampler2DArray uWallNrm;
uniform float uWallLayer[10];
uniform float uWallTile[10];
uniform float uFloorH[10];
uniform float uGroundH[10];
uniform float uBayW[10];
uniform vec3 uWindow[10];
uniform float uFrameDark[10];
uniform vec3 uPalette[80];
uniform vec3 uAccents[8];
uniform float uKitDist;
varying vec3 vFacadeWorld;
varying vec3 vFacade;
flat varying int vFacadeCode;
varying vec3 vWallNormalW;
${GLSL_NOISE}
${GLSL_PERTURB}
// Outputs of the facade evaluation, consumed by later chunks.
float fGlass;
float fRough;
float fMetal;
vec3 fEmissive;
vec3 fNrmSample;
float fNrmStrength;
`,
      )
      .replace(
        '#include <map_fragment>',
        `
// The packed code must not be interpolated (rounding would corrupt the bit fields) → flat int.
int style = min(vFacadeCode & 15, 9);
float shop = float((vFacadeCode >> 4) & 1);
float variant = float((vFacadeCode >> 5) & 255);
int wallMat = (vFacadeCode >> 13) & 7; // OSM building:material override
bool blindWall = ((vFacadeCode >> 16) & 1) == 1; // party / fire wall: no openings
bool kitWall = ((vFacadeCode >> 17) & 1) == 1;   // 3D modules exist for every opening
float u = vFacade.x;
float h = vFacade.y;
float wallLen = vFacade.z;

float layer = uWallLayer[style];
float wallTile = uWallTile[style];
vec3 tint = uPalette[style * 8 + int(mod(variant, 8.0))];
if (wallMat == 2) { layer = 2.0; wallTile = 4.5; tint = vec3(0.86, 0.62, 0.52); }      // sandstone
else if (wallMat == 3) { layer = 1.0; wallTile = 2.2; tint = vec3(1.0); }              // brick
else if (wallMat == 5) { layer = 3.0; wallTile = 3.0; tint = vec3(0.85, 0.84, 0.8); }  // concrete
else if (wallMat == 6) { layer = 4.0; wallTile = 2.5; tint = vec3(0.8, 0.83, 0.85); }  // metal
vec2 wallUV = vec2(u, h) / wallTile;
vec3 col = texture(uWallDiff, vec3(wallUV, layer)).rgb * tint;
fNrmSample = texture(uWallNrm, vec3(wallUV, layer)).rgb;
fNrmStrength = 1.0;
fRough = 0.88;
fMetal = 0.0;
fGlass = 0.0;
fEmissive = vec3(0.0);

// Subtle dirt/weathering: darker towards the ground, streaks below windows.
float grime = fbm2(vec2(u * 0.35, h * 0.12) + variant);
col *= 0.9 + 0.12 * grime;
col *= mix(0.82, 1.0, smoothstep(0.0, 1.6, h));

vec3 win = uWindow[style];
float groundH = uGroundH[style];
float floorH = uFloorH[style];
bool hasWindows = win.y > 0.0 && wallLen > 1.6 && !blindWall;
// Pixel footprint in metres: fade procedural detail to its average when it gets sub-pixel (prevents shimmering).
float footprint = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(h), dFdy(h))));
float detailFade = smoothstep(0.06, 0.22, footprint);
vec3 wallOnly = col;
float windowCoverage = 0.0;
if (hasWindows) {
  float bayW = uBayW[style];
  float bays = max(1.0, floor(wallLen / bayW + 0.5));
  float bw = wallLen / bays;
  float bayIdx = floor(u / bw);
  float lu = u - (bayIdx + 0.5) * bw;
  bool isGround = h < groundH;
  float lv = isGround ? h : mod(h - groundH, floorH);
  float floorIdx = isGround ? 0.0 : 1.0 + floor((h - groundH) / floorH);

  float ww = win.x > 0.0 ? min(win.x, bw - 0.45) : bw + win.x;
  float wh = win.y;
  float sill = win.z;
  bool ribbon = win.x < 0.0;
  bool isShop = isGround && shop > 0.5;
  if (isGround && !ribbon) {
    if (isShop) {
      ww = bw - 0.35;
      sill = 0.35;
      wh = groundH - 1.25;
    } else {
      sill = 1.0;
      wh = min(wh, groundH - 1.7);
    }
  }
  if (isGround && ribbon && style != 5) {
    // Modern ground floors: tall glazing.
    sill = 0.15;
    wh = groundH - 0.6;
  }
  float frame = ribbon ? 0.05 : 0.075;
  windowCoverage = clamp(ww / bw, 0.0, 1.0) * clamp(wh / (isGround ? groundH : floorH), 0.0, 1.0);
  float dx = abs(lu) - ww * 0.5;
  float dy = max(sill - lv, lv - (sill + wh));
  if (style == 4) {
    // Gothic lancet windows: pointed arch on top.
    float top = sill + wh;
    float archH = ww * 0.9;
    if (lv > top - archH) {
      float t = (lv - (top - archH)) / archH;
      dx = abs(lu) - ww * 0.5 * sqrt(max(1.0 - t * t, 0.0));
    }
  }
  bool inside = dx < 0.0 && dy < 0.0;
  vec3 frameCol = uFrameDark[style] > 0.5 ? vec3(0.16, 0.18, 0.2) : vec3(0.93, 0.92, 0.89);

  // Near the camera, 3D modules (reveal, frame, glass, sill) take over: cut the opening.
  // Hole radius is 4 m smaller than the module radius, so a module always fills the hole.
  if (inside && kitWall && distance(vFacadeWorld, cameraPosition) < uKitDist - 4.0) discard;
  if (inside) {
    bool onFrame = dx > -frame || dy > -frame;
    // Mullions / transoms
    if (ribbon) {
      onFrame = onFrame || abs(lu) > ww * 0.5 - frame;
    } else if (style == 4) {
      onFrame = onFrame || abs(lu) < frame * 0.4 || mod(lv - sill, 0.9) < frame * 0.5;
    } else if (!isShop) {
      onFrame = onFrame || abs(lu) < frame * 0.5;
      onFrame = onFrame || abs(lv - (sill + wh * 0.68)) < frame * 0.5;
    } else {
      onFrame = onFrame || abs(lv - (sill + wh * 0.8)) < frame * 0.5;
    }
    if (onFrame) {
      col = frameCol;
      fRough = 0.5;
      fNrmStrength = 0.0;
    } else {
      float rnd = hash12(vec2(bayIdx * 7.31 + variant, floorIdx * 3.17 + wallLen));
      vec3 glass = mix(vec3(0.42, 0.5, 0.56), vec3(0.3, 0.36, 0.4), rnd);
      if (style == 3) glass = mix(vec3(0.78, 0.86, 0.88), vec3(0.66, 0.76, 0.8), rnd); // bright science-centre glazing
      if (style == 4) glass = mix(vec3(0.32, 0.36, 0.48), vec3(0.45, 0.32, 0.3), step(0.5, fract((lu + lv) * 1.7))); // stained glass
      // Curtains / blinds in some windows
      float curtain = (!isShop && !ribbon && rnd > 0.55) ? step(sill + wh * (0.72 + 0.2 * rnd), lv) : 0.0;
      col = mix(glass, vec3(0.78, 0.74, 0.66), curtain);
      fGlass = 1.0 - curtain;
      fRough = mix(0.04, 0.7, curtain);
      fMetal = fGlass * (style == 3 ? 0.35 : 0.85);
      fNrmStrength = 0.0;
      // Shop interiors (back wall, shelves, goods – much darker than the sunlit street) and a few lit rooms
      if (isShop) {
        float y01 = clamp((lv - sill) / wh, 0.0, 1.0);
        vec2 cellId = floor(vec2((u + rnd * 13.0) * 2.2, y01 * 4.0));
        vec3 goods = mix(vec3(0.35), vec3(hash12(cellId), hash12(cellId + 3.1), hash12(cellId + 7.7)), 0.55) * 0.7 + 0.05;
        vec3 interior = mix(mix(vec3(0.33, 0.3, 0.27), vec3(0.24, 0.27, 0.3), rnd), goods, step(0.35, hash12(cellId + rnd)) * step(0.15, y01) * step(y01, 0.85) * 0.8);
        interior = mix(interior, vec3(0.55, 0.52, 0.48), step(0.82, fract(y01 * 4.0)) * step(0.15, y01));
        col = interior * 0.12;
        fMetal = 0.1;
        fRough = 0.07;
        fEmissive = interior * vec3(1.0, 0.9, 0.75) * (0.2 + 0.14 * rnd);
      } else if (rnd > 0.93) {
        fEmissive = vec3(1.0, 0.82, 0.55) * 0.12;
      }
    }
  } else {
    // Recess shadow just outside the window + light sill below it
    float ring = max(dx, dy);
    if (ring < 0.1) col *= 0.72 + 2.8 * ring;
    if (!ribbon && abs(lu) < ww * 0.5 + 0.09 && lv < sill && lv > sill - 0.09) {
      col = frameCol * 0.95;
      fNrmStrength = 0.2;
    }
    // Shop fascia (sign band) with accent colour
    if (isShop && lv > sill + wh + 0.15 && lv < groundH - 0.2 && abs(lu) < bw * 0.5 - 0.05) {
      col = uAccents[int(mod(variant, 8.0))];
      fRough = 0.45;
      fNrmStrength = 0.0;
    }
  }
  // Floor bands (cornices) on classic buildings
  if ((style == 0 || style == 7 || style == 1 || style == 9) && !isGround && lv < 0.16) col *= 0.88;
  if ((style == 0 || style == 7 || style == 9) && isGround && h > groundH - 0.22) col *= 0.85;
}
if (detailFade > 0.0) {
  vec3 avg = mix(wallOnly, vec3(0.34, 0.4, 0.45), windowCoverage * 0.85);
  col = mix(col, avg, detailFade);
  fRough = mix(fRough, mix(0.88, 0.25, windowCoverage), detailFade);
  fMetal = mix(fMetal, windowCoverage * 0.5, detailFade);
  fGlass *= 1.0 - detailFade;
  fNrmStrength = mix(fNrmStrength, 0.4, detailFade);
}
// Plinth
if (h < 0.45 && style != 3) col *= 0.7;
diffuseColor.rgb *= col;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        `
vec3 wN = normalize(vWallNormalW) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 wT = cross(vec3(0.0, 1.0, 0.0), wN);
wT = length(wT) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(wT);
vec3 wB = normalize(cross(wN, wT));
vec3 nW = perturbWorldNormal(wN, wT, wB, fNrmSample, fNrmStrength);
normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmissive;');
  };
  material.customProgramCacheKey = () => 'facade-v6';
  return material;
}
