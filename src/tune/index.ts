import { SwarmBuilder } from '../index';
import type { SwarmBuilderOptions, SwarmConfig, SwarmResult } from '../types';
import { Panel, type Corner, type Phase } from './panel';
import { renderCrewCard } from './card';
import { resolveLang, type Lang } from './locale';
import { CHROME_SELECTOR, DEFAULT_CONFIG, buildSnippet, describeRoot, pickPlain } from './snippet';

export type { SwarmConfig } from '../types';
export type { Corner, Phase } from './panel';
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
  /**
   * Panel language. Left out, it reads `<html lang>` — so a host that already
   * declares its language gets a panel that matches, and demos can switch by URL.
   */
  lang?: Lang;
  /**
   * Where the engine injects its overlay/cursor styles. Defaults to `document`;
   * a host that mounts `root` inside a shadow root passes that shadow root here,
   * since document.head styles never cross the shadow boundary. The panel keeps
   * its own shadow regardless — this only steers the rebuild layer's styles.
   */
  styleRoot?: Document | ShadowRoot;
}

/**
 * A floating tuning panel for a host page. It lives outside the rebuilt subtree
 * and behind a shadow root, so neither its styles nor its markup can collide
 * with the page it is tuning.
 */
export class SwarmTuner {
  private config: SwarmConfig;
  private readonly root: HTMLElement;
  private readonly panel: Panel;
  private readonly initial: SwarmBuilderOptions;
  private readonly lang: Lang;
  private readonly styleRoot: Document | ShadowRoot | undefined;
  private swarm: SwarmBuilder | null = null;
  /** The finished run's numbers, kept for 「名片」 until the next apply/restore. */
  private result: SwarmResult | null = null;

  constructor(options: TuneOptions = {}) {
    const root = typeof options.root === 'string'
      ? document.querySelector<HTMLElement>(options.root)
      : options.root ?? document.body;
    if (!root) throw new Error(`swarm-builder tune: 找不到容器 ${String(options.root)}`);
    this.root = root;
    this.config = { ...DEFAULT_CONFIG, ...pickPlain(options.initial ?? {}) };
    this.initial = options.initial ?? {};
    this.lang = resolveLang(options.lang);
    this.styleRoot = options.styleRoot;

    this.panel = new Panel(this.config, {
      onChange: (next) => {
        this.config = next;
        // A timed run owns the multiplier, so only an untimed one takes live speed edits.
        if (next.targetDuration === 0) this.swarm?.setSpeed(next.speed ?? 1);
      },
      onApply: () => this.apply(),
      onPause: () => {
        if (!this.swarm) return;
        if (this.swarm.isPaused) {
          this.swarm.resume();
          this.panel.setPhase('running');
          this.panel.setStatus('已继续');
        } else {
          this.swarm.pause();
          this.panel.setPhase('paused');
          this.panel.setStatus('已暂停');
        }
      },
      onSkip: () => this.swarm?.skip(),
      onCopy: () => void this.copy(),
      onReset: () => this.reset(),
      onRestore: () => this.restore(),
      // 下面四颗钮改的是正在跑的这一局，和参数行（下一局才生效）分开走。
      onTour: () => this.swarm?.toggleTour(),
      onSpeed: () => this.swarm?.cycleSpeed(),
      onSound: () => this.swarm?.toggleSound(),
      onReplay: () => (this.swarm ? this.swarm.replay() : this.apply()),
      onCard: () => void this.showCard(),
    }, options.position ?? 'bottom-right', options.open ?? false, this.lang);
    document.body.appendChild(this.panel.host);
  }

  /** Rebuild with the panel's current values. The previous run is torn down first. */
  apply(): void {
    this.swarm?.destroy();
    this.result = null;
    this.panel.markApplied(this.config);
    this.panel.setPhase('idle');
    this.panel.setStatus('采蓝图中…');
    this.swarm = new SwarmBuilder({
      ...this.config,
      root: this.root,
      ...(this.styleRoot ? { styleRoot: this.styleRoot } : {}),
      ignore: [CHROME_SELECTOR, ...(this.config.ignore ?? [])],
      autoStart: false,
      // HUD 一条线接管状态行、进度、班组点和工具条：面板读的是和宿主同一份
      // `SwarmStatus`，不再自己拼「重建中 x/y」那种会盖掉实时状态的临时句。
      onStatus: (status) => this.panel.setHud(status),
      onComplete: (result: SwarmResult) => {
        this.result = result;
        this.panel.setResult(result);
        this.initial.onComplete?.(result);
      },
    });
    this.swarm.start();
  }

  /** Back to the library defaults; the values still need 「应用并重跑」 to take effect. */
  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.panel.setConfig(this.config);
    this.panel.setStatus('已重置为库默认值');
  }

  /** Stop building and hand the page back untouched. */
  restore(): void {
    this.swarm?.destroy();
    this.swarm = null;
    this.result = null;
    this.panel.setPhase('idle');
    this.panel.setStatus('已恢复原状');
  }

  /**
   * The finished run's crew as a PNG data URL — the same image 「名片」 shows,
   * for hosts that want to save or post it themselves. Null until a run has
   * actually produced a crew.
   */
  crewCard(): string | null {
    const result = this.result;
    if (!result?.crew?.length) return null;
    const card = renderCrewCard({
      crew: result.crew,
      built: result.built,
      durationMs: result.durationMs,
      seed: result.seed,
    }, this.lang);
    return card || null;
  }

  /** Draw the card and show it in the panel; false when there is nothing to show. */
  showCard(): boolean {
    const result = this.result;
    if (!result?.crew?.length) {
      this.panel.setStatus('这一局还没跑完，完成后才能出名片');
      return false;
    }
    const card = this.crewCard();
    if (!card) {
      this.panel.setStatus('这个环境画不出名片');
      return false;
    }
    this.panel.showCard(card);
    this.panel.setStatus('班组名片已生成，长按或右键保存');
    return true;
  }

  /** The paste-ready snippet: plain data only, `root` as a selector, defaults omitted. */
  snippet(): string {
    return buildSnippet(this.config, describeRoot(this.root), this.lang);
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

  get expanded(): boolean {
    return this.panel.expanded;
  }

  /** What the panel is reporting — for hosts that mirror it into their own chrome. */
  get status(): string {
    return this.panel.statusText;
  }

  get phase(): Phase {
    return this.panel.currentPhase;
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