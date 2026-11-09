import type { Blueprint, BlueprintItem } from './blueprint';
import type { BuildOrder, PickMode, TriggerMode } from '../types';
import { makeRng, resolveSeed, shuffled } from './rng';

export interface SchedulerOptions {
  agentCount: number;
  order: BuildOrder;
  seed: number;
  /** 装箱按预估工时而不是件数；见 `balance`。 */
  balance: boolean;
  /** 一个元素大约多重（毫秒）；只有 balance 开着才用到，所以由调用方注入。 */
  cost: (item: BlueprintItem) => number;
  /** 'queued'（默认）按预先切好的队列领；'live' 用参考实现的代价函数现挑。 */
  pick: PickMode;
  /** 'immediate'（默认）第一帧就全页开放；'scroll' 只放行滚动前沿以上的。 */
  trigger: TriggerMode;
}

/** 领活的一方：编号 + 当前位置，live 挑选要按离光标多远算代价。 */
export interface Claimer {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/** 一帧里看得见的这一段页面，蓝图坐标。 */
export interface ViewBand {
  top: number;
  bottom: number;
}

/** cursor-swarm 的 `trigger` 默认值：元素顶边越过视口 88% 那条线才算到了。 */
const UNLOCK_FRACTION = 0.88;
/** 参考版 pick()：带外先付一百万，带内按纵向位置、再按离光标的距离加权。 */
const OUTSIDE_PENALTY = 1e6;
const GUIDE_BONUS = 5e5;
const BAND_WEIGHT = 0.6;
const CURSOR_WEIGHT = 0.4;
/** 带顶往上再让 40px，免得刚滚出视野的元素立刻变成天价。 */
const BAND_SLACK = 40;

/**
 * How the work is handed out. One shared invariant: a cursor claims from its own
 * queue first, so the page reads as a crew with assigned regions rather than one
 * swarm fighting over the same corner.
 *
 * Spatial orders (each cursor gets one region of the page):
 * - `rows`   one horizontal band, so the page rises top-to-bottom - the one that
 *            matches how a person scrolls.
 * - `cols`   the same cut turned on its side, one vertical band; falls back to
 *            `rows` when the page has no real columns to cut along.
 * - `snake`  the `rows` bands, but each band is walked left-to-right and the
 *            next one right-to-left, so nobody walks back across a page they
 *            just finished.
 * - `depth`  one band per cursor *within* each DOM depth: containers and headings
 *            first, leaves after - a skeleton getting filled in.
 * - `radial` bands by distance from the page centre, working outward.
 *
 * Unit orders (each cursor gets whole units):
 * - `group`  keeps a subtree on one cursor (blockers live in the same unit).
 * - `random` shuffles with the seed, for a choreography that never repeats.
 *
 * Oversized units are split so no cursor idles, and `take()` may steal: a band
 * can hold a child whose parent sits in the band above, and without stealing
 * that cursor would wait forever. `balance` leaves the direction of the sweep
 * alone and changes how much work each band carries.
 *
 * Spatial bands are cut on an element's *leading* edge, not its centre, and
 * ties go to the shallower depth. A container starts above what it contains, so
 * keying by the leading edge puts every parent in the same band as, or an
 * earlier one than, its children - which is what makes `rows` read as a single
 * top-to-bottom sweep instead of a cursor repeatedly jumping back up to fetch a
 * wrapper its next item is still waiting on.
 */
export class Scheduler {
  private readonly queues: BlueprintItem[][] = [];
  private readonly known = new Set<string>();
  private readonly completed = new Set<string>();
  /** `pick: 'live'` 时唯一的工作来源；关着时是 null，一切照旧走 queues。 */
  private readonly pool: BlueprintItem[] | null;
  /** `trigger: 'scroll'` 时是已经滚到的最低那条线；关着时是 Infinity。 */
  private frontier: number;
  private band: ViewBand = { top: Number.NEGATIVE_INFINITY, bottom: Number.POSITIVE_INFINITY };
  readonly total: number;
  /** The number this run shuffled with - 0 in means "pick one for me". */
  readonly seed: number;

