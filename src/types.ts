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
  /** CSS selector; matched elements and their descendants are skipped. */
  ignore?: string;
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
