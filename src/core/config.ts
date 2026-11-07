import type { SwarmBuilderOptions } from '../types';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 8;

export interface NormalizedOptions {
  agentCount: number;
  speed: number;
  ignore: string[];
  maxItems: number;
  duplicate: boolean;
  maxCopies: number;
  guides: boolean;
  maxGuides: number;
  grow: boolean;
  sound: boolean;
  flocking: boolean;
  targetDuration: number;
  performanceMode: 'auto' | 'high' | 'low';
  moveSpeed: number;
  typeInterval: number;
  fadeDuration: number;
}

// Tunables are grouped here so later phases can expose them as public config.
export function normalizeOptions(options: SwarmBuilderOptions | undefined): NormalizedOptions {
  return {
    agentCount: Math.round(clamp(options?.agentCount ?? 6, 1, 24)),
    speed: clamp(options?.speed ?? 1, SPEED_MIN, SPEED_MAX),
    ignore: normalizeIgnore(options?.ignore),
    maxItems: Math.round(clamp(options?.maxItems ?? 400, 1, 5000)),
    duplicate: options?.duplicate ?? true,
    maxCopies: Math.round(clamp(options?.maxCopies ?? 12, 1, 48)),
    guides: options?.guides ?? true,
    maxGuides: Math.round(clamp(options?.maxGuides ?? 16, 0, 64)),
    grow: options?.grow ?? true,
    sound: options?.sound ?? false,
    flocking: options?.flocking ?? true,
    targetDuration: clamp(options?.targetDuration ?? 0, 0, 120),
    performanceMode: options?.performanceMode ?? 'auto',
    moveSpeed: 2200,
    typeInterval: 28,
    fadeDuration: 140,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Measured at 1280x900: 55 nodes -> 58 items holds every frame for a 6.8s run,
 * and 355 nodes -> 367 items still holds every frame but runs for 38s. Frame
 * rate is not what breaks on a crowded page - the choreography drags and turns
 * into noise - so auto trims the effects that add per-item work and visual
 * clutter once the page is past that scale.
 */
const CROWDED_NODES = 250;

export function applyPerformanceMode(opts: NormalizedOptions, elementCount: number): void {
  if (opts.performanceMode === 'high') return;
  if (opts.performanceMode === 'auto' && elementCount < CROWDED_NODES) return;
  opts.guides = false;
  opts.grow = false;
  opts.sound = false;
  opts.maxCopies = Math.min(opts.maxCopies, 6);
}

function normalizeIgnore(ignore: string | string[] | undefined): string[] {
  if (!ignore) return [];
  const list = Array.isArray(ignore) ? ignore : [ignore];
  return list.filter((selector) => typeof selector === 'string' && selector.trim().length > 0);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
