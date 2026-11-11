import { describe, expect, it } from 'vitest';
import { applyPerformanceMode, DEFAULT_OPTIONS, normalizeOptions } from '../src/core/config';

describe('stamps option', () => {
  it('is on by default and can be turned off', () => {
    expect(DEFAULT_OPTIONS.stamps).toBe(true);
    expect(normalizeOptions(undefined).stamps).toBe(true);
    expect(normalizeOptions({ stamps: false }).stamps).toBe(false);
  });
});

describe('applyPerformanceMode and seals', () => {
  it('crowded auto runs drop seals', () => {
    const opts = normalizeOptions(undefined);
    applyPerformanceMode(opts, 260);
    expect(opts.stamps).toBe(false);
  });

  it('small auto runs and high mode keep seals', () => {
    const small = normalizeOptions(undefined);
    applyPerformanceMode(small, 200);
    expect(small.stamps).toBe(true);

    const high = normalizeOptions({ performanceMode: 'high' });
    applyPerformanceMode(high, 4000);
    expect(high.stamps).toBe(true);
  });

  it('low mode always drops seals', () => {
    const low = normalizeOptions({ performanceMode: 'low' });
    applyPerformanceMode(low, 10);
    expect(low.stamps).toBe(false);
  });
});
