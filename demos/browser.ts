/**
 * iframe 母本的适配层：标签条、历史栈、空白页、地址校验、创造者钮与 __browser 吊钩
 * 都在 shell-core.ts（容器壳 minitool/src/shell.ts 共用）；这里只剩 iframe 的挂载、
 * 抓取/重建这条联网链路和状态镜像。
 */
import type { SwarmTuner } from '../src/tune/index';
import { getLang, setLang, tr, trf } from './lang';
import { createShellCore, need, say, normalize, tabTitle, type Case } from './shell-core';

const frame = need<HTMLIFrameElement>('[data-frame]');
const langBtn = need<HTMLButtonElement>('[data-lang]');

let generation = 0;
let tuner: SwarmTuner | null = null;

function nextLoad(): Promise<void> {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 直连只有同源/CORS 站点能成，快进快出；转发口那边可能要开无头浏览器，给它留够时间。 */
const DIRECT_TIMEOUT_MS = 8000;
const RELAY_TIMEOUT_MS = 50000;

/**
 * 转发口的地址。?relay=off / ?relay=fail 是开发期的探针开关，原样传给 /__page：
 * off 完全不走无头渲染，fail 让无头那一步必然失败——用来量「没有无头浏览器时外壳还工不工作」。
 */
function relayHref(url: string): string {
  const knob = core.params.get('relay');
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
  core.addrEl.dataset.loading = 'false';
  if (!got.tuner) {
    core.hintEl.textContent = got.bootError
      ? trf('创造者模式装到这一页时失败了：{0}', got.bootError)
      : tr('这一页没有装上创造者模式');
    return;
  }

  tuner = got.tuner;
  if (core.creatorOn) tuner.open();
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
      core.hintEl.textContent = say(
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
  core.hintEl.textContent = tr('取这一页的 HTML…');
  const got = await grabPage(c.url as string);
  if (mine !== generation) return;

  if ('html' in got) {
    // 这一页是直连、静态转发还是无头渲染拿到的，状态栏那一行会一直带着它；
    // 无头没成时，转发口把原因放在 note 里，挂到提示行的 title 上。
    relayPath = got.render;
    core.hintEl.title = got.note;
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
    core.addrEl.dataset.loading = 'false';
    const boot = await waitForTuner(20000);
    if (mine !== generation) return;
    if (!boot.tuner) {
      core.hintEl.textContent = boot.bootError
        ? trf('创造者模式装到这一页时失败了：{0}', boot.bootError)
        : tr('这一页取到了，但创造者模式没装上');
      return;
    }
    tuner = boot.tuner;
    if (core.creatorOn) tuner.open();
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
  core.addrEl.dataset.loading = 'false';
  core.hintEl.textContent = trf('读不到这一页的 DOM（{0}）：只能原样显示，重建不了', 'why' in got ? got.why : '');
}

async function load(): Promise<void> {
  const mine = ++generation;
  tuner = null;
  core.beginLoad();

  const c = core.caseOf(core.current());
  if (c.custom && (!c.url || c.mode === 'blank')) {
    core.showBlank(c);
    return;
  }
  if (c.custom) await loadCustom(c, mine);
  else await loadPreset(c, mine);
}

function navigate(key: string, raw: string): void {
  const c = core.caseOf(key);
  const url = normalize(raw);
  if (!url) {
    core.blankInput.dataset.bad = 'true';
    core.hintEl.textContent = tr('这个地址读不懂（只认 http/https，或站内相对路径）');
    return;
  }
  delete core.blankInput.dataset.bad;
  c.url = url;
  c.mode = 'rebuild';
  c.title = tabTitle(url);
  core.setTabTitle(key, c.title);
  core.paintChrome();
  void load();
}

const core = createShellCore({
  load: () => void load(),
  navigate,
  chip: (href) => navigate(core.current(), href),
  tuner: () => tuner,
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

// Mirror the panel into the window chrome, the way a browser reflects its page.
setInterval(() => {
  if (!tuner) return;
  core.barEl.dataset.phase = tuner.phase;
  core.hintEl.textContent = `${tr(core.caseOf(core.current()).title)} · ${tuner.status}${relayLabel() ? ` · ${relayLabel()}` : ''}`;
  const items = frame.contentDocument?.querySelectorAll('.sb-item').length ?? 0;
  core.metaEl.textContent = items > 0 ? trf('{0} 个盒子在画', items) : '';
}, 200);

core.boot();