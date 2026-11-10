import type { SwarmTuner } from '../src/tune/index';
import { getLang, setLang, tr, trf } from './lang';

interface Case {
  key: string;
  title: string;
  href: string;
  /** The address the mockup shows, so a case reads like a site rather than a file. */
  origin: string;
  /** 用户自己开的标签：地址是他输入的，不是仓库里的文件。 */
  custom?: boolean;
  url?: string;
  mode?: 'blank' | 'rebuild' | 'frame';
}

const CASES: Case[] = [
  { key: 'home', title: '产品说明页', href: './home.html', origin: 'https://swarm-builder.dev' },
  { key: 'simple', title: '简单页基准', href: './simple.html', origin: 'https://swarm.demo' },
  { key: 'console', title: '密集控制台', href: './console.html', origin: 'https://orbit.demo/console' },
  { key: 'landing', title: '深色落地页', href: './landing.html', origin: 'https://nova.demo' },
  { key: 'dark-ui', title: '复杂工作台', href: './dark-ui.html', origin: 'https://studio.demo' },
  { key: 'tall', title: '长页面跟随', href: './tall.html', origin: 'https://notes.demo/long' },
  { key: 'tune', title: '别人的站点', href: './tune.html', origin: 'https://letterpress.demo' },
];

// 空白页上给三条现成地址：两条同源（一定能重建），一条真的公网（多半只能显示）。
const CHIPS = [
  { label: '这一页自己', href: './home.html' },
  { label: '别人的站点', href: './tune.html' },
  { label: 'example.com', href: 'https://example.com' },
];
function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`mockup browser shell is missing ${selector}`);
  return el;
}

const tabsEl = need<HTMLElement>('[data-tabs]');
const frame = need<HTMLIFrameElement>('[data-frame]');
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
const langBtn = need<HTMLButtonElement>('[data-lang]');
const blankEl = need<HTMLElement>('[data-blank]');
const blankForm = need<HTMLFormElement>('[data-blank-form]');
const blankInput = need<HTMLInputElement>('[data-blank-input]');
const blankChips = need<HTMLElement>('[data-blank-chips]');

const params = new URLSearchParams(location.search);
const fromUrl = params.get('case') ?? '';
// 第一个案例就是打开时看到的那一页：预设页排在 CASES 最前面，不必再抄一遍 key。
const stack: string[] = [CASES.some((c) => c.key === fromUrl) ? fromUrl : (CASES[0] as Case).key];
let cursor = 0;
let generation = 0;
let customSeq = 0;
let tuner: SwarmTuner | null = null;
let creatorOn = true;
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

function nextLoad(): Promise<void> {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 转发口那条路的新文案自己管双语（跟 prompt.ts 一样按 getLang 二选一）：
 * 字典 index.ts 管的是外壳原有的静态文案与老提示，这里不往里加键。
 */
const say = (zh: string, en: string): string => (getLang() === 'en' ? en : zh);

/** 直连只有同源/CORS 站点能成，快进快出；转发口那边可能要开无头浏览器，给它留够时间。 */
const DIRECT_TIMEOUT_MS = 8000;
const RELAY_TIMEOUT_MS = 50000;

/**
 * 转发口的地址。?relay=off / ?relay=fail 是开发期的探针开关，原样传给 /__page：
 * off 完全不走无头渲染，fail 让无头那一步必然失败——用来量「没有无头浏览器时外壳还工不工作」。
 */
function relayHref(url: string): string {
  const knob = params.get('relay');
  const render = knob === 'off' || knob === 'fail' || knob === 'auto' ? `&render=${knob}` : '';
  return `${location.origin}/__page?url=${encodeURIComponent(url)}${render}`;
}

/** 转发口交回来的一页正文，外加它是怎么拿到的——外壳照实转述，不假装每次都是无头渲染。 */
interface GrabbedPage {
  html: string;
  base: string;
  render: string;
  note: string;
}

/** 走了哪条路取到正文，就照实说哪条：这是开发工具，不假装每次都是无头渲染。 */
let relayPath = '';
function relayLabel(): string {
  if (relayPath === 'headless') return say('无头渲染', 'headless render');
  if (relayPath === 'fallback') return say('无头没成，退回静态 HTML', 'headless failed, static HTML');
  if (relayPath === 'fetch') return say('静态 HTML', 'static HTML');
  if (relayPath === 'direct') return say('直连', 'direct fetch');
  return '';
}

/**
 * 重建那一次导航不能死等 `load`：`load` 要等页面上每一个子资源返回，
 * 而第三方站点的一张外链图片挂住（不失败、也不回来）就把整次构建卡死在这里。
 * 改为认这一页自己的就绪状态——先确认换的是我们那份文档（`data-sb-rebuild` 是
 * wrapForRebuild 打的标记，用来躲开上一份 about:blank 的假阳性），再让样式与图片
 * 落一点地。上限之外无论如何都往下走：读得到 DOM 就盖，读不到的部分由重建自己补救。
 */
async function waitRebuildReady(limitMs: number): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (performance.now() < deadline) {
    const doc = frame.contentDocument;
    if (doc?.documentElement.dataset.sbRebuild === '1' && doc.readyState !== 'loading') break;
    await sleep(50);
  }
  await sleep(250);
}

