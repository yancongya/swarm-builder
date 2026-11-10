/**
 * dev-only：让第三方页面先在真浏览器里长一遍，再把长好的 DOM 交给预览壳。
 *
 * 为什么需要它：静态 fetch 拿到的只是站点发货时的空壳。B 站首页的静态 HTML 里只有 13 个
 * <img>、文档高 1078px，而同一页在真浏览器里跑完自己的 JS 之后是五十多个 <img>、几千 px——
 * 缺的那些图不是被防盗链拦了（静态那 13 张全都加载成功），是**根本还没被画出来**。
 * 所以这里开一个无头 Chromium：让页面自己的脚本跑、滚一遍触发懒加载、等图落地，
 * 然后序列化 documentElement.outerHTML。外壳照旧剥脚本、照旧注 <base> 与 no-referrer。
 *
 * 边界（这是开发工具，不是爬虫）：
 *   - 只渲染 middleware 校验过的那一个 http(s) 地址，不点链接、不递归、不带访问者凭据；
 *     每次请求开一个全新 context，渲染完即关，cookie / storage 不留到下一次。
 *   - 一个共享浏览器实例，懒启动；并发请求排队串行，队首之外最多再等 MAX_QUEUE 个。
 *   - 每次请求有总预算、滚动有步数与距离上限、序列化有体积上限；视频流直接掐掉。
 *   - Playwright 或它的浏览器二进制不在、渲染抛错或超时：一律退回原来的静态 fetch，
 *     dev server 照常起、预览壳照常用。调用方靠返回里的 path 判断走的是哪条路。
 *
 * 不进产物：package.json 的 files 只带 dist 与 CHANGELOG，这个模块只被 vite.config.ts 的
 * dev middleware 引用。
 */

/** 一次渲染的总预算（含启动共享浏览器的那一次）。到点就放弃，退回静态 fetch。 */
const RENDER_BUDGET_MS = 35_000;
/** 单步上限：导航、整页 load、图片落地、网络安静，各自都不许把总预算吃光。 */
const NAV_TIMEOUT_MS = 12_000;
const LOAD_TIMEOUT_MS = 5_000;
const IMAGE_SETTLE_MS = 5_000;
const NETWORK_IDLE_MS = 3_000;
const LAUNCH_TIMEOUT_MS = 20_000;
/** 滚动：一屏一步，最多这么多步 / 这么远。无限流的页面靠这两个上限收手。 */
const SCROLL_MAX_STEPS = 28;
const SCROLL_MAX_PX = 24_000;
const SCROLL_PAUSE_MS = 320;
/** 序列化上限（字符）。超了先丢脚本再量一次——外壳本来就要剥脚本，这一步是无损的。 */
const MAX_HTML_CHARS = 6_000_000;
/** 排在自己前面的渲染最多这么多；再来的直接走静态 fetch，不让开发服务器堆一摞浏览器。 */
const MAX_QUEUE = 2;
/** 启动失败后的冷却：二进制不在就别每个请求都再赔 20 秒。 */
const LAUNCH_RETRY_COOLDOWN_MS = 60_000;

const env = () => (globalThis.process?.env ?? {});

/** 'auto' | 'off' | 'fail'：off 完全不试（当作没有无头浏览器），fail 模拟一次渲染失败。 */
function modeFromEnv() {
  const raw = String(env().SB_RELAY_RENDER ?? '').toLowerCase();
  return raw === 'off' || raw === '0' || raw === 'false' ? 'off' : raw === 'fail' ? 'fail' : 'auto';
}

let browserPromise = null;
let liveBrowser = null;
let launchFailedAt = 0;
let launchError = '';
let queue = Promise.resolve();
let waiting = 0;
let closing = false;

const reasonOf = (err) => String(err instanceof Error ? err.message : err).split('\n')[0].slice(0, 300);

async function startBrowser() {
  // 动态 import：Playwright 只是 devDependency，没装它的环境里这一句抛错就够了，
  // middleware 会退回 fetch，dev server 不受影响。
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS, args: ['--mute-audio'] });
  liveBrowser = browser;
  browser.on('disconnected', () => {
    // 浏览器自己崩了 / 被关了：下一次请求重新懒启动，别守着一个空壳。
    if (liveBrowser === browser) {
      liveBrowser = null;
      browserPromise = null;
    }
  });
  return browser;
}

function sharedBrowser() {
  if (closing) throw new Error('relay renderer is shutting down');
  if (launchError && Date.now() - launchFailedAt < LAUNCH_RETRY_COOLDOWN_MS) throw new Error(launchError);
  if (!browserPromise) {
    const pending = startBrowser();
    browserPromise = pending;
    pending.catch((err) => {
      if (browserPromise === pending) browserPromise = null;
      launchError = reasonOf(err);
      launchFailedAt = Date.now();
    });
  }
  return browserPromise;
}

function withTimeout(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`headless render timed out after ${Math.round(ms)}ms`)), ms);
  });
  // race 会给两条 promise 都挂上 handlers：超时之后渲染那条晚到的 rejection 不会变成未处理拒绝。
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * 在页面里滚一遍。滚动是为了触发 IntersectionObserver / scroll 监听那类懒加载；
 * 顺手把已经长出来的图址记在 data-sb-rendered 上——有些列表滚过去会把 src 收回去，
 * 序列化前按这份记录补回来，滚过的路才不算白滚。
 */
