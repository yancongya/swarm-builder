export type CursorShape = 'arrow' | 'crosshair' | 'ibeam';

/**
 * What a cursor is like when it works. Drawn per cursor from the run's seed, so
 * a replay brings back the same crew. 'steady' is the clone everyone was before
 * personalities existed, and what `personality: false` assigns to the whole crew.
 */
export type PersonalityKind = 'rush' | 'tidy' | 'drift' | 'steady';

export interface AgentInfo {
  id: number;
  name: string;
  color: string;
  personality: PersonalityKind;
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
/**
 * The serialisable half of the options: everything a tuning panel can show, a
 * snippet can export and `DEFAULT_OPTIONS` can list. The element handle and the
 * callbacks live on `SwarmBuilderOptions` instead.
 */
export interface SwarmConfig {
  /**
   * Home crew size. 1-24, default 8 — the reference extension's MIN_AGENTS.
   * With `agents: 'auto'` this is the floor, not the headcount.
   */
  agentCount?: number;
  /** Global time multiplier. 0.25-8, default 1. */
  speed?: number;
  /** CSS selector(s); matched elements and their descendants are skipped. */
  ignore?: string | string[];
  /** Upper bound on rebuild items. Default 4000, the reference's MAX_ITEMS. */
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
  /**
   * Sound. Default true, as in the extension. Browsers hold the AudioContext
   * until a gesture, so the run reports `soundBlocked` and the first keydown or
   * pointerdown unlocks it; `keys` binds M to mute.
   */
  sound?: boolean;
  /** Cursors steer around each other mid-flight. Default true. */
  flocking?: boolean;
  /**
   * Scrolls the page so the work stays in view. Default false, exactly as the
   * extension: the reader scrolls (or presses Tour) and the frontier follows.
   * With `trigger: 'scroll'` and no tour, a long page waits below the fold.
   */
  tour?: boolean;
  /** Palette for the construction lines. 'auto' reads the page background. */
  theme?: 'auto' | 'light' | 'dark';
  /**
   * Seconds to stretch or squeeze the run to; 0 keeps the natural pace.
   * Overrides `speed` for the run, because the pace is now a fixed goal.
   */
  targetDuration?: number;
  /**
   * 'auto' (default) drops guides, heading grow, item seals and most copies once
   * the root holds 250+ elements; 'low' always trims; 'high' never does. Sound is
   * not trimmed: it costs a handful of oscillators a second, not DOM work.
   */
  performanceMode?: 'auto' | 'high' | 'low';
  /**
   * Which order the cursors take the page in.
   * 'rows' (default) splits the page into one horizontal band per cursor. With
   * the default `pick: 'live'` the bands only seed the spawn order — work is
   * priced each frame, so the swarm sweeps the visible screen top to bottom.
   * 'group' keeps a subtree on one cursor and balances the cursors by size,
   * which spreads the swarm over the whole page at once.
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
   * Seed for `order: 'random'` and for the opening cluster's entry points.
   * 0 (default) draws a fresh sequence every run; any other value replays it.
   */
  seed?: number;

