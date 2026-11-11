import type { SwarmBuilderOptions, SwarmResult, SwarmStatus, SwarmPhase, AgentInfo } from './types';
import type { Blueprint, BlueprintItem } from './core/blueprint';
import type { Tickable } from './core/engine';
import type { SoundSink } from './core/action';
import type { FlightStage, Flyer } from './core/flight';
import { normalizeOptions, applyPerformanceMode, clamp, SPEED_MIN, SPEED_MAX, SPEED_STEPS } from './core/config';
import { estimateRun, itemWeight } from './core/estimate';
import { Engine } from './core/engine';
import { Agent, URGE_MS } from './core/agent';
import { Scheduler } from './core/scheduler';
import { snapshot } from './core/snapshot';
import { SoundBus } from './core/sound';
import { ScoreBus } from './core/score';
import { Flock } from './core/flocking';
import { Crew, Flight, POINTER_RADIUS } from './core/flight';
import { TourCam, type TourView } from './core/tour';
import { detectEnv, preScan, viewBand, type ScanEnv } from './core/scan';
import { makeRng } from './core/rng';
import { drawPersona, STEADY } from './core/personality';
import { planItem } from './tasks/index';
import { Overlay } from './render/overlay';
import { CursorLayer } from './render/cursor_layer';
import { RollCall } from './render/rollcall';
import { injectStyle } from './render/styles';
import { Hud } from './render/hud';
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
/** 开场聚群：参考版从左右各 40~240px 外进场，高度在视口 5%~95% 之间抽。 */
const INTRO_SPREAD = 200;
const INTRO_EDGE_MIN = 0.05;
const INTRO_EDGE_RANGE = 0.9;
/** 没人动鼠标也没人滚滚轮时的兜底：转够这么久就自己开工。参考版会一直等读者。 */
const GATHER_MS = 2400;
/** 参考版 INTRO_AGENTS：开场先飞进来 18 只，前 MIN_AGENTS 只是原始班底，其余算临时工。 */
const INTRO_AGENTS = 18;
/** 参考版 HUD 每 200ms 刷一次，状态回调跟同一个节拍，不去抖每一帧。 */
const STATUS_MS = 200;
/** 交接仪式：90px 内一前一后收活算「相遇」，火花留 620ms；同一对人 2.6 秒内不重复放。 */
const HANDOFF_RADIUS = 90;
const HANDOFF_MS = 620;
const HANDOFF_COOLDOWN = 2600;
/** 「一前一后」的窗口：两件活在这个时间里先后竣工才算一次交接。 */
const HANDOFF_WINDOW = 2400;
/** 总监模式：按住挪过这么多像素才算「拖派」，否则算一次点催。 */
const DRAG_SLOP = 6;
/** 准星外这么多像素内按下也算抓住这只光标：它在飞，像素级瞄准不现实。 */
const GRAB_RADIUS = 26;

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

/**
 * 开场聚群那一段的闸门。参考版开局只跑轨道场，等读者滚一下滚轮、或者把鼠标伸进群里
 * （任一光标进到指针 48px 内）才 `start()`。库不能把无人值守的宿主永远挂在这儿，所以
 * 多一条兜底：没人动手就自己转够 GATHER_MS 再开工。计时用真实时间——倍速与积压提速
 * 只该拧施工的快慢，不该把开场那团光标缩成一闪。
 */
class IntroTicker implements Tickable {
  private last = performance.now();
  private elapsed = 0;
  private wheeled = false;
  private released = false;
  private readonly onWheel = (): void => { this.wheeled = true; };

  constructor(
    private readonly engine: Engine,
    private readonly agents: () => readonly Agent[],
    private readonly pointer: () => { x: number; y: number } | null,
    private readonly release: () => void,
  ) {
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  tick(): void {
    const now = performance.now();
    this.elapsed += Math.min(now - this.last, MAX_REAL_MS);
    this.last = now;
    const mouse = this.pointer();
    const touched = mouse !== null
      && this.agents().some((agent) => Math.hypot(agent.x - mouse.x, agent.y - mouse.y) < POINTER_RADIUS);
    if (!this.wheeled && !touched && this.elapsed < GATHER_MS) return;
    this.finish();
  }

  /** 读者按了 Tour / Replay 之类：不用等满 2.4 秒，立刻散开开工。 */
  finish(): void {
    if (this.released) return;
    this.released = true;
    this.dispose();
    this.engine.remove(this);
    this.release();
  }

  dispose(): void {
    window.removeEventListener('wheel', this.onWheel);
  }
}

/** 状态闸门：按 200ms 的节拍把状态交出去，自己跟跑完那一帧一起下车。 */
class StatusTicker implements Tickable {
  constructor(
    private readonly engine: Engine,
    private readonly report: () => void,
    private readonly done: () => boolean,
  ) {}

