import type { BlueprintItem, ItemKind } from './blueprint';
import type { NormalizedOptions } from './config';
import type { SoundEvent } from './sound';
import type { Flock } from './flocking';
import type { Overlay } from '../render/overlay';
import type { CursorShape } from '../types';

export interface AgentView {
  readonly x: number;
  readonly y: number;
  moveTo(x: number, y: number): void;
  setShape(shape: CursorShape): void;
  setBadge(text: string | null): void;
}

/**
 * 动作层听到的是同一组事件，但两种实现用法不同：合成点击（SoundBus）只认事件名，
 * 生成式配乐（ScoreBus）还要落点去算音高与声像，所以事件可以带一个盒子。
 * BlueprintItem 结构上就满足它，动作里把自己那个元素传过去就行；
 * 'dup' 不是元素类型，是副本盖章专用的声部。
 */
export interface SoundSpot {
  kind: ItemKind | 'dup';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SoundSink {
  play(event: SoundEvent, spot?: SoundSpot): void;
  /** Enabled, not necessarily audible: the browser may still be holding the context. */
  readonly on: boolean;
  setOn(on: boolean): void;
  /** A context exists but the autoplay policy holds it; one keypress or click unlocks it. */
  readonly blocked: boolean;
  resume(): void;
  /** Fade out over `after` seconds, then close the context. Safe to call twice. */
  close(after?: number): void;
}

export interface RunContext {
  opts: NormalizedOptions;
  overlay: Overlay;
  agent: AgentView;
  /** Null unless the host asked for sound. */
  sound: SoundSink | null;
  /** Other cursors, so a move can dodge them. */
  flock: Flock;
  /** Look up an item the action has to materialise but was not scheduled for. */
  get(id: string): BlueprintItem | undefined;
  /** Count items as built without going through the agent that owns them. */
  markBuilt(ids: string[]): void;
}

export interface Action {
  readonly name: string;
  readonly duration: number;
  begin?(ctx: RunContext): void;
  tick(progress: number, ctx: RunContext): void;
  end(ctx: RunContext): void;
}

/** Builds the ordered action list that visualises one blueprint item. */
export type ActionPlanner = (item: BlueprintItem, ctx: RunContext) => Action[];
