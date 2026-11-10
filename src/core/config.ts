import type { SwarmBuilderOptions, SwarmConfig } from '../types';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 8;
/** 参考版 HUD 上那颗倍速钮循环的三档。 */
export const SPEED_STEPS = [1, 2, 3] as const;

export interface NormalizedOptions extends Omit<Required<SwarmConfig>, 'ignore'> {
  /** The public option also takes a single selector; inside the library it is always a list. */
  ignore: string[];
  moveSpeed: number;
  typeInterval: number;
  fadeDuration: number;
}

/**
 * 库的默认跑法就是参考扩展那一套，不是一个要挑的预设：光标待时绕轨道飞、鼠标当圆心、
 * 班组自动增减、开场先聚群、活按运行时价钱挑、只有滚到的那一段才放行、积压自己提速、
 * 采集前先滚一遍、声音与生成式配乐开着。`tour` 跟参考版一样默认关——读者自己滚，
 * 或者按面板上那个 Tour，前沿才跟着往下走。
 *
 * 单开某一项都到不了那个效果：`rows` 在多光标下是 N 条带并行，`immediate` 让整页
 * 第一帧就敞开，于是镜头一帧冲到页底、构建看着像满屏随机。实测（demos/tall.html，
 * 1280x900，6 光标、speed 2、静音、tour 开）：开场 2.4s 里滚动位置一动不动，开工后
 * 镜头 1.6s 首次下移、6.5s 到底，跨带的前沿只往下走（同一条带里几件并行完工，会交错
 * 几百像素，那不是回头）。
 *
 * 默认值只有这一份：normalizeOptions 读它，面板的「恢复默认」和导出的代码片段也读它。
 */
export const DEFAULT_OPTIONS: Required<SwarmConfig> = {
  agentCount: 8,
  speed: 1,
  ignore: [],
  maxItems: 4000,
  duplicate: true,
  maxCopies: 12,
  guides: true,
  maxGuides: 16,
  grow: true,
  sound: true,
  flocking: true,
  tour: false,
  theme: 'auto',
  targetDuration: 0,
  performanceMode: 'auto',
  order: 'rows',
  balance: false,
  seed: 0,
  flight: 'live',
  pointer: 'follow',
  agents: 'auto',
  gather: true,
  pick: 'live',
  trigger: 'scroll',
  adaptiveSpeed: true,
  scan: 'pre-scroll',
  score: 'generative',
  reducedMotion: 'skip',
  keys: true,
  hud: false,
};

export function normalizeOptions(input: SwarmBuilderOptions | undefined): NormalizedOptions {
  const options = input ?? {};
  const d = DEFAULT_OPTIONS;
  return {
    agentCount: Math.round(clamp(options.agentCount ?? d.agentCount, 1, 24)),
    speed: clamp(options.speed ?? d.speed, SPEED_MIN, SPEED_MAX),
    ignore: normalizeIgnore(options.ignore),
    maxItems: Math.round(clamp(options.maxItems ?? d.maxItems, 1, 5000)),
    duplicate: options.duplicate ?? d.duplicate,
    maxCopies: Math.round(clamp(options.maxCopies ?? d.maxCopies, 1, 48)),
    guides: options.guides ?? d.guides,
    maxGuides: Math.round(clamp(options.maxGuides ?? d.maxGuides, 0, 64)),
    grow: options.grow ?? d.grow,
    sound: options.sound ?? d.sound,
    flocking: options.flocking ?? d.flocking,
    tour: options.tour ?? d.tour,
    theme: options.theme ?? d.theme,
    targetDuration: clamp(options.targetDuration ?? d.targetDuration, 0, 120),
    performanceMode: options.performanceMode ?? d.performanceMode,
    order: options.order ?? d.order,
    balance: options.balance ?? d.balance,
    seed: Math.round(clamp(options.seed ?? d.seed, 0, 2 ** 31 - 1)),
    moveSpeed: 2200,
    typeInterval: 28,
    fadeDuration: 140,
    flight: options.flight ?? d.flight,
    pointer: options.pointer ?? d.pointer,
    agents: options.agents ?? d.agents,
    gather: options.gather ?? d.gather,
    pick: options.pick ?? d.pick,
    trigger: options.trigger ?? d.trigger,
    adaptiveSpeed: options.adaptiveSpeed ?? d.adaptiveSpeed,
    scan: options.scan ?? d.scan,
    score: options.score ?? d.score,
    reducedMotion: options.reducedMotion ?? d.reducedMotion,
    keys: options.keys ?? d.keys,
    hud: options.hud ?? d.hud,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Measured at 1280x900: 55 nodes -> 58 items holds every frame for a 6.8s run,
 * and 355 nodes -> 367 items still holds every frame but runs for 38s. Frame
 * rate is not what breaks on a crowded page - the choreography drags and turns
 * into noise - so auto trims the effects that add per-item work and visual
 * clutter once the page is past that scale.
 *
 * Sound is deliberately NOT in this list: it is throttled to a handful of
 * oscillators per second and adds no nodes, so trimming it bought nothing and
 * made a dense page look like the option was broken.
 */
const CROWDED_NODES = 250;

export function applyPerformanceMode(opts: NormalizedOptions, elementCount: number): void {
  if (opts.performanceMode === 'high') return;
  if (opts.performanceMode === 'auto' && elementCount < CROWDED_NODES) return;
  opts.guides = false;
  opts.grow = false;
  opts.maxCopies = Math.min(opts.maxCopies, 6);
}

function normalizeIgnore(ignore: string | string[] | undefined): string[] {
  if (!ignore) return [];
  const list = Array.isArray(ignore) ? ignore : [ignore];
  return list.filter((selector) => typeof selector === 'string' && selector.trim().length > 0);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
