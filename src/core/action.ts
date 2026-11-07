import type { BlueprintItem } from './blueprint';
import type { NormalizedOptions } from './config';
import type { Overlay } from '../render/overlay';
import type { CursorShape } from '../types';

export interface AgentView {
  readonly x: number;
  readonly y: number;
  moveTo(x: number, y: number): void;
  setShape(shape: CursorShape): void;
  setBadge(text: string | null): void;
}

export interface RunContext {
  opts: NormalizedOptions;
  overlay: Overlay;
  agent: AgentView;
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
