import type { MapImage } from '../../ui/hud/Minimap';
import type { HeilbronnData } from './HeilbronnData';
import { LandUse } from './LandUse';

/** Radar colours per land-use class (dark GTA-like palette). */
const COLORS: Record<number, [number, number, number]> = {
  [LandUse.None]: [27, 34, 39],
  [LandUse.Road]: [124, 133, 140],
  [LandUse.Sidewalk]: [64, 72, 78],
  [LandUse.Plaza]: [78, 86, 92],
  [LandUse.Path]: [70, 80, 66],
  [LandUse.Water]: [43, 92, 132],
  [LandUse.Green]: [44, 72, 50],
  [LandUse.Urban]: [33, 40, 45],
  [LandUse.Rail]: [58, 52, 48],
};

/**
 * Renders the radar map (1 px = 1 m) from the real land-use raster and the LoD2 roof triangles.
 */
export function buildMapImage(data: HeilbronnData): MapImage {
  const { meta, landuse } = data;
  const W = meta.landuse.width;
  const H = meta.landuse.height;
  const step = Math.max(1, Math.round(1 / meta.landuse.cell));
  const w = Math.ceil(W / step);
  const hgt = Math.ceil(H / step);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, hgt);
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const c = COLORS[landuse[y * step * W + x * step]] ?? COLORS[0];
      const i = (y * w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  // Buildings: project roof triangles (x, z) onto the map.
  const mpp = meta.landuse.cell * step;
  const toPx = (x: number, z: number): [number, number] => [(x - meta.bounds.minX) / mpp, (z - meta.bounds.minZ) / mpp];
  g.fillStyle = '#49535b';
  g.strokeStyle = '#49535b';
  g.lineWidth = 0.6;
  const stride = meta.buildings.roofStride;
  g.beginPath();
  for (const chunk of meta.buildings.chunks) {
    if (chunk.roofs.vertices === 0) continue;
    const d = new Float32Array(data.buildings, chunk.roofs.offset, chunk.roofs.vertices * stride);
    for (let t = 0; t + 2 < chunk.roofs.vertices; t += 3) {
      const [ax, ay] = toPx(d[t * stride], d[t * stride + 2]);
      const [bx, by] = toPx(d[(t + 1) * stride], d[(t + 1) * stride + 2]);
      const [cx, cy] = toPx(d[(t + 2) * stride], d[(t + 2) * stride + 2]);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(cx, cy);
      g.closePath();
    }
  }
  g.fill();
  g.stroke(); // closes hairline gaps between triangles
  return { canvas, minX: meta.bounds.minX, minZ: meta.bounds.minZ, metresPerPx: mpp };
}
