import type { Blueprint, BlueprintItem } from './blueprint';
import type { Tickable } from './engine';
import type { Action, ActionPlanner, AgentView, RunContext } from './action';
import type { NormalizedOptions } from './config';
import type { Scheduler } from './scheduler';
import type { CursorShape, AgentInfo } from '../types';
import type { Overlay } from '../render/overlay';
import type { CursorLayer } from '../render/cursor_layer';
import { clamp } from './config';

export interface AgentDeps {
  scheduler: Scheduler;
  overlay: Overlay;
  cursors: CursorLayer;
  opts: NormalizedOptions;
  blueprint: Blueprint;
  planner: ActionPlanner;
  onFinished: (agent: Agent) => void;
}

/** One cursor: pulls tasks from its queue and plays the task's action list. */
export class Agent implements AgentView, Tickable {
  x = 0;
  y = 0;

  private readonly actions: Action[] = [];
  private current: Action | null = null;
  private currentItem: BlueprintItem | null = null;
  private elapsed = 0;
  private finished = false;
  private readonly ctx: RunContext;

  constructor(
    readonly index: number,
    readonly info: AgentInfo,
    private readonly deps: AgentDeps,
    startX: number,
    startY: number,
  ) {
    this.x = startX;
    this.y = startY;
    this.ctx = {
      opts: deps.opts,
      overlay: deps.overlay,
      agent: this,
      get: (id) => deps.blueprint.byId.get(id),
      markBuilt: (ids) => {
        for (const id of ids) this.deps.scheduler.markDone(id);
      },
    };
    deps.cursors.setPosition(info.id, startX, startY);
  }

  tick(dt: number): void {
    if (this.finished) return;

    if (this.current === null) {
      if (this.actions.length === 0) {
        const item = this.deps.scheduler.take(this.index);
        if (item === null) {
          if (this.deps.scheduler.isEmpty(this.index)) this.finish();
          return;
        }
        this.currentItem = item;
        this.actions.push(...this.deps.planner(item, this.ctx));
      }
      const action = this.actions.shift() as Action;
      this.current = action;
      this.elapsed = 0;
      action.begin?.(this.ctx);
      return;
    }

    const action = this.current;
    this.elapsed += dt;
    const progress = action.duration > 0 ? clamp(this.elapsed / action.duration, 0, 1) : 1;
    action.tick(progress, this.ctx);

    if (progress < 1) return;
    action.end(this.ctx);
    this.current = null;
    if (this.actions.length === 0 && this.currentItem !== null) {
      this.deps.scheduler.markDone(this.currentItem.id);
      this.currentItem = null;
    }
  }

  private finish(): void {
    this.finished = true;
    this.deps.cursors.setBadge(this.info.id, null);
    this.deps.cursors.hide(this.info.id);
    this.deps.onFinished(this);
  }

  moveTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.deps.cursors.setPosition(this.info.id, x, y);
  }

  setShape(shape: CursorShape): void {
    this.deps.cursors.setShape(this.info.id, shape);
  }

  setBadge(text: string | null): void {
    this.deps.cursors.setBadge(this.info.id, text);
  }
}