// The case page creates its own tuner from a module script, which lands after load.
// 冷启动时这份文档要现编译整条 /src 依赖图，8 秒不够——那不等于「装不上」，
// 只是还没装上。等到上限之前先认 `__tunerBoot`（启动脚本自己报的失败），
// 有了它才立刻收工，没有就继续等，上限只是「永远装不上」的兜底。
function waitForTuner(limitMs: number): Promise<{ tuner: SwarmTuner | null; bootError: string }> {
  const mine = generation;
  return new Promise((resolve) => {
    let waited = 0;
    const poll = () => {
      const win = frame.contentWindow as (Window & { __tuner?: SwarmTuner; __tunerBoot?: string }) | null;
      if (win?.__tuner) resolve({ tuner: win.__tuner, bootError: '' });
      else if (win?.__tunerBoot) resolve({ tuner: null, bootError: win.__tunerBoot });
      else if (mine !== generation || waited > limitMs) resolve({ tuner: null, bootError: '' });
      else {
        waited += 40;
        setTimeout(poll, 40);
      }
    };
    poll();
  });
}

/** 案例页自带 lang.ts，语言靠 ?lang= 传进去；不带参数的 href 直接加一个。 */
function withLang(href: string): string {
  const url = new URL(href, location.href);
  url.searchParams.set('lang', getLang());
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 只认 http(s)：`javascript:` 与 `data:` 会被写进重建文档，等于让外壳执行任意脚本。 */
function normalize(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  const isPath = text.startsWith('/') || text.startsWith('./') || text.startsWith('../');
  const abs = hasScheme || isPath ? new URL(text, location.href) : new URL(`https://${text}`);
  if (!/^https?:$/.test(abs.protocol)) return '';
  return abs.href;
}

/** 同源就报文件名，公网就报域名 */
function tabTitle(url: string): string {
  const u = new URL(url);
  if (u.origin === location.origin) return u.pathname.split('/').pop() || u.pathname;
  return u.hostname;
}

/** 常见懒加载属性：脚本被剥掉后没人把它们换进 src，图片就永远不发请求。 */
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-echo'];

/**
 * 把懒加载改成「现在就加载」：原生 `loading="lazy"` 置回 eager，脚本用的
 * `data-*` 图址直接写进 src/srcset，`<noscript>` 里的降级图顶上真图的位置。
 * 这三招合起来才让「没有脚本的第三方页」把图交出来——扩展版是靠真浏览器带
 * JS 跑一遍再截图，这里不能那么做。
 */
function eagerImages(parsed: Document): void {
  for (const img of Array.from(parsed.querySelectorAll('img'))) {
    img.setAttribute('loading', 'eager');
    img.removeAttribute('decoding');
    const current = img.getAttribute('src') ?? '';
    if (!current || current.startsWith('data:') || current.startsWith('about:')) {
      for (const attr of LAZY_SRC_ATTRS) {
        const value = img.getAttribute(attr);
        if (value) {
          img.setAttribute('src', value);
          break;
        }
      }
    }
    const srcset = img.getAttribute('srcset') ?? '';
    if (!srcset || srcset.startsWith('data:')) {
      for (const attr of ['data-srcset', 'data-lazy-srcset']) {
        const value = img.getAttribute(attr);
        if (value) {
          img.setAttribute('srcset', value);
          break;
        }
      }
    }
  }
  for (const holder of Array.from(parsed.querySelectorAll('noscript'))) {
    const fallback = holder.querySelector('img[src]');
    const target = fallback
      ? (holder.previousElementSibling?.tagName === 'IMG'
        ? holder.previousElementSibling
        : holder.parentElement?.tagName === 'IMG' ? holder.parentElement : null)
      : null;
    if (target && fallback?.getAttribute('src')) {
      target.setAttribute('src', fallback.getAttribute('src') as string);
      target.setAttribute('loading', 'eager');
    }
    holder.remove();
  }
}

/** 取到的 HTML 先剥脚本再包成一份本地文档：脚本留着会自己画一遍，参数面板就管不住它。 */
let activeRebuildUrl = '';
function rebuildDocUrl(html: string, base: string): string {
  if (activeRebuildUrl) URL.revokeObjectURL(activeRebuildUrl);
  activeRebuildUrl = URL.createObjectURL(new Blob([wrapForRebuild(html, base)], { type: 'text/html;charset=utf-8' }));
  return activeRebuildUrl;
}

function wrapForRebuild(html: string, base: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, iframe').forEach((el) => el.remove());
  // 内联事件属性（onload / onerror）指向的都是刚被剥掉的那些脚本里的函数，
  // 留着每次重绘都抛一个 ReferenceError，还可能把 lazy 类名重新加回去。
  parsed.querySelectorAll('*').forEach((el) => {
    for (const name of Array.from(el.attributes)) {
      if (name.name.toLowerCase().startsWith('on')) el.removeAttribute(name.name);
    }
  });
  parsed.querySelectorAll('meta[http-equiv]').forEach((el) => {
    const kind = (el.getAttribute('http-equiv') ?? '').toLowerCase();
    if (kind === 'refresh' || kind === 'content-security-policy' || kind === 'referrer-policy') el.remove();
  });
  eagerImages(parsed);
  // 重建这份文档是外壳创建出来的，它没有自己的站名，发子资源请求时 Referer 用的是
  // 外壳自己（localhost）；按 Referer 做防盗链的站点会把外链图片一律拦掉，
  // 看起来就是「图全没了」。声明 no-referrer，让图片按直接访问放行。
  // 原页自己常常也带一条 <meta name="referrer">（B 站带的是 no-referrer-when-downgrade），
  // 而后写的那一条才作数——只 prepend 不删除等于没写，Referer 照样漏出去，CDN 照样 403。
  parsed.querySelectorAll('meta[name="referrer" i]').forEach((el) => el.remove());
  const referrer = parsed.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  parsed.head.prepend(referrer);
  const baseEl = parsed.createElement('base');
  baseEl.href = base;
  parsed.head.prepend(baseEl);
  // 外壳靠这个标记认出「这是我们那份文档」，不去等挂住的子资源。
  parsed.documentElement.dataset.sbRebuild = '1';
  // 双语只覆盖仓库里的案例页：抓进来的第三方页保持它自己的原文，
  // 但 html[lang] 会驱动面板的语言，跟外壳对齐才不会出现中英夹着的参数表。
  parsed.documentElement.lang = getLang();
  const boot = parsed.createElement('script');
  boot.type = 'module';
  // 用 dynamic import 而不是 top-level import：静态 import 挂了是模块实例化失败，
  // try/catch 抓不到，`__tunerBoot` 就永远没人写，外壳只能干等到超时。
  boot.textContent = [
    `const mod = await import(${JSON.stringify(new URL('/src/tune/index.ts', location.href).href)}).catch((err) => { window.__tunerBoot = String(err); return null; });`,
    'if (mod) { try {',
    '  const root = document.querySelector("#app") || document.querySelector("main") || document.body;',
    `  window.__tuner = mod.tune({ root, lang: ${JSON.stringify(getLang())}, initial: { sound: true, tour: true, scan: 'pre-scroll' }, open: true, position: "bottom-right" });`,
    '} catch (err) { window.__tunerBoot = String(err); } }',
  ].join('\n');
  parsed.body.append(boot);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

async function loadPreset(c: Case, mine: number): Promise<void> {
  const settled = nextLoad();
  frame.removeAttribute('srcdoc');
  frame.src = withLang(c.href);
  await settled;

  const got = await waitForTuner(20000);
  if (mine !== generation) return;
  addrEl.dataset.loading = 'false';
  if (!got.tuner) {
    hintEl.textContent = got.bootError
      ? trf('创造者模式装到这一页时失败了：{0}', got.bootError)
      : tr('这一页没有装上创造者模式');
    return;
  }

  tuner = got.tuner;
  if (creatorOn) tuner.open();
  else tuner.close();
  tuner.apply();
}

/**
 * 先直连，再走同源转发：直连只有同源页和愿意给 CORS 头的站点能成，
 * 公网大多数会在这里抛错——那不是「这页读不了」，是浏览器不让读，
 * 所以还有第二次机会：本地开发服务器上的 /__page 转发口。
 * 转发口现在会先用无头浏览器把这一页跑一遍（站点自己的 JS 画出来的那些图，
 * 静态 HTML 里根本没有），所以那一次的等待上限比直连长得多，并且在状态栏里说明正在做什么。
 */
async function grabPage(url: string): Promise<GrabbedPage | { why: string }> {
  const crossOrigin = new URL(url).origin !== location.origin;
  const tries: { how: string; href: string; limit: number; relayed: boolean }[] = [
    { how: tr('直连：'), href: url, limit: DIRECT_TIMEOUT_MS, relayed: false },
  ];
  if (crossOrigin) {
    tries.push({ how: tr('同源转发：'), href: relayHref(url), limit: RELAY_TIMEOUT_MS, relayed: true });
  }
  const notes: string[] = [];
  for (const try_ of tries) {
    if (try_.relayed) {
      hintEl.textContent = say(
        '正在用无头浏览器渲染这一页：让站点自己的 JS 把图画出来，可能要十几秒…',
        'Rendering this page in a headless browser so its own JS can draw the images — this can take tens of seconds…',
      );
    }
    // 断网/慢站点的 fetch 会一直挂着，标签就永远停在「取 HTML…」。到点按「取不到」处理——
    // 降级为直接嵌本来就该比死等诚实。转发口的上限要盖住它自己那次无头渲染加静态回退。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), try_.limit);
    try {
      const res = await fetch(try_.href, { credentials: 'omit', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!/html/i.test(type)) throw new Error(trf('不是 HTML（{0}）', type || tr('未知类型')));
      const html = await res.text();
      // 转发口报的是上游跳转之后的地址：相对图址要按它解析，不是按用户输入的那条。
      const base = res.headers.get('x-relay-final-url') || (try_.relayed ? url : res.url) || url;
      return {
        html,
        base,
        render: try_.relayed ? (res.headers.get('x-relay-render') || 'unknown') : 'direct',
        note: res.headers.get('x-relay-note') ?? '',
      };
    } catch (err) {
      const secs = Math.round(try_.limit / 1000);
      const why = err instanceof DOMException && err.name === 'AbortError'
        ? say(`超时（${secs} 秒内没返回）`, `timed out (no reply within ${secs} seconds)`)
        : err instanceof Error ? err.message : String(err);
      notes.push(try_.how + why);
    } finally {
      clearTimeout(timer);
    }
  }
  // 分隔符跟着语言走：整句英文里夹一个全角分号，一眼就能看出是机器拼的。
  return { why: notes.join(getLang() === 'en' ? '; ' : '；') };
}

async function loadCustom(c: Case, mine: number): Promise<void> {
  hintEl.textContent = tr('取这一页的 HTML…');
  const got = await grabPage(c.url as string);
  if (mine !== generation) return;

  if ('html' in got) {
    // 这一页是直连、静态转发还是无头渲染拿到的，状态栏那一行会一直带着它；
    // 无头没成时，转发口把原因放在 note 里，挂到提示行的 title 上。
    relayPath = got.render;
    hintEl.title = got.note;
    c.mode = 'rebuild';
    // 两条路谁先到算谁：正常页靠 load，子资源挂住的页靠自己的 readyState。
    // settled 必须在赋值之前建好，否则会漏掉这次导航的 load 事件。
    const settled = nextLoad();
    // 不用 srcdoc：srcdoc 那份文档的「地址」就是外壳自己的 URL，dev server 跑在
    // 127.0.0.1 上，浏览器于是把它的每一条子资源请求判成「本地页面要连公网」，
    // 直接 ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS——图全灰、样式全丢，
    // 而 dev server 加不加 flag 都改变不了这个判定。
    // blob: 是这份文档自己创建出来的资源，同源可读 DOM，也不走那条检查。
    frame.src = rebuildDocUrl(got.html, c.url as string);
    await Promise.race([settled, waitRebuildReady(6000)]);
    if (mine !== generation) return;
    addrEl.dataset.loading = 'false';
    const boot = await waitForTuner(20000);
    if (mine !== generation) return;
    if (!boot.tuner) {
      hintEl.textContent = boot.bootError
        ? trf('创造者模式装到这一页时失败了：{0}', boot.bootError)
        : tr('这一页取到了，但创造者模式没装上');
      return;
    }
    tuner = boot.tuner;
    if (creatorOn) tuner.open();
    else tuner.close();
    tuner.apply();
    return;
  }

  // 取不到就退回直接嵌：能看到，但那是别人的源，DOM 读不到就不假装能盖。
  c.mode = 'frame';
  const settled = nextLoad();
  frame.removeAttribute('srcdoc');
  frame.src = c.url as string;
  await Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, 6000))]);
  if (mine !== generation) return;
  addrEl.dataset.loading = 'false';
  hintEl.textContent = trf('读不到这一页的 DOM（{0}）：只能原样显示，重建不了', 'why' in got ? got.why : '');
}

