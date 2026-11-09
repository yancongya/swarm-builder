import type { BlueprintItem, Box, RectStyle } from '../core/blueprint';
import type { PageTheme } from './theme';

const HIDDEN_CLASS = 'sb-hidden';

/**
 * The reconstruction surface. It is a child of `root` and coordinates are
 * root-relative, so a non-scrolling container works the same as the document.
 * Items captured from `position: fixed` sources go to a second layer pinned to
 * where the root sat, so they stay on screen while the reader scrolls.
 */
export class Overlay {
  /** Guides are construction lines: visible, but never as strong as content. */
  static readonly GUIDE_OPACITY = 0.55;

  private fixedLayer: HTMLElement | null = null;

  private constructor(
    readonly el: HTMLElement,
    private readonly root: HTMLElement,
    private readonly rootOffset: { x: number; y: number },
    private readonly hidden: HTMLElement[],
    private readonly restoredPosition: string | null,
  ) {}

  static create(
    root: HTMLElement,
    blueprintWidth: number,
    blueprintHeight: number,
    rootOffset: { x: number; y: number },
    backdrop: RectStyle | undefined,
    theme: PageTheme,
  ): Overlay {
    const rootStyle = getComputedStyle(root);
    let restoredPosition: string | null = null;
    if (rootStyle.position === 'static') {
      restoredPosition = root.style.position;
      root.style.position = 'relative';
    }

    const el = document.createElement('div');
    el.className = 'sb-overlay';
    el.dataset.sbTheme = theme;
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
      // Host chrome (a tuning panel, a persistent widget) stays up during the run.
      if (child === el || child.hasAttribute('data-sb-chrome')) continue;
      const html = child as HTMLElement;
      html.classList.add(HIDDEN_CLASS);
      hidden.push(html);
    }

    return new Overlay(el, root, rootOffset, hidden, restoredPosition);
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

  append(el: HTMLElement, item: BlueprintItem): void {
    this.layerFor(item).appendChild(el);
  }

  /** Fixed items are built in their own layer so the page can scroll under them. */
  private layerFor(item: BlueprintItem): HTMLElement {
    if (!item.fixed) return this.el;
    if (!this.fixedLayer) {
      const layer = document.createElement('div');
      layer.className = 'sb-fixed';
      layer.style.transform = `translate3d(${this.rootOffset.x}px, ${this.rootOffset.y}px, 0)`;
      this.el.appendChild(layer);
      this.fixedLayer = layer;
    }
    return this.fixedLayer;
  }

  remove(el: HTMLElement): void {
    el.remove();
  }

  /** Planners create elements as they go; later actions find them by item id. */
  elementOf(id: string): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-item="${id}"]`);
  }

  private tag(el: HTMLElement, item: BlueprintItem): HTMLElement {
    el.dataset.item = item.id;
    return el;
  }

  createRectElement(item: BlueprintItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-item sb-item--building';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = '0px';
    el.style.height = '0px';
    this.append(el, item);
    return this.tag(el, item);
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
    this.append(el, item);
    return this.tag(el, item);
  }

  createMediaElement(item: BlueprintItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-item sb-item--building sb-media';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = '0px';
    el.style.height = '0px';
    el.style.overflow = 'hidden';
    const media = item.media;
    if (media) {
      el.style.borderRadius = media.radius;
      el.style.opacity = media.opacity;
    }
    this.append(el, item);
    return this.tag(el, item);
  }

  /** Fills a media placeholder with its frozen content once the box is drawn. */
  static applyMedia(el: HTMLElement, item: BlueprintItem): void {
    const media = item.media;
    if (!media) return;
    if (media.mode === 'fallback') {
      el.classList.add('sb-media--fallback');
      return;
    }
    el.classList.remove('sb-item--building');

    let content: HTMLElement | Node | null = null;
    if (media.mode === 'svg' && media.node) {
      content = document.importNode(media.node, true);
      const svg = content as SVGSVGElement;
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      (svg as unknown as HTMLElement).style.display = 'block';
    } else {
      const img = document.createElement('img');
      img.src = media.mode === 'img' ? (media.src ?? '') : (media.dataUrl ?? '');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = media.fit === 'none' ? 'fill' : media.fit;
      img.style.objectPosition = media.position;
      img.style.display = 'block';
      // 原图在重建这一趟里回不来了（防盗链、图挂了、跨源被拦）：换成占位块，
      // 别留一个空白洞——观众看到的应该是「这里本来有张图」。
      img.onerror = () => {
        img.remove();
        el.classList.add('sb-media--fallback');
      };
      content = img;
    }
    if (content) el.appendChild(content);
  }

  /** The transient box an Option-drag pulls out of the master before it lands. */
  createCopyBox(item: BlueprintItem, box: Box): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-item sb-copy';
    Overlay.applyGeometry(el, box.x, box.y, box.width, box.height);
    this.append(el, item);
    return el;
  }

  /** Creates an item already finished: this is what a stamped copy is made of. */
  buildFinal(item: BlueprintItem): HTMLElement {
    if (item.kind === 'text') {
      const el = this.createTextElement(item);
      el.textContent = item.text ?? '';
      return el;
    }
    if (item.kind === 'media') {
      const el = this.createMediaElement(item);
      Overlay.applyGeometry(el, item.x, item.y, item.width, item.height);
      Overlay.applyMedia(el, item);
      return el;
    }
    const el = this.createRectElement(item);
    Overlay.applyFinalRectStyle(el, item);
    return el;
  }

  static finalOpacity(item: BlueprintItem): number {
    const raw = item.kind === 'media' ? item.media?.opacity : item.rectStyle?.opacity;
    const value = parseFloat(raw ?? '1');
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  }

  /** A layout line, drawn from one end to the other. */
  createGuide(item: BlueprintItem): HTMLElement {
    const axis = item.guide?.axis ?? 'x';
    const el = document.createElement('div');
    el.className = 'sb-guide';
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.width = axis === 'x' ? '1px' : '0px';
    el.style.height = axis === 'x' ? '0px' : '1px';
    this.append(el, item);
    return el;
  }

  createCaret(height: number, item: BlueprintItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sb-caret';
    el.style.height = `${Math.round(height)}px`;
    this.append(el, item);
    return el;
  }

  /** The box item coordinates are measured from: page layer, or pinned layer. */
  layerRectOf(item: BlueprintItem): DOMRect {
    return this.layerFor(item).getBoundingClientRect();
  }
}
