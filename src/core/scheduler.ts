import type { Blueprint, BlueprintItem } from './blueprint';
import type { BuildOrder } from '../types';
import { makeRng, resolveSeed, shuffled } from './rng';

export interface SchedulerOptions {
  agentCount: number;
  order: BuildOrder;
  seed: number;
  /** 装箱按预估工时而不是件数；见 `balance`。 */
  balance: boolean;
  /** 一个元素大约多重（毫秒）；只有 balance 开着才用到，所以由调用方注入。 */
  cost: (item: BlueprintItem) => number;
}

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
 */
export class Scheduler {
  private readonly queues: BlueprintItem[][] = [];
  private readonly known = new Set<string>();
  private readonly completed = new Set<string>();
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

    for (const unit of unitsFor(blueprint, opts, schedulable, target, makeRng(this.seed))) {
      this.queues.push(unit);
    }
    while (this.queues.length < opts.agentCount) this.queues.push([]);
  }

  isEmpty(agentIndex: number): boolean {
    return (this.queues[agentIndex]?.length ?? 0) === 0;
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
   * Claims the first dependency-free task in this agent's queue, then - only if
   * its own queue is stuck - the first one anywhere else. A blocked item is
   * never lost: its blocker is shallower in the tree, so some queue always has
   * a ready task while work remains.
   */
  take(agentIndex: number): BlueprintItem | null {
    for (let offset = 0; offset < this.queues.length; offset++) {
      const queue = this.queues[(agentIndex + offset) % this.queues.length];
      if (!queue) continue;
      const index = queue.findIndex((item) => this.isReady(item));
      if (index >= 0) return queue.splice(index, 1)[0] as BlueprintItem;
    }
    return null;
  }

  markDone(id: string): void {
    this.completed.add(id);
  }

  get built(): number {
    return this.completed.size;
  }

  private isReady(item: BlueprintItem): boolean {
    return item.blockers.every((blocker) => !this.known.has(blocker) || this.completed.has(blocker));
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
      return bands(schedulable, opts.agentCount, centerY, cost);
    case 'cols':
      return columns(blueprint, schedulable, opts.agentCount, cost);
    case 'snake': {
      const units = bands(schedulable, opts.agentCount, centerY, cost);
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
): BlueprintItem[][] {
  const sorted = schedulable
    .slice()
    .sort((a, b) => key(a) - key(b) || centerY(a) - centerY(b) || a.order - b.order);
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
  return bands(schedulable, agentCount, blocks >= 2 ? centerX : centerY, cost);
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
