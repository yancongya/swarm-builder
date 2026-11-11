import { describe, expect, it } from 'vitest';
import { Agent } from '../src/core/agent';
import { normalizeOptions } from '../src/core/config';
import { STEADY } from '../src/core/personality';
import { crewCardModel } from '../src/tune/card';
import type { Blueprint, BlueprintItem } from '../src/core/blueprint';
import type { ActionPlanner } from '../src/core/action';
import type { CrewMember } from '../src/types';
import type { CursorLayer } from '../src/render/cursor_layer';
import type { Overlay } from '../src/render/overlay';
import type { Scheduler } from '../src/core/scheduler';

function member(id: number, name: string, built: number): CrewMember {
  return { id, name, color: '#fff', personality: 'steady', built };
}

describe('crewCardModel', () => {
  it('sorts by tally, badges the top builder, and keeps every crew row', () => {
    const model = crewCardModel({
      crew: [member(1, 'Ava', 3), member(2, 'Bo', 9), member(3, 'Cy', 0)],
      built: 12,
      durationMs: 4200,
      seed: 12345,
    }, 'zh');
    expect(model.rows.map((row) => row.name)).toEqual(['Bo', 'Ava', 'Cy']);
    expect(model.mvp).toBe(2);
    expect(model.stats).toBe('12 项 · 3 位光标 · 用时 4.2s · 种子 12345');
    // One row per cursor, no folding: the card never hides a participant.
    expect(model.rows).toHaveLength(3);
    // The card grows a row per cursor: a three-person crew is two rows taller than a solo one.
    const solo = crewCardModel({ crew: [member(9, 'Zed', 1)], built: 1, durationMs: 0, seed: 1 }, 'zh');
    expect(model.height - solo.height).toBe(88);
  });

  it('speaks English when asked', () => {
    const model = crewCardModel({
      crew: [member(1, 'Ava', 2)],
      built: 2,
      durationMs: 9000,
      seed: 7,
    }, 'en');
    expect(model.title).toBe('Rebuild crew');
    expect(model.stats).toBe('2 items · 1 cursor · 9.0s · seed 7');
    expect(model.footer).toBe('Same seed, same crew');
  });

  it('has no MVP when nobody finished anything', () => {
    const model = crewCardModel({
      crew: [member(1, 'Ava', 0)],
      built: 0,
      durationMs: 0,
      seed: 1,
    }, 'zh');
    expect(model.mvp).toBeNull();
  });
});

describe('Agent.built', () => {
  const item: BlueprintItem = {
    id: 'a', kind: 'rect', depth: 0, order: 0, group: 0, blockers: [], x: 0, y: 0, width: 100, height: 50,
  };
  const blueprint: Blueprint = {
    items: [item],
    byId: new Map([[item.id, item]]),
    width: 1000,
    height: 3000,
    rootOffset: { x: 0, y: 0 },
    dropped: 0,
    guides: 0,
  };
  const planner: ActionPlanner = () => [{ name: 'rect', duration: 1000, tick: () => {}, end: () => {} }];

  it('counts one finished item per claim, not the copies it seals', () => {
    const agent = new Agent(0, { id: 0, name: 'Ava', color: '#fff', personality: 'steady' }, {
      scheduler: { take: () => item, markDone: () => {} } as unknown as Scheduler,
      overlay: { stamp: () => {} } as unknown as Overlay,
      cursors: {
        setPosition: () => {}, setIdling: () => {}, setShape: () => {}, setBadge: () => {},
        setPose: () => {}, hide: () => {},
      } as unknown as CursorLayer,
      opts: normalizeOptions(undefined),
      blueprint,
      sound: null,
      flock: { offset: () => ({ x: 0, y: 0 }) } as never,
      planner,
      onFinished: () => {},
      onItemDone: () => {},
      rng: () => 0.5,
      persona: STEADY,
      home: true,
    }, 0, 0);

    let guard = 0;
    while (agent.built < 2 && guard++ < 60) agent.tick(100);
    expect(agent.built).toBe(2);
  });
});
