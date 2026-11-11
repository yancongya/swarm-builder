import type { CursorShape, PersonalityKind } from '../types';
import { personaLabel } from '../core/personality';
import { resolveLang } from '../tune/locale';

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
  /** 上一帧位置：速度线按帧间位移估速，不读物理。 */
  lastX: number;
  lastY: number;
}

/** 性格的可见配件：急性子身后两道速度线，强迫症一圈校准环，摸鱼闲久了冒「…」。 */
const TRAIT: Record<PersonalityKind, string> = {
  rush: '<div class="sb-trail"><i></i><i></i></div>',
  tidy: '<div class="sb-ring"></div>',
  drift: '<div class="sb-idle">…</div>',
  steady: '',
};

export class CursorLayer {
  private readonly handles = new Map<number, CursorHandle>();
  private readonly width: number;

  constructor(private readonly parent: HTMLElement) {
    this.width = parent.offsetWidth;
  }

  add(id: number, name: string, color: string, personality: PersonalityKind = 'steady'): CursorHandle {
    const el = document.createElement('div');
    el.className = 'sb-cursor is-arrow';
    if (personality !== 'steady') el.classList.add(`sb-p-${personality}`);
    el.dataset.cursor = String(id);
    el.style.color = color;
    el.innerHTML = `${ARROW}${IBEAM}<div class="sb-cursor__crosshair"></div><div class="sb-ghost"></div>${TRAIT[personality]}<div class="sb-badge"></div>`;

    const label = document.createElement('div');
    label.className = 'sb-name';
    label.textContent = name;
    label.style.background = color;
    label.title = `${name} · ${personaLabel(personality, resolveLang())}`;
    el.appendChild(label);

    this.parent.appendChild(el);
    const handle: CursorHandle = {
      id, el, label,
      badge: el.querySelector<HTMLElement>('.sb-badge') as HTMLElement,
      overhang: label.offsetWidth,
      flipped: false,
      lastX: 0,
      lastY: 0,
    };
    this.handles.set(id, handle);
    return handle;
  }

  setPosition(id: number, x: number, y: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    // 速度线只认「这一帧挪了多远」：24px/帧算满速。施工与待时物理都走这里，
    // 所以两种移动都会带出线的浓淡，而不用动作层各自上报速度。
    const speed = Math.min(1, Math.hypot(x - handle.lastX, y - handle.lastY) / 24);
    handle.el.style.setProperty('--sb-speed', speed.toFixed(2));
    handle.lastX = x;
    handle.lastY = y;
    // 光标贴着页面右边缘时，右侧的名字标签和徽章会画到蓝图画框之外，把文档撑出
    // 一段横向滚动——手机上那半屏尤其明显。标签宽度量一次就够（add 与 setBadge），
    // 所以这里只比一下剩余空间，按需要把标签翻到光标左侧。
    const flip = x + LABEL_GAP + handle.overhang > this.width;
    if (flip !== handle.flipped) {
      handle.flipped = flip;
      handle.el.dataset.flip = flip ? 'left' : 'right';
    }
  }

  /** 摸鱼的光标闲过一阵才冒「…」；领到活立刻收回去。 */
  setIdling(id: number, on: boolean): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.classList.toggle('is-idling', on);
  }

  /** 开场点名：名牌按进场顺序逐个弹一下， delays 由调用方排。 */
  rollCall(ids: readonly number[]): void {
    ids.forEach((id, index) => {
      const handle = this.handles.get(id);
      if (!handle) return;
      handle.label.style.animationDelay = `${index * 90}ms`;
      handle.label.classList.add('sb-rolling');
    });
  }

  setShape(id: number, shape: CursorShape): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    for (const cls of Object.values(SHAPES)) handle.el.classList.remove(cls);
    handle.el.classList.add(SHAPES[shape]);
  }

  /**
   * 待时物理（`flight: 'live'`）写的位置与姿态：箭头朝行进方向歪过去，按下的时候压扁。
   * 关着时没人调用，所以默认那套「落在哪儿就是哪儿」的光标一个像素都不动。
   */
  setPose(id: number, x: number, y: number, angleDeg: number, press: number): void {
    this.setPosition(id, x, y);
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.style.setProperty('--tilt', `${angleDeg.toFixed(1)}deg`);
    handle.el.style.setProperty('--press', press.toFixed(3));
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
