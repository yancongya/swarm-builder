import type { SwarmBuilderOptions } from '../types';

export interface NormalizedOptions {
  agentCount: number;
  speed: number;
  ignore: string[];
  maxItems: number;
  moveSpeed: number;
  typeInterval: number;
  fadeDuration: number;
}

// Tunables are grouped here so later phases can expose them as public config.
export function normalizeOptions(options: SwarmBuilderOptions | undefined): NormalizedOptions {
  return {
    agentCount: Math.round(clamp(options?.agentCount ?? 6, 1, 24)),
    speed: clamp(options?.speed ?? 1, 0.25, 8),
    ignore: options?.ignore ? [options.ignore] : [],
    maxItems: Math.round(clamp(options?.maxItems ?? 400, 1, 5000)),
    moveSpeed: 2200,
    typeInterval: 28,
    fadeDuration: 140,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
