import { SwarmBuilder } from '../index';
import type { AgentInfo, SwarmBuilderOptions, SwarmResult } from '../types';
import { Panel, type Corner } from './panel';
import { CHROME_SELECTOR, DEFAULT_CONFIG, buildSnippet, describeRoot, pickPlain, type PlainConfig } from './snippet';

export type { PlainConfig } from './snippet';
export { DEFAULT_CONFIG } from './snippet';

export interface TuneOptions {
  /** Container to rebuild. A string is treated as a selector. Defaults to document.body. */
  root?: HTMLElement | string;
  /** Starting values for the panel; anything omitted falls back to the library default. */
  initial?: SwarmBuilderOptions;
  /** Which corner the panel sits in, so it can dodge the host's own widgets. */
  position?: Corner;
  /** Start expanded instead of collapsed to a button. */
  open?: boolean;
}

/**
 * A floating tuning panel for a host page. It lives outside the rebuilt subtree
 * and behind a shadow root, so neither its styles nor its markup can collide
 * with the page it is tuning.
 */
export class SwarmTuner {
  private config: PlainConfig;
  private readonly root: HTMLElement;
  private readonly panel: Panel;
  private readonly initial: SwarmBuilderOptions;
  private swarm: SwarmBuilder | null = null;

  constructor(options: TuneOptions = {}) {
    const root = typeof options.root === 'string'
      ? document.querySelector<HTMLElement>(options.root)
      : options.root ?? document.body;
    if (!root) throw new Error(`swarm-builder tune: 找不到容器 ${String(options.root)}`);
    this.root = root;
    this.config = { ...DEFAULT_CONFIG, ...pickPlain(options.initial ?? {}) };
    this.initial = options.initial ?? {};

    this.panel = new Panel(this.config, {
      onChange: (next) => {
        this.config = next;
        // A timed run owns the multiplier, so only an untimed one takes live speed edits.
        if (next.targetDuration === 0) this.swarm?.setSpeed(next.speed ?? 1);
      },
      onApply: () => this.apply(),
      onPause: () => {
        if (!this.swarm) return;
        if (this.swarm.isPaused) this.swarm.resume();
        else this.swarm.pause();
        this.panel.setPaused(this.swarm.isPaused);
      },
      onSkip: () => this.swarm?.skip(),
      onCopy: () => void this.copy(),
    }, options.position ?? 'bottom-right', options.open ?? false);
    document.body.appendChild(this.panel.host);
  }

  /** Rebuild with the panel's current values. The previous run is torn down first. */
  apply(): void {
    this.swarm?.destroy();
    this.panel.setPaused(false);
    this.panel.setStatus('采蓝图中…');
    this.swarm = new SwarmBuilder({
      ...this.config,
      root: this.root,
      ignore: [CHROME_SELECTOR, ...(this.config.ignore ?? [])],
      autoStart: false,
      onStart: (agents: AgentInfo[]) => {
        this.panel.setStatus(`施工中 · ${agents.length} 个光标`);
        this.initial.onStart?.(agents);
      },
      onProgress: (built: number, total: number) => {
        this.panel.setStatus(`重建中 ${built}/${total}`);
        this.initial.onProgress?.(built, total);
      },
      onComplete: (result: SwarmResult) => {
        this.panel.setPaused(false);
        const dropped = result.dropped > 0 ? ` · 丢弃 ${result.dropped}` : '';
        this.panel.setStatus(`完成 ${result.built} 项 · ${(result.durationMs / 1000).toFixed(1)}s${dropped}`);
        this.initial.onComplete?.(result);
      },
    });
    this.swarm.start();
  }

  /** The paste-ready snippet: plain data only, `root` as a selector, defaults omitted. */
  snippet(): string {
    return buildSnippet(this.config, describeRoot(this.root));
  }

  async copy(): Promise<boolean> {
    const code = this.snippet();
    this.panel.showSnippet(code);
    try {
      await navigator.clipboard.writeText(code);
      this.panel.setStatus('配置已复制到剪贴板');
      return true;
    } catch {
      // Clipboard API needs a secure context; on plain http the text is left selected instead.
      this.panel.selectSnippet();
      this.panel.setStatus('已选中片段，按 Ctrl+C 复制');
      return false;
    }
  }

  open(): void {
    this.panel.setExpanded(true);
  }

  close(): void {
    this.panel.setExpanded(false);
  }

  destroy(): void {
    this.swarm?.destroy();
    this.swarm = null;
    this.panel.destroy();
  }
}

/** Drops a tuning panel onto the page and returns its handle. */
export function tune(options: TuneOptions = {}): SwarmTuner {
  return new SwarmTuner(options);
}