  /**
   * What a cursor does while it has nothing to build.
   * 'live' (default) flies it on the extension's own model: velocity integration
   * around a breathing orbit ring (R = 135px ±18%), a tanh swirl, a radial spring
   * clamped to [-2600, 1400], per-cursor curl, and velocity alignment with
   * neighbours inside 90px (0.7 own / 0.3 neighbour). Glyphs lean into their
   * heading and flatten while pressing.
   * 'idle' parks it exactly where its last action landed.
   */
  flight?: FlightMode;
  /**
   * Give every cursor a seeded personality instead of one clone crew. Default
   * true. 'rush' travels and types faster with speed lines behind the arrow,
   * 'tidy' wears a calibration ring and works by the book, 'drift' idles with a
   * "…" bubble and takes its time, 'steady' is the old uniform behaviour. The
   * draw comes from the same per-run rng as the flight parameters, so a seed
   * replays the same team; off assigns 'steady' to everyone and draws nothing.
   */
  personality?: boolean;
  /**
   * Seal every finished item with the initial and colour of the cursor that
   * built it, like a mason's mark on the last brick. Duplicate-stamped copies
   * get their seal too; guides do not. Seals live in their own class and never
   * touch the ⌥ size badge. Default true; the crowded-page trim turns them off.
   */
  stamps?: boolean;
  /**
   * Let the audience direct the build. Default true: while work is under way a
   * click on a cursor urges it (1.8x build clock for ~2.2s, with a halo), and
   * dragging it somewhere else makes its next claim the nearest free job to
   * where the pointer was released. The pointer only ever lands on `.sb-cursor`
   * — rebuilt boxes stay inert — and the controls stay off while gathering,
   * paused or done.
   */
  director?: boolean;
  /**
   * How the real pointer is treated. The pointermove listener is attached when
   * this is not 'ignore', or when `gather` needs it to spot a touch.
   * 'follow' (default) - the orbit centre is the pointer itself, as in the
   * extension; with no pointer on the page the centre drifts.
   * 'repel' - a 48px ring around the pointer shoves cursors out, with an outward
   * impulse when they move into it. Only reads the pointer inside the orbit
   * field, so it needs `flight: 'live'` to do anything.
   * 'ignore' - the swarm never notices the reader.
   */
  pointer?: PointerMode;
  /**
   * Whether the crew size is fixed.
   * 'auto' (default) - agentCount is the floor and 48 the ceiling; the target
   * rises with scroll velocity (every 40px/s) and with half the unlocked work,
   * at most one arrival every 35ms from a random edge, and a cursor that has
   * worked and then sat idle for 2.5s leaves.
   * 'fixed' - exactly agentCount cursors; one hides when its queue empties.
   */
  agents?: AgentPool;
  /**
   * The extension's opening. Default true: 18 cursors fly in from the left and
   * right edges (40-240px out, spread over 5-95% of the viewport height) and
   * orbit the viewport centre at 0.7 of the usual radius; the first `agentCount`
   * of them are the home crew, the rest temps. With `agents: 'fixed'` the
   * opening uses exactly `agentCount` instead. Work is released as soon as the
   * reader wheels, or a cursor comes within 48px of the pointer; left alone it
   * starts after 2.4s. The camera, the crew hiring and the score all wait for
   * that moment.
   */
  gather?: boolean;
  /**
   * How work is claimed.
   * 'live' (default) - the extension's runtime pick: every unlocked task is
   * priced from the cursor (unreached x 1e6 + distance off the visible band x
   * 0.6 + |y - cursorY| x 0.4, guides get a -5e5 bonus) and the cheapest wins, so
   * cursors chase the work in front of them instead of their assigned band.
   * 'queued' - queues are cut up front by `order`; a cursor takes from its own
   * queue and steals only when that queue is blocked.
   */
  pick?: PickMode;
  /**
   * When an item is allowed to be picked up.
   * 'scroll' (default) - only items whose top edge has entered the visible area
   * are ready: the frontier is the bottom of the viewport, exactly where the
   * extension puts it (`frontier = viewBot`). It only ever moves downward, and
   * it needs `tour` or a host that scrolls.
   * 'immediate' - the whole blueprint is open from the first frame.
   */
  trigger?: TriggerMode;
  /**
   * Raise the clock while work piles up: speed x min(1 + backlog x 0.45, 4),
   * recomputed every frame from the unlocked-but-unclaimed count. Default true,
   * as both references pace themselves by the work in front of them; it turns
   * `speed` and `targetDuration` into a floor instead of the pace.
   */
  adaptiveSpeed?: boolean;
  /**
   * How much of the page the capture pass sees.
   * 'pre-scroll' (default) - the extension's pass: wait for fonts and images
   * (bounded), find the element that actually scrolls (a `main{overflow:auto}`
   * page is not the window), walk it down in up to 28 viewport-sized steps so
   * lazy and content-visibility content materialises, return to the top, settle,
   * then capture. It also drops what a real reader cannot see - screen-reader-only
   * boxes, content-visibility:hidden subtrees, closed <details> - and orders
   * items by paint order (z-index, then positioning, then document order).
   * 'single' - one synchronous walk of `root`; what is laid out is what gets built.
   */
  scan?: ScanMode;
  /**
   * The audio layer, once `sound` is on.
   * 'generative' (default) - the extension's score: 104 BPM sixteenth grid,
   * E-minor pentatonic from MIDI 40, glass-piano voices with an inharmonic 2.756
   * partial, box area choosing the octave and x choosing the degree, at most one
   * note per slot and 28 voices live, a generated 3.2s room impulse, key clacks
   * panned by cursor position, an opening swell, and an E-major-add9 strum when
   * the run finishes.
   * 'off' - synthesised key/draw/stamp clicks only.
   */
  score?: ScoreMode;
  /**
   * Behaviour for prefers-reduced-motion: reduce.
   * 'skip' (default) - build nothing, reveal the real page, report immediately.
   * 'run' - animate anyway; this is decoration, not a parallax trap, and the host
   * asked for it.
   */
  reducedMotion?: ReducedMotionMode;
  /**
   * Keyboard shortcuts, default true as in the extension: Escape stops the run
   * and hands the page back, M toggles sound, and any key unlocks audio held by
   * the autoplay policy. Unlike the extension, keystrokes typed into a form
   * field are left alone, so the host's own inputs keep working. Turn it off
   * when the host owns those keys entirely.
   */
  keys?: boolean;
  /**
   * Minimal on-screen HUD for hosts without a keyboard: a progress readout, a
   * touchable skip chip and the "scroll to keep building" hint, pinned to the
   * viewport bottom. Default false — hosts that draw their own chrome (like
   * the tuning panel) keep it off.
   */
  hud?: boolean;
}

export interface SwarmBuilderOptions extends SwarmConfig {
  /** Element whose subtree is rebuilt. Defaults to document.body. */
  root?: HTMLElement;
  /**
   * Where the library stylesheet is injected. Defaults to document; pass the
   * shadow root when `root` lives inside one — document styles do not cross
   * the shadow boundary.
   */
  styleRoot?: Document | ShadowRoot;
  /** Start on the next frame instead of waiting for start(). */
  autoStart?: boolean;
  onStart?: (agents: AgentInfo[]) => void;
  onProgress?: (built: number, total: number) => void;
  onComplete?: (result: SwarmResult) => void;
  /**
   * Called whenever the run's readable state changes, at most every 200ms —
   * the same throttle the extension's HUD refreshes on. The panel and any
   * host-drawn status line read this instead of reaching into the run.
   */
  onStatus?: (status: SwarmStatus) => void;
}

/** Where the run is in its lifecycle; `paused` wins over the phase it froze in. */
export type SwarmPhase = 'idle' | 'scanning' | 'gathering' | 'building' | 'paused' | 'done';

export interface SwarmStatus {
  phase: SwarmPhase;
  /** Items finished so far. */
  built: number;
  /** Items the capture produced, guides included. */
  total: number;
  /** Cursors on stage right now, temps included. */
  agents: number;
  /** Of those, how many are holding a job. */
  busy: number;
  /** The last few cursors holding a job — the extension's row of crew dots. */
  busyCrew: readonly AgentInfo[];
  /** Current clock multiplier, adaptive gate included. */
  speed: number;
  /** Base multiplier before the adaptive gate; the 1x/2x/3x button reads this. */
  pace: number;
  /** Whether sound is enabled (not whether it is audible). */
  sound: boolean;
  /** AudioContext is held by the autoplay policy: one gesture unlocks it. */
  soundBlocked: boolean;
  /** The camera is following the frontier in this run. */
  tour: boolean;
  /**
   * Work is waiting behind the scroll frontier and nothing is ready in front of
   * it — the extension's 「scroll to keep building」 state.
   */
  needsScroll: boolean;
  /** Seconds since start(); frozen once the run is done. */
  elapsed: number;
}

export interface SwarmResult {
  built: number;
  dropped: number;
  /** How many cursors did at least one job, the extension's 「N agents」 count. */
  agents: number;
  durationMs: number;
  /**
   * The seed the run shuffled with. Passing 0 means "draw one", so this is the
   * only place that number can be read back — put it in `seed` to replay.
   */
  seed: number;
}
