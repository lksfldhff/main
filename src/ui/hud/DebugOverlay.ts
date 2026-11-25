import type * as THREE from 'three';
import { h } from '../dom';

/** F3 overlay: FPS, frame time, draw calls, triangles, player position. */
export class DebugOverlay {
  readonly element: HTMLElement;
  private frames = 0;
  private accum = 0;
  private fps = 0;
  private frameMs = 0;

  constructor() {
    this.element = h('pre', { class: 'debug-overlay hidden' });
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('hidden', !visible);
  }

  get visible(): boolean {
    return !this.element.classList.contains('hidden');
  }

  update(dt: number, renderer: THREE.WebGLRenderer, player: THREE.Vector3, extra: string): void {
    this.frames++;
    this.accum += dt;
    if (this.accum < 0.5) return;
    this.fps = this.frames / this.accum;
    this.frameMs = (this.accum / this.frames) * 1000;
    this.frames = 0;
    this.accum = 0;
    if (!this.visible) return;
    const info = renderer.info.render;
    this.element.textContent =
      `FPS        ${this.fps.toFixed(0)}  (${this.frameMs.toFixed(1)} ms)\n` +
      `Draw Calls ${info.calls}\n` +
      `Dreiecke   ${(info.triangles / 1000).toFixed(1)} k\n` +
      `Position   ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}\n` +
      extra;
  }
}