  tick(): void {
    this.report();
    if (this.done()) this.engine.remove(this);
  }
}

export class SwarmBuilder {
  private readonly opts;
  private readonly root: HTMLElement;
  private engine: Engine | null = null;
  private overlay: Overlay | null = null;
  private hud: Hud | null = null;
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
  /** 开场聚群的滚轮监听：交还页面、跳过、销毁时都要摘掉。 */
  private stopIntro: (() => void) | null = null;
  /** 观众指挥的指针监听：收工、暂停、销毁时摘掉。 */
  private stopDirector: (() => void) | null = null;
  private intro: IntroTicker | null = null;
  /** Esc / M / 手势解锁；`keys:false` 时不绑。 */
  private stopKeys: (() => void) | null = null;
  private camera: TourCam | null = null;
  /** 这一局镜头在不在跟：`tour` 是配置，这一个才是现场状态。 */
  private touring = false;
  private phase: SwarmPhase = 'idle';
  /** 暂停住的是哪一段；继续时原样退回去。 */
  private frozen: SwarmPhase = 'idle';
  /** 每次开始/收工换一个号：预滚动那一遍回来得晚，不能把下一局的场子搭歪。 */
  private runId = 0;
  private agents: Agent[] = [];
  private lastStatusAt = 0;
  /** 收工那一刻的时间戳：跑完之后 status.elapsed 不该继续涨。 */
  private endedAt = 0;
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
    injectStyle(options.styleRoot ?? document);
    if (options.autoStart) requestAnimationFrame(() => this.start());
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.startedAt = performance.now();
    this.endedAt = 0;
    const run = ++this.runId;

    // 参考库的规则：读者要求减少动效，就什么都不演，直接把真页面交回去。
    if (this.opts.reducedMotion === 'skip' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finished = true;
      this.phase = 'done';
      this.report(true);
      this.options.onComplete?.({ built: 0, dropped: 0, agents: 0, durationMs: 0, seed: this.opts.seed });
      return;
    }

    this.watchKeys();
    if (this.opts.scan === 'pre-scroll') {
      this.phase = 'scanning';
      this.report(true);
      // 采集前那一遍是异步的：等图片、等字体、把懒加载的内容滚出来。
      // 那一遍出任何岔子都不能把构建拖死，兜底直接按当前 DOM 采。
      void preScan(this.root)
        .then((env) => {
          if (run !== this.runId) return;
          this.env = env;
          this.begin();
        })
        .catch(() => {
          if (run !== this.runId) return;
          this.begin();
        });
      return;
    }
    this.begin();
  }

  /** 镜头要滚的那个元素。预滚动采集顺手量好了；只开镜头没开采集时第一次用到才量。 */
  private get scroller(): Element | null {
    return (this.env ??= detectEnv(this.root)).scroller;
  }

