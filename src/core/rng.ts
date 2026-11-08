/**
 * A seed is only useful if it reproduces, so the generator has to be stable
 * across engines and platforms: Math.random() can neither be seeded nor
 * replayed. mulberry32 is four lines and enough for shuffling a build order.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array; the input keeps its document order. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1));
    const held = out[index] as T;
    out[index] = out[swap] as T;
    out[swap] = held;
  }
  return out;
}

/**
 * The seed the caller passed, or a fresh one when they asked for "different
 * each run" (0). Returned so the run can report which number it actually used.
 */
export function resolveSeed(seed: number): number {
  return seed > 0 ? seed : 1 + Math.floor(Math.random() * (2 ** 31 - 1));
}
