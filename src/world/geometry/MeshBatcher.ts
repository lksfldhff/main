import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects static geometry per (chunk, material) and merges it into a few large meshes.
 * Result: few draw calls, while per-chunk bounding volumes still allow frustum culling.
 * The same structure is the basis for chunk streaming in later phases.
 */
export class MeshBatcher {
  private buckets = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[] }>();
  private materialIds = new Map<THREE.Material, number>();

  constructor(private readonly chunkSize: number) {}

  add(geometry: THREE.BufferGeometry, material: THREE.Material, anchor?: THREE.Vector3): void {
    if (geometry.getAttribute('position').count === 0) return;
    let center = anchor;
    if (!center) {
      geometry.computeBoundingBox();
      center = geometry.boundingBox!.getCenter(new THREE.Vector3());
    }
    const cx = Math.floor(center.x / this.chunkSize);
    const cz = Math.floor(center.z / this.chunkSize);
    const key = `${cx},${cz}|${this.materialId(material)}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, geometries: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
  }

  build(options: { castShadow: boolean; receiveShadow: boolean }): THREE.Group {
    const group = new THREE.Group();
    for (const [key, bucket] of this.buckets) {
      const merged = mergeGeometries(bucket.geometries, false);
      bucket.geometries.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.name = `batch:${key}`;
      mesh.castShadow = options.castShadow;
      mesh.receiveShadow = options.receiveShadow;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }

  private materialId(material: THREE.Material): number {
    let id = this.materialIds.get(material);
    if (id === undefined) {
      id = this.materialIds.size;
      this.materialIds.set(material, id);
    }
    return id;
  }
}
