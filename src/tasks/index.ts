import type { BlueprintItem } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { planRect } from './rect';
import { planText } from './text';

export function planItem(item: BlueprintItem, ctx: RunContext): Action[] {
  return item.kind === 'rect' ? planRect(item, ctx) : planText(item, ctx);
}
