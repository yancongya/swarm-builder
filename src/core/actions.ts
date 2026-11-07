import type { CursorShape } from '../types';
import type { BlueprintItem } from './blueprint';
import type { Action, RunContext } from './action';
import { clamp, easeInOutCubic } from './config';

const MIN_MOVE_MS = 80;
const MAX_MOVE_MS = 420;

/** Travels the cursor to a target; the distance sets the duration. */
export class MoveAction implements Action {
  name = 'move';
  duration = MIN_MOVE_MS;
  private startX = 0;
  private startY = 0;

  constructor(
    private readonly targetX: number,
    private readonly targetY: number,
    private readonly moveSpeed: number,
    private readonly shape: CursorShape = 'arrow',
  ) {}

  begin(ctx: RunContext): void {
    this.startX = ctx.agent.x;
    this.startY = ctx.agent.y;
    const distance = Math.hypot(this.targetX - this.startX, this.targetY - this.startY);
    this.duration = clamp((distance / this.moveSpeed) * 1000, MIN_MOVE_MS, MAX_MOVE_MS);
    ctx.agent.setShape(this.shape);
  }

  tick(progress: number, ctx: RunContext): void {
    const eased = easeInOutCubic(progress);
    ctx.agent.moveTo(
      this.startX + (this.targetX - this.startX) * eased,
      this.startY + (this.targetY - this.startY) * eased,
    );
  }

  end(ctx: RunContext): void {
    ctx.agent.moveTo(this.targetX, this.targetY);
  }
}

/** Slides a snapped element from the guide line onto its real position. */
export class SnapSettleAction implements Action {
  readonly name = 'snap';
  readonly duration = 180;
  private el: HTMLElement | null = null;

  constructor(private readonly item: BlueprintItem) {}

  begin(ctx: RunContext): void {
    this.el = ctx.overlay.elementOf(this.item.id);
    if (this.el) this.displace(this.item.snapFrom ?? 0);
  }

  tick(progress: number): void {
    if (this.el) this.displace((this.item.snapFrom ?? 0) * (1 - easeInOutCubic(progress)));
  }

  end(): void {
    if (this.el) this.displace(0);
  }

  private displace(offset: number): void {
    if (!this.el) return;
    this.el.style.left = `${this.item.x + offset}px`;
  }
}

/** Ramps an element from its placeholder look to its final paint. */
export class FadeInAction implements Action {
  name = 'fade';
  duration: number;
  private readonly from: number;

  constructor(
    private readonly el: HTMLElement,
    private readonly to: number,
    duration: number,
  ) {
    this.duration = duration;
    this.from = to * 0.5;
  }

  begin(): void {
    this.el.style.opacity = `${this.from}`;
  }

  tick(progress: number): void {
    this.el.style.opacity = (this.from + (this.to - this.from) * progress).toFixed(3);
  }

  end(): void {
    this.el.style.opacity = `${this.to}`;
  }
}
