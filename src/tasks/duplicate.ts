import type { BlueprintItem, Box, DupPayload } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { MoveAction } from '../core/actions';
import { clamp, easeInOutCubic } from '../core/config';
import { Overlay } from '../render/overlay';

/**
 * A copy is not rebuilt from scratch: the cursor grabs the master box, drags a
 * translucent outline to the copy position, and the whole subtree appears.
 */
export function planDuplicate(item: BlueprintItem, ctx: RunContext): Action[] {
  const dup = item.dup as DupPayload;
  const ghost = ctx.overlay.createCopyBox(dup.from);
  return [
    new MoveAction(dup.from.x, dup.from.y, ctx.opts.moveSpeed, 'crosshair'),
    new StampDragAction(dup, ghost),
    new StampRevealAction(dup, ghost),
  ];
}

class StampDragAction implements Action {
  readonly name = 'stamp-drag';
  readonly duration: number;

  constructor(
    private readonly dup: DupPayload,
    private readonly ghost: HTMLElement,
  ) {
    const distance = Math.hypot(dup.to.x - dup.from.x, dup.to.y - dup.from.y);
    this.duration = clamp(160 + distance * 0.35, 180, 460);
  }

  tick(progress: number, ctx: RunContext): void {
    const box = lerpBox(this.dup.from, this.dup.to, easeInOutCubic(progress));
    Overlay.applyGeometry(this.ghost, box.x, box.y, box.width, box.height);
    ctx.agent.moveTo(box.x + box.width, box.y + box.height);
    ctx.agent.setBadge(`⌥ ${Math.round(box.width)} × ${Math.round(box.height)}`);
  }

  end(ctx: RunContext): void {
    const { to } = this.dup;
    Overlay.applyGeometry(this.ghost, to.x, to.y, to.width, to.height);
    ctx.agent.moveTo(to.x + to.width, to.y + to.height);
    ctx.agent.setBadge(null);
  }
}

class StampRevealAction implements Action {
  readonly name = 'stamp-reveal';
  readonly duration = 120;
  private revealed: { el: HTMLElement; to: number }[] = [];

  constructor(
    private readonly dup: DupPayload,
    private readonly ghost: HTMLElement,
  ) {}

  begin(ctx: RunContext): void {
    this.revealed = [];
    for (const id of this.dup.items) {
      const item = ctx.get(id);
      if (!item) continue;
      const el = ctx.overlay.buildFinal(item);
      const to = Overlay.finalOpacity(item);
      el.style.opacity = '0';
      this.revealed.push({ el, to });
    }
    this.ghost.remove();
  }

  tick(progress: number): void {
    for (const entry of this.revealed) {
      entry.el.style.opacity = (entry.to * progress).toFixed(3);
    }
  }

  end(ctx: RunContext): void {
    for (const entry of this.revealed) entry.el.style.opacity = `${entry.to}`;
    ctx.markBuilt(this.dup.items);
  }
}

function lerpBox(a: Box, b: Box, t: number): Box {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}
