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
/** 拖尾多少毫秒落一个采样点：跟着屏幕帧走，拐弯处才有足够多的点画成弧。 */
const TRAIL_SAMPLE_MS = 16;
/** 移动不到这个距离不落点：光标原地微抖时不该堆出一坨点。 */
const TRAIL_MIN_STEP = 1.5;
/** 尾巴画出来的最大路程（像素）。倍速只改施工快慢，不该把尾巴拉成横穿整页的长直线。 */
const TRAIL_MAX_PX = 300;

/** 每个 CursorLayer 一个号段，多个实例同页时拖尾渐变 id 也不会撞。 */
let layerSeq = 0;

interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

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
  /** 还一次位置都没写过：第一下落位不该从 (0,0) 拉出一条假尾巴。 */
  primed: boolean;
  /** 本帧锚点：拖尾按它把采样点换算成光标局部坐标。 */
  x: number;
  y: number;
  /** 最近一段路，按时间裁剪；trailLife 为 0 时永远为空。 */
  tail: TrailPoint[];
  /** 上一次落点的时间戳（真实时间，不吃倍速）。 */
  tailAt: number;
  tailEl: SVGSVGElement | null;
  tailLine: SVGPathElement | null;
  tailGrad: SVGLinearGradientElement | null;
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
  private readonly urgeTimers = new Map<number, number>();
  private readonly width: number;
  /** 本层的渐变 id 号段。 */
  private readonly uid = ++layerSeq;

  constructor(
    private readonly parent: HTMLElement,
    /** 拖尾残留秒数；0 = 不建拖尾节点，一帧都不算。 */
    private readonly trailLife = 0,
  ) {
    this.width = parent.offsetWidth;
  }

  add(id: number, name: string, color: string, personality: PersonalityKind = 'steady'): CursorHandle {
    const el = document.createElement('div');
    el.className = 'sb-cursor is-arrow';
    if (personality !== 'steady') el.classList.add(`sb-p-${personality}`);
    el.dataset.cursor = String(id);
    el.style.color = color;
    // 拖尾排在最前面：同一只光标里箭头、名字都压在它上面。渐变写死这色，不靠
    // currentColor——老 Chrome 的 stop-color 不认它。点由 tickTrails 采样，画成曲线。
    const gid = `sb-tail-${this.uid}-${id}`;
    const trail = this.trailLife > 0
      ? `<svg class="sb-tail" aria-hidden="true"><defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
        `<stop offset=".55" stop-color="${color}" stop-opacity=".24"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity=".65"/>` +
        `</linearGradient></defs><path fill="none" stroke="url(#${gid})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : '';
    el.innerHTML = `${trail}${ARROW}${IBEAM}<div class="sb-cursor__crosshair"></div><div class="sb-cursor__hit"></div><div class="sb-ghost"></div>${TRAIT[personality]}<div class="sb-urge"></div><div class="sb-badge"></div>`;

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
      primed: false,
      x: 0,
      y: 0,
      tail: [],
      tailAt: 0,
      tailEl: el.querySelector<SVGSVGElement>('.sb-tail'),
      tailLine: el.querySelector<SVGPathElement>('.sb-tail path'),
      tailGrad: this.trailLife > 0 ? el.querySelector<SVGLinearGradientElement>(`#${gid}`) : null,
    };
    this.handles.set(id, handle);
    return handle;
  }

  setPosition(id: number, x: number, y: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.x = x;
    handle.y = y;
    handle.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    // 速度线只认「这一帧挪了多远」：24px/帧算满速。施工与待时物理都走这里，
    // 所以两种移动都会带出线；方向也按同一帧的位移转，尾巴始终拖在身后。
    const dx = x - handle.lastX;
    const dy = y - handle.lastY;
    if (handle.primed) {
      const dist = Math.hypot(dx, dy);
      const moving = dist > 0.5;
      // 只要在动，最淡也留 0.18：短线在高速下一闪就没，等于没画。
      handle.el.style.setProperty('--sb-trail', moving ? (0.18 + 0.82 * Math.min(1, dist / 24)).toFixed(2) : '0');
      if (moving) {
        const dir = (Math.atan2(dy, dx) * 180) / Math.PI;
        handle.el.style.setProperty('--sb-dir', `${dir.toFixed(0)}deg`);
      }
    } else {
      handle.primed = true;
      handle.el.style.setProperty('--sb-trail', '0');
    }
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

  /**
   * 拖尾按真实时间裁剪：倍速只拧施工，不该把残留一起缩短。采样的是 setPosition
   * 已经写下的位置，这里不读布局；点换算成光标局部坐标，整条尾巴跟着锚点走。
   * 停下来的光标不再落点，只让老点逐个过期，于是尾巴慢慢缩短直到消失。
   */
  tickTrails(now: number): void {
    if (this.trailLife <= 0) return;
    const lifeMs = this.trailLife * 1000;
    for (const handle of this.handles.values()) {
      const line = handle.tailLine;
      const grad = handle.tailGrad;
      const svg = handle.tailEl;
      if (!line || !grad || !svg) continue;
      if (handle.el.hidden) {
        if (handle.tail.length > 0) {
          handle.tail.length = 0;
          line.setAttribute('d', '');
        }
        continue;
      }
      if (now - handle.tailAt < TRAIL_SAMPLE_MS) continue;
      handle.tailAt = now;
      const tail = handle.tail;
      const head = tail[tail.length - 1];
      let changed = false;
      if (!head || Math.hypot(handle.x - head.x, handle.y - head.y) > TRAIL_MIN_STEP) {
        tail.push({ x: handle.x, y: handle.y, t: now });
        changed = true;
      }
      while (tail.length > 0 && now - (tail[0] as TrailPoint).t > lifeMs) {
        tail.shift();
        changed = true;
      }
      // 没落新点、也没点过期时锚点几乎没动，曲线原样留着，不白写一遍属性。
      if (!changed) continue;
      if (tail.length < 2) {
        if (line.getAttribute('d')) line.setAttribute('d', '');
        continue;
      }
      // 时间裁剪只管残留多久；路线上再裁一刀：倍速越高、同样时间里光标跨得越远，
      // 不裁的话 8× 会把尾巴拉成横穿整页的长直线。从脑袋往回走到上限，跨过上限的
      // 那一小段按比例截断——尾巴长度与倍速无关，但采样点本身还留着按时间过期。
      const render: TrailPoint[] = [];
      let span = 0;
      let prev: TrailPoint | null = null;
      for (let i = tail.length - 1; i >= 0; i--) {
        const point = tail[i] as TrailPoint;
        if (!prev) {
          render.push(point);
          prev = point;
          continue;
        }
        const seg = Math.hypot(prev.x - point.x, prev.y - point.y);
        if (span + seg >= TRAIL_MAX_PX) {
          const rest = Math.max(0, TRAIL_MAX_PX - span);
          const t = seg > 0 ? rest / seg : 0;
          render.push({ x: prev.x + (point.x - prev.x) * t, y: prev.y + (point.y - prev.y) * t, t: point.t });
          break;
        }
        render.push(point);
        span += seg;
        prev = point;
      }
      render.reverse();
      if (render.length < 2) {
        if (line.getAttribute('d')) line.setAttribute('d', '');
        continue;
      }
      const x = handle.x;
      const y = handle.y;
      // 点换算到光标局部坐标，再按这一段的包围盒给 SVG 定尺寸与位置。0×0 的
      // SVG 视口在 Chromium 里不画溢出内容，所以不能靠 overflow:visible。
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of render) {
        const px = point.x - x;
        const py = point.y - y;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const pad = 4;
      const left = minX - pad;
      const top = minY - pad;
      svg.style.left = `${left.toFixed(1)}px`;
      svg.style.top = `${top.toFixed(1)}px`;
      svg.style.width = `${Math.max(1, maxX - minX + pad * 2).toFixed(1)}px`;
      svg.style.height = `${Math.max(1, maxY - minY + pad * 2).toFixed(1)}px`;
      // 顺序连点画出来是一段段直线，拐弯处是硬折角；这里每两个点的中点是终点、
      // 采样点自己当控制点，把整条尾巴抹成一条平滑曲线（两端照样落在真实位置上）。
      const local = render.map((point) => ({ x: point.x - x - left, y: point.y - y - top }));
      const first = local[0] as { x: number; y: number };
      let d = `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
      if (local.length === 2) {
        const last = local[1] as { x: number; y: number };
        d += `L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
      } else {
        for (let i = 1; i < local.length - 1; i++) {
          const cur = local[i] as { x: number; y: number };
          const next = local[i + 1] as { x: number; y: number };
          const mx = (cur.x + next.x) / 2;
          const my = (cur.y + next.y) / 2;
          d += `Q${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
        }
        const last = local[local.length - 1] as { x: number; y: number };
        d += `L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
      }
      line.setAttribute('d', d);
      // 渐变从尾到头：透明 → 本色的半透明，拖得越远越淡。
      const last = local[local.length - 1] as { x: number; y: number };
      grad.setAttribute('x1', first.x.toFixed(1));
      grad.setAttribute('y1', first.y.toFixed(1));
      grad.setAttribute('x2', last.x.toFixed(1));
      grad.setAttribute('y2', last.y.toFixed(1));
    }
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

  /** 观众点了一下催工：亮一圈光环，ms 之后自己收。连点只延长窗口，不叠动画。 */
  urge(id: number, ms: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.classList.add('is-urged');
    const previous = this.urgeTimers.get(id);
    if (previous !== undefined) window.clearTimeout(previous);
    this.urgeTimers.set(id, window.setTimeout(() => {
      handle.el.classList.remove('is-urged');
      this.urgeTimers.delete(id);
    }, ms));
  }

  /** 正在被总监拖走：类挂在光标上，CSS 换抓取手势。 */
  setDirecting(id: number, on: boolean): void {
    const handle = this.handles.get(id);
    if (handle) handle.el.classList.toggle('is-directing', on);
  }

  hide(id: number): void {
    const handle = this.handles.get(id);
    if (!handle) return;
    handle.el.hidden = true;
    handle.tail.length = 0;
    handle.tailLine?.setAttribute('d', '');
  }

  destroy(): void {
    for (const timer of this.urgeTimers.values()) window.clearTimeout(timer);
    this.urgeTimers.clear();
    for (const handle of this.handles.values()) handle.el.remove();
    this.handles.clear();
  }
}
