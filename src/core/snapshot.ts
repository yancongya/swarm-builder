import type { Blueprint, BlueprintItem, MediaPayload, RectStyle, TextStyle } from './blueprint';
import type { NormalizedOptions } from './config';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'SOURCE', 'TRACK', 'AUDIO', 'BR', 'SLOT']);
const MEDIA_TAGS = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME']);

interface WalkState {
  items: BlueprintItem[];
  idSeq: number;
  groupSeq: number;
  dropped: number;
  limit: number;
}

/**
 * Coordinates are relative to the root's border box, which is what the overlay
 * layer is positioned against, so page scroll during capture stays irrelevant.
 */
export function snapshot(root: HTMLElement, options: NormalizedOptions): Blueprint {
  const rootRect = root.getBoundingClientRect();
  const state: WalkState = { items: [], idSeq: 0, groupSeq: 0, dropped: 0, limit: options.maxItems };

  for (const child of Array.from(root.children)) {
    if ((child as HTMLElement).classList?.contains('sb-overlay')) continue;
    walk(child as HTMLElement, rootRect, [], 0, state, options, state.groupSeq++);
  }

  const backdrop = takeBackdrop(state.items, rootRect.width * rootRect.height);

  return {
    items: state.items,
    width: Math.max(root.scrollWidth, Math.round(rootRect.width)),
    height: Math.max(root.scrollHeight, Math.round(rootRect.height)),
    dropped: state.dropped,
    ...(backdrop ? { backdrop } : {}),
  };
}

/** Removes and returns the first item large enough to read as the page backdrop. */
function takeBackdrop(items: BlueprintItem[], rootArea: number): BlueprintItem['rectStyle'] | undefined {
  const index = items.findIndex(
    (item) => item.kind === 'rect' && item.width * item.height >= rootArea * 0.55,
  );
  if (index < 0) return undefined;
  const [removed] = items.splice(index, 1);
  return removed?.rectStyle;
}

function walk(
  el: Element,
  rootRect: DOMRect,
  ancestorIds: string[],
  depth: number,
  state: WalkState,
  options: NormalizedOptions,
  group: number,
): void {
  if (!isVisible(el) || shouldIgnore(el, options.ignore)) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const box = {
    x: round(rect.left - rootRect.left),
    y: round(rect.top - rootRect.top),
    width: round(rect.width),
    height: round(rect.height),
  };

  const computed = getComputedStyle(el);
  const created: string[] = [];

  if (MEDIA_TAGS.has(el.tagName.toUpperCase())) {
    if (isPainted(computed)) {
      const id = nextId(state);
      pushItem(state, {
        id,
        kind: 'rect',
        depth,
        group,
        blockers: ancestorIds.slice(-1),
        ...box,
        rectStyle: rectStyleOf(computed),
      });
      created.push(id);
    }
    const id = nextId(state);
    pushItem(state, {
      id,
      kind: 'media',
      depth,
      group,
      blockers: [...ancestorIds, ...created].slice(-1),
      ...contentBox(rect, computed, rootRect),
      media: captureMedia(el, computed),
    });
    return;
  }

  if (isPainted(computed)) {
    const id = nextId(state);
    pushItem(state, {
      id,
      kind: 'rect',
      depth,
      group,
      blockers: ancestorIds.slice(-1),
      ...box,
      rectStyle: rectStyleOf(computed),
    });
    created.push(id);
  }

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;

    const measured = measureText(node as Text);
    if (!measured) continue;

    const id = nextId(state);
    pushItem(state, {
      id,
      kind: 'text',
      depth,
      group,
      blockers: [...ancestorIds, ...created].slice(-1),
      x: round(measured.left - rootRect.left),
      y: round(measured.top - rootRect.top),
      width: round(measured.right - measured.left),
      height: round(measured.bottom - measured.top),
      text,
      textStyle: textStyleOf(computed),
    });
    created.push(id);
  }

  const nextAncestors = [...ancestorIds, ...created];
  for (const child of Array.from(el.children)) {
    walk(child, rootRect, nextAncestors, depth + 1, state, options, group);
  }
}

