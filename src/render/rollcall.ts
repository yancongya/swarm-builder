import type { AgentInfo } from '../types';
import type { CursorLayer } from './cursor_layer';
import { resolveLang } from '../tune/locale';

/**
 * 开场点名：聚群那 2.4 秒里，视口上方挂一条「领班 · N 人到齐」，名牌按进场
 * 顺序逐个弹一下。纯装饰——不加减光标、不改聚群时长，开工那一帧就拆掉。
 * 领班取原始班底的第一只（infos[0] 永远是 home）。
 */
export class RollCall {
  readonly el: HTMLElement;

  constructor(
    parent: HTMLElement,
    width: number,
    top: number,
    crew: readonly AgentInfo[],
    cursors: CursorLayer,
  ) {
    const foreman = crew[0]?.name ?? '';
    this.el = document.createElement('div');
    this.el.className = 'sb-rollcall';
    this.el.style.left = `${Math.round(width / 2)}px`;
    this.el.style.top = `${Math.round(top + 16)}px`;
    this.el.textContent = resolveLang() === 'zh'
      ? `领班 ${foreman} · ${crew.length} 人到齐`
      : `Foreman ${foreman} · crew of ${crew.length} ready`;
    parent.appendChild(this.el);
    cursors.rollCall(crew.map((agent) => agent.id));
  }

  destroy(): void {
    this.el.remove();
  }
}