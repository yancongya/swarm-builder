/**
 * 两壳共享骨架：demos/browser.ts（iframe 母本）与 minitool/src/shell.ts（容器 fork）
 * 的案例元数据、标签条、历史栈、地址校验、新标签页骨架、创造者钮与 __browser 吊钩。
 * 容器差异（挂载方式、联网/离线、语言切换的导航写法、状态镜像）留在适配层，经 hooks 注入。
 */
import type { SwarmTuner } from '../src/tune/index';
import { getLang, tr } from './lang';

export interface Case {
  key: string;
  title: string;
  href: string;
  /** GitHub Pages address of this built-in page; the local and offline shells only display it. */
  origin: string;
  /** 用户自己开的标签：地址是他输入的，不是仓库里的文件。 */
  custom?: boolean;
  url?: string;
  mode?: 'blank' | 'rebuild' | 'frame';
}

export const CASES: Case[] = [
  { key: 'home', title: '产品说明页', href: './home.html', origin: 'https://yancongya.github.io/swarm-builder/demos/home.html' },
  { key: 'console', title: '密集控制台', href: './console.html', origin: 'https://yancongya.github.io/swarm-builder/demos/console.html' },
  { key: 'blender', title: 'Blender 工作区', href: './blender.html', origin: 'https://yancongya.github.io/swarm-builder/demos/blender.html' },
];

// 空白页上给三条现成地址：两条站内（切到内置案例），一条真的公网（适配层决定怎么回应）。
export const CHIPS = [
  { label: '这一页自己', href: './home.html' },
  { label: '密集控制台', href: './console.html' },
  { label: 'example.com', href: 'https://example.com' },
];

export function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`browser shell is missing ${selector}`);
  return el;
}

/** 新文案不在母本字典里（demos/dicts 不可改），双语在源码里二选一。 */
export const say = (zh: string, en: string): string => (getLang() === 'en' ? en : zh);

/** 只认 http(s)：`javascript:` 与 `data:` 绝不能进地址流程。 */
export function normalize(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const isPath = text.startsWith('/') || text.startsWith('./') || text.startsWith('../');
  const abs = hasScheme || isPath ? new URL(text, location.href) : new URL(`https://${text}`);
  if (!/^https?:$/.test(abs.protocol)) return '';
  return abs.href;
}

/** 同源就报文件名，公网就报域名 */
export function tabTitle(url: string): string {
  const u = new URL(url);
  if (u.origin === location.origin) return u.pathname.split('/').pop() || u.pathname;
  return u.hostname;
}

export interface ShellHooks {
  /** 挂载当前案例：母本走 iframe，容器走 shadow。 */
  load(): void;
  /** 空白页地址回车：母本去抓页，容器只产离线提示。 */
  navigate(key: string, raw: string): void;
  /** 空白页 chip 点击：母本按地址导航，容器站内切案例、站外离线提示。 */
  chip(href: string): void;
  /** 当前 tuner：创造者钮与 __browser 吊钩共用。 */
  tuner(): SwarmTuner | null;
  /** 用户反馈类提示的写法（容器要粘住几秒）；缺省直接覆写状态行。 */
  hint?(text: string): void;
  /** 新标签页展示时的额外动作（容器把 viewport 限回可视高度）。 */
  blankShown?(c: Case): void;
  /** 创造者面板默认开合：母本开、容器收。 */
  creatorDefault?: boolean;
}

export interface ShellCore {
  readonly cases: Case[];
  readonly params: URLSearchParams;
  readonly hintEl: HTMLElement;
  readonly metaEl: HTMLElement;
  readonly barEl: HTMLElement;
  readonly addrEl: HTMLElement;
  readonly blankInput: HTMLInputElement;
  readonly creatorOn: boolean;
  current(): string;
  caseOf(key: string): Case;
  go(key: string): void;
  openBlank(): string;
  closeTab(key: string): void;
  showBlank(c: Case): void;
  paintChrome(): void;
  setTabTitle(key: string, title: string): void;
  /** load() 的公共前奏：地址条转圈、状态条归 idle、清提示。 */
  beginLoad(): void;
  /** ?u= 分享链接落地址；否则画 chrome 开首局。适配层在自己的初始化末尾调。 */
  boot(): void;
}