function contentBox(rect: DOMRect, cs: CSSStyleDeclaration, rootRect: DOMRect): { x: number; y: number; width: number; height: number } {
  const left = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
  const top = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
  const right = (parseFloat(cs.borderRightWidth) || 0) + (parseFloat(cs.paddingRight) || 0);
  const bottom = (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return {
    x: round(rect.left - rootRect.left + left),
    y: round(rect.top - rootRect.top + top),
    width: round(rect.width - left - right),
    height: round(rect.height - top - bottom),
  };
}

/** Media is frozen at snapshot time: the live element may change or unload mid-run. */
function captureMedia(el: Element, cs: CSSStyleDeclaration): MediaPayload {
  const tag = el.tagName.toUpperCase();
  const base = {
    fit: cs.objectFit === 'none' ? 'fill' : cs.objectFit,
    position: cs.objectPosition,
    radius: `${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`,
    opacity: cs.opacity,
  };

  if (tag === 'IMG') {
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src;
    return src ? { ...base, mode: 'img', src } : { ...base, mode: 'fallback' };
  }

  if (tag === 'SVG') {
    return { ...base, mode: 'svg', node: el.cloneNode(true) };
  }

  if (tag === 'CANVAS') {
    try {
      return { ...base, mode: 'still', dataUrl: (el as HTMLCanvasElement).toDataURL('image/png') };
    } catch {
      return { ...base, mode: 'fallback' };
    }
  }

  if (tag === 'VIDEO') {
    const video = el as HTMLVideoElement;
    if (!video.videoWidth || !video.readyState) return { ...base, mode: 'fallback' };
    try {
      const frame = document.createElement('canvas');
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frame.getContext('2d')?.drawImage(video, 0, 0);
      return { ...base, mode: 'still', dataUrl: frame.toDataURL('image/png') };
    } catch {
      return { ...base, mode: 'fallback' };
    }
  }

  return { ...base, mode: 'fallback' };
}

function nextId(state: WalkState): string {
  return `i${state.idSeq++}`;
}

function pushItem(state: WalkState, item: Omit<BlueprintItem, 'order'>): void {
  if (state.items.length >= state.limit) {
    state.dropped++;
    return;
  }
  state.items.push({ ...item, order: state.items.length });
}

/** Union of the text node's line boxes, or null when it renders nothing. */
function measureText(node: Text): { left: number; top: number; right: number; bottom: number } | null {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects());
  if (rects.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    if (r.width <= 0) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!Number.isFinite(left) || right - left < 1) return null;
  return { left, top, right, bottom };
}

function isVisible(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return parseFloat(style.opacity) > 0.05;
}

function shouldIgnore(el: Element, ignore: string[]): boolean {
  if (ignore.length === 0) return false;
  return ignore.some((selector) => {
    try {
      return el.matches(selector) || el.closest(selector) !== null;
    } catch {
      return false;
    }
  });
}

function isPainted(style: CSSStyleDeclaration): boolean {
  if (style.boxShadow !== 'none') return true;
  if (style.backgroundImage !== 'none') return true;
  if (hasAlphaColor(style.backgroundColor)) return true;
  return (
    parseFloat(style.borderTopWidth) > 0 ||
    parseFloat(style.borderRightWidth) > 0 ||
    parseFloat(style.borderBottomWidth) > 0 ||
    parseFloat(style.borderLeftWidth) > 0
  );
}

function hasAlphaColor(color: string): boolean {
  if (color === 'transparent') return false;
  const alpha = color.startsWith('rgba') || color.startsWith('hsla');
  if (!alpha) return true;
  const last = color.slice(color.lastIndexOf(',') + 1, -1).trim();
  const value = parseFloat(last);
  return Number.isFinite(value) ? value > 0.01 : true;
}

function rectStyleOf(style: CSSStyleDeclaration): RectStyle {
  return {
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundSize: style.backgroundSize,
    backgroundPosition: style.backgroundPosition,
    borderTop: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
    borderRight: `${style.borderRightWidth} ${style.borderRightStyle} ${style.borderRightColor}`,
    borderBottom: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`,
    borderLeft: `${style.borderLeftWidth} ${style.borderLeftStyle} ${style.borderLeftColor}`,
    radius: `${style.borderTopLeftRadius} ${style.borderTopRightRadius} ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`,
    boxShadow: style.boxShadow,
    opacity: style.opacity,
  };
}

function textStyleOf(style: CSSStyleDeclaration): TextStyle {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    color: style.color,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