async function sweepAndSerialize(ctx, url, deadline) {
  const page = await ctx.newPage();
  // 视频流既贵又跟「图片资源全不全」无关：掐掉，页面自己的 poster 图照旧走 img。
  await ctx.route('**/*', (route) => (route.request().resourceType() === 'media' ? route.abort() : route.continue()));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const status = response?.status() ?? 200;
  await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => {});

  await page.evaluate(
    async ({ pause, maxSteps, maxPx, until }) => {
      const el = document.scrollingElement || document.documentElement;
      const step = Math.max(300, Math.round(window.innerHeight * 0.85));
      const pin = () => {
        for (const img of document.images) {
          const src = img.currentSrc || img.getAttribute('src') || '';
          if (img.naturalWidth > 0 && src && !src.startsWith('data:')) img.setAttribute('data-sb-rendered', src);
        }
      };
      let y = 0;
      for (let i = 0; i < maxSteps && y < maxPx && Date.now() < until; i++) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, pause));
        pin();
        const next = y + step;
        if (next >= el.scrollHeight) {
          // 到底了再站一会儿：无限流这时候往往正在追加下一批。
          window.scrollTo(0, el.scrollHeight);
          await new Promise((r) => setTimeout(r, pause));
          pin();
          if (el.scrollHeight <= next + step) break;
        }
        y = next;
      }
      pin();
    },
    { pause: SCROLL_PAUSE_MS, maxSteps: SCROLL_MAX_STEPS, maxPx: SCROLL_MAX_PX, until: deadline - IMAGE_SETTLE_MS - NETWORK_IDLE_MS },
  );

  // 等图落地：complete 对坏图也是 true，所以这里只把它当「请求有结果了」，
  // 真正的全不全由外壳那边按 naturalWidth 量。
  await page
    .waitForFunction(
      () => Array.from(document.images).every((img) => {
        const src = img.getAttribute('src') || '';
        return !src || src.startsWith('data:') || img.complete;
      }),
      null,
      { timeout: IMAGE_SETTLE_MS, polling: 250 },
    )
    .catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => {});

  const out = await page.evaluate((maxChars) => {
    for (const img of document.images) {
      img.setAttribute('loading', 'eager');
      img.removeAttribute('decoding');
      const seen = img.getAttribute('data-sb-rendered');
      const src = img.getAttribute('src') || '';
      if (seen && (!src || src.startsWith('data:') || img.naturalWidth === 0)) img.setAttribute('src', seen);
      img.removeAttribute('data-sb-rendered');
    }
    const html = () => `<!doctype html>${document.documentElement.outerHTML}`;
    let text = html();
    let droppedScripts = false;
    if (text.length > maxChars) {
      // 外壳的 wrapForRebuild 本来就要剥脚本：体积超限时先剥了再量，别整页退回静态壳。
      document.querySelectorAll('script').forEach((el) => el.remove());
      droppedScripts = true;
      text = html();
    }
    return { text, droppedScripts, finalUrl: location.href, imgs: document.images.length };
  }, MAX_HTML_CHARS);

  if (out.text.length > MAX_HTML_CHARS) throw new Error(`rendered DOM too large (${out.text.length} chars)`);
  return { html: out.text, finalUrl: out.finalUrl, status, imgs: out.imgs, droppedScripts: out.droppedScripts };
}

async function attempt(url, mode) {
  if (mode === 'fail') throw new Error('simulated headless failure (?render=fail / SB_RELAY_RENDER=fail)');
  const started = Date.now();
  const deadline = started + RENDER_BUDGET_MS;
  const browser = await sharedBrowser();
  const version = browser.version();
  // 无头 Chromium 默认的 UA 里带 HeadlessChrome，有些站点按它发另一套（更空的）页面。
  // 这里报的就是它自己真实的版本号，只是去掉 headless 标记。
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
  });
  try {
    const out = await withTimeout(sweepAndSerialize(ctx, url, deadline), Math.max(1000, deadline - Date.now()));
    return { ok: true, attempted: true, ...out, ms: Date.now() - started };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * 渲染一个地址。永远不抛：失败也返回一个说法，由 middleware 决定退回静态 fetch。
 * attempted=false 表示「根本没试」（关掉了 / 排队太长），attempted=true 表示「试了但没成」。
 * @param {string} url 已经被 middleware 校验过的 http(s) 地址
 * @param {{ mode?: 'auto' | 'off' | 'fail' }} [opts]
 */
export async function renderPage(url, opts = {}) {
  const mode = opts.mode ?? modeFromEnv();
  if (mode === 'off') return { ok: false, attempted: false, reason: 'headless render is switched off' };
  if (waiting >= MAX_QUEUE) return { ok: false, attempted: false, reason: `render queue busy (${waiting} waiting)` };
  waiting += 1;
  const job = queue.then(() => attempt(url, mode));
  // 队列只用来排序，不传结果也不传错误：上一次失败不该毒化下一次。
  queue = job.then(() => {}, () => {});
  try {
    return await job;
  } catch (err) {
    return { ok: false, attempted: true, reason: reasonOf(err) };
  } finally {
    waiting -= 1;
  }
}

/** dev server 关掉（含 vite 自己重启）时把共享浏览器收走，别留一个孤儿进程。 */
export async function closeRenderer() {
  if (closing) return;
  closing = true;
  const pending = browserPromise;
  browserPromise = null;
  liveBrowser = null;
  if (pending) await pending.then((browser) => browser.close()).catch(() => {});
  // vite 重启时可能在同一个进程里再开一台：收完之后允许重新懒启动，不留死锁。
  closing = false;
}