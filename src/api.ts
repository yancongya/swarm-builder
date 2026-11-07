import type { SwarmBuilderOptions, SwarmResult, AgentInfo } from './types';
import type { Blueprint } from './core/blueprint';
import type { Tickable } from './core/engine';
import { normalizeOptions, clamp, SPEED_MIN, SPEED_MAX } from './core/config';
import { Engine } from './core/engine';
import { Agent } from './core/agent';
import { Scheduler } from './core/scheduler';
import { snapshot } from './core/snapshot';
import { SoundBus } from './core/sound';
import { planItem } from './tasks/index';
import { Overlay } from './render/overlay';
import { CursorLayer } from './render/cursor_layer';
import { injectStyle } from './render/styles';

const PALETTE = ['#ff6b6b', '#4dd0e1', '#ffd166', '#a78bfa', '#8bc34a', '#f472b6', '#60a5fa', '#fb923c'];
const NAMES = ['Ava', 'Bo', 'Cy', 'Dee', 'Echo', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lux'];

class ProgressTicker implements Tickable {
  private last = -1;

  constructor(
    private readonly engine: Engine,
    private readonly scheduler: Scheduler,
    private readonly report: (built: number, total: number) => void,
  ) {}

  tick(): void {
    const built = this.scheduler.built;
    if (built !== this.last) {
      this.last = built;
      this.report(built, this.scheduler.total);
    }
    // The ticker must leave the clock, otherwise the engine never idles.
    if (built >= this.scheduler.total) this.engine.remove(this);
  }
}

export class SwarmBuilder {
  private readonly opts;
  private readonly root: HTMLElement;
  private engine: Engine | null = null;
  private overlay: Overlay | null = null;
  private cursors: CursorLayer | null = null;
  private scheduler: Scheduler | null = null;
  private blueprint: Blueprint | null = null;
  private startedAt = 0;
  private started = false;
  private finished = false;
  private destroyed = false;
  private sound: SoundBus | null = null;

  constructor(private readonly options: SwarmBuilderOptions = {}) {
    this.opts = normalizeOptions(options);
    this.root = options.root ?? document.body;
    injectStyle();
    if (options.autoStart) requestAnimationFrame(() => this.start());
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;

    const blueprint = snapshot(this.root, this.opts);
    this.blueprint = blueprint;

    // Nothing measurable (hidden or zero-width host): skip the blank layer so
    // the real page never flickers off for a frame.
    if (blueprint.items.length === 0) {
      this.options.onComplete?.({ built: 0, dropped: blueprint.dropped, durationMs: 0 });
      return;
    }

    const overlay = Overlay.create(this.root, blueprint.width, blueprint.height, blueprint.rootOffset, blueprint.backdrop);
    const cursors = new CursorLayer(overlay.el);
    const scheduler = new Scheduler(blueprint, this.opts.agentCount);
    const engine = new Engine();
    engine.speed = this.opts.speed;
    const sound = this.opts.sound ? new SoundBus() : null;
    this.sound = sound;

    this.overlay = overlay;
    this.cursors = cursors;
    this.scheduler = scheduler;
    this.engine = engine;

    const infos: AgentInfo[] = [];
    for (let index = 0; index < this.opts.agentCount; index++) {
      const info: AgentInfo = {
        id: index,
        name: NAMES[index % NAMES.length] as string,
        color: PALETTE[index % PALETTE.length] as string,
      };
      infos.push(info);
      cursors.add(info.id, info.name, info.color);
      // Appear near the region each agent owns instead of one shared corner.
      const head = scheduler.peek(index);
      const startX = head ? head.x + 140 : blueprint.width / 2;
      const startY = head ? head.y + 90 : blueprint.height / 2;
      engine.add(new Agent(
        index,
        info,
        { scheduler, overlay, cursors, opts: this.opts, blueprint, sound, planner: planItem, onFinished: (agent) => engine.remove(agent) },
        startX,
        startY,
      ));
    }

    if (this.options.onProgress) engine.add(new ProgressTicker(engine, scheduler, this.options.onProgress));

    this.startedAt = performance.now();
    this.options.onStart?.(infos);
    engine.whenIdle(() => this.complete());
  }

  private complete(): void {
    this.finished = true;
    const result: SwarmResult = {
      built: this.scheduler?.built ?? 0,
      dropped: this.blueprint?.dropped ?? 0,
      durationMs: Math.round(performance.now() - this.startedAt),
    };
    this.overlay?.reveal();
    this.cursors?.destroy();
    this.options.onComplete?.(result);
  }

  /** Freezes the clock mid-stroke; `resume()` continues from the same frame. */
  pause(): void {
    this.engine?.pause();
  }

  resume(): void {
    this.engine?.resume();
  }

  get isPaused(): boolean {
    return this.engine?.isPaused ?? false;
  }

  /** Time multiplier for the rest of the run, 0.25x to 8x. */
  setSpeed(multiplier: number): void {
    const speed = clamp(multiplier, SPEED_MIN, SPEED_MAX);
    this.opts.speed = speed;
    if (this.engine) this.engine.speed = speed;
  }

  /**
   * Ends the run now. The finished state of a rebuild is the real page, so
   * there is nothing to draw: stop the clock, count everything as built, reveal.
   */
  skip(): void {
    if (!this.engine || this.destroyed || this.finished) return;
    this.engine.stop();
    if (this.blueprint) {
      for (const item of this.blueprint.items) this.scheduler?.markDone(item.id);
    }
    this.complete();
  }

  destroy(): void {
    this.destroyed = true;
    this.engine?.stop();
    this.sound?.dispose();
    this.sound = null;
    this.cursors?.destroy();
    this.overlay?.destroy();
    this.engine = null;
    this.cursors = null;
    this.overlay = null;
  }
}
