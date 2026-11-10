import type { Blueprint, BlueprintItem } from './blueprint';
import type { Tickable } from './engine';
import type { Action, ActionPlanner, AgentView, RunContext } from './action';
import type { NormalizedOptions } from './config';
import type { Scheduler } from './scheduler';
import type { CursorShape, AgentInfo } from '../types';
import type { Overlay } from '../render/overlay';
import type { CursorLayer } from '../render/cursor_layer';
import type { SoundSink } from './action';
import type { Flock } from './flocking';
import type { Flyer } from './flight';
import { makeFlyer } from './flight';
import { clamp } from './config';

export interface AgentDeps {
  scheduler: Scheduler;
  overlay: Overlay;
  cursors: CursorLayer;
  opts: NormalizedOptions;
  blueprint: Blueprint;
  sound: SoundSink | null;
  flock: Flock;
  planner: ActionPlanner;
  onFinished: (agent: Agent) => void;
  /** 待时物理的随机参数要用同一个种子抽，不然回放两次跑不出同一支队伍。 */
  rng: () => number;
  /** 原始班底：自己那一份活干完就收起；临时工交给班组决定什么时候走。 */
  home: boolean;
}

/** One cursor: pulls tasks from its queue and plays the task's action list. */
export class Agent implements AgentView, Tickable, Flyer {
  x = 0;
  y = 0;
  /** 以下七个字段属于待时物理（flight:'live'）；默认关着时没人读它们。 */
  vx = 0;
  vy = 0;
  angle = 0;
  press = 0;
  orbit = 120;
  spin = 1;
  curl = 0;
  pace = 500;
  force = 1200;
  busy = false;
  worked = false;
  idleFor = 0;

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
    // 聚群走的也是轨道场，所以只开 gather 没开 flight 时这套物理参数照样要抽。
    if (deps.opts.flight === 'live' || deps.opts.gather) Object.assign(this, makeFlyer(startX, startY, deps.rng));
    this.ctx = {
      opts: deps.opts,
      overlay: deps.overlay,
      agent: this,
      sound: deps.sound,
      flock: deps.flock,
      get: (id) => deps.blueprint.byId.get(id),
      markBuilt: (ids) => {
        for (const id of ids) this.deps.scheduler.markDone(id);
      },
    };
    deps.cursors.setPosition(info.id, startX, startY);
  }

  /** A finished cursor is hidden, so neither the camera nor its neighbours should count it. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** 原始班底的一员：它不会自己离场，见 `Crew` 的离场条件。 */
  get isHome(): boolean {
    return this.deps.home;
  }

  /** 物理写完位置和姿态以后由外层调用：一帧一次，不在每个动作里各写一遍。 */
  renderPose(): void {
    this.deps.cursors.setPose(this.info.id, this.x, this.y, this.angle, this.press);
  }

  tick(dt: number): void {
    if (this.finished) return;

    if (this.current === null) {
      if (this.actions.length === 0) {
        const item = this.deps.scheduler.take(this);
        if (item === null) {
          this.idleFor += dt / 1000;
          this.retireWhenDone();
          return;
        }
        this.currentItem = item;
        this.busy = true;
        this.worked = true;
        this.idleFor = 0;
        this.actions.push(...this.deps.planner(item, this.ctx));
      }
      const action = this.actions.shift() as Action;
      this.current = action;
      this.elapsed = 0;
      // 参考版只在按下工具的时候压扁，赶路不算一次点击。
      if (action.name !== 'move') this.press = 1;
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
      this.busy = false;
    }
  }

  /**
   * 原始班底干完自己那一份就收起，和默认行为一致；临时工只有在整个页面没活
   * 的时候才退场，否则它会在一屏滚完之前把自己隐藏掉，活就没人接了。
   * 「等滚动才放行」的活也算没接的活：`trigger: 'scroll'` 下班底必须留在场上，
   * 不然下一屏解锁时已经没人能领，整局就停在那里。
   */
  private retireWhenDone(): void {
    const scheduler = this.deps.scheduler;
    // 开场聚群时领不到活是正常的，别把正在集合的人当成干完了收走。
    if (scheduler.isHeld) return;
    if (scheduler.pending === 0) this.retire();
    else if (this.deps.home && scheduler.gated === 0 && scheduler.isEmpty(this.index)) this.retire();
  }

  /** 收起这个光标：干完了，或者作为临时工被班组退回。 */
  retire(): void {
    this.finished = true;
    this.busy = false;
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
