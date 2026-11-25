import { DEFAULT_BINDINGS, type Action } from './KeyBindings';

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'Tab']);

/**
 * Keyboard + mouse state. Uses Pointer Lock for mouse look; falls back to
 * click-and-drag when pointer lock is unavailable (e.g. embedded browsers).
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private dragging = false;
  private lockListeners = new Set<(locked: boolean) => void>();

  /** Gameplay input is ignored while disabled (menus). */
  enabled = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly bindings: Record<Action, readonly string[]> = DEFAULT_BINDINGS,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  isDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.down.has(code));
  }

  /** Returns true once per physical key press (edge-triggered) and consumes it. */
  consumePress(action: Action): boolean {
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) return true;
    }
    return false;
  }

  /** Movement axes: x = right(+)/left(-), y = forward(+)/backward(-). */
  moveAxis(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    return {
      x: (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
      y: (this.isDown('forward') ? 1 : 0) - (this.isDown('backward') ? 1 : 0),
    };
  }

  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  async requestPointerLock(): Promise<boolean> {
    if (this.pointerLocked) return true;
    try {
      await this.target.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  onPointerLock(listener: (locked: boolean) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  /** Clears all transient state (call on state transitions). */
  reset(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseDX = this.mouseDY = this.wheelDelta = 0;
    this.dragging = false;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.target.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault();
    if (e.code === 'F3') e.preventDefault();
    if (!e.repeat && !this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (this.pointerLocked || this.dragging) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && !this.pointerLocked) this.dragging = true;
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheelDelta += Math.sign(e.deltaY);
  };

  private onPointerLockChange = (): void => {
    const locked = this.pointerLocked;
    this.lockListeners.forEach((l) => l(locked));
  };
}
