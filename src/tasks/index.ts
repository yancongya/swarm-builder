import type { BlueprintItem, ItemKind } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { planRect } from './rect';
import { planText } from './text';
import { planMedia } from './media';
import { planDuplicate } from './duplicate';

const PLANNERS: Record<ItemKind, (item: BlueprintItem, ctx: RunContext) => Action[]> = {
  rect: planRect,
  text: planText,
  media: planMedia,
};

export function planItem(item: BlueprintItem, ctx: RunContext): Action[] {
  return item.dup ? planDuplicate(item, ctx) : PLANNERS[item.kind](item, ctx);
}
