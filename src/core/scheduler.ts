import type { Blueprint, BlueprintItem } from './blueprint';
import type { BuildOrder } from '../types';
import { makeRng, resolveSeed, shuffled } from './rng';

export interface SchedulerOptions {
  agentCount: number;
  order: BuildOrder;
  seed: number;
}

/**
 * How the work is handed out. Three strategies, one shared invariant: a cursor
 * claims from its own queue first, so the page reads as a crew with assigned
 * regions rather than one swarm fighting over the same corner.
 *
 * - `group`  keeps a subtree on one cursor (blockers live in the same unit).
 * - `rows`   gives each cursor one horizontal band, so the page rises
 *            top-to-bottom - the one that matches how a person scrolls.
 * - `random` shuffles with the seed, for a choreography that never repeats.
 *
 * Oversized units are split so no cursor idles, and `take()` may steal: a band
 * can hold a child whose parent sits in the band above, and without stealing
 * that cursor would wait forever.
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

    for (const unit of unitsFor(opts.order, schedulable, opts.agentCount, target, makeRng(this.seed))) {
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

function unitsFor(
  order: BuildOrder,
  schedulable: BlueprintItem[],
  agentCount: number,
  target: number,
  rng: () => number,
): BlueprintItem[][] {
  if (order === 'rows') return bands(schedulable, agentCount);
  const units: BlueprintItem[][] = [];
  if (order === 'random') units.push(...chunks(shuffled(schedulable, rng), target));
  else for (const group of groups(schedulable)) units.push(...chunks(group, target));
  return lighten(units, agentCount);
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

/**
 * One band per cursor: sorted by centre-y, then cut into contiguous slices of
 * the same size. Sorting by y (not dividing the height) is what keeps the
 * bands even when the page has a dense section and a sparse one.
 */
function bands(schedulable: BlueprintItem[], agentCount: number): BlueprintItem[][] {
  const sorted = schedulable
    .slice()
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x || a.order - b.order);
  const per = Math.max(1, Math.ceil(sorted.length / Math.max(1, agentCount)));
  const units: BlueprintItem[][] = [];
  for (let start = 0; start < sorted.length; start += per) {
    units.push(sorted.slice(start, start + per));
  }
  return units;
}

/** Largest unit into the lightest queue, so every cursor stays busy. */
function lighten(units: BlueprintItem[][], agentCount: number): BlueprintItem[][] {
  const queues: BlueprintItem[][] = Array.from({ length: Math.max(1, agentCount) }, () => []);
  units.sort((a, b) => b.length - a.length);
  for (const unit of units) {
    let lightest = 0;
    for (let index = 1; index < queues.length; index++) {
      if (queues[index]!.length < queues[lightest]!.length) lightest = index;
    }
    queues[lightest]!.push(...unit);
  }
  return queues;
}
