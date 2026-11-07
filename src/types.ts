export type CursorShape = 'arrow' | 'crosshair' | 'ibeam';

export interface AgentInfo {
  id: number;
  name: string;
  color: string;
}

export interface SwarmBuilderOptions {
  /** Element whose subtree is rebuilt. Defaults to document.body. */
  root?: HTMLElement;
  /** Number of cursors working in parallel. 1-24, default 6. */
  agentCount?: number;
  /** Global time multiplier. 0.25-8, default 1. */
  speed?: number;
  /** CSS selector(s); matched elements and their descendants are skipped. */
  ignore?: string | string[];
  /** Upper bound on rebuild items, protects long pages. Default 400. */
  maxItems?: number;
  /** Build repeated siblings once and stamp the rest. Default true. */
  duplicate?: boolean;
  /** Copies per repeated group. 1-48, default 12. */
  maxCopies?: number;
  /** Draw the alignment lines the layout implies. Default true. */
  guides?: boolean;
  /** Layout lines per run. 0-64, default 16. */
  maxGuides?: number;
  /** Headings grow to their real size while being typed. Default true. */
  grow?: boolean;
  /** Synthesised typing and drag clicks. Default false: sound needs a user gesture. */
  sound?: boolean;
  /** Cursors steer around each other mid-flight. Default true. */
  flocking?: boolean;
  /**
   * Seconds to stretch or squeeze the entrance to; 0 keeps the natural pace.
   * Overrides `speed` for the run, because the pace is now a fixed goal.
   */
  targetDuration?: number;
  /**
   * 'auto' (default) drops guides, heading grow, sound and most copies once the
   * root holds 250+ elements; 'low' always trims; 'high' never does.
   */
  performanceMode?: 'auto' | 'high' | 'low';
  /** Start on the next frame instead of waiting for start(). */
  autoStart?: boolean;
  onStart?: (agents: AgentInfo[]) => void;
  onProgress?: (built: number, total: number) => void;
  onComplete?: (result: SwarmResult) => void;
}

export interface SwarmResult {
  built: number;
  dropped: number;
  durationMs: number;
}
