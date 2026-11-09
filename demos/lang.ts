/**
 * 演示站的双语引擎。
 *
 * 页面里写死的仍然是中文——中文是源码，字典只负责在切到 EN 时把文本节点换掉。
 * 这样做的好处是：不加 data-i18n 键、不重写任何一页的 DOM，验收里那些「完成」「读不懂」
 * 之类的中文断言也照旧成立（默认语言一直是 zh）。
 */
import { DICTS } from './lang-data';

export type Lang = 'zh' | 'en';

export const LANG_STORAGE = 'sb-lang';

// 中文标点（、〜〿）、汉字（㐀-鿿）与全角形式（！-￯）。
// 区间不从 U+3000 起：那是全角空格，抄进字面量会退化成普通空格，区间一下盖住整个 ASCII。
const CJK = /[、-〿㐀-鿿！-￯]/;

/** 优先级：URL 上的 ?lang= > 上次记的选择 > 中文。 */
export function getLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl;
  try {
    const stored = localStorage.getItem(LANG_STORAGE);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    // 无痕模式 / srcdoc 里被禁：读不到就当没记过。
  }
  return 'zh';
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE, lang);
  } catch {
    // 存不下也只是下次回到默认值。
  }
}

/** 比对的键：内部空白折叠成单个空格，首尾空白去掉——HTML 里的缩进不该影响命中。 */
function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tableFor(key: string): Map<string, string> {
  const cached = TABLES.get(key);
  if (cached) return cached;
  const built = new Map((DICTS[key] ?? []).map(([zh, en]) => [zh, en]));
  TABLES.set(key, built);
  return built;
}

const TABLES = new Map<string, Map<string, string>>();

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

/** 换掉一棵子树；返回命中的条数。 */
export function applyLang(root: ParentNode, langKey: string): { hit: number; missed: string[] } {
  const dict = tableFor(langKey);
  let hit = 0;

  const seen = new Set<string>();
  const walk = (node: Node) => {
    if (node.nodeType === 8) return;
    if (node.nodeType === 3) {
      const raw = node.textContent ?? '';
      if (!CJK.test(raw)) return;
      const mapped = dict.get(norm(raw));
      if (mapped === undefined) {
        if (!seen.has(raw)) {
          seen.add(raw);
          missed.push(norm(raw));
        }
        return;
      }
      node.textContent = mapped;
      hit += 1;
      return;
    }
    if (node.nodeType === 1) {
      const el = node as Element;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      // 自带双语内容的块（比如那段给 AI 的提示词）自己管自己，别让字典插一脚。
      if (el.hasAttribute('data-i18n-skip')) return;
      for (const name of ATTRS) {
        const value = el.getAttribute(name);
        if (!value || !CJK.test(value)) continue;
        const mapped = dict.get(norm(value));
        if (mapped === undefined) missed.push(norm(value));
        else el.setAttribute(name, mapped);
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };

  const missed: string[] = [];
  walk(root);

  const title = document.querySelector('title');
  if (title && CJK.test(title.textContent ?? '')) {
    const mapped = dict.get(norm(title.textContent ?? ''));
    if (mapped !== undefined) title.textContent = mapped;
    else if (title.textContent) missed.push(norm(title.textContent));
  }
  return { hit, missed };
}

/** 这一页当前该用哪套字典：默认按文件名取，外壳可以用 data-lang-key 指名。 */
function langKey(): string {
  const explicit = document.body?.getAttribute('data-lang-key');
  if (explicit) return explicit;
  return location.pathname.split('/').pop()?.replace(/\.html?$/, '') ?? '';
}

const KEY = langKey();

/**
 * 运行时才写进 DOM 的句子（外壳的提示、标签标题）走这里：源码写中文，
 * 切到 EN 时按同一套字典查英文。查不到就退回中文——少一条不会白屏，只是那一行还是中文。
 */
export function tr(text: string): string {
  if (getLang() === 'zh') return text;
  return tableFor(KEY).get(norm(text)) ?? text;
}

/** 带插空的句子：两边语言都用 {0} 占位，查完字典再填。 */
export function trf(text: string, ...args: (string | number)[]): string {
  return tr(text).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

const lang = getLang();
document.documentElement.lang = lang === 'en' ? 'en' : 'zh';
const report = lang === 'en' ? applyLang(document.documentElement, KEY) : { hit: 0, missed: [] };

declare global {
  interface Window {
    __sbI18n: { lang: Lang; key: string; hit: number; missed: string[] };
  }
}
window.__sbI18n = { lang, key: KEY, ...report };
