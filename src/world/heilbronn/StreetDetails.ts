import * as THREE from 'three';
import type { WorldContext } from '../WorldContext';
import type { HeilbronnData } from './HeilbronnData';
import type { Terrain } from './Terrain';
import { createMarkingsMaterial, Mark } from '../../rendering/materials/MarkingsMaterial';
import { PropInstancer } from '../props/PropInstancer';
import * as Models from '../props/PropModels';
import { Random } from '../../utils/random';
import { createCanvas } from '../../rendering/textures/CanvasUtils';

/**
 * Street furniture and road paint from OpenStreetMap: lane markings, tram rails,
 * zebra crossings / signalised crossings, traffic lights, real trees, benches,
 * bus stops and the historic Rathaus clock.
 */
export function buildStreetDetails(
  ctx: WorldContext,
  data: HeilbronnData,
  terrain: Terrain,
  /** Parts now handled by StreetFurniture (glass shelters, library benches) are skipped here. */
  options: { busStops?: boolean; benches?: boolean } = {},
): void {
  const osm = data.meta.osm ?? {};
  const extra: number[] = [];

  // --- Crossings: zebra stripes (unsignalised) or two transverse lines (signalised "Furt").
  const quad = (cx: number, cy: number, cz: number, ax: THREE.Vector2, bx: THREE.Vector2, la: number, lb: number) => {
    const corners = [
      [-la, -lb],
      [la, -lb],
      [la, lb],
      [-la, lb],
    ].map(([a, b]) => [cx + ax.x * a + bx.x * b, cy, cz + ax.y * a + bx.y * b]);
    for (const i of [0, 1, 2, 0, 2, 3]) extra.push(corners[i][0], corners[i][1] + 0.045, corners[i][2], 0, Mark.Solid);
  };
  for (const [x, y, z, dx, dz, width, kind] of osm.crossings ?? []) {
    const along = new THREE.Vector2(dx, dz).normalize();
    const across = new THREE.Vector2(-along.y, along.x);
    const half = width / 2 - 0.3;
    if (kind === 0) {
      for (let s = -half + 0.25; s <= half - 0.25; s += 1.0) {
        quad(x + across.x * s, y, z + across.y * s, along, across, 2.0, 0.25);
      }
    } else {
      for (const off of [-2.0, 2.0]) quad(x + along.x * off, y, z + along.y * off, along, across, 0.12, half);
    }
  }

  const base = data.markings;
  if (base.length + extra.length > 0) {
    const all = new Float32Array(base.length + extra.length);
    all.set(base, 0);
    all.set(extra, base.length);
    const inter = new THREE.InterleavedBuffer(all, 5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(inter, 3, 0));
    geo.setAttribute('mark', new THREE.InterleavedBufferAttribute(inter, 2, 3));
    // Draped flat ribbons: an up normal is accurate enough and cheaper than computing one.
    const normals = new Float32Array((all.length / 5) * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, createMarkingsMaterial());
    mesh.receiveShadow = true;
    mesh.name = 'markings';
    mesh.renderOrder = 1;
    ctx.root.add(mesh);
  }

  // --- Props
  const m = ctx.materials;
  const rng = new Random(77);
  const props = new PropInstancer();
  const cyl = (height: number, radius: number) => (pos: THREE.Vector3, scale: number) =>
    ctx.physics.addStaticCylinder(pos.clone().setY(pos.y + (height * scale) / 2), (height * scale) / 2, radius * scale);
  props.define('osmTree', Models.tree(19), [m.color('#5a4636', 0.9), m.color('#4f7f34', 0.85)], cyl(3.6, 0.26));
  props.define('signal', Models.trafficLight(), [
    m.color('#5d6266', 0.5, 0.6),
    m.color('#1d2022', 0.6, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 1.6, roughness: 0.3 }),
    m.color('#2a2a26', 0.3),
  ], cyl(3.3, 0.08));
  props.define('bench', Models.bench(), [m.color('#3a4044', 0.5, 0.5), m.color('#8d6342', 0.7)]);
  props.define('busStop', Models.busStop(), [m.color('#9aa0a4', 0.45, 0.6), busSignMaterial()], cyl(2.6, 0.06));

  for (const [x, y, z] of osm.trees ?? []) {
    const color = new THREE.Color().setHSL(0.24 + rng.range(-0.03, 0.05), 0.4 + rng.range(0, 0.25), 0.72 + rng.range(-0.08, 0.1));
    props.place('osmTree', new THREE.Vector3(x, y, z), rng.range(0, Math.PI * 2), rng.range(0.85, 1.3), color);
  }
  for (const [x, , z, dx, dz, width] of osm.signals ?? []) {
    const d = new THREE.Vector2(dx, dz).normalize();
    const right = new THREE.Vector2(-d.y, d.x);
    const off = width / 2 + 0.7;
    const px = x + right.x * off;
    const pz = z + right.y * off;
    props.place('signal', new THREE.Vector3(px, terrain.heightAt(px, pz), pz), Math.atan2(-d.x, -d.y));
  }
  if (options.benches !== false) for (const [x, y, z] of osm.benches ?? []) props.place('bench', new THREE.Vector3(x, y, z), rng.range(0, Math.PI * 2));
  if (options.busStops !== false) for (const [x, , z] of osm.busStops ?? []) props.place('busStop', new THREE.Vector3(x, terrain.heightAt(x, z), z), rng.range(0, Math.PI * 2));
  props.build(ctx);

  for (const [x, y, z] of osm.fountains ?? []) addFountain(ctx, x, y, z);
  for (const c of osm.clocks ?? []) addWallClock(ctx, c);
}

