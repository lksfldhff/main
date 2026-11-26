import * as THREE from 'three';
import { GLSL_NOISE } from '../../rendering/materials/glsl';
import type { HeilbronnMeta } from './HeilbronnData';

/** Module types – must match tools/geo/facades.py. */
export const Module = { Window: 0, Shop: 1, Door: 2, Balcony: 3, Chimney: 4 } as const;
const STRIDE = 10;
const SHUTTER = 99; // anchor sentinel: y follows the per-instance shutter position

/** Surface parts inside a module (selects the material response in the shader). */
const P = { Reveal: 0, Glass: 1, Frame: 2, Stone: 3, Shutter: 4, Trim: 5, Awning: 6, DoorLeaf: 7, Slab: 8, Railing: 9, Rail: 10, Brick: 11, ShopGlass: 12, ShopFrame: 13 };

/**
 * Builds module geometry whose vertices are (anchor × instance size + fixed offset):
 * frames, sills and reveals keep their real thickness for every window size ("9-slice").
 */
class ModuleBuilder {
  private pos: number[] = [];
  private anchor: number[] = [];
  private nrm: number[] = [];

  /** x/y given as [anchor, offset]; z absolute (metres, +z = out of the wall). */
  quad(c: [number, number, number, number, number][], n: [number, number, number], part: number): void {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [ax, ox, ay, oy, z] = c[i];
      this.pos.push(ox, oy, z);
      this.anchor.push(ax, ay, part);
      this.nrm.push(...n);
    }
  }

  box(x0: [number, number], x1: [number, number], y0: [number, number], y1: [number, number], z0: number, z1: number, part: number, faces = 'xyzXYZ'): void {
    const c = (x: [number, number], y: [number, number], z: number): [number, number, number, number, number] => [x[0], x[1], y[0], y[1], z];
    if (faces.includes('Z')) this.quad([c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], [0, 0, 1], part);
    if (faces.includes('z')) this.quad([c(x1, y0, z0), c(x0, y0, z0), c(x0, y1, z0), c(x1, y1, z0)], [0, 0, -1], part);
    if (faces.includes('Y')) this.quad([c(x0, y1, z1), c(x1, y1, z1), c(x1, y1, z0), c(x0, y1, z0)], [0, 1, 0], part);
    if (faces.includes('y')) this.quad([c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)], [0, -1, 0], part);
    if (faces.includes('X')) this.quad([c(x1, y0, z1), c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1)], [1, 0, 0], part);
    if (faces.includes('x')) this.quad([c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0)], [-1, 0, 0], part);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('kitAnchor', new THREE.Float32BufferAttribute(this.anchor, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    return g;
  }
}

const L: [number, number] = [-0.5, 0];
const R: [number, number] = [0.5, 0];
const B: [number, number] = [-0.5, 0];
const T: [number, number] = [0.5, 0];
const a = (anchor: number, offset: number): [number, number] => [anchor, offset];

function windowModule(): THREE.BufferGeometry {
  const m = new ModuleBuilder();
  const D = -0.22;
  // reveal (Laibung)
  m.quad([[-0.5, 0, 0.5, 0, 0], [0.5, 0, 0.5, 0, 0], [0.5, 0, 0.5, 0, D], [-0.5, 0, 0.5, 0, D]], [0, -1, 0], P.Reveal);
  m.quad([[-0.5, 0, -0.5, 0, D], [0.5, 0, -0.5, 0, D], [0.5, 0, -0.5, 0, 0], [-0.5, 0, -0.5, 0, 0]], [0, 1, 0], P.Reveal);
  m.quad([[-0.5, 0, -0.5, 0, 0], [-0.5, 0, 0.5, 0, 0], [-0.5, 0, 0.5, 0, D], [-0.5, 0, -0.5, 0, D]], [1, 0, 0], P.Reveal);
  m.quad([[0.5, 0, -0.5, 0, D], [0.5, 0, 0.5, 0, D], [0.5, 0, 0.5, 0, 0], [0.5, 0, -0.5, 0, 0]], [-1, 0, 0], P.Reveal);
  // glass
  m.quad([[-0.5, 0, -0.5, 0, -0.15], [0.5, 0, -0.5, 0, -0.15], [0.5, 0, 0.5, 0, -0.15], [-0.5, 0, 0.5, 0, -0.15]], [0, 0, 1], P.Glass);
  // frame ring, mullion, transom
  const f = 0.07;
  m.box(L, a(-0.5, f), B, T, -0.17, -0.1, P.Frame, 'ZXY');
  m.box(a(0.5, -f), R, B, T, -0.17, -0.1, P.Frame, 'ZxY');
  m.box(L, R, a(0.5, -f), T, -0.17, -0.1, P.Frame, 'Zy');
  m.box(L, R, B, a(-0.5, f), -0.17, -0.1, P.Frame, 'ZY');
  m.box(a(0, -0.03), a(0, 0.03), B, T, -0.165, -0.11, P.Frame, 'ZxX');
  m.box(L, R, a(0.18, -0.03), a(0.18, 0.03), -0.165, -0.11, P.Frame, 'ZyY');
  // roller shutter (height per instance)
  m.quad([[-0.5, f, SHUTTER, 0, -0.12], [0.5, -f, SHUTTER, 0, -0.12], [0.5, -f, 0.5, -f, -0.12], [-0.5, f, 0.5, -f, -0.12]], [0, 0, 1], P.Shutter);
  // sill and lintel
  m.box(a(-0.5, -0.09), a(0.5, 0.09), a(-0.5, -0.06), B, -0.1, 0.12, P.Stone, 'ZYyxX');
  m.box(a(-0.5, -0.1), a(0.5, 0.1), a(0.5, 0.03), a(0.5, 0.12), 0, 0.05, P.Trim, 'ZYyxX');
  return m.build();
}