  private begin(): void {
    if (this.begun || this.destroyed || !this.started) return;
    this.begun = true;
    applyPerformanceMode(this.opts, this.root.querySelectorAll('*').length);
    const blueprint = snapshot(this.root, this.opts);
    this.blueprint = blueprint;

    // Nothing measurable (hidden or zero-width host): skip the blank layer so
    // the real page never flickers off for a frame.
    if (blueprint.items.length === 0) {
      this.finished = true;
      this.phase = 'done';
      this.stopKeys?.();
      this.stopKeys = null;
      this.report(true);
      this.options.onComplete?.({ built: 0, dropped: blueprint.dropped, agents: 0, durationMs: 0, seed: this.opts.seed });
      return;
    }

    const theme = this.opts.theme === 'auto' ? pageTheme(this.root, blueprint.backdrop) : this.opts.theme;
    const overlay = Overlay.create(this.root, blueprint.width, blueprint.height, blueprint.rootOffset, blueprint.backdrop, theme);
    const cursors = new CursorLayer(overlay.el);
    if (this.opts.hud) this.hud = new Hud(this.root, () => this.skip());
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

    // 两套声部都先建出来，静音只是把出口拉到 0：这样 M 键、面板上的开关都能
    // 在跑到一半时把它接回来，而不是等下一局。参考版也是开场就 init()。
    const stage = (): { width: number; top: number; height: number } => ({
      width: blueprint.width,
      top: this.band.top,
      height: this.band.height,
    });
    const generative = this.opts.score === 'generative';
    const score = generative ? new ScoreBus(stage, this.opts.sound) : null;
    const sound: SoundSink = score ?? new SoundBus(this.opts.sound);
    this.sound = sound;
    this.score = score;

    this.overlay = overlay;
    this.cursors = cursors;
    this.scheduler = scheduler;
    this.engine = engine;

    const agents: Agent[] = this.agents = [];
    const byFlyer = new Map<Flyer, Agent>();
    /** 指针只认编号：光标元素上写的是 id，改派要落到对应的那一只。 */
    const byId = new Map<number, Agent>();
    const flyers = (): Agent[] => agents.filter((agent) => !agent.isFinished);

    // 交接仪式：两只光标一前一后在同一片区域收活（竣工点相距 90px 内、间隔不到 2.4 秒），
    // 两点中间亮一记击掌火花。纯装饰——不读也不写任何物理量，成对冷却防刷屏；
    // 辅助线不算一件「活」，既不触发也不落点。
    const lastHandoff = new Map<string, number>();
    const recentBuilds: { x: number; y: number; at: number; agent: Agent }[] = [];
    const spawnHandoff = (
      x: number, y: number, angle: number, a: AgentInfo, b: AgentInfo,
    ): void => {
      const el = document.createElement('div');
      el.className = 'sb-handoff';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty('--sb-angle', `${angle}rad`);
      el.style.setProperty('--sb-a', a.color);
      el.style.setProperty('--sb-b', b.color);
      overlay.el.appendChild(el);
      window.setTimeout(() => el.remove(), HANDOFF_MS);
    };
    const handoff = (agent: Agent, item: BlueprintItem): void => {
      if (item.kind === 'guide') return;
      const x = agent.x;
      const y = agent.y;
      const now = performance.now();
      while (recentBuilds.length > 0 && now - (recentBuilds[0]?.at ?? 0) > HANDOFF_WINDOW) recentBuilds.shift();
      for (let index = recentBuilds.length - 1; index >= 0; index--) {
        const mark = recentBuilds[index] as (typeof recentBuilds)[number];
        if (mark.agent === agent) continue;
        const distance = Math.hypot(mark.x - x, mark.y - y);
        if (distance > HANDOFF_RADIUS) continue;
        const pair = agent.index < mark.agent.index
          ? `${agent.index}-${mark.agent.index}`
          : `${mark.agent.index}-${agent.index}`;
        // 第一次相遇没有冷却记录，别拿 0 当时间戳——否则开局 2.6 秒内的交接全被吞掉。
        const last = lastHandoff.get(pair);
        if (last !== undefined && now - last < HANDOFF_COOLDOWN) continue;
        lastHandoff.set(pair, now);
        spawnHandoff(
          (mark.x + x) / 2,
          (mark.y + y) / 2,
          Math.atan2(y - mark.y, x - mark.x),
          mark.agent.info,
          agent.info,
        );
        break;
      }
      recentBuilds.push({ x, y, at: now, agent });
      if (recentBuilds.length > 48) recentBuilds.shift();
    };

    const addAgent = (x: number, y: number, home: boolean): Agent => {
      const id = this.nextCursorId++;
      // 性格和进场点、轨道参数共用这一局的 rng：同一种子回放同一支队伍。
      // 关掉时一个数都不抽，全员稳当当，rng 流与没有性格时完全一致。
      const persona = this.opts.personality ? drawPersona(rng) : STEADY;
      const info: AgentInfo = {
        id,
        name: NAMES[id % NAMES.length] as string,
        color: PALETTE[id % PALETTE.length] as string,
        personality: persona.kind,
      };
      cursors.add(info.id, info.name, info.color, persona.kind);
      const agent = new Agent(
        info.id,
        info,
        {
          scheduler, overlay, cursors, opts: this.opts, blueprint, sound, flock,
          planner: planItem, rng, persona, home,
          onFinished: (done) => { flock.remove(done); engine.remove(done); },
          onItemDone: (done, item) => handoff(done, item),
        },
        x,
        y,
      );
      engine.add(agent);
      agents.push(agent);
      byFlyer.set(agent, agent);
      byId.set(agent.info.id, agent);
      if (this.opts.flocking) flock.add(agent);
      return agent;
    };

    const infos: AgentInfo[] = [];
    // 聚群要按视口算进场点，而 this.band 要到下面 wantsFrame 那段才填，这里先取一次。
    const opening = this.opts.gather ? viewBand(this.root, this.scroller) : null;
    // 开场人数按蓝图条目数缩放：~21 项的小页面不该飞进来 18 只挤成一团（真机反馈「页面不需要这么多鼠标」）。
    // min(18, max(3, ceil(items/12)))：小页保底 3 只，大页封顶参考版的 18 只。
    const introCount = Math.min(INTRO_AGENTS, Math.max(3, Math.ceil(blueprint.items.length / 12)));
    // auto 班组的原始班底（home）也跟着缩到不超过开场人数，否则小页面仍被 agentCount 顶住、降不下来；
    // 其余开场光标算临时工，由班组决定去留。固定班组（agents:'fixed'）不参与缩放，按那个数来、不额外招人。
    const homeCount = this.opts.agents === 'auto' ? Math.min(this.opts.agentCount, introCount) : this.opts.agentCount;
    const crewSize = opening && this.opts.agents === 'auto' ? introCount : this.opts.agentCount;
    for (let index = 0; index < crewSize; index++) {
      const home = index < homeCount;
      if (!opening) {
        // Appear near the region each agent owns instead of one shared corner.
        const head = scheduler.peek(index);
        const startX = head ? head.x + 140 : blueprint.width / 2;
        const startY = head ? head.y + 90 : blueprint.height / 2;
        infos.push(addAgent(startX, startY, home).info);
        continue;
      }
      // 参考版的开场：左右轮流进场，各在画面外 40~240px，高度在视口 5%~95% 之间抽。
      // 进场点用这一局的种子抽，回放才跑得出同一支队伍。
      const off = SPAWN_OFFSCREEN + rng() * INTRO_SPREAD;
      const startX = index % 2 === 0 ? -off : blueprint.width + off;
      const startY = opening.top + opening.height * (INTRO_EDGE_MIN + rng() * INTRO_EDGE_RANGE);
      infos.push(addAgent(startX, startY, home).info);
    }

    if (this.opts.director) {
      this.watchDirector({
        overlay, cursors, scheduler,
        agentOf: (id) => byId.get(id) ?? null,
        nearest: (x, y, radius) => {
          let best: Agent | null = null;
          let bestDistance = radius * radius;
          for (const agent of agents) {
            if (agent.isFinished) continue;
            const dx = agent.x - x;
            const dy = agent.y - y;
            const distance = dx * dx + dy * dy;
            if (distance <= bestDistance) {
              bestDistance = distance;
              best = agent;
            }
          }
          return best;
        },
      });
    }

    // 四套参考实现里只有这一处按帧读布局，其余都从 this.band 取缓存。
    const wantsFrame = this.opts.flight === 'live'
      || this.opts.gather
      || this.opts.agents === 'auto'
      || this.opts.pick === 'live'
      || this.opts.trigger === 'scroll'
      || this.opts.adaptiveSpeed
      || generative;
    let flight: Flight | null = null;
    let crew: Crew | null = null;
    // 聚群期间参考版只跑轨道场：不招人、不动镜头、不发活，所以这几样都等开工再进时钟。
    let building = !this.opts.gather;
    if (wantsFrame) {
      this.band = viewBand(this.root, this.scroller);
      const flightStage = (): FlightStage => ({
        top: this.band.top,
        height: this.band.height,
        width: blueprint.width,
        pointer: this.pointer,
      });
      flight = this.opts.flight === 'live' || this.opts.gather
        ? new Flight(flyers, flightStage, this.opts.pointer === 'follow', this.opts.pointer === 'repel')
        : null;
      if (this.opts.gather || (flight && this.opts.pointer !== 'ignore')) this.watchPointer();
      crew = this.opts.agents === 'auto'
        ? new Crew({
            active: () => flyers().length,
            available: () => scheduler.available,
            busy: () => flyers().reduce((n, agent) => n + (agent.busy ? 1 : 0), 0),
            scrollPos: () => this.band.top,
            spawn: (edge, y) => addAgent(edge === 'left' ? -SPAWN_OFFSCREEN : blueprint.width + SPAWN_OFFSCREEN, y, false),
            leave: (flyer) => byFlyer.get(flyer)?.retire(),
            isHome: (flyer) => byFlyer.get(flyer)?.isHome ?? false,
            floor: homeCount,
            stage: flightStage,
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
        if (building) crew?.tick(realMs);
        // 位置归物理，姿态归物理，施工中的那一帧除外（它自己 moveTo 过）。
        if (flight) for (const agent of flyers()) agent.renderPose();
        return scheduler.pending === 0 && agents.every((agent) => agent.isFinished);
      });
      engine.add(ticker);
    }

    // 镜头只在这一局里存在，但先把它建好：Tour 是运行时开关，参考版的 HUD 上
    // 那颗钮切的就是同一局里跟不跟，不是下一局的配置。
    const camViews = (): readonly TourView[] => {
      const live = flyers();
      // 手里还有活（没领的、或已经领了正在飞的）就跟着人走；全闲下来才朝下一屏望。
      if (this.opts.trigger !== 'scroll' || scheduler.available > 0 || live.some((a) => a.busy)) return live;
      const ahead = scheduler.nextGatedY();
      // 靶子按「挡住的那件往下 1/4 屏」交给镜头，镜头把它拉到视口下缘往上 90px，
      // 于是真正的条目落在解锁线（视口底边）以上——只把条目本身交给镜头，它正好压着线，滚到位了却没解锁。
      return ahead === null ? live : [...live, { x: 0, y: ahead + this.band.height * 0.25 }];
    };
    const camera = new TourCam(
      camViews,
      this.root,
      () => scheduler.built >= scheduler.total,
      (cam) => {
        engine.remove(cam);
        this.touring = false;
        this.report(true);
      },
      () => this.scroller,
    );
    this.camera = camera;

    if (this.options.onProgress) engine.add(new ProgressTicker(engine, scheduler, this.options.onProgress));
    if (this.options.onStatus || this.hud) {
      const done = (): boolean => scheduler.pending === 0 && agents.every((agent) => agent.isFinished);
      engine.add(new StatusTicker(engine, () => this.report(), done));
    }

    let roll: RollCall | null = null;
    const launch = (): void => {
      // 开工那一帧点名结束：小剧场拆掉，名牌恢复安静。
      roll?.destroy();
      roll = null;
      building = true;
      this.phase = 'building';
      this.touring = this.opts.tour;
      scheduler.release();
      this.syncDirector();
      if (flight) flight.introCenter = null;
      if (this.touring) engine.add(camera);
      score?.start();
      this.report(true);
      this.options.onStart?.(infos);
    };

    if (this.opts.gather && flight) {
      this.phase = 'gathering';
      scheduler.hold();
      // 圆心钉在视口正中：镜头这段时间不动，读者看到的就是一群光标在眼前绕圈。
      flight.introCenter = { x: blueprint.width / 2, y: this.band.top + this.band.height / 2 };
      const intro = new IntroTicker(engine, flyers, () => this.pointer, () => {
        this.stopIntro = null;
        this.intro = null;
        launch();
      });
      this.intro = intro;
      this.stopIntro = () => intro.dispose();
      engine.add(intro);
      // 开场点名：聚群这几秒里挂一条领班牌，名牌按进场顺序逐个弹。纯装饰，
      // 不加减人也不改聚群时长；开工（或跳过/交还时随隔离层一起拆）即消失。
      roll = new RollCall(overlay.el, blueprint.width, this.band.top, infos, cursors);
      // 参考版在开场那一下先放一段气声，群蜂散开时才接琶音。
      score?.intro();
      this.report(true);
    } else {
      launch();
    }
    engine.whenIdle(() => this.complete());
  }

