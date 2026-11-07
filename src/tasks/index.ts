import type { BlueprintItem, ItemKind } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { SnapSettleAction } from '../core/actions';
import { planRect } from './rect';
import { planText } from './text';
import { planMedia } from './media';
import { planDuplicate } from './duplicate';
import { planGuide } from './guide';

const PLANNERS: Record<ItemKind, (item: BlueprintItem, ctx: RunContext) => Action[]> = {
  rect: planRect,
  text: planText,
  media: planMedia,
  guide: planGuide,
};

export function planItem(item: BlueprintItem, ctx: RunContext): Action[] {
  if (item.kind === 'guide') return planGuide(item, ctx);
  if (item.dup) return planDuplicate(item, ctx);
  const actions = PLANNERS[item.kind](item, ctx);
  if (item.snapFrom) actions.push(new SnapSettleAction(item));
  return actions;
}
