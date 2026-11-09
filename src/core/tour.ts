import type { Tickable } from './engine';

const CHECK_MS = 180;
const MARGIN = 90;
// A smooth scroll is a browser animation; re-aiming before it settles fights it.
const SETTLE_MS = 500;

export interface TourView {
  readonly x: number;
  readonly y: number;
}

/**
 * Keeps the work in view on a page taller than the viewport by following the
 * front of the build. Off unless the host asks: it moves the scroll position,
 * which belongs to the host.
 *
 * The scroll target is whatever actually scrolls. `main{overflow:auto}` shells
 * (dashboards, admin UIs) never move the window no matter how much you ask it,
 * so the caller hands us the element it found — see `detectEnv`.
 */
export class TourCam implements Tickable {
  private lastCheck = 0;
  private lastScroll = 0;
  private handedBack = false;

  constructor(
    private readonly views: () => readonly TourView[],
    private readonly root: HTMLElement,
    private readonly isFinished: () => boolean,
    // The camera has to leave the clock itself, or the engine never idles.
    private readonly onDone: (cam: TourCam) => void,
    private readonly scroller: () => Element | null = () => null,
  ) {}

  /** 窗口自己滚时返回 null：那时 scrollTo 才是对的选择。 */
  private get el(): Element | null {
    const el = this.scroller();
    return el && el !== document.documentElement && el !== document.body ? el : null;
  }

  private get height(): number {
    const el = this.el;
    return el ? el.clientHeight : window.innerHeight;
  }

  tick(): void {
    const now = performance.now();
    if (this.isFinished()) {
      if (!this.handedBack) {
        this.handedBack = true;
        // Hand the page back from the top so the reveal reads as one picture.
        this.shift(this.root.getBoundingClientRect().top);
        this.onDone(this);
      }
      return;
    }
    if (now - this.lastCheck < CHECK_MS || now - this.lastScroll < SETTLE_MS) return;
    this.lastCheck = now;

    const views = this.views();
    if (views.length === 0) return;
    let highest = Infinity;
    let lowest = -Infinity;
    for (const view of views) {
      highest = Math.min(highest, view.y);
      lowest = Math.max(lowest, view.y);
    }
    // 元素坐标是相对 root 的，root 在视口里的位置就是它的 rect.top：
    // 这一套算法对「谁在滚」无所谓，getBoundingClientRect 本来就是视口坐标。
    const top = this.root.getBoundingClientRect().top;
    const viewport = this.height;
    if (top + lowest > viewport - MARGIN) {
      this.shift(top + lowest - viewport + MARGIN);
    } else if (top + highest < MARGIN) {
      this.shift(top + highest - MARGIN);
    }
  }

  private shift(delta: number): void {
    if (Math.abs(delta) < 2) return;
    this.lastScroll = performance.now();
    const behavior: ScrollBehavior = 'smooth';
    const el = this.el;
    if (el) el.scrollBy({ top: delta, behavior });
    else window.scrollBy({ top: delta, behavior });
  }
}