function shopModule(): THREE.BufferGeometry {
  const m = new ModuleBuilder();
  const D = -0.12;
  m.quad([[-0.5, 0, 0.5, 0, 0], [0.5, 0, 0.5, 0, 0], [0.5, 0, 0.5, 0, D], [-0.5, 0, 0.5, 0, D]], [0, -1, 0], P.Reveal);
  m.quad([[-0.5, 0, -0.5, 0, 0], [-0.5, 0, 0.5, 0, 0], [-0.5, 0, 0.5, 0, D], [-0.5, 0, -0.5, 0, D]], [1, 0, 0], P.Reveal);
  m.quad([[0.5, 0, -0.5, 0, D], [0.5, 0, 0.5, 0, D], [0.5, 0, 0.5, 0, 0], [0.5, 0, -0.5, 0, 0]], [-1, 0, 0], P.Reveal);
  m.quad([[-0.5, 0, -0.5, 0, -0.1], [0.5, 0, -0.5, 0, -0.1], [0.5, 0, 0.5, 0, -0.1], [-0.5, 0, 0.5, 0, -0.1]], [0, 0, 1], P.ShopGlass);
  const f = 0.06;
  m.box(L, a(-0.5, f), B, T, -0.11, -0.05, P.ShopFrame, 'ZX');
  m.box(a(0.5, -f), R, B, T, -0.11, -0.05, P.ShopFrame, 'Zx');
  m.box(L, R, a(0.5, -f), T, -0.11, -0.05, P.ShopFrame, 'Zy');
  m.box(L, R, B, a(-0.5, 0.12), -0.11, -0.02, P.ShopFrame, 'ZY');
  m.box(L, R, a(0.3, -0.025), a(0.3, 0.025), -0.11, -0.06, P.ShopFrame, 'ZyY');
  m.box(a(0, -0.03), a(0, 0.03), B, a(0.3, 0), -0.11, -0.06, P.ShopFrame, 'ZxX');
  // awning (shown on some instances)
  m.quad([[-0.5, -0.15, 0.5, 0.42, 0.02], [0.5, 0.15, 0.5, 0.42, 0.02], [0.5, 0.15, 0.5, -0.12, 1.15], [-0.5, -0.15, 0.5, -0.12, 1.15]], [0, 0.9, 0.45], P.Awning);
  return m.build();
}

function doorModule(): THREE.BufferGeometry {
  const m = new ModuleBuilder();
  // stone portal
  m.box(a(-0.5, -0.16), L, B, a(0.5, 0.16), 0, 0.09, P.Trim, 'ZxXY');
  m.box(R, a(0.5, 0.16), B, a(0.5, 0.16), 0, 0.09, P.Trim, 'ZxXY');
  m.box(L, R, T, a(0.5, 0.16), 0, 0.09, P.Trim, 'Zy');
  // leaf + transom light
  m.quad([[-0.5, 0, -0.5, 0, 0.03], [0.5, 0, -0.5, 0, 0.03], [0.5, 0, 0.5, -0.45, 0.03], [-0.5, 0, 0.5, -0.45, 0.03]], [0, 0, 1], P.DoorLeaf);
  m.quad([[-0.5, 0, 0.5, -0.4, 0.035], [0.5, 0, 0.5, -0.4, 0.035], [0.5, 0, 0.5, -0.03, 0.035], [-0.5, 0, 0.5, -0.03, 0.035]], [0, 0, 1], P.Glass);
  m.box(L, R, a(0.5, -0.45), a(0.5, -0.4), 0.03, 0.06, P.Frame, 'ZyY');
  // step
  m.box(a(-0.5, -0.28), a(0.5, 0.28), a(-0.5, -0.02), a(-0.5, 0.14), 0, 0.42, P.Stone, 'ZYxX');
  return m.build();
}

