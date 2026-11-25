import type { FacadeStyle } from '../../world/buildings/FacadeStyles';
import { Random } from '../../utils/random';
import { addNoise, createCanvas, shade } from './CanvasUtils';

/**
 * One texture tile = one window bay × one floor. Geometry UVs count bays (u) and floors (v),
 * so windows always align with the building's real dimensions.
 * Each facade is drawn twice: colour + roughness (glass is glossy, plaster is matte).
 */

const PX_PER_M = 80;

type Channel = 'color' | 'rough';

interface Palette {
  wall: string;
  trim: string;
  frame: string;
  plinth: string;
  shutters: string;
  awning: string;
  glass: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
}

function palette(style: FacadeStyle, channel: Channel): Palette {
  if (channel === 'rough') {
    const g = (v: number) => `rgb(${v},${v},${v})`;
    return {
      wall: g(235),
      trim: g(200),
      frame: g(140),
      plinth: g(215),
      shutters: g(170),
      awning: g(230),
      glass: (ctx, x, y, w, h) => {
        ctx.fillStyle = g(28);
        ctx.fillRect(x, y, w, h);
      },
    };
  }
  return {
    wall: style.wall,
    trim: style.trim,
    frame: style.frame,
    plinth: style.plinth,
    shutters: style.shutters ?? style.trim,
    awning: style.awning ?? style.trim,
    glass: (ctx, x, y, w, h) => {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, style.glassTop);
      grad.addColorStop(0.55, style.glassBottom);
      grad.addColorStop(1, shade(style.glassBottom, -0.25));
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      // faint diagonal reflection streak
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h);
      ctx.lineTo(x + w * 0.45, y + h);
      ctx.lineTo(x + w * 0.95, y);
      ctx.lineTo(x + w * 0.65, y);
      ctx.fill();
      ctx.restore();
    },
  };
}

function fillWall(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, channel: Channel, seed: number) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  if (channel === 'color') addNoise(ctx, w, h, new Random(seed), 900, 0.06, 2);
}

function drawWindow(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  style: FacadeStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  channel: Channel,
) {
  const frame = Math.max(3, w * 0.045);
  // Reveal shadow (window recess)
  if (channel === 'color') {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  }
  ctx.fillStyle = p.frame;
  ctx.fillRect(x, y, w, h);
  p.glass(ctx, x + frame, y + frame, w - frame * 2, h - frame * 2);
  ctx.fillStyle = p.frame;
  if (style.mullions !== 'none') ctx.fillRect(x + w / 2 - frame / 2, y, frame, h);
  if (style.mullions === 'cross') ctx.fillRect(x, y + h * 0.32, w, frame);
  // Sill
  ctx.fillStyle = p.trim;
  ctx.fillRect(x - frame * 1.5, y + h, w + frame * 3, frame * 1.6);
  if (channel === 'color') {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - frame * 1.5, y + h + frame * 1.6, w + frame * 3, frame);
  }
}

export function drawUpperFacade(style: FacadeStyle, channel: Channel): HTMLCanvasElement {
  const w = Math.round(style.bayWidth * PX_PER_M);
  const h = Math.round(style.floorHeight * PX_PER_M);
  const [canvas, ctx] = createCanvas(w, h);
  const p = palette(style, channel);
  fillWall(ctx, w, h, p.wall, channel, 11);

  const ww = w * style.window.width;
  const wh = h * style.window.height;
  const wx = (w - ww) / 2;
  const wy = h * style.window.top;

  if (style.ribbon) {
    // Continuous window band + spandrel line
    ctx.fillStyle = p.trim;
    ctx.fillRect(0, h - 6, w, 6);
    p.glass(ctx, 0, wy, w, wh);
    ctx.fillStyle = p.frame;
    ctx.fillRect(0, wy, 4, wh);
    ctx.fillRect(0, wy, w, 4);
    ctx.fillRect(0, wy + wh - 4, w, 4);
    ctx.fillRect(w / 2 - 2, wy, 4, wh);
    return canvas;
  }

  if (style.shutters) {
    const sw = ww * 0.36;
    ctx.fillStyle = p.shutters;
    for (const sx of [wx - sw - 3, wx + ww + 3]) {
      ctx.fillRect(sx, wy, sw, wh);
      if (channel === 'color') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        for (let ly = wy + 6; ly < wy + wh - 4; ly += 7) ctx.fillRect(sx + 2, ly, sw - 4, 2);
        ctx.fillStyle = p.shutters;
      }
    }
  }
  // Lintel / decorative header
  ctx.fillStyle = p.trim;
  ctx.fillRect(wx - 6, wy - 10, ww + 12, 7);
  drawWindow(ctx, p, style, wx, wy, ww, wh, channel);
  // Floor band
  if (channel === 'color') {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, h - 4, w, 4);
  }
  return canvas;
}

export function drawGroundFacade(style: FacadeStyle, channel: Channel): HTMLCanvasElement {
  const w = Math.round(style.bayWidth * PX_PER_M);
  const h = Math.round(style.groundHeight * PX_PER_M);
  const [canvas, ctx] = createCanvas(w, h);
  const p = palette(style, channel);
  fillWall(ctx, w, h, p.wall, channel, 23);

  const plinthH = h * 0.08;
  if (style.ground === 'glass') {
    ctx.fillStyle = p.plinth;
    ctx.fillRect(0, 0, w, h);
    p.glass(ctx, 5, h * 0.12, w - 10, h * 0.84);
    ctx.fillStyle = p.frame;
    ctx.fillRect(0, h * 0.12, 5, h * 0.84);
    ctx.fillRect(w - 5, h * 0.12, 5, h * 0.84);
    ctx.fillRect(0, h * 0.3, w, 4);
    ctx.fillStyle = p.trim;
    ctx.fillRect(0, h * 0.96, w, h * 0.04);
    return canvas;
  }

  if (style.ground === 'shop') {
    // Fascia band for the shop sign
    ctx.fillStyle = p.trim;
    ctx.fillRect(0, 0, w, h * 0.06);
    const sx = w * 0.07;
    const sw = w * 0.86;
    const sy = h * 0.2;
    const sh = h * 0.72 - plinthH * 0.2;
    // Awning stripe
    ctx.fillStyle = p.awning;
    ctx.fillRect(sx - 4, h * 0.1, sw + 8, h * 0.07);
    if (channel === 'color') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (let x = sx; x < sx + sw; x += 18) ctx.fillRect(x, h * 0.1, 9, h * 0.07);
    }
    ctx.fillStyle = p.frame;
    ctx.fillRect(sx, sy, sw, sh);
    p.glass(ctx, sx + 5, sy + 5, sw - 10, sh - 10);
    ctx.fillStyle = p.frame;
    ctx.fillRect(sx, sy + sh * 0.22, sw, 4);
    // Stone plinth
    ctx.fillStyle = p.plinth;
    ctx.fillRect(0, h - plinthH, w, plinthH);
    return canvas;
  }

  // Residential ground floor with rusticated plinth
  ctx.fillStyle = p.plinth;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  if (channel === 'color') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = h * 0.72; y < h; y += h * 0.07) ctx.fillRect(0, y, w, 2);
  }
  const ww = w * style.window.width;
  const wh = h * 0.42;
  drawWindow(ctx, p, style, (w - ww) / 2, h * 0.2, ww, wh, channel);
  return canvas;
}
