import type { Blueprint, BlueprintItem } from './blueprint';
import type { NormalizedOptions } from './config';
import { clamp } from './config';

const MIN_MOVE_MS = 80;
const MAX_MOVE_MS = 420;
const MAX_TYPE_MS = 700;
const HOLD_MS = 260;
const STAMP_BASE_MS = 160;
const STAMP_MIN_MS = 180;
const STAMP_MAX_MS = 460;
const STAMP_REVEAL_MS = 120;
const GUIDE_DRAW_MS = 160;
const GUIDE_DROP_MS = 170;
const SNAP_MS = 180;
// The model prices the choreographed actions only. Measured at speed 1 on the
// three demo pages, the real run is 1.28x-1.69x longer (22 items: 2.24s vs
// 3.79s; 58: 6.81s vs 8.71s; 100: 6.99s vs 11.47s) because an agent burns whole
// frames at each action boundary and idles while its next item waits on a
// blocked ancestor. That gap scales with the page, so it is folded in as one
// calibration factor: the mid value leaves every measured page within 15%.
const PACE_CALIBRATION = 1.45;

/**
 * Predicts the wall-clock length of a run at speed 1 by walking the queues the
 * scheduler will actually hand out: cursors work in parallel, so the longest
 * queue is the run. `targetDuration` turns this into a speed multiplier.
 */
export function estimateRun(blueprint: Blueprint, opts: NormalizedOptions, queues: readonly (readonly BlueprintItem[])[]): number {
  let longest = 0;
  for (const queue of queues) {
    const head = queue[0];
    // Mirrors where api.ts drops a cursor: near its first item, not at a corner.
    let x = head ? head.x + 140 : blueprint.width / 2;
    let y = head ? head.y + 90 : blueprint.height / 2;
    let ms = 0;
    for (const item of queue) {
      ms += itemCost(item, opts, x, y);
      x = item.x + item.width;
      y = item.y + item.height;
    }
    longest = Math.max(longest, ms);
  }
  return Math.round(longest * PACE_CALIBRATION);
}

/**
 * The part of an item's cost that does not depend on where the cursor came
 * from. Feeding this to the scheduler's bin packing is what `balance` is:
 * estimated milliseconds per item, not item counts.
 */
export function itemWeight(item: BlueprintItem, opts: NormalizedOptions): number {
  return itemCost(item, opts, item.x, item.y);
}

function itemCost(item: BlueprintItem, opts: NormalizedOptions, fromX: number, fromY: number): number {
  const targetX = item.dup && !item.consumed ? item.dup.from.x : item.x;
  const targetY = item.dup && !item.consumed ? item.dup.from.y : item.y;
  const distance = Math.hypot(targetX - fromX, targetY - fromY);
  let ms = clamp((distance / opts.moveSpeed) * 1000, MIN_MOVE_MS, MAX_MOVE_MS);

  if (item.kind === 'guide') return ms + GUIDE_DRAW_MS + GUIDE_DROP_MS;

  if (item.dup) {
    const travel = Math.hypot(item.dup.to.x - item.dup.from.x, item.dup.to.y - item.dup.from.y);
    return ms + clamp(STAMP_BASE_MS + travel * 0.35, STAMP_MIN_MS, STAMP_MAX_MS) + STAMP_REVEAL_MS;
  }

  if (item.kind === 'text') {
    ms += Math.min(MAX_TYPE_MS, Math.max(160, (item.text ?? '').length * opts.typeInterval)) + HOLD_MS;
  } else {
    ms += Math.max(90, Math.min(380, 90 + (item.width + item.height) * 0.22));
    ms += item.kind === 'media' ? opts.fadeDuration * 1.6 : opts.fadeDuration;
  }
  if (item.snapFrom) ms += SNAP_MS;
  return ms;
}
