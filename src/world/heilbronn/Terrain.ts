import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { HeilbronnMeta } from './HeilbronnData';

const CHUNK_CELLS = 64;
const LOD_LEVELS = [
  { step: 1, distance: 0 },
  { step: 2, distance: 220 },
  { step: 4, distance: 480 },
];

/**
 * Real terrain from the DGM1 elevation model: chunked render meshes + one Rapier
 * heightfield collider + fast height queries for gameplay (spawning, props, water checks).
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly minX: number;
  private readonly minZ: number;

  constructor(
    meta: HeilbronnMeta,
    private readonly heights: Float32Array,
    material: THREE.Material,
    physics: PhysicsWorld,
  ) {
    this.cols = meta.terrain.cols;
    this.rows = meta.terrain.rows;
    this.cell = meta.terrain.cell;
    this.minX = meta.bounds.minX;
    this.minZ = meta.bounds.minZ;
    this.group.name = 'terrain';
    this.buildMeshes(material);
    this.buildCollider(physics);
  }

  get extent(): { minX: number; minZ: number; maxX: number; maxZ: number } {
    return {
      minX: this.minX,
      minZ: this.minZ,
      maxX: this.minX + (this.cols - 1) * this.cell,
      maxZ: this.minZ + (this.rows - 1) * this.cell,
    };
  }

  /** Bilinearly interpolated ground height at world (x, z). */
  heightAt(x: number, z: number): number {
    const fx = THREE.MathUtils.clamp((x - this.minX) / this.cell, 0, this.cols - 1.001);
    const fz = THREE.MathUtils.clamp((z - this.minZ) / this.cell, 0, this.rows - 1.001);
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h = (rr: number, cc: number) => this.heights[rr * this.cols + cc];
    // Same triangle split as the render mesh / Rapier heightfield.
    const a = h(r, c);
    const b = h(r, c + 1);
    const d = h(r + 1, c);
    const e = h(r + 1, c + 1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(d, e, tx), tz);
  }

  private buildMeshes(material: THREE.Material): void {
    const { cols, rows } = this;
    for (let r0 = 0; r0 < rows - 1; r0 += CHUNK_CELLS) {
      for (let c0 = 0; c0 < cols - 1; c0 += CHUNK_CELLS) {
        const r1 = Math.min(r0 + CHUNK_CELLS, rows - 1);
        const c1 = Math.min(c0 + CHUNK_CELLS, cols - 1);
        // Level of detail: full 2 m grid nearby, coarser grids further away.
        // LOD switching measures distance to the object origin → place it at the chunk centre.
        const cx = this.minX + ((c0 + c1) / 2) * this.cell;
        const cz = this.minZ + ((r0 + r1) / 2) * this.cell;
        const cy = this.heights[Math.round((r0 + r1) / 2) * cols + Math.round((c0 + c1) / 2)];
        const lod = new THREE.LOD();
        lod.name = `terrain:${r0},${c0}`;
        lod.position.set(cx, cy, cz);
        lod.updateMatrix();
        lod.matrixAutoUpdate = false;
        LOD_LEVELS.forEach(({ step, distance }) => {
          const geo = this.chunkGeometry(r0, c0, r1, c1, step);
          geo.translate(-cx, -cy, -cz);
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, material);
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          lod.addLevel(mesh, distance);
        });
        this.group.add(lod);
      }
    }
  }

  /** Grid mesh for a chunk sampled every `step` cells, with skirts hiding cracks between LOD levels. */
  private chunkGeometry(r0: number, c0: number, r1: number, c1: number, step: number): THREE.BufferGeometry {
    const { cols, rows, cell, minX, minZ, heights } = this;
    const sampleIdx = (a: number, b: number) => {
      const out: number[] = [];
      for (let i = a; i < b; i += step) out.push(i);
      out.push(b);
      return out;
    };
    const rs = sampleIdx(r0, r1);
    const cs = sampleIdx(c0, c1);
    const w = cs.length;
    const hgt = rs.length;
    const positions: number[] = [];
    const normals: number[] = [];
    const vertex = (r: number, c: number, drop = 0) => {
      const y = heights[r * cols + c];
      positions.push(minX + c * cell, y - drop, minZ + r * cell);
      const hl = heights[r * cols + Math.max(c - step, 0)];
      const hr = heights[r * cols + Math.min(c + step, cols - 1)];
      const hu = heights[Math.max(r - step, 0) * cols + c];
      const hd = heights[Math.min(r + step, rows - 1) * cols + c];
      const nx = hl - hr;
      const nz = hu - hd;
      const ny = 2 * cell * step;
      const len = Math.hypot(nx, ny, nz);
      normals.push(nx / len, ny / len, nz / len);
      return positions.length / 3 - 1;
    };
    for (const r of rs) for (const c of cs) vertex(r, c);
    const idx: number[] = [];
    for (let i = 0; i < hgt - 1; i++) {
      for (let j = 0; j < w - 1; j++) {
        const a = i * w + j;
        const b = a + 1;
        const d = a + w;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    // Skirts: a 2 m curtain hanging down from every chunk edge.
    const skirt = (edge: [number, number][]) => {
      const top = edge.map(([r, c]) => rs.indexOf(r) * w + cs.indexOf(c));
      const bottom = edge.map(([r, c]) => vertex(r, c, 2));
      for (let k = 0; k < edge.length - 1; k++) {
        idx.push(top[k], bottom[k], top[k + 1], top[k + 1], bottom[k], bottom[k + 1]);
        idx.push(top[k], top[k + 1], bottom[k], top[k + 1], bottom[k + 1], bottom[k]);
      }
    };
    skirt(cs.map((c) => [r0, c] as [number, number]));
    skirt(cs.map((c) => [r1, c] as [number, number]));
    skirt(rs.map((r) => [r, c0] as [number, number]));
    skirt(rs.map((r) => [r, c1] as [number, number]));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  private buildCollider(physics: PhysicsWorld): void {
    const { cols, rows, cell } = this;
    const nrows = rows - 1; // cells along z
    const ncols = cols - 1; // cells along x
    // Rapier expects a column-major (nrows+1)×(ncols+1) matrix: index = col * (nrows+1) + row.
    const data = new Float32Array((nrows + 1) * (ncols + 1));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) data[c * rows + r] = this.heights[r * cols + c];
    }
    const sizeX = ncols * cell;
    const sizeZ = nrows * cell;
    physics.addStaticHeightfield(
      nrows,
      ncols,
      data,
      new THREE.Vector3(sizeX, 1, sizeZ),
      new THREE.Vector3(this.minX + sizeX / 2, 0, this.minZ + sizeZ / 2),
    );
  }
}
