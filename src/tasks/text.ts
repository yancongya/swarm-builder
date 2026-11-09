import type { BlueprintItem } from '../core/blueprint';
import type { Action, RunContext } from '../core/action';
import { MoveAction } from '../core/actions';
import type { Overlay } from '../render/overlay';

const BLINK_MS = 460;
const HOLD_MS = 260;
const MAX_TYPE_MS = 700;

export function planText(item: BlueprintItem, ctx: RunContext): Action[] {
  const el = ctx.overlay.createTextElement(item);
  const caret = ctx.overlay.createCaret(caretHeight(item), item);
  caret.style.color = item.textStyle?.color ?? 'currentColor';
  caret.style.opacity = '0';
  return [
    new MoveAction(item.x + 2, caretTop(item) + caretHeight(item) / 2, ctx.opts.moveSpeed, 'ibeam'),
    new TypeAction(item, el, caret, ctx.overlay, ctx.opts.typeInterval, ctx.opts.grow),
  ];
}

/** Headings start small and reach their real size as they are typed. */
const GROW_START = 0.62;

class TypeAction implements Action {
  readonly name = 'type';
  readonly duration: number;
  private typed = -1;
  private readonly fullSize: number;

  constructor(
    private readonly item: BlueprintItem,
    private readonly el: HTMLElement,
    private readonly caret: HTMLElement,
    private readonly overlay: Overlay,
    typeInterval: number,
    grow: boolean,
  ) {
    this.duration = Math.min(MAX_TYPE_MS, Math.max(160, (item.text ?? '').length * typeInterval)) + HOLD_MS;
    this.fullSize = grow && item.grow ? parseFloat(item.textStyle?.fontSize ?? '0') : 0;
  }

  begin(ctx: RunContext): void {
    this.caret.style.opacity = '1';
    if (this.fullSize > 0) {
      this.el.style.fontSize = `${this.fullSize * GROW_START}px`;
      // grow 是生成式配乐才有的事件：默认那套合成点击不该因为这个多出一声。
      if (ctx.opts.score === 'generative') ctx.sound?.play('grow', this.item);
    }
  }

  tick(progress: number, ctx: RunContext): void {
    const text = this.item.text ?? '';
    const typed = Math.min(text.length, Math.ceil(progress * text.length));
    if (typed !== this.typed) {
      this.typed = typed;
      this.el.textContent = text.slice(0, typed);
      if (this.fullSize > 0) {
        const size = this.fullSize * (GROW_START + (1 - GROW_START) * Math.min(1, typed / Math.max(1, text.length * 0.6)));
        this.el.style.fontSize = `${Math.round(size * 10) / 10}px`;
      }
      this.placeCaret(ctx);
      if (typed > 0) ctx.sound?.play('type', this.item);
    }
    const elapsed = progress * this.duration;
    const blinking = elapsed > this.duration - HOLD_MS;
    this.caret.style.opacity = blinking && Math.floor(elapsed / BLINK_MS) % 2 === 1 ? '0' : '1';
  }

  end(): void {
    if (this.fullSize > 0 && this.item.textStyle) this.el.style.fontSize = this.item.textStyle.fontSize;
    this.caret.remove();
  }

  /** The caret sits on the last rendered line box, and the cursor follows it. */
  private placeCaret(ctx: RunContext): void {
    const node = this.el.firstChild;
    let left = this.item.x;
    let top = caretTop(this.item);

    if (node) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      const last = rects[rects.length - 1];
      if (last && last.width > 0) {
        const origin = this.overlay.layerRectOf(this.item);
        left = last.right - origin.left;
        top = last.top - origin.top;
      }
    }

    this.caret.style.left = `${Math.round(left)}px`;
    this.caret.style.top = `${Math.round(top)}px`;
    ctx.agent.moveTo(left + 3, top + caretHeight(this.item) / 2);
  }
}

function caretHeight(item: BlueprintItem): number {
  const size = parseFloat(item.textStyle?.fontSize ?? '16') || 16;
  return Math.min(item.height, size * 1.2);
}

function caretTop(item: BlueprintItem): number {
  const size = parseFloat(item.textStyle?.fontSize ?? '16') || 16;
  const line = parseFloat(item.textStyle?.lineHeight ?? '') || size * 1.2;
  return item.y + Math.max(0, (line - size * 1.2) / 2);
}
