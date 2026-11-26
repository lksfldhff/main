import type * as THREE from 'three';
import { h } from '../dom';

/** F3 performance monitor: FPS, frame time (avg + worst), draw calls, triangles, GPU objects, memory. */
export class DebugOverlay {
  readonly element: HTMLElement;
  private frames = 0;
  private accum = 0;
  private fps = 0;
  private frameMs = 0;
  private worstMs = 0;
  private windowWorst = 0;

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
    this.windowWorst = Math.max(this.windowWorst, dt);
    if (this.accum < 0.5) return;
    this.fps = this.frames / this.accum;
    this.frameMs = (this.accum / this.frames) * 1000;
    this.worstMs = this.windowWorst * 1000;
    this.frames = 0;
    this.accum = 0;
    this.windowWorst = 0;
    if (!this.visible) return;
    const info = renderer.info.render;
    const mem = renderer.info.memory;
    const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.element.textContent =
      `FPS        ${this.fps.toFixed(0)}  (${this.frameMs.toFixed(1)} ms, max ${this.worstMs.toFixed(0)} ms)\n` +
      `Draw Calls ${info.calls}\n` +
      `Dreiecke   ${(info.triangles / 1000).toFixed(1)} k\n` +
      `GPU        ${mem.geometries} Geometrien · ${mem.textures} Texturen · ${renderer.info.programs?.length ?? 0} Shader\n` +
      (heap ? `JS-Heap    ${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB\n` : '') +
      `Position   ${player.x.toFixed(1)} / ${player.y.toFixed(1)} / ${player.z.toFixed(1)}\n` +
      extra;
  }
}