  constructor(blueprint: Blueprint, opts: SchedulerOptions) {
    this.seed = resolveSeed(opts.seed);
    this.total = blueprint.items.length;
    // Consumed items are materialised by a stamp action, so they must not be
    // claimable, and they must not hold a real task waiting on them.
    const schedulable = blueprint.items.filter((item) => !item.consumed);
    for (const item of schedulable) this.known.add(item.id);
    const target = Math.max(1, Math.ceil(schedulable.length / opts.agentCount));
    this.pool = opts.pick === 'live' ? schedulable.slice() : null;
    this.frontier = opts.trigger === 'scroll' ? 0 : Number.POSITIVE_INFINITY;

    for (const unit of unitsFor(blueprint, opts, schedulable, target, makeRng(this.seed))) {
      this.queues.push(unit);
    }
    while (this.queues.length < opts.agentCount) this.queues.push([]);
  }

  isEmpty(agentIndex: number): boolean {
    if (this.pool) return this.pool.length === 0;
    return (this.queues[agentIndex]?.length ?? 0) === 0;
  }

  /**
   * 每帧报一次可见范围：`trigger:'scroll'` 用它推进只降不升的前沿，
   * `pick:'live'` 用它算「在这屏外面」的代价。
   */
  setViewport(band: ViewBand): void {
    this.band = band;
    if (this.frontier !== Number.POSITIVE_INFINITY) {
      this.frontier = Math.max(this.frontier, band.top + (band.bottom - band.top) * UNLOCK_FRACTION);
    }
  }

  /** 还没被领走的活，含被前沿挡住的；0 表示这局做完了。 */
  get pending(): number {
    if (this.pool) return this.pool.length;
    let n = 0;
    for (const queue of this.queues) n += queue.length;
    return n;
  }

  /** 参考版的 backlog()：已解锁、还没落定的活。用来把时钟拧快。 */
  get backlog(): number {
    let n = 0;
    this.eachUnclaimed((item) => { if (this.unlocked(item)) n++; });
    return n;
  }

  /** 已解锁又没人领、依赖也齐的活：班组按这个决定要不要再招人。 */
  get available(): number {
    let n = 0;
    this.eachUnclaimed((item) => { if (this.ready(item)) n++; });
    return n;
  }

  private eachUnclaimed(fn: (item: BlueprintItem) => void): void {
    if (this.pool) {
      for (const item of this.pool) fn(item);
      return;
    }
    for (const queue of this.queues) for (const item of queue) fn(item);
  }

  /** 还欠着多少件「要滚到才放行」的活。不为 0 时谁都不能收工，包括原始班底。 */
  get gated(): number {
    let n = 0;
    this.eachUnclaimed((item) => { if (!this.unlocked(item)) n++; });
    return n;
  }

  /** 最近的一件被挡住的东西在页面的哪个位置——镜头拿它当前方的靶子，滚过去才会解锁。 */
  nextGatedY(): number | null {
    let best = Number.POSITIVE_INFINITY;
    this.eachUnclaimed((item) => { if (!this.unlocked(item)) best = Math.min(best, item.y); });
    return Number.isFinite(best) ? best : null;
  }

  /** The distribution as handed out, so a run length can be predicted from it. */
  get agentQueues(): readonly (readonly BlueprintItem[])[] {
    return this.queues;
  }

  /** Where the agent should appear, so cursors start dispersed over the page. */
  peek(agentIndex: number): BlueprintItem | null {
    return this.queues[agentIndex]?.[0] ?? null;
  }

  /**
   * `queued`（默认）：先在自己那条队列里找第一个能干的，找不到再顺移着抢；
   * 被挡住的任务不会丢，它的阻碍者深度更浅，总有队列里有活。
   * `live`：整页一个池子，按参考实现的代价挑最便宜的那个。
   */
  take(claimer: Claimer): BlueprintItem | null {
    if (this.pool) return this.pickLive(claimer);
    const offset = ((claimer.index % this.queues.length) + this.queues.length) % this.queues.length;
    for (let step = 0; step < this.queues.length; step++) {
      const queue = this.queues[(offset + step) % this.queues.length];
      if (!queue) continue;
      const index = queue.findIndex((item) => this.ready(item));
      if (index >= 0) return queue.splice(index, 1)[0] as BlueprintItem;
    }
    return null;
  }