  /**
   * 读者的鼠标：轨道场要么绕着它转，要么把它周围的 Cursor 弹开。
   * 参考版把 mouse 记在视口坐标里，我们的光标记在蓝图坐标里，所以按 root 换算一次。
   */
  private watchPointer(): void {
    const onMove = (event: PointerEvent): void => {
      this.pointer = this.stagePoint(event);
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

  /** 指针事件换算成蓝图坐标（相对 root 的边框盒）。 */
  private stagePoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * 观众就是总监：施工期间指针只落在光标上——点一下催工，拖到别处松手改派。
   * 重建出来的盒子一个像素都不碰；聚群、暂停、收工之后监听还在，但阶段检查直接放行。
   * 拖一只闲着的会真的跟着指针走（物理让开），施工中的那只不拽人，只记落点。
   */
  private watchDirector(deps: {
    overlay: Overlay;
    cursors: CursorLayer;
    scheduler: Scheduler;
    agentOf: (id: number) => Agent | null;
    nearest: (x: number, y: number, radius: number) => Agent | null;
  }): void {
    let press: {
      pointerId: number;
      agent: Agent;
      startX: number;
      startY: number;
      dragging: boolean;
    } | null = null;
    let target: HTMLElement | null = null;

    const clearTarget = (): void => {
      target?.remove();
      target = null;
    };
    const showTarget = (x: number, y: number, color: string): void => {
      if (!target) {
        target = document.createElement('div');
        target.className = 'sb-target';
        deps.overlay.el.appendChild(target);
      }
      target.style.left = `${x}px`;
      target.style.top = `${y}px`;
      target.style.color = color;
    };
    const endPress = (commit: boolean, event: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      clearTarget();
      const current = press;
      press = null;
      if (!current) return;
      deps.cursors.setDirecting(current.agent.info.id, false);
      if (!current.dragging) {
        // 按下去就松开：催这一只，光环与施工时钟同一个窗口。
        current.agent.urge();
        deps.cursors.urge(current.agent.info.id, URGE_MS);
        return;
      }
      current.agent.endDrag();
      if (!commit) return;
      const point = this.stagePoint(event);
      deps.scheduler.reassign(current.agent.index, point.x, point.y);
      const ping = document.createElement('div');
      ping.className = 'sb-assign';
      ping.style.left = `${point.x}px`;
      ping.style.top = `${point.y}px`;
      ping.style.color = current.agent.info.color;
      deps.overlay.el.appendChild(ping);
      window.setTimeout(() => ping.remove(), 700);
    };
    const onMove = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (!press.dragging
        && Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < DRAG_SLOP) return;
      event.preventDefault();
      const point = this.stagePoint(event);
      if (!press.dragging) {
        press.dragging = true;
        deps.cursors.setDirecting(press.agent.info.id, true);
        press.agent.beginDrag();
      }
      if (press.agent.dragging) press.agent.dragTo(point.x, point.y);
      showTarget(point.x, point.y, press.agent.info.color);
    };
    const onUp = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.pointerId) return;
      endPress(true, event);
    };
    const onCancel = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.pointerId) return;
      endPress(false, event);
    };
    const onDown = (event: PointerEvent): void => {
      if (this.phase !== 'building' || this.finished || this.destroyed) return;
      if (press || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const hit = event.target instanceof Element ? event.target.closest('.sb-cursor') : null;
      let agent: Agent | null = null;
      if (hit instanceof HTMLElement) {
        const id = Number(hit.dataset.cursor);
        agent = Number.isFinite(id) ? deps.agentOf(id) : null;
      }
      // 光标一直在飞，按下那一瞬可能已经挪出箭头几个像素：锚点附近也算点中，
      // 否则观众永远追不上。盒子仍然不接指针，这里只认光标自己。
      if (!agent) {
        const point = this.stagePoint(event);
        agent = deps.nearest(point.x, point.y, GRAB_RADIUS);
      }
      if (!agent || agent.isFinished) return;
      event.preventDefault();
      event.stopPropagation();
      press = {
        pointerId: event.pointerId,
        agent,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    };
    // 光标是虚拟 UI：点它不该被宿主页面的全局点击监听当成一次页面点击。
    const onClick = (event: MouseEvent): void => {
      if (this.phase !== 'building' || this.finished) return;
      if (event.target instanceof Element && event.target.closest('.sb-cursor')) event.stopPropagation();
    };
    deps.overlay.el.addEventListener('pointerdown', onDown);
    deps.overlay.el.addEventListener('click', onClick);
    this.stopDirector = () => {
      deps.overlay.el.removeEventListener('pointerdown', onDown);
      deps.overlay.el.removeEventListener('click', onClick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      clearTarget();
      if (press) {
        deps.cursors.setDirecting(press.agent.info.id, false);
        press.agent.endDrag();
        press = null;
      }
    };
  }

  /** 只有施工中、开着观众指挥、这一局还没收工时，光标才接指针。 */
  private syncDirector(): void {
    this.overlay?.el.classList.toggle(
      'is-directing',
      this.opts.director && this.phase === 'building' && !this.finished,
    );
  }

  private complete(): void {
    this.finished = true;
    this.phase = 'done';
    this.touring = false;
    this.syncDirector();
    this.endedAt = performance.now();
    // 名片只列真竣工过的人：skip 交回来的「完成数」里可能有没盖过章的活，
    // 与其给每个人摊派一笔假账，不如让 tally 只算自己收尾的那几件。
    const crew = this.agents
      .filter((agent) => agent.built > 0)
      .map((agent) => ({ ...agent.info, built: agent.built }));
    const result: SwarmResult = {
      built: this.scheduler?.built ?? 0,
      dropped: this.blueprint?.dropped ?? 0,
      agents: this.agents.filter((agent) => agent.worked).length,
      durationMs: Math.round(this.endedAt - this.startedAt),
      seed: this.scheduler?.seed ?? this.opts.seed,
      ...(crew.length > 0 ? { crew } : {}),
    };
    // 参考版是收尾和弦先响，真页面亮出来那一下再落一个下落扫频，余响里把声部关掉。
    this.score?.finale();
    this.overlay?.reveal();
    this.hud?.destroy();
    this.hud = null;
    this.score?.release();
    this.cursors?.destroy();
    // 场上已经没光标了：读数不能还挂着一群被强行停住的替身。
    this.agents = [];
    this.stopPointer?.();
    this.stopPointer = null;
    this.stopDirector?.();
    this.stopDirector = null;
    this.stopIntro?.();
    this.stopIntro = null;
    this.intro = null;
    this.stopKeys?.();
    this.stopKeys = null;
    this.sound?.close(1.4);
    this.sound = null;
    this.score = null;
    this.report(true);
    this.options.onComplete?.(result);
  }

  /** Freezes the clock mid-stroke; `resume()` continues from the same frame. */
  pause(): void {
    if (!this.engine || this.finished || this.destroyed || this.phase === 'paused') return;
    this.engine.pause();
    this.frozen = this.phase;
    this.phase = 'paused';
    this.syncDirector();
    this.report(true);
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = this.frozen;
    this.engine?.resume();
    this.syncDirector();
    this.report(true);
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
    this.report(true);
  }

  /** 参考版 HUD 那颗倍速钮：1× → 2× → 3× → 1×。 */
  cycleSpeed(): number {
    const at = SPEED_STEPS.indexOf(this.opts.speed as (typeof SPEED_STEPS)[number]);
    const next = SPEED_STEPS[(at + 1) % SPEED_STEPS.length] ?? 1;
    this.setSpeed(next);
    return next;
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

  /** 参考版 toggle()：在跑的收工，跑完的重放，还没跑的开局。 */
  toggle(): void {
    if (this.started && !this.finished && !this.destroyed) this.stop();
    else if (this.finished) this.replay();
    else this.start();
  }

  /**
   * Hands the page back now and forgets the run, the reference's `stop(reveal)`.
   * `reveal` is the extension's 「Go live」: it plays the falling sweep on the way
   * out, where a plain stop leaves silently. The instance stays usable —
   * `start()` or `replay()` begins a fresh run on the same options.
   */
  stop(reveal = false): void {
    if (this.destroyed) return;
    if (reveal && !this.finished) this.score?.release();
    this.runId++;
    this.started = false;
    this.begun = false;
    this.finished = false;
    this.phase = 'idle';
    this.touring = false;
    this.endedAt = 0;
    this.teardown(reveal ? 1.4 : 0.25);
    this.report(true);
  }

  /** 参考版 restart()：拆掉这一局，按同一份配置再采一遍、再演一遍。 */
  replay(): void {
    if (this.destroyed) return;
    this.stop();
    this.start();
  }

  setSound(on: boolean): void {
    this.opts.sound = on;
    this.sound?.setOn(on);
    this.report(true);
  }

  get isSoundOn(): boolean {
    return this.sound?.on ?? this.opts.sound;
  }

  /**
   * The reference's speaker button. When sound is on but the browser is still
   * holding the context, this unlocks it instead of muting — the 「Tap for
   * sound」 state.
   */
  toggleSound(): void {
    const sound = this.sound;
    if (!sound) {
      this.opts.sound = !this.opts.sound;
      this.report(true);
      return;
    }
    if (sound.on && sound.blocked) sound.resume();
    else sound.setOn(!sound.on);
    this.opts.sound = sound.on;
    this.report(true);
  }

  /** The reference's Tour button: follows the frontier, mid-run, without a new capture. */
  setTour(on: boolean): void {
    this.opts.tour = on;
    if (!this.engine || this.finished || this.destroyed || !this.camera) return;
    this.touring = on;
    if (on) {
      // 参考版开 Tour 时顺手 engine.start()：聚群那一段不必等满 2.4 秒。
      this.intro?.finish();
      this.engine.add(this.camera);
    } else {
      this.engine.remove(this.camera);
    }
    this.report(true);
  }

  get isTouring(): boolean {
    return this.touring;
  }

  toggleTour(): void {
    this.setTour(!this.touring);
  }

  /** What the run is doing right now; the panel and any host chrome read this. */
  get status(): SwarmStatus {
    const scheduler = this.scheduler;
    const live = this.agents.filter((agent) => !agent.isFinished);
    const busyCrew = live.filter((agent) => agent.busy);
    return {
      phase: this.destroyed ? 'idle' : this.phase,
      built: scheduler?.built ?? 0,
      total: scheduler?.total ?? 0,
      agents: live.length,
      busy: busyCrew.length,
      busyCrew: busyCrew.slice(-5).map((agent) => agent.info),
      speed: this.engine?.speed ?? this.opts.speed,
      pace: this.pace,
      sound: this.sound?.on ?? this.opts.sound,
      soundBlocked: this.sound?.blocked ?? false,
      tour: this.touring,
      // 参考版那句 "scroll to keep building"：活被解锁线挡着、眼前又没得干、镜头也没在跟。
      needsScroll: this.phase === 'building'
        && scheduler !== null
        && !this.touring
        && this.opts.trigger === 'scroll'
        && scheduler.pending > 0
        && scheduler.gated > 0
        && scheduler.backlog === 0,
      elapsed: this.elapsed,
    };
  }

  private get elapsed(): number {
    if (!this.started) return 0;
    const end = this.finished || this.destroyed ? this.endedAt : performance.now();
    return Math.max(0, end - this.startedAt) / 1000;
  }

  /** 200ms 的节拍：跟参考版 HUD 的刷新率一样，`force` 只给阶段切换用。 */
  private report(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastStatusAt < STATUS_MS) return;
    this.lastStatusAt = now;
    const status = this.status;
    this.hud?.update(status);
    this.options.onStatus?.(status);
  }

  private teardown(soundAfter: number): void {
    this.engine?.stop();
    this.stopPointer?.();
    this.stopPointer = null;
    this.stopDirector?.();
    this.stopDirector = null;
    this.stopIntro?.();
    this.stopIntro = null;
    this.intro = null;
    this.stopKeys?.();
    this.stopKeys = null;
    this.cursors?.destroy();
    this.overlay?.destroy();
    this.hud?.destroy();
    this.hud = null;
    this.sound?.close(soundAfter);
    this.sound = null;
    this.score = null;
    this.camera = null;
    this.engine = null;
    this.cursors = null;
    this.overlay = null;
    this.scheduler = null;
    this.blueprint = null;
    this.agents = [];
  }

  /**
   * 参考版绑在 window 上的那几个键：Esc 收工、M 静音、任何键与按下都用来解锁音频。
   * 库跑在宿主页面里，读者在输入框里敲 m 不该把配乐关了——那一类目标是让开的。
   */
  private watchKeys(): void {
    if (!this.opts.keys || this.stopKeys) return;
    const editing = (event: Event): boolean => {
      const target = event.composedPath()[0] ?? event.target;
      const el = target instanceof HTMLElement ? target : null;
      return el !== null && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    };
    const onKey = (event: KeyboardEvent): void => {
      if (!editing(event)) {
        if (event.key === 'Escape' && this.started && !this.finished) {
          event.stopPropagation();
          this.stop();
        } else if ((event.key === 'm' || event.key === 'M') && !event.metaKey && !event.ctrlKey && !event.altKey) {
          this.toggleSound();
        }
      }
      this.unlockSound();
    };
    const onDown = (): void => this.unlockSound();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    this.stopKeys = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }

  private unlockSound(): void {
    const sound = this.sound;
    if (!sound?.blocked) return;
    sound.resume();
    // resume() 是个 promise：上下文状态要到下一拍才翻，参考版也是等 80ms 再刷按钮。
    setTimeout(() => {
      if (!this.destroyed) this.report(true);
    }, 80);
  }

  destroy(): void {
    this.destroyed = true;
    this.started = false;
    this.phase = 'idle';
    this.touring = false;
    this.endedAt = 0;
    this.teardown(0.1);
    this.report(true);
  }
}
