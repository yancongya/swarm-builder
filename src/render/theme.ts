import type { RectStyle } from '../core/blueprint';

const TRANSPARENT = /^(rgba\(0, 0, 0, 0\)|transparent)$/;

export type PageTheme = 'light' | 'dark';

/**
 * The ghost boxes and copy outlines are drawn over whatever the page is painted
 * in, so their ink has to follow the page: a dashed white edge disappears on a
 * light site and a dark one sinks into a dark one.
 */
export function pageTheme(root: HTMLElement, backdrop?: RectStyle): PageTheme {
  const candidates = [
    backdrop?.backgroundColor,
    getComputedStyle(root).backgroundColor,
    getComputedStyle(document.body).backgroundColor,
    getComputedStyle(document.documentElement).backgroundColor,
  ];
  for (const value of candidates) {
    if (!value || TRANSPARENT.test(value)) continue;
    return luminance(value) > 0.5 ? 'light' : 'dark';
  }
  return 'light'; // an unstyled document is painted white
}

function luminance(color: string): number {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return 1;
  const [r, g, b] = parts as [string, string, string];
  return (0.2126 * Number(r) + 0.7152 * Number(g) + 0.0722 * Number(b)) / 255;
}
