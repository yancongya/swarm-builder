export interface Tickable {
  tick(elapsedMs: number): void;
}

const MAX_FRAME_MS = 48;

/**
 * Single rAF clock for the whole run. Every duration in the library is
 * wall-clock time divided by `speed` here, so raising speed mid-run and,
 * later, pause/resume need no changes in the task layer.
 */
export class Engine {
  private readonly tickables = new Set<Tickable>();
  private frame = 0;
  private last = 0;
  private paused = false;
  speed = 1;
  private idleCallback: (() => void) | null = null;

  add(tickable: Tickable): void {
    this.tickables.add(tickable);
    if (!this.paused) this.run();
  }

  remove(tickable: Tickable): void {
    this.tickables.delete(tickable);
  }

  whenIdle(callback: () => void): void {
    this.idleCallback = callback;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Freezes the clock; the run resumes exactly where it stopped. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.tickables.size > 0) this.run();
    else this.finishIdle();
  }

  private finishIdle(): void {
    this.frame = 0;
    const idle = this.idleCallback;
    this.idleCallback = null;
    idle?.();
  }

  private run(): void {
    if (this.frame !== 0) return;
    this.last = performance.now();
    const step = (now: number) => {
      const real = Math.min(now - this.last, MAX_FRAME_MS);
      this.last = now;
      const scaled = real * this.speed;
      for (const tickable of Array.from(this.tickables)) tickable.tick(scaled);
      if (this.tickables.size === 0) {
        this.finishIdle();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.tickables.clear();
    this.idleCallback = null;
  }
}