function busSignMaterial(): THREE.MeshStandardMaterial {
  const [canvas, g] = createCanvas(128, 128);
  g.fillStyle = '#f4c400';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#1d6b3a';
  g.lineWidth = 7;
  g.stroke();
  g.fillStyle = '#1d6b3a';
  g.font = 'bold 76px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
}

function addFountain(ctx: WorldContext, x: number, y: number, z: number): void {
  const stone = ctx.materials.color('#b9a48c', 0.8);
  const water = new THREE.MeshStandardMaterial({ color: 0x3f6f78, roughness: 0.05, metalness: 0.2 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.6, 28), stone);
  basin.position.set(x, y + 0.3, z);
  const surface = new THREE.Mesh(new THREE.CircleGeometry(1.45, 28), water);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(x, y + 0.61, z);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 12), stone);
  column.position.set(x, y + 1.1, z);
  for (const mesh of [basin, column]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  ctx.root.add(basin, surface, column);
  ctx.physics.addStaticCylinder(new THREE.Vector3(x, y + 0.3, z), 0.3, 1.7);
}

/** Wall-mounted clock; the historic Rathaus clock gets an astronomical dial. */
function addWallClock(ctx: WorldContext, c: { name: string; x: number; y: number; z: number; nx: number; nz: number }): void {
  const astronomical = /rathaus/i.test(c.name);
  const size = astronomical ? 3.2 : 1.2;
  const [canvas, g] = createCanvas(512, 512);
  const R = 250;
  g.translate(256, 256);
  g.fillStyle = astronomical ? '#1c3f7a' : '#f3efe4';
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d9b04f';
  g.lineWidth = 14;
  g.stroke();
  if (astronomical) {
    // Zodiac ring and golden sun / moon pointers
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, R * 0.72, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#d9b04f';
    g.font = 'bold 30px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    numerals.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2;
      g.fillText(n, Math.sin(a) * R * 0.86, -Math.cos(a) * R * 0.86);
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      g.beginPath();
      g.arc(Math.sin(a) * R * 0.55, -Math.cos(a) * R * 0.55, 12, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 34, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(Math.sin(a) * R * 0.82 - 6, -Math.cos(a) * R * 0.82 - 6, 12, 12);
    }
  }
  g.strokeStyle = astronomical ? '#e8c463' : '#222';
  g.lineCap = 'round';
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(R * 0.45, -R * 0.2);
  g.stroke();
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(-R * 0.1, -R * 0.75);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ctx.materials.anisotropy;
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(size / 2, 48),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: astronomical ? 0.3 : 0 }),
  );
  face.position.set(c.x, c.y, c.z);
  face.rotation.y = Math.atan2(c.nx, c.nz);
  face.castShadow = true;
  ctx.root.add(face);
}
