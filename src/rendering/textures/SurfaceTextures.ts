import { Random } from '../../utils/random';
import { addNoise, createCanvas, heightToNormal, shade } from './CanvasUtils';

/** A generated tiling surface. `tileSize` = metres covered by one texture repeat. */
export interface SurfaceTextureSet {
  color: HTMLCanvasElement;
  normal?: HTMLCanvasElement;
  normalStrength?: number;
  tileSize: number;
}

export function asphalt(): SurfaceTextureSet {
  const size = 512;
  const rng = new Random(101);
  const [c, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#45484c';
  ctx.fillRect(0, 0, size, size);
  addNoise(ctx, size, size, rng, 14000, 0.16, 2);
  // Darker patches & repaired seams
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(20,22,25,${0.05 + rng.next() * 0.07})`;
    ctx.beginPath();
    ctx.ellipse(rng.next() * size, rng.next() * size, 30 + rng.next() * 70, 20 + rng.next() * 40, rng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const [hc, hctx] = createCanvas(size, size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);
  addNoise(hctx, size, size, rng, 20000, 0.5, 1.5);
  return { color: c, normal: heightToNormal(hc, 1.2), tileSize: 8 };
}

export function paving(): SurfaceTextureSet {
  // 3 m × 3 m of 30 cm concrete slabs
  const size = 512;
  const n = 10;
  const cell = size / n;
  const rng = new Random(202);
  const [c, ctx] = createCanvas(size, size);
  const [hc, hctx] = createCanvas(size, size);
  ctx.fillStyle = '#7d7a75';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, size, size);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tone = 0.5 + rng.next() * 0.07;
      const v = Math.round(255 * tone);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
      hctx.fillStyle = '#fff';
      hctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
    }
  }
  addNoise(ctx, size, size, rng, 9000, 0.12, 2);
  return { color: c, normal: heightToNormal(hc, 2.5), tileSize: 3 };
}

export function cobblestone(): SurfaceTextureSet {
  // Warm sandstone-toned cobbles, 4 m × 4 m
  const size = 512;
  const rng = new Random(303);
  const [c, ctx] = createCanvas(size, size);
  const [hc, hctx] = createCanvas(size, size);
  ctx.fillStyle = '#6f655b';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, size, size);
  const rows = 26;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * rh * 0.5 - rh;
    while (x < size + rh) {
      const w = rh * (0.9 + rng.next() * 0.5);
      const base = 108 + rng.next() * 42;
      const warm = 6 + rng.next() * 16;
      ctx.fillStyle = `rgb(${base + warm},${base},${base - 12 - warm * 0.5})`;
      const draw = (g: CanvasRenderingContext2D, dx: number) => {
        g.beginPath();
        g.roundRect(x + 1.5 + dx, r * rh + 1.5, w - 3, rh - 3, 4);
        g.fill();
      };
      draw(ctx, 0);
      hctx.fillStyle = `rgb(${200 + rng.next() * 55},0,0)`;
      draw(hctx, 0);
      // wrap horizontally for seamless tiling
      if (x + w > size) {
        draw(ctx, -size);
        draw(hctx, -size);
      }
      x += w;
    }
  }
  addNoise(ctx, size, size, rng, 8000, 0.12, 2);
  return { color: c, normal: heightToNormal(hc, 3), tileSize: 4 };
}

export function concrete(base = '#b9b6af', seed = 404): SurfaceTextureSet {
  const size = 256;
  const rng = new Random(seed);
  const [c, ctx] = createCanvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  addNoise(ctx, size, size, rng, 5000, 0.1, 2);
  return { color: c, tileSize: 2 };
}

export function grass(): SurfaceTextureSet {
  const size = 512;
  const rng = new Random(505);
  const [c, ctx] = createCanvas(size, size);
  ctx.fillStyle = '#5f7f3e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = rng.next() > 0.5 ? 'rgba(120,150,70,0.18)' : 'rgba(40,70,30,0.16)';
    ctx.beginPath();
    ctx.ellipse(rng.next() * size, rng.next() * size, 40 + rng.next() * 90, 30 + rng.next() * 60, rng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 9000; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const g = 90 + rng.next() * 80;
    ctx.strokeStyle = `rgba(${g * 0.6},${g},${g * 0.35},0.5)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng.next() - 0.5) * 3, y - 3 - rng.next() * 4);
    ctx.stroke();
  }
  return { color: c, tileSize: 6 };
}

export function roofGravel(): SurfaceTextureSet {
  const set = concrete('#75726c', 606);
  const ctx = set.color.getContext('2d')!;
  addNoise(ctx, 256, 256, new Random(607), 9000, 0.25, 1.5);
  return { ...set, tileSize: 3 };
}

