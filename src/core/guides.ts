import type { Blueprint, BlueprintItem } from './blueprint';

const BAND_HEIGHT = 900;
const MIN_FONT = 13;
const MIN_WIDTH = 30;
/** How many elements must agree on an edge before it counts as a layout line. */
const MIN_SHARE = 3;
/** Near-miss elements within this distance get pulled onto the line. */
const SNAP_RANGE = 32;
const MIN_SNAP_OFFSET = 6;
/** Only the two biggest headings of a line are worth snapping. */
const MAX_SNAP_MEMBERS = 2;

interface GuideSeed {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
  members: BlueprintItem[];
}

/**
 * Finds the alignment lines a designer would have used: edges shared by three
 * or more text blocks inside the same vertical band. Each line becomes a task
 * that runs just before the elements sitting on it.
 */
export function applyGuides(blueprint: Blueprint, maxGuides: number): number {
  const candidates = blueprint.items.filter(isCandidate);
  const bands = new Map<number, BlueprintItem[]>();
  for (const item of candidates) {
    const band = Math.floor(item.y / BAND_HEIGHT);
    const list = bands.get(band);
    if (list) list.push(item);
    else bands.set(band, [item]);
  }

  const seeds: GuideSeed[] = [];
  for (const band of bands.values()) {
    seeds.push(...collect(band, 'x'));
    seeds.push(...collect(band, 'y'));
  }
  seeds.sort((a, b) => a.axis.localeCompare(b.axis) || a.pos - b.pos);

  let created = 0;
  for (const seed of seeds) {
    if (created >= maxGuides) break;
    const first = seed.members[0] as BlueprintItem;
    const index = blueprint.items.indexOf(first);
    if (index < 0) continue;

    const guide: BlueprintItem = {
      id: `g${created}`,
      kind: 'guide',
      depth: first.depth,
      order: 0,
      group: first.group,
      blockers: [],
      x: seed.axis === 'x' ? seed.pos : seed.from,
      y: seed.axis === 'x' ? seed.from : seed.pos,
      width: seed.axis === 'x' ? 0 : seed.to - seed.from,
      height: seed.axis === 'x' ? seed.to - seed.from : 0,
      guide: { axis: seed.axis, pos: seed.pos, from: seed.from, to: seed.to },
    };
    blueprint.items.splice(index, 0, guide);
    created++;

    // Gating every element on the line would serialise the whole page, so only
    // the two headlines the line actually explains have to wait for it.
    const gated = [...seed.members].sort((a, b) => fontSizeOf(b) - fontSizeOf(a)).slice(0, MAX_SNAP_MEMBERS);
    for (const member of gated) member.blockers.push(guide.id);
    if (seed.axis === 'x') {
      for (const member of nearMisses(seed, candidates)) {
        member.blockers.push(guide.id);
        member.snapFrom = seed.pos - member.x;
      }
    }
  }

  for (const [order, item] of blueprint.items.entries()) item.order = order;
  return created;
}

function isCandidate(item: BlueprintItem): boolean {
  if (item.kind !== 'text' || !item.textStyle) return false;
  return fontSizeOf(item) >= MIN_FONT && item.width > MIN_WIDTH;
}

function collect(band: BlueprintItem[], axis: 'x' | 'y'): GuideSeed[] {
  const buckets = new Map<number, BlueprintItem[]>();
  for (const item of band) {
    const edge = Math.round(axis === 'x' ? item.x : item.y);
    const list = buckets.get(edge);
    if (list) list.push(item);
    else buckets.set(edge, [item]);
  }

  const seeds: GuideSeed[] = [];
  for (const [pos, members] of buckets) {
    if (members.length < MIN_SHARE) continue;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      from = Math.min(from, axis === 'x' ? m.y : m.x);
      to = Math.max(to, axis === 'x' ? m.y + m.height : m.x + m.width);
    }
    seeds.push({ axis, pos, from, to, members });
  }
  return seeds;
}

/**
 * Headings that almost share the line get snapped onto it, so the guide reads
 * as the cause of the alignment instead of as decoration.
 */
function nearMisses(seed: GuideSeed, candidates: BlueprintItem[]): BlueprintItem[] {
  const inside = new Set<BlueprintItem>(seed.members);
  return candidates
    .filter((item) => !inside.has(item))
    .filter((item) => {
      const offset = Math.abs(item.x - seed.pos);
      return offset >= MIN_SNAP_OFFSET && offset <= SNAP_RANGE;
    })
    .filter((item) => item.y >= seed.from - 450 && item.y <= seed.to)
    .sort((a, b) => fontSizeOf(b) - fontSizeOf(a))
    .slice(0, MAX_SNAP_MEMBERS);
}

export function fontSizeOf(item: BlueprintItem): number {
  const size = parseFloat(item.textStyle?.fontSize ?? '0');
  return Number.isFinite(size) ? size : 0;
}
