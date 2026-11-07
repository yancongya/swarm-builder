import type { BlueprintItem, RectStyle } from '../core/blueprint';

const HIDDEN_CLASS = 'sb-hidden';

/**
 * The reconstruction surface. It is a child of `root` and coordinates are
 * root-relative, so a non-scrolling container works the same as the document.
 */
export class Overlay {
  private constructor(
    readonly el: HTMLElement,
    private readonly root: HTMLElement,
    private readonly hidden: HTMLElement[],
    private readonly restoredPosition: string | null,
  ) {}

  static create(root: HTMLElement, blueprintWidth: number, blueprintHeight: number, backdrop?: RectStyle): Overlay {
    const rootStyle = getComputedStyle(root);
    let restoredPosition: string | null = null;
    if (rootStyle.position === 'static') {
      restoredPosition = root.style.position;
      root.style.position = 'relative';
    }

    const el = document.createElement('div');
    el.className = 'sb-overlay';
    el.style.width = `${blueprintWidth}px`;
    el.style.height = `${blueprintHeight}px`;
    if (backdrop) {
      el.style.backgroundColor = backdrop.backgroundColor;
      el.style.backgroundImage = backdrop.backgroundImage;
      el.style.backgroundSize = backdrop.backgroundSize;
      el.style.backgroundPosition = backdrop.backgroundPosition;
    }
    // Absolute children resolve against the padding box; item coordinates come
    // from the border box, so shift the layer by the root's own border.
    el.style.left = `-${parseFloat(rootStyle.borderLeftWidth) || 0}px`;
    el.style.top = `-${parseFloat(rootStyle.borderTopWidth) || 0}px`;
    el.setAttribute('aria-hidden', 'true');
    root.appendChild(el);

    const hidden: HTMLElement[] = [];
    for (const child of Array.from(root.children)) {
      if (child === el) continue;
      const html = child as HTMLElement;
      html.classList.add(HIDDEN_CLASS);
      hidden.push(html);
    }

    return new Overlay(el, root, hidden, restoredPosition);
  }

  /** Go live: real page back, reconstruction layer gone. */
  reveal(): void {
    this.el.remove();
    this.showOriginal();
  }

  destroy(): void {
    this.el.remove();
    this.showOriginal();
  }

  private showOriginal(): void {
    for (const child of this.hidden) child.classList.remove(HIDDEN_CLASS);
    if (this.restoredPosition !== null) this.root.style.position = this.restoredPosition;
  }

  append(el: HTMLElement): void {
    this.el.appendChild(el);
  }

  remove(el: HTMLElement): void {
    el.remove();
  }

  createRectElement(item: BlueprintItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-item sb-item--building';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = '0px';
    el.style.height = '0px';
    this.append(el);
    return el;
  }

  static applyGeometry(el: HTMLElement, x: number, y: number, width: number, height: number): void {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  static applyFinalRectStyle(el: HTMLElement, item: BlueprintItem): void {
    const style = item.rectStyle;
    if (!style) return;
    el.classList.remove('sb-item--building');
    el.classList.add('sb-item--live');
    Overlay.applyGeometry(el, item.x, item.y, item.width, item.height);
    el.style.backgroundColor = style.backgroundColor;
    el.style.backgroundImage = style.backgroundImage;
    el.style.backgroundSize = style.backgroundSize;
    el.style.backgroundPosition = style.backgroundPosition;
    el.style.borderTop = style.borderTop;
    el.style.borderRight = style.borderRight;
    el.style.borderBottom = style.borderBottom;
    el.style.borderLeft = style.borderLeft;
    el.style.borderRadius = style.radius;
    el.style.boxShadow = style.boxShadow;
    el.style.opacity = style.opacity;
  }

  createTextElement(item: BlueprintItem): HTMLElement {
    const el = document.createElement('div');
    const style = item.textStyle;
    el.className = 'sb-text';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = `${item.width}px`;
    el.style.minHeight = `${item.height}px`;
    if (style) {
      el.style.fontFamily = style.fontFamily;
      el.style.fontSize = style.fontSize;
      el.style.fontWeight = style.fontWeight;
      el.style.fontStyle = style.fontStyle;
      el.style.lineHeight = style.lineHeight;
      el.style.letterSpacing = style.letterSpacing;
      el.style.color = style.color;
    }
    this.append(el);
    return el;
  }

  createCaret(height: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-caret';
    el.style.height = `${Math.round(height)}px`;
    this.append(el);
    return el;
  }
}
