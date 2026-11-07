import type { BlueprintItem } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { MoveAction } from '../core/actions';
import { DragRectAction } from './rect';
import { Overlay } from '../render/overlay';

export function planMedia(item: BlueprintItem, ctx: RunContext): Action[] {
  const el = ctx.overlay.createMediaElement(item);
  return [
    new MoveAction(item.x, item.y, ctx.opts.moveSpeed, 'crosshair'),
    new DragRectAction(item, el),
    new RevealMediaAction(item, el, ctx.opts.fadeDuration),
  ];
}

/** Swaps the grey placeholder for the frozen content, then fades it in. */
class RevealMediaAction implements Action {
  readonly name = 'reveal-media';
  readonly duration: number;
  private readonly target: number;

  constructor(
    private readonly item: BlueprintItem,
    private readonly el: HTMLElement,
    fadeDuration: number,
  ) {
    this.duration = fadeDuration * 1.6;
    this.target = clampOpacity(item.media?.opacity);
  }

  begin(): void {
    Overlay.applyMedia(this.el, this.item);
    this.el.style.opacity = '0';
  }

  tick(progress: number): void {
    this.el.style.opacity = (this.target * progress).toFixed(3);
  }

  end(): void {
    this.el.style.opacity = `${this.target}`;
  }
}

function clampOpacity(value: string | undefined): number {
  const raw = parseFloat(value ?? '1');
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}