function balconyModule(): THREE.BufferGeometry {
  const m = new ModuleBuilder();
  // balcony door (glass) with frame
  m.quad([[-0.5, 0, -0.5, 0, 0.02], [0.5, 0, -0.5, 0, 0.02], [0.5, 0, 0.5, 0, 0.02], [-0.5, 0, 0.5, 0, 0.02]], [0, 0, 1], P.Glass);
  m.box(L, a(-0.5, 0.07), B, T, 0.0, 0.06, P.Frame, 'ZX');
  m.box(a(0.5, -0.07), R, B, T, 0.0, 0.06, P.Frame, 'Zx');
  m.box(L, R, a(0.5, -0.07), T, 0.0, 0.06, P.Frame, 'Zy');
  m.box(a(0, -0.03), a(0, 0.03), B, T, 0.0, 0.05, P.Frame, 'ZxX');
  // slab
  m.box(a(-0.5, -0.32), a(0.5, 0.32), a(-0.5, -0.18), B, 0, 1.32, P.Slab);
  // railing panels (bars are cut in the shader) and handrail
  m.quad([[-0.5, -0.3, -0.5, 0, 1.28], [0.5, 0.3, -0.5, 0, 1.28], [0.5, 0.3, -0.5, 1.0, 1.28], [-0.5, -0.3, -0.5, 1.0, 1.28]], [0, 0, 1], P.Railing);
  m.quad([[-0.5, -0.3, -0.5, 0, 0], [-0.5, -0.3, -0.5, 0, 1.28], [-0.5, -0.3, -0.5, 1.0, 1.28], [-0.5, -0.3, -0.5, 1.0, 0]], [-1, 0, 0], P.Railing);
  m.quad([[0.5, 0.3, -0.5, 0, 1.28], [0.5, 0.3, -0.5, 0, 0], [0.5, 0.3, -0.5, 1.0, 0], [0.5, 0.3, -0.5, 1.0, 1.28]], [1, 0, 0], P.Railing);
  m.box(a(-0.5, -0.32), a(0.5, 0.32), a(-0.5, 0.98), a(-0.5, 1.04), 1.24, 1.31, P.Rail);
  return m.build();
}

function chimneyModule(): THREE.BufferGeometry {
  const m = new ModuleBuilder();
  m.box(a(0, -0.31), a(0, 0.31), [0, -0.6], [1, 0], -0.31, 0.31, P.Brick, 'xyzXYZ'.replace('y', ''));
  m.box(a(0, -0.36), a(0, 0.36), [1, 0], [1, 0.08], -0.36, 0.36, P.Frame);
  return m.build();
}

const KIT_VERTEX_HEAD = `
attribute vec3 kitAnchor;
attribute vec2 iSize;
attribute float iRand;
attribute vec3 iColor;
varying float vPart;
varying float vRand;
varying vec3 vKitColor;
varying vec3 vKitLocal;
varying vec2 vKitSize;`;

/** Module vertex = anchor × instance size + fixed offset; optional parts collapse per instance. */
const KIT_BEGIN_VERTEX = `
float ay = kitAnchor.y;
float shutterFrac = iRand < 0.42 ? 0.15 + iRand * 1.6 : 0.0;
if (ay > 50.0) ay = 0.5 - min(shutterFrac, 0.95);
vec3 transformed = vec3(kitAnchor.x * iSize.x + position.x, ay * iSize.y + position.y, position.z);
vPart = kitAnchor.z;
if (vPart > 3.5 && vPart < 4.5 && shutterFrac <= 0.0) transformed = vec3(0.0);
if (vPart > 5.5 && vPart < 6.5 && iRand > 0.45) transformed = vec3(0.0);
vRand = iRand;
vKitColor = iColor;
vKitLocal = transformed;
vKitSize = iSize;
`;

/** Shadow-map material with the same module deformation. */
function createKitDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${KIT_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', KIT_BEGIN_VERTEX);
  };
  m.customProgramCacheKey = () => 'facade-kit-depth-v1';
  return m;
}