  private pickLive(claimer: Claimer): BlueprintItem | null {
    const pool = this.pool as BlueprintItem[];
    let best = -1;
    let cheapest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < pool.length; index++) {
      const item = pool[index] as BlueprintItem;
      if (!this.ready(item)) continue;
      const score = this.pickScore(item, claimer.y);
      if (score < cheapest) {
        cheapest = score;
        best = index;
      }
    }
    return best < 0 ? null : (pool.splice(best, 1)[0] as BlueprintItem);
  }

  /**
   * 参考版 swarm.js 的 pick()：不在视口里先付一百万，带外的那一段按距离乘 0.6，
   * 离光标纵向距离再乘 0.4，参考线反方向优惠 50 万——于是永远是「眼前这屏从上往下」，
   * 手边那条线优先。
   */
  private pickScore(item: BlueprintItem, cursorY: number): number {
    const y = item.y;
    const top = this.band.top - BAND_SLACK;
    const outside = y >= top && y <= this.band.bottom ? 0 : y < top ? 1 : 2;
    return outside * OUTSIDE_PENALTY
      + (outside === 1 ? top - y : y) * BAND_WEIGHT
      + Math.abs(y - cursorY) * CURSOR_WEIGHT
      - (item.kind === 'guide' ? GUIDE_BONUS : 0);
  }

  markDone(id: string): void {
    this.completed.add(id);
  }

  get built(): number {
    return this.completed.size;
  }

  private ready(item: BlueprintItem): boolean {
    return this.unlocked(item) && item.blockers.every((blocker) => !this.known.has(blocker) || this.completed.has(blocker));
  }

  /** `trigger:'immediate'` 时前沿是 Infinity，这一句永远为真。 */
  private unlocked(item: BlueprintItem): boolean {
    return item.y <= this.frontier;
  }
}

/** 空间顺序按页面几何切带，单元顺序按子树/洗牌切块。 */
function unitsFor(
  blueprint: Blueprint,
  opts: SchedulerOptions,
  schedulable: BlueprintItem[],
  target: number,
  rng: () => number,
): BlueprintItem[][] {
  // balance 改的是「一条带切多长」：等件数切带换成等工时切带。件数等分在
  // 密集带和稀疏带之间会让某个光标多干一倍的活，而带的条数正好等于光标数时，
  // 再怎么装箱都还是「一条带一个光标」——所以均衡必须发生在切分那一步。
  const cost = opts.balance ? opts.cost : null;

  switch (opts.order) {
    case 'rows':
      return bands(schedulable, opts.agentCount, topY, cost, ancestorFirst);
    case 'cols':
      return columns(blueprint, schedulable, opts.agentCount, cost);
    case 'snake': {
      const units = bands(schedulable, opts.agentCount, topY, cost, ancestorFirst);
      // 带内改按 x 排，奇数带整个反过来：光标扫完一条带正好停在下一条带的
      // 开头那一侧，不必横穿整页回到起点。
      units.forEach((unit, index) => {
        unit.sort((a, b) => centerX(a) - centerX(b) || centerY(a) - centerY(b) || a.order - b.order);
        if (index % 2 === 1) unit.reverse();
      });
      return units;
    }
    case 'depth':
      return layers(schedulable, opts.agentCount, cost);
    case 'radial':
      return bands(schedulable, opts.agentCount, radial(blueprint), cost);
    case 'random':
      return lighten(chunks(shuffled(schedulable, rng), target), opts);
    default: {
      const units: BlueprintItem[][] = [];
      for (const group of groups(schedulable)) units.push(...chunks(group, target));
      return lighten(units, opts);
    }
  }
}

/**
 * A unit smaller than the share it would occupy stays whole - splitting it
 * would put a subtree across two cursors for nothing. A bigger one is cut so no
 * cursor idles behind it.
 */
