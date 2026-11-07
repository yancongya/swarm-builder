export type ItemKind = 'rect' | 'text' | 'media' | 'guide';

/**
 * Media is captured at snapshot time because the source element can change or
 * unload while the rebuild is running. `fallback` keeps the grey placeholder,
 * which is what happens for cross-origin canvases and iframes.
 */
export interface MediaPayload {
  mode: 'img' | 'svg' | 'still' | 'fallback';
  src?: string;
  node?: Node;
  dataUrl?: string;
  fit: string;
  position: string;
  radius: string;
  opacity: string;
}

export interface RectStyle {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  borderTop: string;
  borderRight: string;
  borderBottom: string;
  borderLeft: string;
  radius: string;
  boxShadow: string;
  opacity: string;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A repeated sibling (card row, list row, gallery) is built once as the master
 * and then stamped: the copy drags out of the master box and its items appear
 * in one fade instead of being re-drawn and re-typed.
 */
export interface DupPayload {
  master: string;
  from: Box;
  to: Box;
  /** Ids of every item belonging to this copy, in document order. */
  items: string[];
}

/** A layout line three or more elements agree on. */
export interface GuidePayload {
  axis: 'x' | 'y';
  /** Fixed coordinate of the line. */
  pos: number;
  /** Line extent along the other axis. */
  from: number;
  to: number;
}

/** All coordinates are relative to the snapshot root's border box. */
export interface BlueprintItem {
  id: string;
  kind: ItemKind;
  depth: number;
  order: number;
  /** Index of the root child this item belongs to; keeps a subtree on one cursor. */
  group: number;
  /** Nearest ancestor task that must finish first. Always smaller in document order. */
  blockers: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rectStyle?: RectStyle;
  text?: string;
  textStyle?: TextStyle;
  media?: MediaPayload;
  /** Set on the first item of a copy; the rest of its group is `consumed`. */
  dup?: DupPayload;
  /** Never scheduled on its own: a stamp action materialises it. */
  consumed?: boolean;
  /** Guide line geometry. */
  guide?: GuidePayload;
  /** Horizontal offset the item starts at, then settles onto its real x. */
  snapFrom?: number;
  /** Headings grow to their real size while they are typed. */
  grow?: boolean;
  /**
   * Source element is (or sits inside) a `position: fixed` box, so its item
   * coordinates belong to the viewport layer instead of the page layer.
   */
  fixed?: boolean;
}

export interface Blueprint {
  items: BlueprintItem[];
  byId: Map<string, BlueprintItem>;
  width: number;
  height: number;
  /**
   * Where the root sat in the viewport when it was captured. Fixed items are
   * rebuilt in a layer pinned to this point, so they stay put if the reader
   * scrolls while the swarm is working.
   */
  rootOffset: { x: number; y: number };
  dropped: number;
  /** Layout lines added by the guide pass. */
  guides: number;
  /**
   * Painted box covering most of the root, treated as the page backdrop: it is
   * painted on the overlay immediately instead of being animated, so the page
   * never flashes white while the first frames are still being built.
   */
  backdrop?: RectStyle;
}
