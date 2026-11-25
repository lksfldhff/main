import * as THREE from 'three';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { HeilbronnMeta } from './HeilbronnData';

/**
 * Turns the preprocessed LoD2 vertex streams into one wall mesh + one roof mesh per 200 m chunk
 * (2 draw calls per chunk) and one trimesh collider per chunk.
 */
export function buildBuildingMeshes(
  meta: HeilbronnMeta,
  buffer: ArrayBuffer,
  facadeMaterial: THREE.Material,
  roofMaterial: THREE.Material,
  physics: PhysicsWorld,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'buildings';
  const { wallStride, roofStride } = meta.buildings;

  for (const chunk of meta.buildings.chunks) {
    const colliderParts: Float32Array[] = [];

    if (chunk.walls.vertices > 0) {
      const data = new Float32Array(buffer, chunk.walls.offset, chunk.walls.vertices * wallStride);
      const inter = new THREE.InterleavedBuffer(data, wallStride);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 0));
      geo.setAttribute('facade', new THREE.InterleavedBufferAttribute(inter, 4, 3));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      group.add(makeMesh(geo, facadeMaterial, `walls:${chunk.cx},${chunk.cz}`));
      colliderParts.push(extractPositions(data, wallStride, chunk.walls.vertices));
    }
    if (chunk.roofs.vertices > 0) {
      const data = new Float32Array(buffer, chunk.roofs.offset, chunk.roofs.vertices * roofStride);
      const inter = new THREE.InterleavedBuffer(data, roofStride);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 0));
      geo.setAttribute('roof', new THREE.InterleavedBufferAttribute(inter, 3, 3));
      if (roofStride >= 7) geo.setAttribute('roofRgb', new THREE.InterleavedBufferAttribute(inter, 1, 6));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      group.add(makeMesh(geo, roofMaterial, `roofs:${chunk.cx},${chunk.cz}`));
      colliderParts.push(extractPositions(data, roofStride, chunk.roofs.vertices));
    }

    if (colliderParts.length) {
      const total = colliderParts.reduce((n, p) => n + p.length, 0);
      const vertices = new Float32Array(total);
      let o = 0;
      for (const p of colliderParts) {
        vertices.set(p, o);
        o += p.length;
      }
      const indices = new Uint32Array(total / 3);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
      physics.addStaticTrimesh(vertices, indices);
    }
  }
  return group;
}

function makeMesh(geo: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function extractPositions(data: Float32Array, stride: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = data[i * stride];
    out[i * 3 + 1] = data[i * stride + 1];
    out[i * 3 + 2] = data[i * stride + 2];
  }
  return out;
}
