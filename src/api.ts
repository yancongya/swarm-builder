import type { SwarmBuilderOptions, SwarmResult, AgentInfo } from './types';
import type { Blueprint } from './core/blueprint';
import type { Tickable } from './core/engine';
import type { SoundSink } from './core/action';
import type { FlightStage, Flyer } from './core/flight';
import { normalizeOptions, applyPerformanceMode, clamp, SPEED_MIN, SPEED_MAX } from './core/config';
import { estimateRun, itemWeight } from './core/estimate';
import { Engine } from './core/engine';
import { Agent } from './core/agent';
import { Scheduler } from './core/scheduler';
import { snapshot } from './core/snapshot';
import { SoundBus } from './core/sound';
import { ScoreBus } from './core/score';
import { Flock } from './core/flocking';
import { Crew, Flight } from './core/flight';
import { TourCam, type TourView } from './core/tour';
import { detectEnv, preScan, viewBand, type ScanEnv } from './core/scan';
import { makeRng } from './core/rng';
import { planItem } from './tasks/index';
import { Overlay } from './render/overlay';
import { CursorLayer } from './render/cursor_layer';
import { injectStyle } from './render/styles';
import { pageTheme } from './render/theme';

/** 一屏蓝图坐标：物理的圆心、挑选的带、配乐的声像共用这一份测量。 */
type Stage = { top: number; bottom: number; height: number };

