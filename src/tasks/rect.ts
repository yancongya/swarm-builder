import type { BlueprintItem } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { FadeInAction, MoveAction } from '../core/actions';
import { easeInOutCubic } from '../core/config';
import { Overlay } from '../render/overlay';

export function planRect(item: BlueprintItem, ctx: RunContext): Action[] {
  const el = ctx.overlay.createRectElement(item);
  return [
    new MoveAction(item.x, item.y, ctx.opts.moveSpeed, 'crosshair'),
    new DragRectAction(item, el),
    new FadeInAction(el, finalOpacity(item), ctx.opts.fadeDuration),
  ];
}

/** Drag from the top-left corner to the bottom-right while the box grows. */
class DragRectAction implements Action {
  readonly name = 'drag';
  readonly duration: number;

  constructor(
    private readonly item: BlueprintItem,
    private readonly el: HTMLElement,
  ) {
    this.duration = Math.max(90, Math.min(380, 90 + (item.width + item.height) * 0.22));
  }

  tick(progress: number, ctx: RunContext): void {
    const eased = easeInOutCubic(progress);
    const { item } = this;
    const width = item.width * eased;
    const height = item.height * eased;
    ctx.agent.moveTo(item.x + width, item.y + height);
    Overlay.applyGeometry(this.el, item.x, item.y, width, height);
    ctx.agent.setBadge(`${Math.round(width)} × ${Math.round(height)}`);
  }

  end(ctx: RunContext): void {
    const { item } = this;
    Overlay.applyGeometry(this.el, item.x, item.y, item.width, item.height);
    ctx.agent.moveTo(item.x + item.width, item.y + item.height);
    ctx.agent.setBadge(null);
  }
}

function finalOpacity(item: BlueprintItem): number {
  const raw = parseFloat(item.rectStyle?.opacity ?? '1');
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}
