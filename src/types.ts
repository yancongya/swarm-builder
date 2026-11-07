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
