import { h } from '../dom';

export interface MapImage {
  canvas: HTMLCanvasElement;
  /** World rect covered by the image (x right/east, z down/south; 1 image px = metresPerPx). */
  minX: number;
  minZ: number;
  metresPerPx: number;
}

export interface MapMarker {
  x: number;
  z: number;
  color: string;
}

/**
 * GTA-style radar: a round minimap rotating with the camera, the player arrow in the centre,
 * north indicator and markers (parked cars). Renders into a small canvas every other frame.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private map: MapImage | null = null;
  private frame = 0;
  private readonly size = 208;
  /** Visible radius in metres. */
  private radius = 120;

  constructor() {
    this.canvas = h('canvas', { class: 'minimap-canvas', width: String(this.size * 2), height: String(this.size * 2) }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.element = h('div', { class: 'minimap hidden' }, this.canvas);
  }

  setMap(map: MapImage | null): void {
    this.map = map;
    this.element.classList.toggle('hidden', !map);
  }

  /** Zoom out while driving fast. */
  setSpeed(speed: number): void {
    const target = 120 + Math.min(Math.abs(speed), 30) * 5;
    this.radius += (target - this.radius) * 0.05;
  }

  update(x: number, z: number, cameraYaw: number, playerYaw: number, markers: MapMarker[] = []): void {
    if (!this.map || (this.frame++ & 1) === 1) return;
    const g = this.ctx;
    const S = this.size * 2;
    const scale = S / 2 / this.radius; // canvas px per metre
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#151b20';
    g.fillRect(0, 0, S, S);
    // World → screen: translate player to centre, rotate so the camera looks "up".
    g.translate(S / 2, S / 2);
    g.rotate(cameraYaw);
    g.scale(scale, scale);
    const m = this.map;
    g.imageSmoothingEnabled = true;
    g.drawImage(m.canvas, m.minX - x, m.minZ - z, m.canvas.width * m.metresPerPx, m.canvas.height * m.metresPerPx);
    for (const mk of markers) {
      const dx = mk.x - x;
      const dz = mk.z - z;
      if (dx * dx + dz * dz > this.radius * this.radius * 1.2) continue;
      g.fillStyle = mk.color;
      g.beginPath();
      g.arc(dx, dz, 3.2 / scale * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Player arrow (screen space, rotated relative to the camera)
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(cameraYaw - playerYaw);
    g.fillStyle = '#f2ede4';
    g.strokeStyle = '#0d1418';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -16);
    g.lineTo(11, 12);
    g.lineTo(0, 6);
    g.lineTo(-11, 12);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // North marker on the rim
    const a = cameraYaw - Math.PI / 2;
    const r = S / 2 - 22;
    g.fillStyle = '#e8b064';
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d1418';
    g.font = 'bold 20px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r + 1);
    // Rim
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.stroke();
  }
}
