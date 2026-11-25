import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import { posterColumn, clockFace } from '../../rendering/textures/SurfaceTextures';
import { addBuilding } from '../builders/BuildingBuilder';
import { getFacadeStyle } from '../buildings/FacadeStyles';
import { rect } from '../geometry/Polygon';

function addMesh(ctx: WorldContext, geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, rotY = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.root.add(mesh);
  return mesh;
}

/**
 * Generic sandstone clock tower used as the plaza landmark in the Phase 1 test district.
 * (The real Kilianskirche follows with real footprint data in a later phase.)
 */
export function addClockTower(ctx: WorldContext, x: number, z: number, size = 9, levels = 8): void {
  const style = getFacadeStyle('sandstein-rot');
  const half = size / 2;
  const height = addBuilding(ctx, { footprint: rect(x - half, z - half, x + half, z + half), levels, style, roof: 'flat' });

  const stone = ctx.materials.color('#b9775c', 0.85);
  const copper = ctx.materials.color('#5f9b86', 0.55, 0.35);
  const gold = ctx.materials.color('#d8b25a', 0.35, 0.8);
  const top = height - 0.1;

  // Belfry stage + octagonal spire
  addMesh(ctx, new THREE.BoxGeometry(size - 2, 4, size - 2), stone, new THREE.Vector3(x, top + 2, z));
  const spire = addMesh(ctx, new THREE.ConeGeometry((size - 2) * 0.62, 12, 8), copper, new THREE.Vector3(x, top + 4 + 6, z));
  spire.rotation.y = Math.PI / 8;
  addMesh(ctx, new THREE.SphereGeometry(0.35, 12, 8), gold, new THREE.Vector3(x, top + 16.3, z));

  const faceMat = ctx.materials.canvasMaterial(clockFace(), 0.5);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), faceMat);
    face.position.set(x + Math.sin(a) * (half - 0.98), top + 2, z + Math.cos(a) * (half - 0.98));
    face.rotation.y = a;
    ctx.root.add(face);
  }
}

/** Round fountain with basin, water surface and column. */
export function addFountain(ctx: WorldContext, x: number, z: number): void {
  const stone = ctx.materials.color('#c9b79c', 0.8);
  const water = ctx.materials.color('#4d8fa0', 0.08, 0.1);
  addMesh(ctx, new THREE.CylinderGeometry(4.2, 4.4, 0.7, 40), stone, new THREE.Vector3(x, 0.5, z));
  addMesh(ctx, new THREE.TorusGeometry(4.2, 0.2, 8, 48), stone, new THREE.Vector3(x, 0.9, z)).rotation.x = Math.PI / 2;
  const surf = addMesh(ctx, new THREE.CircleGeometry(4.1, 40), water, new THREE.Vector3(x, 0.87, z));
  surf.rotation.x = -Math.PI / 2;
  surf.castShadow = false;
  addMesh(ctx, new THREE.CylinderGeometry(0.5, 0.7, 2.6, 16), stone, new THREE.Vector3(x, 1.6, z));
  addMesh(ctx, new THREE.CylinderGeometry(1.3, 0.4, 0.4, 24), stone, new THREE.Vector3(x, 2.9, z));
  addMesh(ctx, new THREE.SphereGeometry(0.4, 16, 10), stone, new THREE.Vector3(x, 3.4, z));
  ctx.physics.addStaticCylinder(new THREE.Vector3(x, 0.5, z), 0.5, 4.4);
}

/** Advertising column ("Litfaßsäule") – also the first interactable object. */
export function addPosterColumn(ctx: WorldContext, x: number, z: number): void {
  const posters = ctx.materials.canvasMaterial(posterColumn(), 0.75);
  const dark = ctx.materials.color('#2b3a35', 0.6, 0.3);
  addMesh(ctx, new THREE.CylinderGeometry(0.72, 0.72, 2.9, 32), posters, new THREE.Vector3(x, 1.75, z));
  addMesh(ctx, new THREE.CylinderGeometry(0.8, 0.8, 0.3, 32), dark, new THREE.Vector3(x, 0.15, z));
  addMesh(ctx, new THREE.CylinderGeometry(0.85, 0.78, 0.18, 32), dark, new THREE.Vector3(x, 3.27, z));
  addMesh(ctx, new THREE.SphereGeometry(0.62, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark, new THREE.Vector3(x, 3.35, z));
  ctx.physics.addStaticCylinder(new THREE.Vector3(x, 1.7, z), 1.7, 0.8);

  let visits = 0;
  ctx.interactions.register({
    position: new THREE.Vector3(x, 0, z),
    radius: 2.4,
    prompt: 'Plakate lesen',
    onInteract: () => {
      visits++;
      ctx.events.emit('notify', {
        title: 'Litfaßsäule',
        text:
          visits === 1
            ? 'Willkommen im Testviertel! Hier entsteht bald das echte Heilbronn – mit Neckar, Kilianskirche und Marktplatz.'
            : 'Neckarfest · Käthchen-Theater · Wochenmarkt am Samstag. Mehr Plakate folgen in Phase 2.',
      });
    },
  });
}
