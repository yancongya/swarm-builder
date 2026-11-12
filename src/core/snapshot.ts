import type { Blueprint, BlueprintItem, Box, DupPayload, MediaPayload, RectStyle, TextStyle } from './blueprint';
import type { NormalizedOptions } from './config';
import { applyGuides } from './guides';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'SOURCE', 'TRACK', 'AUDIO', 'BR', 'SLOT']);
const MEDIA_TAGS = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME']);
/** A node this deep in a subtree is too specific to read as a repeated pattern. */
const MAX_DUP_ITEMS = 48;
/** A paragraph longer than this is worth typing, so its node is never copied. */
const MAX_DUP_TEXT = 40;

/** One element plus every item its subtree produced: a duplicate candidate. */
interface Candidate {
  parent: Element;
  signature: string;
  box: Box;
  ids: string[];
  kinds: string;
  longText: boolean;
}

interface WalkState {
  items: BlueprintItem[];
  candidates: Candidate[];
  idSeq: number;
  groupSeq: number;
  dropped: number;
  limit: number;
  /** 预滚动采集才编号：按绘制序排，后盖的压在先盖的上面。 */
  strict: boolean;
}

/**
 * Coordinates are relative to the root's border box, which is what the overlay
 * layer is positioned against, so page scroll during capture stays irrelevant.
 */
export function snapshot(root: HTMLElement, options: NormalizedOptions): Blueprint {
  const rootRect = root.getBoundingClientRect();
  const strict = options.scan === 'pre-scroll';
  const state: WalkState = {
    items: [],
    candidates: [],
    idSeq: 0,
    groupSeq: 0,
    dropped: 0,
    limit: options.maxItems,
    strict,
  };

  for (const child of Array.from(root.children)) {
    if ((child as HTMLElement).classList?.contains('sb-overlay')) continue;
    walk(child as HTMLElement, rootRect, [], 0, state, options, state.groupSeq++, false, 0);
  }

  if (strict) state.items.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  const backdrop = takeBackdrop(state.items, rootRect.width * rootRect.height);
  const blueprint: Blueprint = {
    items: state.items,
    byId: new Map(),
    width: Math.max(root.scrollWidth, Math.round(rootRect.width)),
    height: Math.max(root.scrollHeight, Math.round(rootRect.height)),
    rootOffset: { x: rootRect.left, y: rootRect.top },
    dropped: state.dropped,
    guides: 0,
    ...(backdrop ? { backdrop } : {}),
  };
  for (const item of state.items) blueprint.byId.set(item.id, item);

  if (options.duplicate) applyDuplicates(state.candidates, blueprint.byId, options.maxCopies);
  if (options.guides) blueprint.guides = applyGuides(blueprint, options.maxGuides);
  for (const item of state.items) if (!blueprint.byId.has(item.id)) blueprint.byId.set(item.id, item);

  return blueprint;
}

/**
 * Repeated siblings keep only their first instance as a real task; the rest
 * become stamp tasks that drag out of the master box and reveal their items at
 * once. Bucketing is per parent, so "same shape" means "same row of cards".
 */
function applyDuplicates(candidates: Candidate[], byId: Map<string, BlueprintItem>, maxCopies: number): void {
  const eligible = candidates.filter((c) => c.ids.length > 0 && c.ids.length <= MAX_DUP_ITEMS && !c.longText);

  for (const [, bucket] of groupByParent(eligible)) {
    for (const group of bucket.values()) {
      if (group.length < 2) continue;
      const master = group[0] as Candidate;
      const similar = group.slice(1).filter((copy) => isSimilarBox(master.box, copy.box, master.kinds === copy.kinds && master.kinds === 'text'));
      for (const copy of similar.slice(0, maxCopies)) {
        const root = byId.get(copy.ids[0] as string);
        const masterRoot = master.ids[0];
        if (!root || !masterRoot) continue;
        const payload: DupPayload = { master: masterRoot, from: master.box, to: copy.box, items: copy.ids.slice() };
        root.dup = payload;
        root.blockers = [masterRoot];
        for (const id of copy.ids.slice(1)) {
          const item = byId.get(id);
          if (item) item.consumed = true;
        }
      }
    }
  }
}

function groupByParent(candidates: Candidate[]): Map<Element, Map<string, Candidate[]>> {
  const out = new Map<Element, Map<string, Candidate[]>>();
  for (const c of candidates) {
    let bucket = out.get(c.parent);
    if (!bucket) {
      bucket = new Map();
      out.set(c.parent, bucket);
    }
    const group = bucket.get(c.signature);
    if (group) group.push(c);
    else bucket.set(c.signature, [c]);
  }
  return out;
}