function chunks(items: BlueprintItem[], size: number): BlueprintItem[][] {
  if (items.length <= size * 1.5) return [items];
  const out: BlueprintItem[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/** Subtrees in document order, largest subtree first. */
function groups(schedulable: BlueprintItem[]): BlueprintItem[][] {
  const byGroup = new Map<number, BlueprintItem[]>();
  for (const item of schedulable) {
    const group = byGroup.get(item.group);
    if (group) group.push(item);
    else byGroup.set(item.group, [item]);
  }
  return [...byGroup.values()];
}

const centerY = (item: BlueprintItem): number => item.y + item.height / 2;
const centerX = (item: BlueprintItem): number => item.x + item.width / 2;
/** 横带的切分轴：元素的顶边，不是它的中线。 */
const topY = (item: BlueprintItem): number => item.y;
/**
 * 顶边齐平时按深度排，浅的先。一个容器和它的第一个子元素常常同一条顶边（子元素没有
 * 上内边距），这时候只有深度能决定谁该先落地——反了的话子元素会一直等着它的父，
 * 光标就得回头去别的带里抢，自上而下就断了。
 */
const ancestorFirst = (a: BlueprintItem, b: BlueprintItem): number => a.depth - b.depth;

/**
 * One band per cursor: sorted by the key, then cut into contiguous slices.
 * Without `cost` the slices hold the same number of items; with `cost` each
 * slice carries the same estimated milliseconds, which is what makes the
 * cursors finish together on a page whose top half is denser than its bottom.
 */
function bands(
  schedulable: BlueprintItem[],
  agentCount: number,
  key: (item: BlueprintItem) => number,
  cost: ((item: BlueprintItem) => number) | null,
  tie: (a: BlueprintItem, b: BlueprintItem) => number = (a, b) => centerY(a) - centerY(b),
): BlueprintItem[][] {
  const sorted = schedulable
    .slice()
    .sort((a, b) => key(a) - key(b) || tie(a, b) || a.order - b.order);
  if (!cost) {
    const per = Math.max(1, Math.ceil(sorted.length / Math.max(1, agentCount)));
    const units: BlueprintItem[][] = [];
    for (let start = 0; start < sorted.length; start += per) {
      units.push(sorted.slice(start, start + per));
    }
    return units;
  }
  const cuts = splitPoints(sorted.map(cost), agentCount);
  return cuts.map((start, index) => sorted.slice(start, cuts[index + 1] ?? sorted.length));
}

/**
 * 把排好序的工时切成 k 段连续区间，让最重的那段尽量轻（painters partition DP）。
 * 贪心按 share 收口会被尾部 leftovers 带偏，而等件数切法本身也是一种连续切法，
 * 所以 DP 的散布只会 ≤ 它——balance 开了永远不会比不开更 uneven。
 */
function splitPoints(weights: number[], k: number): number[] {
  const n = weights.length;
  const parts = Math.max(1, Math.min(k, n));
  if (parts <= 1) return [0];
  const prefix: number[] = [0];
  for (const weight of weights) prefix.push((prefix[prefix.length - 1] ?? 0) + weight);
  const sum = (from: number, to: number) => (prefix[to] ?? 0) - (prefix[from] ?? 0);

  let previous = prefix.slice(); // 1 段：前 i 件的工时就是那一段
  const choices: number[][] = [];
  for (let part = 2; part <= parts; part++) {
    const current = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const pick = new Array<number>(n + 1).fill(part - 1);
    for (let end = part; end <= n; end++) {
      for (let cut = part - 1; cut < end; cut++) {
        const value = Math.max(previous[cut] ?? Number.POSITIVE_INFINITY, sum(cut, end));
        if (value < (current[end] ?? Number.POSITIVE_INFINITY)) {
          current[end] = value;
          pick[end] = cut;
        }
      }
    }
    choices.push(pick);
    previous = current;
  }

  const cuts: number[] = [];
  let end = n;
  for (let part = parts; part >= 2; part--) {
    end = choices[part - 2]![end]!;
    cuts.push(end);
  }
  cuts.push(0);
  return cuts.reverse();
}

/**
 * 到页面中心的距离，用来把带切成一圈一圈。中心取蓝图包围盒的中点，
 * 而不是视口中心：长页的镜头在动，几何中心才是「从中间往外盖」的那个中间。
 */
function radial(blueprint: Blueprint): (item: BlueprintItem) => number {
  const cx = blueprint.width / 2;
  const cy = blueprint.height / 2;
  return (item) => Math.hypot(centerX(item) - cx, centerY(item) - cy);
}

/**
 * 按 x 切带之前先问一句：这页真有几栏吗？
 * 只有当元素的横向覆盖之间存在一条空槽（左右两栏之间的那种沟），按 x 切出来的
 * 带才各自落在不同的区域里。检测时先扔掉整幅宽的元素——页头和通栏容器横跨左右
 * 两栏，它们一参与，任何页面都会被合并成一块，多栏页就永远认不出来了。
 * 单栏页里所有元素 x 都重叠，切出来是把同一行劈成两半，画面反而更乱，所以退回按 y 切。
 */
function columns(
  blueprint: Blueprint,
  schedulable: BlueprintItem[],
  agentCount: number,
  cost: ((item: BlueprintItem) => number) | null,
): BlueprintItem[][] {
  const spans = schedulable
    .filter((item) => item.width < blueprint.width * 0.6)
    .map((item) => [item.x, item.x + item.width] as const)
    .sort((a, b) => a[0] - b[0]);
  const gutter = Math.max(24, blueprint.width * 0.06);
  let reach = Number.NEGATIVE_INFINITY;
  let blocks = 0;
  for (const [start, end] of spans) {
    if (start > reach + gutter) blocks++;
    reach = Math.max(reach, end);
  }
  return blocks >= 2
    ? bands(schedulable, agentCount, centerX, cost)
    : bands(schedulable, agentCount, topY, cost, ancestorFirst);
}

/**
 * 每一层 DOM 深度内部再切横带，第 i 条带交给第 i 个光标：
 * 于是画面是「外层骨架先一圈圈亮起来，叶子随后填进去」，而不是一条竖线走到底。
 * 开了 balance 就不再按编号交带，而是每切一条就交给当前累计工时最少的光标。
 */
function layers(
  schedulable: BlueprintItem[],
  agentCount: number,
  cost: ((item: BlueprintItem) => number) | null,
): BlueprintItem[][] {
  const queues: BlueprintItem[][] = Array.from({ length: Math.max(1, agentCount) }, () => []);
  const load = queues.map(() => 0);
  const depths = [...new Set(schedulable.map((item) => item.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    const slice = bands(schedulable.filter((item) => item.depth === depth), agentCount, centerY, cost);
    slice.forEach((unit, index) => {
      let into = index % queues.length;
      if (cost) {
        into = 0;
        for (let i = 1; i < queues.length; i++) if (load[i]! < load[into]!) into = i;
        load[into]! += unit.reduce((sum, item) => sum + cost(item), 0);
      }
      queues[into]!.push(...unit);
    });
  }
  return queues;
}

/** Biggest unit into the lightest queue, so every cursor stays busy. */
function lighten(units: BlueprintItem[][], opts: SchedulerOptions): BlueprintItem[][] {
  // balance 开着时「轻重」按预估工时算，关着时按件数算——后者是原来的行为。
  const weigh = (unit: BlueprintItem[]): number =>
    opts.balance ? unit.reduce((sum, item) => sum + opts.cost(item), 0) : unit.length;
  const queues: BlueprintItem[][] = Array.from({ length: Math.max(1, opts.agentCount) }, () => []);
  const load = queues.map(() => 0);
  units.sort((a, b) => weigh(b) - weigh(a));
  for (const unit of units) {
    let lightest = 0;
    for (let index = 1; index < queues.length; index++) {
      if (load[index]! < load[lightest]!) lightest = index;
    }
    queues[lightest]!.push(...unit);
    load[lightest]! += weigh(unit);
  }
  return queues;
}
