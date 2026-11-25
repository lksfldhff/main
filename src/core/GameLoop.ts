export type FixedStepFn = (dt: number) => void;
export type FrameFn = (frameDt: number, alpha: number) => void;

/**
 * Fixed-timestep simulation with variable-rate rendering.
 * Physics/gameplay run in `fixedDt` steps; rendering gets an interpolation factor `alpha`.
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  /** When false only the frame callback runs (menus, pause). */
  simulate = false;

  constructor(
    private readonly fixedDt: number,
    private readonly maxSubSteps: number,
    private readonly onFixedStep: FixedStepFn,
    private readonly onFrame: FrameFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    if (this.simulate) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
        this.onFixedStep(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      // Avoid the "spiral of death" on very slow frames.
      if (steps === this.maxSubSteps) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }

    this.onFrame(frameDt, this.simulate ? this.accumulator / this.fixedDt : 1);
  };
}