async function load(): Promise<void> {
  const mine = ++generation;
  tuner = null;
  addrEl.dataset.loading = 'true';
  barEl.dataset.phase = 'idle';
  hintEl.textContent = tr('载入中…');
  metaEl.textContent = '';

  const c = caseOf(current());
  if (c.custom && (!c.url || c.mode === 'blank')) {
    showBlank(c);
    return;
  }
  blankEl.hidden = true;
  if (c.custom) await loadCustom(c, mine);
  else await loadPreset(c, mine);
}

function showBlank(c: Case): void {
  blankEl.hidden = false;
  blankInput.value = c.url ?? '';
  addrEl.dataset.loading = 'false';
  hintEl.textContent = tr('新标签页：输入一个地址，回车就开工');
  metaEl.textContent = '';
  if (!blankChips.childElementCount) {
    for (const chip of CHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = tr(chip.label);
      btn.addEventListener('click', () => navigate(current(), chip.href));
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
  void load();
  return key;
}

function navigate(key: string, raw: string): void {
  const c = caseOf(key);
  const url = normalize(raw);
  if (!url) {
    blankInput.dataset.bad = 'true';
    hintEl.textContent = tr('这个地址读不懂（只认 http/https，或站内相对路径）');
    return;
  }
  delete blankInput.dataset.bad;
  c.url = url;
  c.mode = 'rebuild';
  c.title = tabTitle(url);
  const label = tabEls.get(key)?.querySelector('b');
  if (label) label.textContent = c.title;
  paintChrome();
  void load();
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
  if (wasCurrent) void load();
}

function go(key: string): void {
  if (key === current()) {
    void load();
    return;
  }
  stack.splice(cursor + 1, stack.length, key);
  cursor = stack.length - 1;
  paintChrome();
  void load();
}

backBtn.addEventListener('click', () => {
  if (cursor === 0) return;
  cursor -= 1;
  paintChrome();
  void load();
});
fwdBtn.addEventListener('click', () => {
  if (cursor >= stack.length - 1) return;
  cursor += 1;
  paintChrome();
  void load();
});
reloadBtn.addEventListener('click', () => void load());
newTabBtn.addEventListener('click', () => void openBlank());
blankForm.addEventListener('submit', (e) => {
  e.preventDefault();
  navigate(current(), blankInput.value);
});

// 语言切换走整页重载：外壳的静态文案、案例页的字典、srcdoc 里注入的 lang 都从
// ?lang= 与 localStorage 读一次，热切换要把这三处分别再跑一遍，不如重载一次来得可靠。
langBtn.addEventListener('click', () => {
  const next = getLang() === 'en' ? 'zh' : 'en';
  setLang(next);
  const url = new URL(location.href);
  url.searchParams.set('lang', next);
  location.href = `${url.pathname}?${url.searchParams}${url.hash}`;
});

creatorBtn.addEventListener('click', () => {
  creatorOn = !creatorOn;
  creatorBtn.setAttribute('aria-pressed', String(creatorOn));
  if (!tuner) return;
  if (creatorOn) tuner.open();
  else tuner.close();
});

// Mirror the panel into the window chrome, the way a browser reflects its page.
setInterval(() => {
  if (!tuner) return;
  barEl.dataset.phase = tuner.phase;
  hintEl.textContent = `${tr(caseOf(current()).title)} · ${tuner.status}${relayLabel() ? ` · ${relayLabel()}` : ''}`;
  const items = frame.contentDocument?.querySelectorAll('.sb-item').length ?? 0;
  metaEl.textContent = items > 0 ? trf('{0} 个盒子在画', items) : '';
}, 200);

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
window.__browser = {
  get cases() {
    return CASES.map((c) => c.key);
  },
  current,
  tuner: () => tuner,
  go,
  openBlank,
  navigate,
};

// ?u= 让验收和分享链接直接落到某个自定义地址上，不必先点加号再打字。
const bootUrl = params.get('u');
if (bootUrl) {
  navigate(openBlank(), bootUrl);
} else {
  paintChrome();
  void load();
}