/** Repeated cards keep their size; repeated labels only keep their line height. */
function isSimilarBox(a: Box, b: Box, textOnly: boolean): boolean {
  const ratio = (x: number, y: number): number => {
    const big = Math.max(x, y);
    return big <= 0 ? 1 : Math.abs(x - y) / big;
  };
  if (ratio(a.height, b.height) > 0.15) return false;
  if (textOnly) return true;
  return ratio(a.width, b.width) <= 0.15;
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
  insideFixed: boolean,
  parentTop: number,
): void {
  if (!isVisible(el, options.scan === 'pre-scroll') || shouldIgnore(el, options.ignore)) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const box = {
    x: round(rect.left - rootRect.left),
    y: round(rect.top - rootRect.top),
    width: round(rect.width),
    height: round(rect.height),
  };

  const computed = getComputedStyle(el);
  const fixed = insideFixed || computed.position === 'fixed';
  // 层号取祖先链上最大的那个：一个 z-index:10 的卡片里的文字，画得比同级
  // 那个没有层的卡片晚，跟浏览器实际盖谁在上面一致。
  const ownZ = computed.position === 'static' || computed.zIndex === 'auto'
    ? 0
    : Math.round(parseFloat(computed.zIndex) || 0);
  const topHere = Math.max(parentTop, ownZ);
  const positioned = computed.position !== 'static';
  const created: string[] = [];
  const itemStart = state.items.length;

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
        ...(fixed ? { fixed: true } : {}),
      }, topHere, positioned);
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
      ...(fixed ? { fixed: true } : {}),
    }, topHere, positioned);
    recordCandidate(el, state, itemStart, depth, box);
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
      ...(fixed ? { fixed: true } : {}),
    }, topHere, positioned);
    created.push(id);
  }

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const raw = node.textContent ?? '';
    const clipText = computed.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2;
    const end = clipText ? visibleTextEnd(node as Text, rect.bottom - (parseFloat(computed.paddingBottom) || 0)) : raw.length;
    const source = raw.slice(0, end);
    const text = computed.whiteSpace.startsWith('pre') ? source.trimEnd() : source.replace(/\s+/g, ' ').trim();
    if (text.length === 0) continue;

    const measured = measureText(node as Text, end);
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
      width: round(clipText ? Math.min(measured.right - measured.left, rect.width - (parseFloat(computed.paddingLeft) || 0) - (parseFloat(computed.paddingRight) || 0)) : measured.right - measured.left),
      height: round(clipText ? Math.min(measured.bottom - measured.top, rect.bottom - measured.top) : measured.bottom - measured.top),
      text,
      textStyle: textStyleOf(computed),
      ...(clipText ? { clipText: true } : {}),
      grow: shouldGrow(computed, round(measured.bottom - measured.top)),
      ...(fixed ? { fixed: true } : {}),
    }, topHere, positioned);
    created.push(id);
  }

  const nextAncestors = [...ancestorIds, ...created];
  for (const child of Array.from(el.children)) {
    walk(child, rootRect, nextAncestors, depth + 1, state, options, group, fixed, topHere);
  }

  recordCandidate(el, state, itemStart, depth, box);
}

function recordCandidate(el: Element, state: WalkState, from: number, depth: number, box: Box): void {
  const ids: string[] = [];
  const kinds: string[] = [];
  let longText = false;
  for (let index = from; index < state.items.length; index++) {
    const item = state.items[index] as BlueprintItem;
    ids.push(item.id);
    kinds.push(item.kind[0] as string);
    if (item.kind === 'text' && (item.text?.length ?? 0) > MAX_DUP_TEXT) longText = true;
  }
  if (ids.length === 0) return;

  const classes = Array.from(el.classList).sort().join(' ');
  state.candidates.push({
    parent: el.parentElement ?? el,
    signature: `${el.tagName.toUpperCase()}.${classes}.${depth}.${kinds.join('')}`,
    box,
    ids,
    kinds: kinds.join(''),
    longText,
  });
}

/** Large headings are the ones worth growing into place while they are typed. */
function shouldGrow(cs: CSSStyleDeclaration, height: number): boolean {
  const size = parseFloat(cs.fontSize);
  return Number.isFinite(size) && size >= 28 && height < 400;
}

function contentBox(rect: DOMRect, cs: CSSStyleDeclaration, rootRect: DOMRect): { x: number; y: number; width: number; height: number } {  const left = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
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

function pushItem(state: WalkState, item: Omit<BlueprintItem, 'order'>, top: number, positioned: boolean): void {
  if (state.items.length >= state.limit) {
    state.dropped++;
    return;
  }
  const order = state.items.length;
  // 一个整数键排绘制序：层号权重最大，其次「自己参与层叠」，最后文档顺序。
  const z = top * 1e7 + (positioned ? 5e6 : 0) + order;
  state.items.push({ ...item, order, ...(state.strict ? { z } : {}) });
}

/** Union of the text node's line boxes, or null when it renders nothing. */
function measureText(node: Text, end = node.length): { left: number; top: number; right: number; bottom: number } | null {
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, end);
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

/** The Range of a scrollable text node includes lines the reader cannot see. */
function visibleTextEnd(node: Text, bottom: number): number {
  let low = 0;
  let high = node.length;
  const range = document.createRange();
  range.setStart(node, 0);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    range.setEnd(node, mid);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
    const last = rects[rects.length - 1];
    if (!last || last.bottom <= bottom + 0.5) low = mid;
    else high = mid - 1;
  }
  return low;
}

function isVisible(el: Element, strict: boolean): boolean {
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (strict && isReaderOnly(el, style)) return false;
  return parseFloat(style.opacity) > (strict ? 0.03 : 0.05);
}

/**
 * 预滚动采集多剔的三类：读者在页面上根本看不到的东西，浏览器扩展不会给它拍照，
 * 我们也不该给它一个光标。
 * - `.sr-only` 那类只喂读屏软件的盒子（clip 收成 0 或 inset(50%)）
 * - `content-visibility: hidden` 而滚动也没让它现身的子树（滚过之后浏览器会改写这个值）
 * - 没展开的 `<details>` 里的内容
 */
function isReaderOnly(el: Element, style: CSSStyleDeclaration): boolean {
  const clip = style.clip;
  if (clip && clip !== 'auto' && /rect\(\s*0(px)?\s*,\s*0(px)?\s*,\s*0(px)?\s*,\s*0(px)?\s*\)/.test(clip)) return true;
  if (/inset\(\s*50%/.test(style.clipPath)) return true;
  if (style.contentVisibility === 'hidden') return true;
  const details = el.closest('details');
  return details !== null && !(details as HTMLDetailsElement).open;
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
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
