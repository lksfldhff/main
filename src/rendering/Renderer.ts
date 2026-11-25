import * as THREE from 'three';

/** Owns the WebGL renderer and keeps canvas size / pixel ratio in sync with the window. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  private renderScale = 1;
  private resizeListeners = new Set<(w: number, h: number) => void>();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get size(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.resize();
  }

  onResize(listener: (w: number, h: number) => void): void {
    this.resizeListeners.add(listener);
    listener(this.size.width, this.size.height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  private resize = (): void => {
    const { width, height } = this.size;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.setSize(width, height, false);
    this.resizeListeners.forEach((l) => l(width, height));
  };
}
