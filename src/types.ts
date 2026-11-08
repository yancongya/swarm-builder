export type CursorShape = 'arrow' | 'crosshair' | 'ibeam';

export interface AgentInfo {
  id: number;
  name: string;
  color: string;
}

export type BuildOrder = 'group' | 'rows' | 'cols' | 'snake' | 'depth' | 'radial' | 'random';

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
  /** Scrolls the page so the work stays in view. Default false: the host owns the scroll. */
  tour?: boolean;
  /** Palette for the construction lines. 'auto' reads the page background. */
  theme?: 'auto' | 'light' | 'dark';
  /**
   * Seconds to stretch or squeeze the entrance to; 0 keeps the natural pace.
   * Overrides `speed` for the run, because the pace is now a fixed goal.
   */
  targetDuration?: number;
  /**
   * 'auto' (default) drops guides, heading grow and most copies once the root
   * holds 250+ elements; 'low' always trims; 'high' never does. Sound is not
   * trimmed: it costs a handful of oscillators a second, not DOM work.
   */
  performanceMode?: 'auto' | 'high' | 'low';
  /**
   * Which order the cursors take the page in.
   * 'group' (default) keeps a subtree on one cursor and balances the cursors by
   * size — fastest, and the swarm spreads over the whole page at once.
   * 'rows' splits the page into one horizontal band per cursor and each cursor
   * sweeps downward, so a tall page visibly builds top to bottom (pairs with `tour`).
   * 'cols' is 'rows' turned on its side: one vertical band per cursor, the page
   * fills left to right. It needs a page that is actually wider than one column —
   * a single-column page degenerates to one busy cursor, so bands fall back to
   * 'rows' when the content does not spread across the viewport.
   * 'snake' keeps the 'rows' bands and sweeps them alternately left-right,
   * left-right, so a cursor never walks back across the page it just built.
   * 'depth' builds by DOM depth: containers and headings first, then the leaves
   * inside them, which reads as a skeleton getting filled in.
   * 'radial' works outward from the centre of the page. Ancestors often sit in
   * the outer band while their children sit in the inner one, so a cursor can
   * claim a child whose parent is still pending — work stealing covers it, and
   * the hole gets filled when the parent lands.
   * 'random' shuffles the queue with `seed`.
   */
  order?: BuildOrder;
  /**
   * Cut the page into bands/subtrees of equal *estimated work* instead of equal
   * item counts, so the cursors finish at roughly the same time rather than one
   * of them still typing while five sit idle. Off by default; it stacks on top of
   * any order and does not change which direction the page is swept in.
   */
  balance?: boolean;
  /**
   * Seed for `order: 'random'`. 0 (default) draws a fresh sequence every run;
   * any other value makes that run reproducible.
   */
  seed?: number;
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
  /**
   * The seed the run shuffled with. Passing 0 means "draw one", so this is the
   * only place that number can be read back — put it in `seed` to replay.
   */
  seed: number;
}
