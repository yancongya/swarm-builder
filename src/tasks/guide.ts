import type { BlueprintItem, GuidePayload } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { MoveAction } from '../core/actions';
import { easeInOutCubic } from '../core/config';
import { Overlay } from '../render/overlay';

export function planGuide(item: BlueprintItem, ctx: RunContext): Action[] {
  const guide = item.guide as GuidePayload;
  const el = ctx.overlay.createGuide(item);
  return [
    new MoveAction(item.x, item.y, ctx.opts.moveSpeed, 'crosshair'),
    new DrawGuideAction(guide, el),
    new DropGuideAction(el),
  ];
}

class DrawGuideAction implements Action {
  readonly name = 'draw-guide';
  readonly duration = 160;

  constructor(
    private readonly guide: GuidePayload,
    private readonly el: HTMLElement,
  ) {}

  begin(ctx: RunContext): void {
    // 参考线只在有几何的事件上发声：竖线报它的 x，横线报起点，配乐据此选声部与声像。
    const { axis, pos, from, to } = this.guide;
    ctx.sound?.play('guide', axis === 'x'
      ? { kind: 'guide', x: pos, y: from, width: 0, height: to - from }
      : { kind: 'guide', x: from, y: pos, width: to - from, height: 0 });
    this.el.style.opacity = `${Overlay.GUIDE_OPACITY}`;
  }

  tick(progress: number, ctx: RunContext): void {
    const span = (this.guide.to - this.guide.from) * easeInOutCubic(progress);
    if (this.guide.axis === 'x') {
      this.el.style.height = `${span}px`;
      ctx.agent.moveTo(this.guide.pos, this.guide.from + span);
    } else {
      this.el.style.width = `${span}px`;
      ctx.agent.moveTo(this.guide.from + span, this.guide.pos);
    }
    ctx.agent.setBadge(`${this.guide.axis}=${Math.round(this.guide.pos)}`);
  }

  end(ctx: RunContext): void {
    const span = this.guide.to - this.guide.from;
    if (this.guide.axis === 'x') this.el.style.height = `${span}px`;
    else this.el.style.width = `${span}px`;
    ctx.agent.setBadge(null);
  }
}

/** The line holds briefly, then leaves: the elements it explains are next. */
class DropGuideAction implements Action {
  readonly name = 'drop-guide';
  readonly duration = 170;

  constructor(private readonly el: HTMLElement) {}

  begin(): void {
    this.el.style.opacity = `${Overlay.GUIDE_OPACITY}`;
  }

  tick(progress: number): void {
    const held = Math.min(1, progress / 0.6);
    this.el.style.opacity = `${Overlay.GUIDE_OPACITY * (1 - held)}`;
  }

  end(): void {
    this.el.remove();
  }
}