export function createShellCore(hooks: ShellHooks): ShellCore {
  const tabsEl = need<HTMLElement>('[data-tabs]');
  const addrEl = need<HTMLElement>('[data-addr]');
  const urlEl = need<HTMLElement>('[data-url]');
  const hintEl = need<HTMLElement>('[data-hint]');
  const metaEl = need<HTMLElement>('[data-meta]');
  const barEl = need<HTMLElement>('[data-statusbar]');
  const creatorBtn = need<HTMLButtonElement>('[data-creator]');
  const backBtn = need<HTMLButtonElement>('[data-back]');
  const fwdBtn = need<HTMLButtonElement>('[data-fwd]');
  const reloadBtn = need<HTMLButtonElement>('[data-reload]');
  const newTabBtn = need<HTMLButtonElement>('[data-newtab]');
  const blankEl = need<HTMLElement>('[data-blank]');
  const blankForm = need<HTMLFormElement>('[data-blank-form]');
  const blankInput = need<HTMLInputElement>('[data-blank-input]');
  const blankChips = need<HTMLElement>('[data-blank-chips]');

  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('case') ?? '';
  // 第一个案例就是打开时看到的那一页：预设页排在 CASES 最前面，不必再抄一遍 key。
  const stack: string[] = [CASES.some((c) => c.key === fromUrl) ? fromUrl : (CASES[0] as Case).key];
  let cursor = 0;
  let customSeq = 0;
  let creatorOn = hooks.creatorDefault ?? true;
  const tabEls = new Map<string, HTMLButtonElement>();

  function caseOf(key: string): Case {
    const found = CASES.find((c) => c.key === key);
    if (!found) throw new Error(`unknown case ${key}`);
    return found;
  }

  function current(): string {
    return stack[cursor] as string;
  }

  function paintChrome(): void {
    const active = current();
    for (const tab of tabsEl.querySelectorAll<HTMLButtonElement>('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.key === active));
    }
    const c = caseOf(active);
    urlEl.textContent = c.custom ? (c.url ?? '') : c.origin;
    params.set('case', active);
    // 自定义标签把地址写进 URL，刷新和分享都回得到同一页；预设页不需要这个参数。
    if (c.custom && c.url) params.set('u', c.url);
    else params.delete('u');
    history.replaceState(null, '', `?${params}`);
    backBtn.disabled = cursor === 0;
    fwdBtn.disabled = cursor >= stack.length - 1;
    // 按钮的按压态跟着真实开关走：默认值改成关以后，HTML 里的初始 aria-pressed 不再可信。
    creatorBtn.setAttribute('aria-pressed', String(creatorOn));
  }

  function makeTab(item: Case): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.dataset.key = item.key;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    const dot = document.createElement('span');
    dot.className = 'fav';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('b');
    label.textContent = tr(item.title);
    tab.append(dot, label);
    if (item.custom) {
      const close = document.createElement('i');
      close.className = 'close';
      close.setAttribute('aria-label', tr('关闭标签'));
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(item.key);
      });
      tab.append(close);
    }
    tab.addEventListener('click', () => go(item.key));
    tabEls.set(item.key, tab);
    return tab;
  }

  for (const item of CASES) tabsEl.append(makeTab(item));

  function showBlank(c: Case): void {
    blankEl.hidden = false;
    hooks.blankShown?.(c);
    blankInput.value = c.url ?? '';
    addrEl.dataset.loading = 'false';
    const hint = hooks.hint ?? ((text: string) => { hintEl.textContent = text; });
    hint(tr('新标签页：输入一个地址，回车就开工'));
    metaEl.textContent = '';
    if (!blankChips.childElementCount) {
      for (const chip of CHIPS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.textContent = tr(chip.label);
        btn.addEventListener('click', () => hooks.chip(chip.href));
        blankChips.append(btn);
      }
    }
    blankInput.focus();
  }

  function openBlank(): string {
    const key = `custom-${++customSeq}`;
    const item: Case = { key, title: '新标签页', href: '', origin: '', custom: true, mode: 'blank' };
    CASES.push(item);
    const tab = makeTab(item);
    tabsEl.append(tab);
    // 标签条在窄屏是要横滚的：新开的这一页得自己滚进视野，不然加号点了像没反应。
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    stack.splice(cursor + 1, stack.length, key);
    cursor = stack.length - 1;
    paintChrome();
    hooks.load();
    return key;
  }

  function closeTab(key: string): void {
    const at = CASES.findIndex((c) => c.key === key);
    if (at === -1 || !CASES[at]?.custom) return;
    const wasCurrent = key === current();
    CASES.splice(at, 1);
    tabEls.get(key)?.remove();
    tabEls.delete(key);
    const keep: string[] = [];
    for (const k of stack) if (k !== key) keep.push(k);
    stack.length = 0;
    stack.push(...(keep.length ? keep : [(CASES[0] as Case).key]));
    cursor = Math.min(cursor, stack.length - 1);
    paintChrome();
    if (wasCurrent) hooks.load();
  }

  function go(key: string): void {
    if (key === current()) return;
    stack.splice(cursor + 1, stack.length, key);
    cursor = stack.length - 1;
    paintChrome();
    hooks.load();
  }

  backBtn.addEventListener('click', () => {
    if (cursor === 0) return;
    cursor -= 1;
    paintChrome();
    hooks.load();
  });
  fwdBtn.addEventListener('click', () => {
    if (cursor >= stack.length - 1) return;
    cursor += 1;
    paintChrome();
    hooks.load();
  });
  reloadBtn.addEventListener('click', () => hooks.load());
  newTabBtn.addEventListener('click', () => openBlank());
  blankForm.addEventListener('submit', (e) => {
    e.preventDefault();
    hooks.navigate(current(), blankInput.value);
  });

  creatorBtn.addEventListener('click', () => {
    creatorOn = !creatorOn;
    creatorBtn.setAttribute('aria-pressed', String(creatorOn));
    const tuner = hooks.tuner();
    if (!tuner) return;
    if (creatorOn) tuner.open();
    else tuner.close();
  });

  window.__browser = {
    get cases() {
      return CASES.map((c) => c.key);
    },
    current,
    tuner: () => hooks.tuner(),
    go,
    openBlank,
    navigate: (key, raw) => hooks.navigate(key, raw),
  };

  return {
    cases: CASES,
    params,
    hintEl,
    metaEl,
    barEl,
    addrEl,
    blankInput,
    get creatorOn() {
      return creatorOn;
    },
    current,
    caseOf,
    go,
    openBlank,
    closeTab,
    showBlank,
    paintChrome,
    setTabTitle(key: string, title: string): void {
      const label = tabEls.get(key)?.querySelector('b');
      if (label) label.textContent = title;
    },
    beginLoad(): void {
      addrEl.dataset.loading = 'true';
      barEl.dataset.phase = 'idle';
      hintEl.textContent = tr('载入中…');
      metaEl.textContent = '';
      blankEl.hidden = true;
    },
    boot(): void {
      // ?u= 让验收和分享链接直接落到某个自定义地址上，不必先点加号再打字。
      const bootUrl = params.get('u');
      if (bootUrl) hooks.navigate(openBlank(), bootUrl);
      else {
        paintChrome();
        hooks.load();
      }
    },
  };
}

declare global {
  interface Window {
    __browser: {
      get cases(): string[];
      current(): string;
      tuner(): SwarmTuner | null;
      go(key: string): void;
      openBlank(): string;
      navigate(key: string, raw: string): void;
    };
  }
}
