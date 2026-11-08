import type { CursorShape } from '../types';

const ARROW = `
<svg class="sb-cursor__arrow" width="17" height="19" viewBox="0 0 17 19" fill="none">
  <path d="M1 1 L1 15.5 L4.9 12.1 L7.2 17.4 L9.9 16.2 L7.6 11 L12.6 10.4 Z"
    fill="currentColor" stroke="#0b0d10" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

const IBEAM = `
<svg class="sb-cursor__ibeam" width="13" height="19" viewBox="0 0 13 19" fill="none">
  <path d="M6.5 2 V17 M2.5 2 H10.5 M2.5 17 H10.5" stroke="#0b0d10" stroke-width="3" stroke-linecap="round"/>
  <path d="M6.5 2 V17 M2.5 2 H10.5 M2.5 17 H10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

const SHAPES: Record<CursorShape, string> = {
  arrow: 'is-arrow',
  crosshair: 'is-crosshair',
  ibeam: 'is-ibeam',
};

/** 名字标签与尺寸徽章离光标锚点的最小水平间距，对应 styles.ts 里的 left 值。 */
const LABEL_GAP = 16;

export interface CursorHandle {
  id: number;
  el: HTMLElement;
  label: HTMLElement;
  badge: HTMLElement;
  /** 名字标签/尺寸徽章伸出光标锚点右侧的宽度，贴边时用它决定挂哪一侧。 */
  overhang: number;
  flipped: boolean;
}

export class CursorLayer {
  private readonly handles = new Map<number, CursorHandle>();
  private readonly width: number;

  constructor(private readonly parent: HTMLElement) {
    this.width = parent.offsetWidth;
  }

  add(id: number, name: string, color: string): CursorHandle {
    const el = document.createElement('div');
    el.className = 'sb-cursor is-arrow';
    el.style.color = color;
    el.innerHTML = `${ARROW}${IBEAM}<div class="sb-cursor__crosshair"></div><div class="sb-ghost"></div><div class="sb-badge"></div>`;

    const label = document.createElement('div');
    label.className = 'sb-name';
    label.textContent = name;
    label.style.background = color;
    el.appendChild(label);

    this.parent.appendChild(el);
    const handle: CursorHandle = {
      id, el, label,
      badge: el.querySelector<HTMLElement>('.sb-badge') as HTMLElement,
      overhang: label.offsetWidth,
      flipped: false,
    };
    this.handles.set(id, handle);
    return handle;
  }

  setPosition(id: number, x: number, y: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    // 光标贴着页面右边缘时，右侧的名字标签和徽章会画到蓝图画框之外，把文档撑出
    // 一段横向滚动——手机上那半屏尤其明显。标签宽度量一次就够（add 与 setBadge），
    // 所以这里只比一下剩余空间，按需要把标签翻到光标左侧。
    const flip = x + LABEL_GAP + handle.overhang > this.width;
    if (flip !== handle.flipped) {
      handle.flipped = flip;
      handle.el.dataset.flip = flip ? 'left' : 'right';
    }
  }

  setShape(id: number, shape: CursorShape): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    for (const cls of Object.values(SHAPES)) handle.el.classList.remove(cls);
    handle.el.classList.add(SHAPES[shape]);
  }

  /** A null badge ends the drag affordance (size badge + corner marker). */
  setBadge(id: number, text: string | null): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    if (text === null) {
      handle.el.classList.remove('is-dragging');
      handle.badge.textContent = '';
      handle.overhang = handle.label.offsetWidth;
      return;
    }
    handle.el.classList.add('is-dragging');
    handle.badge.textContent = text;
    // 徽章在 is-dragging 之前是 display:none，量不到宽度，所以先挂上再量。
    handle.overhang = Math.max(handle.label.offsetWidth, handle.badge.offsetWidth);
  }

  hide(id: number): void {
    const handle = this.handles.get(id);
    if (handle) handle.el.hidden = true;
  }

  destroy(): void {
    for (const handle of this.handles.values()) handle.el.remove();
    this.handles.clear();
  }
}