function createKitMaterial(maxDist: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKitMaxDist = maxDist;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uKitMaxDist;
${KIT_VERTEX_HEAD}`,
      )
      .replace('#include <begin_vertex>', KIT_BEGIN_VERTEX)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec3 kitCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
if (distance(kitCenter, cameraPosition) > uKitMaxDist) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vPart;
varying float vRand;
varying vec3 vKitColor;
varying vec3 vKitLocal;
varying vec2 vKitSize;
${GLSL_NOISE}
float kRough;
float kMetal;
vec3 kEmissive;`,
      )
      .replace(
        '#include <map_fragment>',
        `
int part = int(vPart + 0.5);
vec3 c = vec3(0.9);
kRough = 0.8; kMetal = 0.0; kEmissive = vec3(0.0);
float grain = 0.92 + 0.12 * valueNoise(vKitLocal.xy * 9.0 + vRand * 17.0);
if (part == 0) { c = vKitColor * 0.78 * grain; kRough = 0.92; }
else if (part == 1 || part == 12) {
  c = mix(vec3(0.36, 0.43, 0.48), vec3(0.24, 0.29, 0.33), vRand);
  kRough = 0.05; kMetal = 0.8;
  if (part == 1 && vRand > 0.62 && vKitLocal.y > vKitSize.y * (0.18 + 0.2 * vRand)) { c = vec3(0.82, 0.78, 0.7); kRough = 0.8; kMetal = 0.0; }
  if (part == 12) {
    // Shop window: less mirror-like than upper windows so the lit interior reads through –
    // a cheap fake interior (back wall, shelves with goods) instead of a blank reflective panel.
    vec2 q = vKitLocal.xy + vec2(vRand * 13.0, 0.0);
    float y01 = clamp(vKitLocal.y / max(vKitSize.y, 0.1) + 0.5, 0.0, 1.0);
    vec3 backWall = mix(vec3(0.33, 0.3, 0.27), vec3(0.24, 0.27, 0.3), vRand);
    float shelf = step(0.82, fract(y01 * 4.0));
    vec2 cellId = floor(vec2(q.x * 2.2, y01 * 4.0));
    vec3 goods = mix(vec3(0.35), vec3(hash12(cellId), hash12(cellId + 3.1), hash12(cellId + 7.7)), 0.55) * 0.7 + 0.05;
    float hasGoods = step(0.35, hash12(cellId + vRand)) * step(0.15, y01) * step(y01, 0.85);
    c = mix(backWall, goods, hasGoods * 0.8);
    c = mix(c, vec3(0.55, 0.52, 0.48), shelf * step(0.15, y01));
    // Interiors are much darker than the sunlit street: tiny diffuse part, the rest is "interior light".
    kEmissive = c * vec3(1.0, 0.9, 0.75) * (0.2 + 0.14 * vRand);
    c *= 0.12;
    kMetal = 0.1; kRough = 0.07;
  }
}
else if (part == 2) { c = vec3(0.93, 0.92, 0.9); kRough = 0.45; }
else if (part == 3) { c = vec3(0.74, 0.72, 0.67) * grain; kRough = 0.8; }
else if (part == 4) { c = mix(vec3(0.62, 0.6, 0.56), vec3(0.75, 0.73, 0.68), vRand) * (0.86 + 0.14 * step(0.5, fract(vKitLocal.y * 16.0))); kRough = 0.55; }
else if (part == 5) { c = min(vKitColor * 1.04, vec3(1.0)) * grain; kRough = 0.85; }
else if (part == 6) {
  vec3 acc = vRand < 0.15 ? vec3(0.62, 0.12, 0.1) : vRand < 0.3 ? vec3(0.12, 0.3, 0.28) : vec3(0.85, 0.66, 0.22);
  c = mix(acc, vec3(0.92, 0.9, 0.84), step(0.5, fract(vKitLocal.x * 1.6))); kRough = 0.9;
}
else if (part == 7) {
  vec3 leaf = vRand < 0.25 ? vec3(0.17, 0.24, 0.2) : vRand < 0.5 ? vec3(0.3, 0.2, 0.13) : vRand < 0.75 ? vec3(0.15, 0.16, 0.18) : vec3(0.36, 0.14, 0.12);
  float panel = step(0.06, abs(fract(vKitLocal.y * 1.2) - 0.5)) * step(0.05, abs(vKitLocal.x));
  c = leaf * (0.8 + 0.2 * panel) * grain; kRough = 0.55;
}
else if (part == 8) { c = vec3(0.68, 0.67, 0.64) * grain; kRough = 0.9; }
else if (part == 9) {
  if (fract((vKitLocal.x + vKitLocal.z) * 8.0) > 0.22 && vKitLocal.y > -vKitSize.y * 0.5 + 0.08) discard;
  c = vec3(0.16, 0.17, 0.18); kRough = 0.45; kMetal = 0.6;
}
else if (part == 10) { c = vec3(0.16, 0.17, 0.18); kRough = 0.4; kMetal = 0.6; }
else if (part == 11) {
  vec2 bp = vec2(vKitLocal.x + vKitLocal.z, vKitLocal.y) * vec2(4.0, 13.0);
  bp.x += step(1.0, mod(floor(bp.y), 2.0)) * 0.5;
  float mortar = step(0.9, fract(bp.x)) + step(0.85, fract(bp.y));
  c = mix(vKitColor * grain, vec3(0.7, 0.68, 0.64), clamp(mortar, 0.0, 1.0)); kRough = 0.9;
}
else if (part == 13) { c = vec3(0.19, 0.2, 0.22); kRough = 0.4; kMetal = 0.55; }
diffuseColor.rgb *= c;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = kMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += kEmissive;');
  };
  material.customProgramCacheKey = () => 'facade-kit-v1';
  return material;
}

/**
 * Instanced 3D facade modules from tools/geo/facades.py: windows with reveals, frames,
 * sills and roller shutters; shop fronts with awnings; doors at real house-number
 * positions; balconies; chimneys. One InstancedMesh per (chunk, module type), one material.
 */
export class FacadeKit {
  readonly group = new THREE.Group();
  /** Shared with the facade shader (openings are cut where modules are shown). */
  readonly distance = { value: 160 };
  private readonly chimneyDistance = { value: 700 };
  private readonly chunks: { center: THREE.Vector3; meshes: THREE.InstancedMesh[] }[] = [];
  private readonly depthMaterial = createKitDepthMaterial();
  instanceCount = 0;

  constructor(meta: HeilbronnMeta, buffer: ArrayBuffer) {
    this.group.name = 'facade-kit';
    const kit = meta.kit;
    if (!kit) return;
    const geos = [windowModule(), shopModule(), doorModule(), balconyModule(), chimneyModule()];
    const material = createKitMaterial(this.distance);
    const chimneyMaterial = createKitMaterial(this.chimneyDistance);
    const data = new Float32Array(buffer);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const ch of kit.chunks) {
      const start = ch.offset / 4;
      const byType: number[][] = [[], [], [], [], []];
      for (let i = 0; i < ch.count; i++) byType[data[start + i * STRIDE + 7]]?.push(start + i * STRIDE);
      const meshes: THREE.InstancedMesh[] = [];
      const center = new THREE.Vector3();
      byType.forEach((list, type) => {
        if (list.length === 0) return;
        const geo = geos[type].clone();
        const size = new Float32Array(list.length * 2);
        const rand = new Float32Array(list.length);
        const color = new Float32Array(list.length * 3);
        const mesh = new THREE.InstancedMesh(geo, type === Module.Chimney ? chimneyMaterial : material, list.length);
        list.forEach((o, i) => {
          const pos = new THREE.Vector3(data[o], data[o + 1], data[o + 2]);
          center.add(pos);
          q.setFromAxisAngle(up, Math.atan2(data[o + 3], data[o + 4]));
          mesh.setMatrixAt(i, m.compose(pos, q, one));
          size[i * 2] = data[o + 5];
          size[i * 2 + 1] = data[o + 6];
          rand[i] = data[o + 8];
          const rgb = Math.round(data[o + 9]);
          color[i * 3] = Math.pow(((rgb >> 16) & 255) / 255, 2.2);
          color[i * 3 + 1] = Math.pow(((rgb >> 8) & 255) / 255, 2.2);
          color[i * 3 + 2] = Math.pow((rgb & 255) / 255, 2.2);
        });
        geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
        geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(rand, 1));
        geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
        mesh.computeBoundingSphere();
        mesh.castShadow = type === Module.Chimney || type === Module.Balcony;
        mesh.customDepthMaterial = this.depthMaterial;
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        this.group.add(mesh);
        // Chimneys stay visible over the whole city (cheap, important for the roofscape).
        if (type !== Module.Chimney) meshes.push(mesh);
        this.instanceCount += list.length;
      });
      const total = byType.reduce((n, l) => n + l.length, 0);
      if (total) this.chunks.push({ center: center.divideScalar(total), meshes });
    }
  }

  /** Quality setting: 0 disables 3D modules (painted facades only). */
  setDistance(d: number): void {
    this.distance.value = d;
  }

  /** Chunk-level culling: skip whole chunks far beyond the module distance. */
  update(camera: THREE.Vector3): void {
    const limit = this.distance.value + 160;
    for (const c of this.chunks) {
      const near = c.center.distanceTo(camera) < limit;
      for (const mesh of c.meshes) mesh.visible = near;
    }
  }
}
