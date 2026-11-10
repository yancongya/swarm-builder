import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewBand } from '../src/core/scan';

afterEach(() => vi.unstubAllGlobals());

function page(winH: number) {
  const documentElement = { clientHeight: winH };
  const body = {};
  vi.stubGlobal('window', { innerHeight: winH });
  vi.stubGlobal('document', { documentElement, body });
  return { documentElement, body };
}

const box = (top: number, bottom: number) =>
  ({ getBoundingClientRect: () => ({ top, bottom }) }) as unknown as HTMLElement;

describe('viewBand', () => {
  it('window scroller: band follows the root offset', () => {
    const { documentElement } = page(800);
    const band = viewBand(box(-500, 2400), documentElement as unknown as Element);
    expect(band).toEqual({ top: 500, bottom: 1300, height: 800 });
  });

  it('body scroller is the window path too', () => {
    const { body } = page(800);
    const band = viewBand(box(-500, 2400), body as unknown as Element);
    expect(band).toEqual({ top: 500, bottom: 1300, height: 800 });
  });

  it('null scroller falls back to the window', () => {
    page(900);
    expect(viewBand(box(-200, 4000), null)).toEqual({ top: 200, bottom: 1100, height: 900 });
  });

  it('padded scroller: the 1.9px deadlock regression', () => {
    // 真机几何：窗口 800，滚动层顶被 chrome 垫到 108、底 798。
    // 旧算法按窗口顶算前沿只到 582，y=583.9 的条目永久锁在前沿外。
    page(800);
    const band = viewBand(box(108, 3000), box(108, 798) as unknown as Element);
    expect(band.top).toBe(0);
    expect(band.height).toBe(690);
    expect(band.bottom).toBe(690);
    expect(band.bottom).toBeGreaterThanOrEqual(583.9);
  });

  it('scroller partly below the window: only the visible slice counts', () => {
    page(800);
    const band = viewBand(box(700, 3000), box(700, 1390) as unknown as Element);
    expect(band).toEqual({ top: 0, bottom: 100, height: 100 });
  });

  it('scroller fully above the window: zero-height band', () => {
    page(800);
    const band = viewBand(box(-600, 2000), box(-600, -100) as unknown as Element);
    expect(band.height).toBe(0);
    expect(band.bottom).toBe(band.top);
  });
});