import { Random } from '../../utils/random';

export function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  return [canvas, ctx];
}

/** Sprinkles small light/dark specks for a subtle material grain. */
export function addNoise(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rng: Random,
  count: number,
  alpha: number,
  size = 2,
): void {
  for (let i = 0; i < count; i++) {
    const light = rng.next() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha * rng.next()})` : `rgba(0,0,0,${alpha * rng.next()})`;
    const s = size * (0.5 + rng.next());
    ctx.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
}

/** Adjusts a hex colour's brightness by `amount` (-1..1). */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

/** Converts a grayscale height canvas into a tangent-space normal map (Sobel filter, tiling). */
export function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width;
  const h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [out, ctx] = createCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const hAt = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
