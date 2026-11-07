import type { Blueprint, BlueprintItem } from './blueprint';

/**
 * Distribution keeps a subtree on one cursor: blockers live inside the same
 * unit, so cursors work in parallel instead of waiting on each other. Units are
 * balanced largest-first, and oversized groups are split so no cursor idles.
 */
export class Scheduler {
  private readonly queues: BlueprintItem[][] = [];
  private readonly known = new Set<string>();
  private readonly completed = new Set<string>();
  readonly total: number;

  constructor(blueprint: Blueprint, agentCount: number) {
    this.total = blueprint.items.length;
    for (const item of blueprint.items) this.known.add(item.id);

    const target = Math.max(1, Math.ceil(this.total / agentCount));
    const units: BlueprintItem[][] = [];
    const groups = new Map<number, BlueprintItem[]>();
    for (const item of blueprint.items) {
      const group = groups.get(item.group);
      if (group) group.push(item);
      else groups.set(item.group, [item]);
    }

    for (const group of groups.values()) {
      if (group.length <= target * 1.5) {
        units.push(group);
        continue;
      }
      for (let start = 0; start < group.length; start += target) {
        units.push(group.slice(start, start + target));
      }
    }

    for (let index = 0; index < agentCount; index++) this.queues.push([]);
    units.sort((a, b) => b.length - a.length);
    for (const unit of units) {
      let lightest = 0;
      for (let index = 1; index < this.queues.length; index++) {
        if (this.queues[index]!.length < this.queues[lightest]!.length) lightest = index;
      }
      this.queues[lightest]!.push(...unit);
    }
  }

  isEmpty(agentIndex: number): boolean {
    return (this.queues[agentIndex]?.length ?? 0) === 0;
  }

  /** Where the agent should appear, so cursors start dispersed over the page. */
  peek(agentIndex: number): BlueprintItem | null {
    return this.queues[agentIndex]?.[0] ?? null;
  }

  /** Claims the first dependency-free task in this agent's queue. */
  take(agentIndex: number): BlueprintItem | null {
    const queue = this.queues[agentIndex];
    if (!queue) return null;
    const index = queue.findIndex((item) => this.isReady(item));
    if (index < 0) return null;
    return queue.splice(index, 1)[0] as BlueprintItem;
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
