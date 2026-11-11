import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import { normalizeOptions } from '../src/core/config';
import { Scheduler } from '../src/core/scheduler';
import { STEADY } from '../src/core/personality';
import type { Blueprint, BlueprintItem } from '../src/core/blueprint';
import type { ActionPlanner } from '../src/core/action';
import type { CursorLayer } from '../src/render/cursor_layer';
import type { Overlay } from '../src/render/overlay';

function item(id: string, x: number, y: number): BlueprintItem {
  return { id, kind: 'rect', depth: 0, order: 0, group: 0, blockers: [], x, y, width: 100, height: 50 };
}

function blueprint(items: BlueprintItem[]): Blueprint {
  return {
    items,
    byId: new Map(items.map((entry) => [entry.id, entry])),
    width: 1000,
    height: 3000,
    rootOffset: { x: 0, y: 0 },
    dropped: 0,
    guides: 0,
  };
}

function scheduler(items: BlueprintItem[], pick: 'queued' | 'live' = 'queued'): Scheduler {
  return new Scheduler(blueprint(items), {
    agentCount: 2,
    order: 'rows',
    seed: 1,
    balance: false,
    cost: () => 1,
    pick,
    trigger: 'immediate',
  });
}

describe('Scheduler.reassign', () => {
  it('claims the job nearest the drop, even from another cursor\'s band', () => {
    const a = item('a', 0, 0);
    const b = item('b', 0, 100);
    const c = item('c', 0, 1000);
    const d = item('d', 0, 1100);
    const plan = scheduler([a, b, c, d]);
    // rows + 2 cursors: band 0 holds a,b and band 1 holds c,d.
    expect(plan.take({ index: 0, x: 0, y: 0 })?.id).toBe('a');
    plan.reassign(0, 50, 1130);
    // c is the head of the other band, but d sits at the drop; reassignment picks d.
    expect(plan.take({ index: 0, x: 0, y: 0 })?.id).toBe('d');
    // The command is spent: the next claim is back to its own band.
    expect(plan.take({ index: 0, x: 0, y: 0 })?.id).toBe('b');
  });

  it('works on the live pool too', () => {
    const a = item('a', 0, 0);
    const b = item('b', 0, 2000);
    const pool = scheduler([a, b], 'live');
    pool.reassign(0, 50, 2025);
    expect(pool.take({ index: 0, x: 0, y: 0 })?.id).toBe('b');
    expect(pool.take({ index: 0, x: 0, y: 0 })?.id).toBe('a');
  });
});

describe('Agent.urge', () => {
  const idlePlanner: ActionPlanner = () => [{
    name: 'rect',
    duration: 1000,
    tick: () => {},
    end: () => {},
  }];

  const crew = (item: BlueprintItem) => {
    const cursors = {
      setPosition: () => {}, setIdling: () => {}, setShape: () => {}, setBadge: () => {},
      setPose: () => {}, hide: () => {},
    } as unknown as CursorLayer;
    const overlay = { stamp: () => {} } as unknown as Overlay;
    return new Agent(0, { id: 0, name: 'Ava', color: '#fff', personality: 'steady' }, {
      scheduler: { take: () => item, markDone: () => {} } as unknown as Scheduler,
      overlay,
      cursors,
      opts: normalizeOptions(undefined),
      blueprint: blueprint([item]),
      sound: null,
      flock: { offset: () => ({ x: 0, y: 0 }) } as never,
      planner: idlePlanner,
      onFinished: () => {},
      onItemDone: () => {},
      rng: () => 0.5,
      persona: STEADY,
      home: true,
    }, 0, 0);
  };

  const ticksToFinish = (urged: boolean): number => {
    const agent = crew(item('a', 0, 0));
    if (urged) agent.urge(20000);
    let ticks = 0;
    // First tick claims the job; every tick after that advances the one action.
    do {
      agent.tick(100);
      ticks++;
    } while (agent.busy && ticks < 40);
    return ticks;
  };

  it('finishes the same action in fewer ticks while the window is open', () => {
    const normal = ticksToFinish(false);
    const urged = ticksToFinish(true);
    expect(normal).toBe(11);
    expect(urged).toBeLessThan(normal);
    expect(urged).toBeGreaterThanOrEqual(6);
  });
});

describe('director option', () => {
  it('is on by default and can be turned off', () => {
    expect(normalizeOptions(undefined).director).toBe(true);
    expect(normalizeOptions({ director: false }).director).toBe(false);
  });
});
