export type ItemKind = 'rect' | 'text' | 'media';

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
}

export interface Blueprint {
  items: BlueprintItem[];
  width: number;
  height: number;
  dropped: number;
  /**
   * Painted box covering most of the root, treated as the page backdrop: it is
   * painted on the overlay immediately instead of being animated, so the page
   * never flashes white while the first frames are still being built.
   */
  backdrop?: RectStyle;
}
