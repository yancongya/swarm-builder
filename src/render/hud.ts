import type { SwarmStatus } from '../types';
import { resolveLang } from '../tune/locale';

const TEXT = {
  zh: { skip: '跳过', scroll: '滚动以继续施工' },
  en: { skip: 'Skip', scroll: 'Scroll to keep building' },
} as const;

/**
 * 无键盘宿主的逃生门：进度、可触摸跳过、滚动提示。挂在 root 上而不是
 * aria-hidden 的 overlay 里，fixed 钉在视口底，样式随 styleRoot 进 shadow。
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(root: HTMLElement, onSkip: () => void) {
    const text = TEXT[resolveLang()];
    this.el = document.createElement('div');
    this.el.className = 'sb-hud';
    this.hint = document.createElement('div');
    this.hint.className = 'sb-hud__hint';
    this.hint.textContent = text.scroll;
    this.hint.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'sb-hud__bar';
    this.progress = document.createElement('span');
    this.progress.className = 'sb-hud__progress';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'sb-hud__skip';
    skip.textContent = text.skip;
    skip.addEventListener('click', onSkip);
    bar.append(this.progress, skip);
    this.el.append(this.hint, bar);
    root.appendChild(this.el);
  }

  update(status: SwarmStatus): void {
    this.progress.textContent = `${status.built}/${status.total}`;
    this.hint.hidden = !status.needsScroll;
  }

  destroy(): void {
    this.el.remove();
  }
}