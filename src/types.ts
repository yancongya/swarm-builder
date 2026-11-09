export type CursorShape = 'arrow' | 'crosshair' | 'ibeam';

export interface AgentInfo {
  id: number;
  name: string;
  color: string;
}

export type BuildOrder = 'group' | 'rows' | 'cols' | 'snake' | 'depth' | 'radial' | 'random';

export type FlightMode = 'idle' | 'live';
export type PointerMode = 'ignore' | 'follow' | 'repel';
export type AgentPool = 'fixed' | 'auto';
export type PickMode = 'queued' | 'live';
export type TriggerMode = 'immediate' | 'scroll';
export type ScanMode = 'single' | 'pre-scroll';
export type ScoreMode = 'off' | 'generative';
export type ReducedMotionMode = 'run' | 'skip';

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

  // ---------------------------------------------------------------------
  // 复刻两套参考实现的开关。全部默认关：关掉时运行算法与上面那组选项完全一致，
  // 不会多一次滚动、多一个光标，也不会多一声配音。
  // ---------------------------------------------------------------------

  /**
   * What a cursor does while it has nothing to build.
   * 'idle' (default) parks it exactly where its last action landed.
   * 'live' flies it on the extension's own model: velocity integration around a
   * breathing orbit ring (R = 135px ±18%), a tanh swirl, a radial spring clamped
   * to [-2600, 1400], per-cursor curl, and velocity alignment with neighbours
   * inside 90px (0.7 own / 0.3 neighbour). Glyphs lean into their heading and
   * flatten while pressing.
   */
  flight?: FlightMode;
  /**
   * How the real pointer is treated. The pointermove listener is only attached
   * when this is not 'ignore'.
   * 'ignore' (default) - the swarm never notices the reader.
   * 'follow' - the orbit centre is the pointer itself.
   * 'repel' - a 48px ring around the pointer shoves cursors out, with an outward
   * impulse when they move into it. Only reads the pointer inside the orbit
   * field, so it needs `flight: 'live'` to do anything.
   */
  pointer?: PointerMode;
  /**
   * Whether the crew size is fixed.
   * 'fixed' (default) - exactly agentCount cursors; one hides when its queue empties.
   * 'auto' - agentCount becomes the floor and 48 the ceiling; the target rises
   * with scroll velocity (every 40px/s) and with half the unlocked work, at most
   * one arrival every 35ms from a random edge, and a cursor that has worked and
   * then sat idle for 2.5s leaves.
   */
  agents?: AgentPool;
  /**
   * How work is claimed.
   * 'queued' (default) - queues are cut up front by `order`; a cursor takes from
   * its own queue and steals only when that queue is blocked.
   * 'live' - the extension's runtime pick: every unlocked task is priced from
   * the cursor (unreached x 1e6 + distance off the visible band x 0.6 +
   * |y - cursorY| x 0.4, guides get a -5e5 bonus) and the cheapest wins, so
   * cursors chase the work in front of them instead of their assigned band.
   */
  pick?: PickMode;
  /**
   * When an item is allowed to be picked up.
   * 'immediate' (default) - the whole blueprint is open from the first frame.
   * 'scroll' - only items above the scroll frontier are ready. The frontier is
   * the line 12% above the bottom of the visible area (the reference's
   * rootMargin -12%, i.e. its `trigger: 0.88`); it only ever moves downward, and
   * it needs `tour` or a host that scrolls.
   */
  trigger?: TriggerMode;
  /**
   * Raise the clock while work piles up: speed x min(1 + backlog x 0.45, 4),
   * recomputed every frame from the unlocked-but-unclaimed count. Off by
   * default, because it turns `speed` and `targetDuration` into a floor instead
   * of the pace.
   */
  adaptiveSpeed?: boolean;
  /**
   * How much of the page the capture pass sees.
   * 'single' (default) - one synchronous walk of `root`; what is laid out is
   * what gets built.
   * 'pre-scroll' - the extension's pass: wait for fonts and images (bounded),
   * find the element that actually scrolls (a `main{overflow:auto}` page is not
   * the window), walk it down in up to 28 viewport-sized steps so lazy and
   * content-visibility content materialises, return to the top, settle, then
   * capture. It also drops what a real reader cannot see - screen-reader-only
   * boxes, content-visibility:hidden subtrees, closed <details> - and orders
   * items by paint order (z-index, then positioning, then document order).
   */
  scan?: ScanMode;
  /**
   * The audio layer, once `sound` is on.
   * 'off' (default) - synthesised key/draw/stamp clicks only.
   * 'generative' - the extension's score: 104 BPM sixteenth grid, E-minor
   * pentatonic from MIDI 40, glass-piano voices with an inharmonic 2.756
   * partial, box area choosing the octave and x choosing the degree, at most one
   * note per slot and 28 voices live, a generated 3.2s room impulse, key clacks
   * panned by cursor position, and an E-major-add9 strum when the run finishes.
   */
  score?: ScoreMode;
  /**
   * Behaviour for prefers-reduced-motion: reduce.
   * 'run' (default) - animate anyway; this is decoration, not a parallax trap,
   * and the host asked for it.
   * 'skip' - the reference library's rule: build nothing, reveal the real page,
   * report immediately.
   */
  reducedMotion?: ReducedMotionMode;
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
