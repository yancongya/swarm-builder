import type { SwarmBuilderOptions } from '../types';
import type { Lang } from './locale';

/** The serialisable half of the options: `root` is an element and the callbacks are functions. */
export type PlainConfig = Omit<SwarmBuilderOptions, 'root' | 'autoStart' | 'onStart' | 'onProgress' | 'onComplete'>;

export const DEFAULT_CONFIG: Required<PlainConfig> = {
  agentCount: 6,
  speed: 1,
  targetDuration: 0,
  performanceMode: 'auto',
  order: 'group',
  balance: false,
  seed: 0,
  ignore: [],
  maxItems: 400,
  duplicate: true,
  maxCopies: 12,
  guides: true,
  maxGuides: 16,
  grow: true,
  sound: false,
  flocking: true,
  tour: false,
  theme: 'auto',
  flight: 'idle',
  pointer: 'ignore',
  agents: 'fixed',
  pick: 'queued',
  trigger: 'immediate',
  adaptiveSpeed: false,
  scan: 'single',
  score: 'off',
  reducedMotion: 'run',
};

const KEYS = Object.keys(DEFAULT_CONFIG) as (keyof PlainConfig)[];

export function pickPlain(source: SwarmBuilderOptions): PlainConfig {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out as PlainConfig;
}

/** The panel is chrome, not content: it must never end up in an exported production config. */
export const CHROME_SELECTOR = '[data-sb-chrome]';

export function withoutChrome(ignore: string[]): string[] {
  return ignore.filter((selector) => selector !== CHROME_SELECTOR);
}

function literal(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

function same(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.join('\u0000') === b.join('\u0000') : a === b;
}

export function describeRoot(root: HTMLElement): { selector: string; guessed: boolean } {
  if (root === document.body) return { selector: 'body', guessed: false };
  if (root.id) return { selector: `#${CSS.escape(root.id)}`, guessed: false };
  return { selector: '#app', guessed: true };
}

/**
 * Emits code rather than JSON so the same click serves both a human pasting into
 * a file and an agent asked to apply the settings. Only values that differ from
 * the defaults are listed, which keeps the snippet short and teaches the defaults.
 */
export function buildSnippet(config: PlainConfig, root: { selector: string; guessed: boolean }, lang: Lang = 'zh'): string {
  const en = lang === 'en';
  const rows = [`  root: document.querySelector('${root.selector}'),${root.guessed ? (en ? ' // guessed - swap in your own container' : ' // 猜的：换成你的容器') : ''}`];
  for (const key of KEYS) {
    const value = config[key];
    if (value === undefined || same(value, DEFAULT_CONFIG[key])) continue;
    rows.push(key === 'ignore' ? `  ignore: ${literal(withoutChrome(value as string[]))},` : `  ${key}: ${literal(value)},`);
  }
  return [
    en
      ? '// Exported by swarm-builder creator mode; only options that differ from the defaults are listed.'
      : '// 由 swarm-builder 创造者模式导出，只列出与默认值不同的选项。',
    "import { SwarmBuilder } from 'swarm-builder';",
    '',
    'const swarm = new SwarmBuilder({',
    ...rows,
    '});',
    'swarm.start();',
    '',
  ].join('\n');
}