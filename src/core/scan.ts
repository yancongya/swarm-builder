/**
 * 预滚动采集：参考实现（浏览器扩展）的那一遍。
 * 扩展跑在真页面上，脚本会把懒加载、无限列表、`content-visibility` 的内容
 * 自己补出来；我们只有 DOM 快照，所以采集前先自己滚一遍把它们逼出来，再退回顶部。
 */

/** 最多走 28 屏；再长的页面靠这个也铺不完，不如让构建先开始。 */
const MAX_STEPS = 28;
/** 每一屏停多久：够浏览器发懒加载请求、够 `content-visibility` 计量布局。 */
const STEP_MS = 90;
const IMAGE_WAIT = 2500;
const FONT_WAIT = 1200;
/** 回到顶部后的收尾：滚动触发的重排落定，避免采到布局中途的坐标。 */
const SETTLE_MS = 150;
/** 只有「差不多是整屏」的容器才当页面滚动容器；列表框、下拉面板不算。 */
const MIN_VIEWPORT_RATIO = 0.5;

export interface ScanEnv {
  /** 这一遍真正滚的那个元素；页面自己滚时就是根滚动元素。 */
  scroller: Element;
  /** 视口高度，用来决定「一屏」多高。 */
  height: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 等一帧，让浏览器把刚滚进视野的东西真的画出来。 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function isScrollBox(el: Element): boolean {
  const overflow = getComputedStyle(el).overflowY;
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

/**
 * 当前看得见的那一段页面，蓝图坐标（相对 root 边框盒）。
 * 滚动逐段解锁、待时物理的圆心、配乐的声像都要它，所以量一次给所有人。
 */
export function viewBand(root: HTMLElement, scroller: Element | null): { top: number; bottom: number; height: number } {
  const rootTop = root.getBoundingClientRect().top;
  const box = scroller && scroller !== document.documentElement && scroller !== document.body ? scroller : null;
  const winH = window.innerHeight || document.documentElement.clientHeight || 600;
  if (box) {
    // 滚动层可能被宿主 chrome 垫高、或伸出窗口：前沿是它真正可见的那一段，
    // 不是窗口顶加 clientHeight——差的那几像素会把页底条目永久锁在前沿外。
    const rect = box.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const height = Math.max(0, Math.min(rect.bottom, winH) - visibleTop);
    const top = visibleTop - rootTop;
    return { top, bottom: top + height, height };
  }
  return { top: -rootTop, bottom: -rootTop + winH, height: winH };
}

/**
 * 「真的还有得滚」，不是「数值上超了一点点」。
 * 阈值必须比 body 默认那 8px 外边距大：`#app{height:100vh;overflow:hidden}` 这种
 * 整页壳，html 的 scrollHeight 正好是 100vh + 16px，按 8px 判会把它当成滚动者，
 * 于是滚了 16 像素就收工，被锁住的 4000px 内容一格都没露出来。
 */
function hasRoom(el: Element): boolean {
  const extra = el.scrollHeight - el.clientHeight;
  return extra > 32 && extra > el.clientHeight * 0.03;
}

/**
 * 找出「这页其实是靠谁滚的」。
 * 由便宜到贵：先看容器自己，再往祖先找（`body{overflow:auto}` 的整页壳），
 * 再看窗口自己滚不滚（绝大多数页面在这一句就结束了），最后才扫一遍后代，
 * 找一个占屏高度的滚动区——`main{overflow:auto}` + `body{overflow:hidden}`
 * 那类后台壳就是这种，直接滚 window 一格都不动。
 * 都没有但内容确实超出时，返回根滚动元素并把它解锁。
 */
export function detectEnv(root: HTMLElement): ScanEnv {
  const viewport = Math.max(200, window.innerHeight || document.documentElement.clientHeight || 600);

  if (isScrollBox(root) && hasRoom(root)) return { scroller: root, height: root.clientHeight };

  // 祖先链要跨过 shadow 边界：parentElement 走到 ShadowRoot 就断，
  // 宿主外面的滚动容器（固定开窗那类壳）永远找不到。
  for (let node: Node | null = root.parentNode; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
    if (!(node instanceof Element)) continue;
    if (isScrollBox(node) && hasRoom(node) && node.clientHeight >= viewport * MIN_VIEWPORT_RATIO) {
      return { scroller: node, height: node.clientHeight };
    }
  }

  const page = document.scrollingElement ?? document.documentElement;
  if (hasRoom(page)) return { scroller: page, height: viewport };

  let best: Element | null = null;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!isScrollBox(el) || !hasRoom(el) || el.clientHeight < viewport * MIN_VIEWPORT_RATIO) continue;
    if (!best || el.scrollHeight > best.scrollHeight) best = el;
  }
  if (best) return { scroller: best, height: best.clientHeight };

  // 内容超出视口，却没有任何一处愿意滚：这是被 `overflow:hidden` 锁住的整页壳
  // （单页应用等脚本回来再解锁，可脚本根本没跑）。解开，并且构建完也不还回去——
  // 读者要的是一个能滚的页面，不是一个恢复原状的洁癖。
  const locked = [root, document.body, page].find((el) => el && hasRoom(el));
  if (locked) {
    (locked as HTMLElement).style.setProperty('overflow-y', 'auto', 'important');
    return { scroller: locked, height: viewport };
  }
  return { scroller: page, height: viewport };
}

function pendingImages(root: HTMLElement): number {
  let waiting = 0;
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (img.complete || img.currentSrc === '') continue;
    // 还没进过视野的懒图，请求根本没发出去：等它也没意义，滚动那一遍已经拉过了。
    if (img.loading === 'lazy' && !isInView(img)) continue;
    waiting++;
  }
  return waiting;
}

function isInView(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > -100 && rect.top < (window.innerHeight || 900) + 100;
}

async function waitFor(probe: () => number, limitMs: number): Promise<void> {
  const deadline = performance.now() + limitMs;
  while (probe() > 0 && performance.now() < deadline) await sleep(100);
}

/**
 * 滚到底再回顶，把「只有滚动才会出现」的内容逼出来。
 * 这一步做完才允许采集，否则懒加载图与 `content-visibility` 的区块会以
 * 零尺寸落进蓝图——构建看起来缺图，页面也看不出有多长。
 */
export async function preScan(root: HTMLElement): Promise<ScanEnv> {
  const env = detectEnv(root);
  const step = Math.max(160, Math.round(env.height * 0.9));
  for (let index = 0; index < MAX_STEPS; index++) {
    const travel = step * (index + 1);
    env.scroller.scrollTop = travel;
    if (env.scroller.scrollTop < travel - 2) break; // 到底了（含亚像素与阻尼滚动）
    await sleep(STEP_MS);
    await nextFrame();
  }

  await waitFor(() => pendingImages(root), IMAGE_WAIT);
  // 字体落定后再采：文本框宽度在换字前后不一样，晚了会把每一行的宽度量错。
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), sleep(FONT_WAIT)]);

  env.scroller.scrollTop = 0;
  await sleep(SETTLE_MS);
  await nextFrame();
  return env;
}