export function roofTiles(color: string): SurfaceTextureSet {
  // 2 m × 2 m of clay tiles; u runs along the eaves, v up the slope
  const size = 256;
  const rows = 6;
  const cols = 8;
  const rng = new Random(707);
  const [c, ctx] = createCanvas(size, size);
  const [hc, hctx] = createCanvas(size, size);
  const rh = size / rows;
  const cw = size / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = k * cw + (r % 2) * cw * 0.5;
      ctx.fillStyle = shade(color, (rng.next() - 0.5) * 0.18);
      const grad = hctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
      grad.addColorStop(0, '#202020');
      grad.addColorStop(1, '#ffffff');
      for (const dx of [0, -size]) {
        ctx.fillRect(x + dx, r * rh, cw - 1, rh);
        hctx.fillStyle = grad;
        hctx.fillRect(x + dx, r * rh, cw - 1, rh);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x, (r + 1) * rh - 4, cw, 4);
    }
  }
  addNoise(ctx, size, size, rng, 2500, 0.1, 2);
  return { color: c, normal: heightToNormal(hc, 2), tileSize: 2 };
}

export function quayStone(): SurfaceTextureSet {
  // Large sandstone ashlar blocks, 4 m × 4 m
  const size = 256;
  const rng = new Random(808);
  const [c, ctx] = createCanvas(size, size);
  const [hc, hctx] = createCanvas(size, size);
  ctx.fillStyle = '#5f5248';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, size, size);
  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -rh : 0;
    while (x < size) {
      const w = rh * (1.6 + rng.next() * 1.2);
      ctx.fillStyle = shade('#a48a72', (rng.next() - 0.5) * 0.22);
      ctx.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      hctx.fillStyle = '#fff';
      hctx.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      x += w;
    }
  }
  addNoise(ctx, size, size, rng, 4000, 0.14, 2);
  return { color: c, normal: heightToNormal(hc, 2), tileSize: 4 };
}

/** Lane markings for one road cross-section (u = across, v = along the road; 9 m per repeat). */
export function roadMarkings(): SurfaceTextureSet {
  const w = 256;
  const h = 512;
  const [c, ctx] = createCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(240,240,232,0.92)';
  ctx.fillRect(4, 0, 6, h); // edge lines
  ctx.fillRect(w - 10, 0, 6, h);
  ctx.fillRect(w / 2 - 3, 0, 6, h / 3); // 3 m dash / 6 m gap
  return { color: c, tileSize: 9 };
}

export function zebraCrossing(): SurfaceTextureSet {
  const w = 256;
  const h = 128;
  const [c, ctx] = createCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(242,242,235,0.92)';
  ctx.fillRect(0, 0, w / 2, h);
  return { color: c, tileSize: 1 };
}

export function posterColumn(): HTMLCanvasElement {
  const [c, ctx] = createCanvas(1024, 256);
  const rng = new Random(909);
  const colors = ['#e2b23c', '#2f5d62', '#c4472f', '#efe8d8', '#28323a', '#7a9e7e', '#d9773a'];
  ctx.fillStyle = '#d8d2c4';
  ctx.fillRect(0, 0, 1024, 256);
  let x = 0;
  while (x < 1024) {
    const w = 110 + rng.next() * 90;
    const bg = rng.pick(colors);
    ctx.fillStyle = bg;
    ctx.fillRect(x + 4, 10, w - 8, 236);
    ctx.fillStyle = bg === '#efe8d8' ? '#28323a' : '#f5f0e6';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(rng.pick(['NECKAR', 'KONZERT', 'KÄTHCHEN', 'MARKT', 'KINO', 'THEATER', 'FEST']), x + 14, 56);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(rng.pick(['Sa · 20 Uhr', 'Heilbronn', 'Eintritt frei', 'Ab Freitag']), x + 14, 82);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(x + w / 2, 165, 40 + rng.next() * 15, 0, Math.PI * 2);
    ctx.fill();
    x += w;
  }
  return c;
}

export function clockFace(): HTMLCanvasElement {
  const s = 256;
  const [c, ctx] = createCanvas(s, s);
  ctx.fillStyle = '#2c3a40';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#f1ead9';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c99a45';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#2c3a40';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillRect(s / 2 + Math.sin(a) * s * 0.36 - 4, s / 2 - Math.cos(a) * s * 0.36 - 4, 8, 8);
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(s / 2, s / 2);
  ctx.lineTo(s / 2 + s * 0.17, s / 2 - s * 0.1);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(s / 2, s / 2);
  ctx.lineTo(s / 2 - s * 0.04, s / 2 - s * 0.32);
  ctx.stroke();
  return c;
}
