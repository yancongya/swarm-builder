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
  ) {}

  tick(): void {
    const now = performance.now();
    if (this.isFinished()) {
      if (!this.handedBack) {
        this.handedBack = true;
        // Hand the page back from the top so the reveal reads as one picture.
        const rect = this.root.getBoundingClientRect();
        this.scrollTo(window.scrollY + rect.top);
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
    const top = this.root.getBoundingClientRect().top;
    if (top + lowest > window.innerHeight - MARGIN) {
      this.scrollTo(window.scrollY + top + lowest - window.innerHeight + MARGIN);
    } else if (top + highest < MARGIN) {
      this.scrollTo(window.scrollY + top + highest - MARGIN);
    }
  }

  private scrollTo(documentY: number): void {
    this.lastScroll = performance.now();
    window.scrollTo({ top: Math.max(0, documentY), behavior: 'smooth' });
  }
}