// 八色按「土系 + 一枚石板灰」排：相邻必须能一眼分开，因为光标名牌只有 10px，
// 且名牌底就是这色、字是深色——饱和度太高的霓虹套色在浅页上直接糊掉。
const PALETTE = ['#e08b3f', '#c9a227', '#93a54f', '#6f9d8a', '#c9603f', '#a97e56', '#8a97ab', '#dcc07a'];
const NAMES = ['Ava', 'Bo', 'Cy', 'Dee', 'Echo', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lux'];

/** 积压每件 +45%，最多 4 倍：cursor-swarm 的 `_rate()`。 */
const ADAPTIVE_GAIN = 0.45;
const ADAPTIVE_MAX = 4;
/** 掉帧与暂停回来都不许把光标弹飞：物理按真实时间积分，一帧封顶 50ms。 */
const MAX_REAL_MS = 50;
/** 临时光标从画面外进场，参考版是视口左右各让 30~40px。 */
const SPAWN_OFFSCREEN = 40;

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

/**
 * 帧服务：一帧量一次视口，再按开关依次跑解锁前沿、速率闸门、轨道场、班组和姿态。
 * 物理吃真实时间——倍速只改施工快慢，不该把待时的弧线圈也拉到几倍速，
 * 否则 8 倍速下轨道场一帧只走 50ms，光标看着像冻住了。
 */
class FrameTicker implements Tickable {
  private last = performance.now();

  constructor(
    private readonly engine: Engine,
    private readonly onFrame: (realMs: number) => boolean,
  ) {}

  tick(): void {
    const now = performance.now();
    const real = Math.min(now - this.last, MAX_REAL_MS);
    this.last = now;
    if (this.onFrame(real)) this.engine.remove(this);
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
  /** 蓝图已就位：预滚动采集时 start() 与 begin() 之间隔着那一遍滚动。 */
  private begun = false;
  private finished = false;
  private destroyed = false;
  private sound: SoundSink | null = null;
  private score: ScoreBus | null = null;
  private stopPointer: (() => void) | null = null;
  /** 这一轮定下的基准倍速；自适应速率在它之上乘，`setSpeed` 换的就是它。 */
  private pace = 1;
  /** 真实鼠标在蓝图坐标里的位置；读者不在页面上时是 null。 */
  private pointer: { x: number; y: number } | null = null;
  private band: Stage = { top: 0, bottom: 0, height: 0 };
  /** 光标编号自己管：动态班组会招出 agentCount 以外的人，编号不能撞。 */
  private nextCursorId = 0;
  /** 这一页其实靠谁滚；预滚动采集顺手就量好了，镜头跟随没有采集时自己补一次。 */
  private env: ScanEnv | null = null;

  constructor(private readonly options: SwarmBuilderOptions = {}) {
    this.opts = normalizeOptions(options);
    this.root = options.root ?? document.body;
    injectStyle();
    if (options.autoStart) requestAnimationFrame(() => this.start());
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.startedAt = performance.now();

    // 参考库的规则：读者要求减少动效，就什么都不演，直接把真页面交回去。
    if (this.opts.reducedMotion === 'skip' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finished = true;
      this.options.onComplete?.({ built: 0, dropped: 0, durationMs: 0, seed: this.opts.seed });
      return;
    }

    if (this.opts.scan === 'pre-scroll') {
      // 采集前那一遍是异步的：等图片、等字体、把懒加载的内容滚出来。
      // 那一遍出任何岔子都不能把构建拖死，兜底直接按当前 DOM 采。
      void preScan(this.root)
        .then((env) => {
          this.env = env;
          this.begin();
        })
        .catch(() => this.begin());
      return;
    }
    this.begin();
  }

  /** 镜头要滚的那个元素。预滚动采集顺手量好了；只开镜头没开采集时第一次用到才量。 */
  private get scroller(): Element | null {
    return (this.env ??= detectEnv(this.root)).scroller;
  }

  private begin(): void {
    if (this.begun || this.destroyed) return;
    this.begun = true;
    applyPerformanceMode(this.opts, this.root.querySelectorAll('*').length);
    const blueprint = snapshot(this.root, this.opts);
    this.blueprint = blueprint;

    // Nothing measurable (hidden or zero-width host): skip the blank layer so
    // the real page never flickers off for a frame.
    if (blueprint.items.length === 0) {
      this.options.onComplete?.({ built: 0, dropped: blueprint.dropped, durationMs: 0, seed: this.opts.seed });
      return;
    }

    const theme = this.opts.theme === 'auto' ? pageTheme(this.root, blueprint.backdrop) : this.opts.theme;
    const overlay = Overlay.create(this.root, blueprint.width, blueprint.height, blueprint.rootOffset, blueprint.backdrop, theme);
    const cursors = new CursorLayer(overlay.el);
    const scheduler = new Scheduler(blueprint, {
      agentCount: this.opts.agentCount,
      order: this.opts.order,
      seed: this.opts.seed,
      balance: this.opts.balance,
      cost: (item) => itemWeight(item, this.opts),
      pick: this.opts.pick,
      trigger: this.opts.trigger,
    });
    const engine = new Engine();
    const flock = new Flock();
    const rng = makeRng(scheduler.seed);
    // A target time replaces the baseline multiplier: the run is timed, not sped.
    this.pace = this.opts.targetDuration > 0
      ? clamp(estimateRun(blueprint, this.opts, scheduler.agentQueues) / (this.opts.targetDuration * 1000), SPEED_MIN, SPEED_MAX)
      : this.opts.speed;
    engine.speed = this.pace;

    const generative = this.opts.sound && this.opts.score === 'generative';
    const score = generative ? new ScoreBus(() => ({ width: blueprint.width, top: this.band.top, height: this.band.height })) : null;
    const clicks = this.opts.sound && !generative ? new SoundBus() : null;
    const sound: SoundSink | null = score ?? clicks;
    this.sound = sound;
    this.score = score;

    this.overlay = overlay;
    this.cursors = cursors;
    this.scheduler = scheduler;
    this.engine = engine;

    const agents: Agent[] = [];
    const byFlyer = new Map<Flyer, Agent>();
    const flyers = (): Agent[] => agents.filter((agent) => !agent.isFinished);
    const addAgent = (x: number, y: number, home: boolean): Agent => {
      const id = this.nextCursorId++;
      const info: AgentInfo = {
        id,
        name: NAMES[id % NAMES.length] as string,
        color: PALETTE[id % PALETTE.length] as string,
      };
      cursors.add(info.id, info.name, info.color);
      const agent = new Agent(
        info.id,
        info,
        {
          scheduler, overlay, cursors, opts: this.opts, blueprint, sound, flock,
          planner: planItem, rng, home,
          onFinished: (done) => { flock.remove(done); engine.remove(done); },
        },
        x,
        y,
      );
      engine.add(agent);
      agents.push(agent);
      byFlyer.set(agent, agent);
      if (this.opts.flocking) flock.add(agent);
      return agent;
    };

    const infos: AgentInfo[] = [];
    for (let index = 0; index < this.opts.agentCount; index++) {
      // Appear near the region each agent owns instead of one shared corner.
      const head = scheduler.peek(index);
      const startX = head ? head.x + 140 : blueprint.width / 2;
      const startY = head ? head.y + 90 : blueprint.height / 2;
      infos.push(addAgent(startX, startY, true).info);
    }

    // 四套参考实现里只有这一处按帧读布局，其余都从 this.band 取缓存。
    const wantsFrame = this.opts.flight === 'live'
      || this.opts.agents === 'auto'
      || this.opts.pick === 'live'
      || this.opts.trigger === 'scroll'
      || this.opts.adaptiveSpeed
      || generative;
    if (wantsFrame) {
      this.band = viewBand(this.root, this.scroller);
      const stage = (): FlightStage => ({
        top: this.band.top,
        height: this.band.height,
        width: blueprint.width,
        pointer: this.pointer,
      });
      const flight = this.opts.flight === 'live'
        ? new Flight(flyers, stage, this.opts.pointer === 'follow', this.opts.pointer === 'repel')
        : null;
      if (flight && this.opts.pointer !== 'ignore') this.watchPointer();
      const crew = this.opts.agents === 'auto'
        ? new Crew({
            active: () => flyers().length,
            available: () => scheduler.available,
            busy: () => flyers().reduce((n, agent) => n + (agent.busy ? 1 : 0), 0),
            scrollPos: () => this.band.top,
            spawn: (edge, y) => addAgent(edge === 'left' ? -SPAWN_OFFSCREEN : blueprint.width + SPAWN_OFFSCREEN, y, false),
            leave: (flyer) => byFlyer.get(flyer)?.retire(),
            isHome: (flyer) => byFlyer.get(flyer)?.isHome ?? false,
            floor: this.opts.agentCount,
            stage,
            rng,
          }, flyers)
        : null;
      const ticker = new FrameTicker(engine, (realMs) => {
        this.band = viewBand(this.root, this.scroller);
        if (this.opts.pick === 'live' || this.opts.trigger === 'scroll') scheduler.setViewport(this.band);
        if (this.opts.adaptiveSpeed) {
          engine.speed = clamp(this.pace * Math.min(1 + scheduler.backlog * ADAPTIVE_GAIN, ADAPTIVE_MAX), SPEED_MIN, SPEED_MAX);
        }
        flight?.tick(realMs);
        crew?.tick(realMs);
        // 位置归物理，姿态归物理，施工中的那一帧除外（它自己 moveTo 过）。
        if (flight) for (const agent of flyers()) agent.renderPose();
        return scheduler.pending === 0 && agents.every((agent) => agent.isFinished);
      });
      engine.add(ticker);
    }

    // The camera follows the cursors, so it leaves as soon as they do.
    // 逐段解锁时还得往远处看：只有被前沿挡住的那件东西能告诉镜头下一屏在哪儿。
    if (this.opts.tour) {
      const camViews = (): readonly TourView[] => {
        const live = flyers();
        if (this.opts.trigger !== 'scroll') return live;
        const ahead = scheduler.nextGatedY();
        // 靶子按「挡住的那件往下 1/4 屏」交给镜头，镜头把它拉到视口下缘往上 90px，
        // 于是真正的条目落在解锁线（88%）以上——按 12% 那条边距拉会差几十像素，滚到位了却没解锁。
        return ahead === null ? live : [...live, { x: 0, y: ahead + this.band.height * 0.25 }];
      };
      engine.add(new TourCam(
        camViews,
        this.root,
        () => scheduler.built >= scheduler.total,
        (cam) => engine.remove(cam),
        () => this.scroller,
      ));
    }

    if (this.options.onProgress) engine.add(new ProgressTicker(engine, scheduler, this.options.onProgress));

    score?.start();
    this.options.onStart?.(infos);
    engine.whenIdle(() => this.complete());
  }

  /**
   * 读者的鼠标：轨道场要么绕着它转，要么把它周围的 Cursor 弹开。
   * 参考版把 mouse 记在视口坐标里，我们的光标记在蓝图坐标里，所以按 root 换算一次。
   */
  private watchPointer(): void {
    const toStage = (event: PointerEvent): { x: number; y: number } => {
      const rect = this.root.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onMove = (event: PointerEvent): void => {
      this.pointer = toStage(event);
    };
    // 指针离开文档就不当它是圆心：否则光标会一直贴着读者最后一次停下的地方。
    const onLeave = (): void => {
      this.pointer = null;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    this.stopPointer = () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      this.pointer = null;
    };
  }

  private complete(): void {
    this.finished = true;
    const result: SwarmResult = {
      built: this.scheduler?.built ?? 0,
      dropped: this.blueprint?.dropped ?? 0,
      durationMs: Math.round(performance.now() - this.startedAt),
      seed: this.scheduler?.seed ?? this.opts.seed,
    };
    // 参考版是收尾和弦先响，真页面亮出来那一下再落一个下落扫频。
    this.score?.finale();
    this.overlay?.reveal();
    this.score?.release();
    this.cursors?.destroy();
    this.stopPointer?.();
    this.stopPointer = null;
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
    // 自适应速率开着时这一下改的是闸门的地面，不是当下的倍速：
    // 下一帧就会重算成 pace * (1 + backlog * 0.45)。
    this.pace = speed;
    if (this.engine) this.engine.speed = speed;
  }

  /**
   * Ends the run now. The finished state of a rebuild is the real page, so
   * there is nothing to draw: stop the clock, count everything as built, reveal.
   */
  skip(): void {
    if (this.destroyed || this.finished) return;
    // 预滚动还没跑完就按「跳过」：不再等，直接按当前 DOM 采集并收工。
    if (this.started && !this.begun) this.begin();
    if (!this.engine) return;
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
    this.score = null;
    this.stopPointer?.();
    this.stopPointer = null;
    this.cursors?.destroy();
    this.overlay?.destroy();
    this.engine = null;
    this.cursors = null;
    this.overlay = null;
  }
}
