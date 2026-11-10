/**
 * 小工具外壳：demos/index.html + demos/browser.ts 的移植版。
 *
 * 与母本的差异都来自容器硬约束（见 minitool skill 的 device-capabilities）：
 * - **去 iframe**：案例页面以 shadow 根挂进 [data-viewport]；viewport 自己就是
 *   固定定位的滚动容器（外壳文档不滚）——引擎上游已支持 shadow 宿主（detectEnv
 *   跨 shadow 找滚动者、viewBand 实测滚动矩形、styleRoot 把样式注进 shadow），
 *   外壳不再垫 .case-scroll / 抄样式副本这类环境补丁；
 * - **不联网**：fetch / 转发口 / 第三方页重建全部删除。地址栏、example.com chip
 *   都保留，但只产出一句「容器离线」的明示提示，不假装在抓；
 * - **不开新窗口 / 不跳站外**：gh 链接保留原址，所有 <a> 点击在捕获阶段拦下；
 * - **语言切换**走 replaceState ?lang= + location.reload()（母本是 location.href= 跳转）。
 *
 * 母本 demos/ 一行不改：字典（lang.ts / lang-data）、案例 HTML、browser.css 全部
 * 作为输入被读取；新文案走 say(zh, en) 与 data-say，不进母本字典。
 */
import { SwarmBuilder } from '../../src/index';
import type { SwarmBuilderOptions } from '../../src/types';
import { tune, type SwarmTuner } from '../../src/tune/index';
import { applyLang, getLang, setLang, tr, trf } from '../../demos/lang';
import caseCss from 'minitool:case-css';
import panelCss from 'minitool:panel-css';
import darkUiHtml from 'minitool:case-html:dark-ui';
import homeHtml from 'minitool:case-html:home';
import consoleHtml from 'minitool:case-html:console';
import landingHtml from 'minitool:case-html:landing';
import simpleHtml from 'minitool:case-html:simple';
import tallHtml from 'minitool:case-html:tall';
import tuneHtml from 'minitool:case-html:tune';

interface Case {
  key: string;
  title: string;
  href: string;
  /** 地址栏显示的站名：让案例读起来像个站点而不是一个文件。 */
  origin: string;
  /** 用户自己开的标签：地址是他输入的，不是仓库里的文件。 */
  custom?: boolean;
  url?: string;
  mode?: 'blank';
}

/** 构建期已剥 script/link/_blank 的案例 HTML，key 与 demos/<key>.html 一致。 */
const CASE_HTML: Record<string, string> = {
  home: homeHtml,
  simple: simpleHtml,
  console: consoleHtml,
  landing: landingHtml,
  'dark-ui': darkUiHtml,
  tall: tallHtml,
  tune: tuneHtml,
};

const CASES: Case[] = [
  { key: 'home', title: '产品说明页', href: './home.html', origin: 'https://swarm-builder.dev' },
  { key: 'simple', title: '简单页基准', href: './simple.html', origin: 'https://swarm.demo' },
  { key: 'console', title: '密集控制台', href: './console.html', origin: 'https://orbit.demo/console' },
  { key: 'landing', title: '深色落地页', href: './landing.html', origin: 'https://nova.demo' },
  { key: 'dark-ui', title: '复杂工作台', href: './dark-ui.html', origin: 'https://studio.demo' },
  { key: 'tall', title: '长页面跟随', href: './tall.html', origin: 'https://notes.demo/long' },
  { key: 'tune', title: '别人的站点', href: './tune.html', origin: 'https://letterpress.demo' },
];

// 空白页上给三条现成地址：两条站内（切到内置案例），一条真的公网（只产出离线提示）。
const CHIPS = [
  { label: '这一页自己', href: './home.html' },
  { label: '别人的站点', href: './tune.html' },
  { label: 'example.com', href: 'https://example.com' },
];

/**
 * 各案例的重建根与初始参数。母本 creator.ts 统一找 #app；tune 案例的内联脚本
 * 用 #site 且自带初始值（它的 body 没有 data-swarm，被构建期剥掉的脚本里写着）。
 */
const ROOT_SEL: Record<string, string> = { tune: '#site' };
const CASE_INIT: Record<string, SwarmBuilderOptions> = {
  tune: { agentCount: 6, targetDuration: 8, sound: true, tour: true },
};

function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`minitool shell is missing ${selector}`);
  return el;
}

/** 新文案不在母本字典里（demos/dicts 不可改），双语在源码里二选一。 */
const say = (zh: string, en: string): string => (getLang() === 'en' ? en : zh);

/**
 * home 提示词的英文整段（母本 demos/prompt.ts 的 PROMPT_EN 原样搬入——
 * 那个模块带 clipboard/execCommand，import 进包会被门禁拦；只取文本）。
 * 中文留在案例 HTML 里当源码，切 EN 时整段替换。
 */
const PROMPT_EN = `Use swarm-builder to add a "swarm of cursors rebuilds this page" entrance animation to my project. It is a zero-dependency MIT library, shipped as ESM / CJS / IIFE.

1. Install: npm i swarm-builder. Before it is published, git clone https://github.com/yancongya/swarm-builder.git, run npm install && npm run build, then npm i the local path (or the tgz from npm pack) in your project. From a CDN, load dist/swarm-builder.iife.js — the global is SwarmBuilder. In a framework, start it after the container is mounted (useEffect / onMounted); deploying is just shipping those files, there is no server side.
2. Point it at one container; leave the rest of the page alone:
   import { mount } from 'swarm-builder';
   mount({ root: document.querySelector('#app'), agentCount: 8, order: 'rows', tour: true, sound: true });
3. Want to tune while watching? Use creator mode instead (floating ball in the corner; the 29 parameters are split into six purpose tabs - scale / order / cursors / capture / sound / look - with one tab open at a time and the current values in each tab's hover note; hit "Apply & rerun" after editing):
   import { tune } from 'swarm-builder/tune';
   tune({ root: '#app', initial: { order: 'depth', balance: true } });
4. Everyday parameters: agentCount = 1-24 cursors; order = group / rows / cols / snake / depth / radial / random; balance splits the bands by estimated work instead of item count; speed is a 0.25-8 multiplier, targetDuration hands the multiplier to the estimator so the whole run fits a fixed number of seconds; seed makes a random order replayable (0 = drawn per run); maxItems caps the blueprint and anything over it is reported as dropped; ignore takes a selector and skips whole subtrees; duplicate / maxCopies control how repeated modules get stamped; guides / maxGuides control the alignment lines; grow steps a heading up to its real font size; flocking keeps cursors from clipping through each other; tour follows the construction frontier while scrolling; sound is synthesised, no audio files; theme picks the guide ink from the page it is drawn on; performanceMode trims effects automatically on dense pages.
5. These eleven switches are on by default, matching the original; turn them off to fall back to the plainer mode: flight (live orbits while idle / idle stays where it landed), pointer (follow uses the mouse as the orbit centre / ignore / repel with a 48px ring - only does anything under live), agents (auto grows with scroll velocity and claimable backlog up to 48 / fixed), gather (open with the flock gathering before work / start immediately), pick (live prices every job each frame and the closest cursor takes it / queued sticks to pre-cut queues), trigger (scroll only opens what you have scrolled past / immediate opens the whole page on frame one), adaptiveSpeed (+45% per queued item, 4x at most), scan (pre-scroll runs the page end to end first so lazy content and images arrive - the one to use when rebuilding someone else's site / single walks it once), score (generative is the 104 BPM generative score / off is clicks only), reducedMotion (skip builds nothing and hands the real page straight back / run anyway), keys (Esc ends the run, M mutes, any key or tap unlocks audio / off leaves the host's keyboard alone).
6. Do not: do not restructure my markup for the sake of the animation; this is an entrance animation, the rebuilt boxes are not interactive and the real DOM is handed back when it ends.
7. Acceptance: no console errors, document width never exceeds the viewport, and after the animation the real page still works and is still interactive.`;

/**
 * flex gap 能力实测（Chrome 84+ 才有）。用布局探测而不是 CSS.supports：
 * Chrome 66-83 已注册 gap 属性（grid 用），supports 会误报 true，而 flex 上并不生效。
 * cssfix 的 enhancement（清零 margin 基线）挂在 .supports-flex-gap 上，
 * 外壳 document、案例 shadow（:host）、面板（:host）三处都要带类才生效。
 */
function detectFlexGap(): boolean {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;display:flex;gap:10px';
  const a = document.createElement('i');
  a.style.cssText = 'width:10px;height:10px';
  const b = document.createElement('i');
  b.style.cssText = 'width:10px;height:10px';
  probe.append(a, b);
  document.body.append(probe);
  const ok = b.offsetLeft - a.offsetLeft > 10;
  probe.remove();
  return ok;
}

export function start(): void {
  const tabsEl = need<HTMLElement>('[data-tabs]');
  const navEl = need<HTMLElement>('.nav');
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
  const viewportEl = need<HTMLElement>('[data-viewport]');
  const blankEl = need<HTMLElement>('[data-blank]');
  const blankForm = need<HTMLFormElement>('[data-blank-form]');
  const blankInput = need<HTMLInputElement>('[data-blank-input]');
  const blankChips = need<HTMLElement>('[data-blank-chips]');

  // flex gap 能力类：外壳 document 与案例 shadow 的 host 都要带（见 detectFlexGap 注释）。
  const flexGapOk = detectFlexGap();
  document.documentElement.classList.toggle('supports-flex-gap', flexGapOk);
  viewportEl.classList.toggle('supports-flex-gap', flexGapOk);

  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('case') ?? '';
  // 第一个案例就是打开时看到的那一页：预设页排在 CASES 最前面，不必再抄一遍 key。
  const stack: string[] = [CASES.some((c) => c.key === fromUrl) ? fromUrl : (CASES[0] as Case).key];
  let cursor = 0;
  let customSeq = 0;
  let tuner: SwarmTuner | null = null;
  // 创造者面板默认收起（用户要求）：顶栏「创造者模式」钮随时可展开。
  let creatorOn = false;
  let shadow: ShadowRoot | null = null;
  const tabEls = new Map<string, HTMLButtonElement>();

  // 进场态：顶栏（tabs+nav）藏起、视口让到状态栏下沿，构建完成才落回（见 shell-extra.css）。
  document.documentElement.classList.add('pre-build');
  let chromeShown = false;
  function revealChrome(): void {
    if (chromeShown) return;
    chromeShown = true;
    document.documentElement.classList.remove('pre-build');
  }

  /**
   * 顶部出血：容器里系统状态栏浮在 webview 上方，fixed top:0 会被盖住。
   * 官方 getWindowInfo().statusBarHeight（9.49+，异步，文档明令禁止硬编码状态栏高度）
   * 写进 --sb-safe-top；浏览器直跑 / 旧客户端没有 window.xhs → 保持 0px 兜底
   * （桌面本就没有状态栏）。pre-build 期间顶栏本来就藏着，接口返回前不会有顶栏露出。
   */
  function readSafeTop(): void {
    const xhs = (
      window as unknown as {
        xhs?: { miniTool?: { getWindowInfo?: () => Promise<{ statusBarHeight?: number }> } };
      }
    ).xhs;
    const get = xhs?.miniTool?.getWindowInfo;
    if (typeof get !== 'function') return;
    void get()
      .then((info) => {
        const h = Number(info?.statusBarHeight);
        if (Number.isFinite(h) && h > 0) {
          document.documentElement.style.setProperty('--sb-safe-top', `${h}px`);
        }
      })
      .catch(() => {
        // 拿不到就不避让：接口不在（旧客户端/非容器）与读取失败同样按 0 处理。
      });
  }

  function caseOf(key: string): Case {
    const found = CASES.find((c) => c.key === key);
    if (!found) throw new Error(`unknown case ${key}`);
    return found;
  }

  function current(): string {
    return stack[cursor] as string;
  }

  /** chrome 高度实测：双语换行、窄屏折行都会改它，viewport 开窗的 top/bottom 靠这三个变量对齐。 */
  function measureChrome(): void {
    const style = document.documentElement.style;
    style.setProperty('--sb-tabs-h', `${tabsEl.offsetHeight}px`);
    style.setProperty('--sb-chrome-h', `${tabsEl.offsetHeight + navEl.offsetHeight}px`);
    style.setProperty('--sb-status-h', `${barEl.offsetHeight}px`);
  }

  function paintChrome(): void {
    const active = current();
    for (const tab of tabsEl.querySelectorAll<HTMLButtonElement>('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.key === active));
    }
    const c = caseOf(active);
    urlEl.textContent = c.custom ? (c.url ?? '') : c.origin;
    params.set('case', active);
    if (c.custom && c.url) params.set('u', c.url);
    else params.delete('u');
    // replaceState 不在容器禁令里（只有 location.href= / location.assign 被禁）。
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

  /** 面板挂在 document.body 上：把它从状态条后面抬起来（inline style 必胜，不赌层叠）。 */
  function liftPanel(): void {
    const host = document.querySelector<HTMLElement>('[data-sb-chrome]');
    if (!host) return;
    if ((host.dataset.pos ?? '').startsWith('bottom')) {
      host.style.bottom = 'calc(16px + var(--sb-status-h, 25px))';
    }
  }

  /**
   * 把案例挂进 viewport 的 shadow 根：共享样式 + 案例内联样式 + 正文，
   * 双语按案例字典过一遍，然后按母本 creator.ts 的方式装上创造者面板。
   * 上一个案例的面板挂在 document.body 上，不会随 shadow 清空——必须显式销毁。
   */
  function mountCase(c: Case): void {
    const html = CASE_HTML[c.key];
    if (!html) {
      hintEl.textContent = tr('这一页没有装上创造者模式');
      return;
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    tuner?.destroy();
    tuner = null;
    window.__tuner = undefined;

    if (!shadow) shadow = viewportEl.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';
    viewportEl.classList.remove('is-blank');

    // 共享样式（demo.css + console.css 的三段式 Chrome 61 成品）
    const shared = document.createElement('style');
    shared.textContent = caseCss;
    shadow.append(shared);

    // 案例自己的内联 <style>（构建期已过 fixCss 的 shadow 基线）
    for (const style of Array.from(parsed.head.querySelectorAll('style'))) {
      shadow.append(style);
    }

    // 正文：data-swarm / data-demo 等属性随 body 元素留在 parsed.body 上，内容搬进来。
    // 滚动者就是 viewport 自己（shell-extra.css 里 overflow-y:auto）：引擎 detectEnv
    // 会跨过 shadow 边界找到宿主外的滚动容器，viewBand 按它的实测矩形算可见段——
    // 不再需要垫一层 .case-scroll 来把滚动者塞进案例根的祖先链。
    while (parsed.body.firstChild) shadow.append(parsed.body.firstChild);

    // light DOM 的 .blank（新标签页）必须有 <slot> 才进渲染树：attachShadow 后未被
    // 投射的 light 子树不渲染，inline 尺寸也救不回来。放最后 → 层叠压过案例内容。
    shadow.append(document.createElement('slot'));

    if (getLang() === 'en') applyLang(shadow, c.key);

    const rootSel = ROOT_SEL[c.key] ?? '#app';
    const root = shadow.querySelector<HTMLElement>(rootSel);
    if (!root) {
      hintEl.textContent = trf('这一页没有装上创造者模式：找不到 {0}', rootSel);
      return;
    }

    let swarmAttr: SwarmBuilderOptions = {};
    try {
      swarmAttr = JSON.parse(parsed.body.dataset.swarm ?? '{}') as SwarmBuilderOptions;
    } catch {
      // 预设页的 data-swarm 是仓库自己写的，坏 JSON 只会来自误改，退回默认值继续。
    }
    // 引擎默认 scan:'pre-scroll'（打开先逐屏滚一遍逼懒加载，扫完才出集群开建）——
    // 母本在 iframe 里滚的是案例自身，用户看到的「预加载滚动全局 + 空白 + 集群后才构建」
    // 正是这一段。容器里按用户反馈强制 single（不预滚，挂载即开建）；面板里仍可调回。
    // onComplete：首局构建完成 → 顶栏落回（pre-build 进场态，见 revealChrome）。
    const initial: SwarmBuilderOptions = {
      ...swarmAttr,
      ...(CASE_INIT[c.key] ?? {}),
      scan: 'single',
      onComplete: revealChrome,
    };

    tuner = tune({
      root,
      initial,
      open: creatorOn,
      position: 'bottom-right',
      lang: getLang(),
      // CSS 不跨 shadow 边界：引擎样式直接注进案例的 shadow 根（上游 styleRoot 选项），
      // 不再从 document.head 抄一份副本进来。
      styleRoot: shadow,
    });
    window.__tuner = tuner;
    liftPanel();
    // 母本 loadPreset 每次挂载都显式开跑：面板只负责调参，不负责启动这一局。
    tuner.apply();
    if (params.has('auto')) tuner.apply();

    // 面板 host 挂在 body 上（shadow 同步创建）：注入 Chrome 61 基线 compat + gap 能力类。
    const panelHost = document.querySelector<HTMLElement>('[data-sb-chrome]');
    if (panelHost) {
      panelHost.classList.toggle('supports-flex-gap', flexGapOk);
      const panelShadow = panelHost.shadowRoot;
      if (panelShadow && !panelShadow.querySelector('style[data-panel-compat]')) {
        const compat = document.createElement('style');
        compat.setAttribute('data-panel-compat', '');
        compat.textContent = panelCss;
        panelShadow.append(compat);
      }
    }

    bootCase(c.key, shadow);
  }

  /** 案例内联 script 被构建期剥离后的功能代接：母本脚本逻辑按 key 在这里补回。 */
  function bootCase(key: string, sr: ShadowRoot): void {
    // dark-ui：canvas 预览图（母本 paintGlView IIFE）。
    if (key === 'dark-ui') paintGlView(sr);

    // home：「再盖一遍」= 面板的「应用并重跑」（母本 [data-replay] → __tuner.apply）。
    const replay = sr.querySelector<HTMLElement>('[data-replay]');
    if (replay) replay.addEventListener('click', () => tuner?.apply());

    // home：提示词一键复制。容器禁 clipboard/execCommand —— 降级为选中正文让用户自己复制。
    const copyBtn = sr.querySelector<HTMLButtonElement>('[data-copy-prompt]');
    const promptBlock = sr.querySelector<HTMLElement>('[data-prompt]');
    if (copyBtn && promptBlock) setupPrompt(sr, copyBtn, promptBlock);
  }

  /** 母本 dark-ui 内联 script 的原样移植：给 .gl-view canvas 画预览底图。 */
  function paintGlView(sr: ShadowRoot): void {
    const c = sr.querySelector<HTMLCanvasElement>('.gl-view');
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.fillStyle = '#2d3138';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#5f6a7a';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, (c.height / 4) * i);
      g.lineTo(c.width, (c.height / 4) * i);
      g.stroke();
    }
    const grd = g.createLinearGradient(0, 0, c.width, c.height);
    grd.addColorStop(0, '#c9793c');
    grd.addColorStop(1, '#6d7a45');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(c.width * 0.5, c.height * 0.45, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e6e9ef';
    g.font = '11px sans-serif';
    g.fillText('viewport GL', 8, c.height - 8);
  }

  /** 母本 prompt.ts 的移植：EN 整段替换 + 复制（容器里降级为「选中」）。 */
  function setupPrompt(sr: ShadowRoot, button: HTMLButtonElement, block: HTMLElement): void {
    const idle = (): string => (getLang() === 'en' ? 'Copy prompt' : '一键复制');
    if (getLang() === 'en') block.textContent = PROMPT_EN;
    button.textContent = idle();
    button.addEventListener('click', () => {
      // 正文在 shadow 树里：document 的 selection 选不中 shadow 内容（Range 能指过去，
      // 但 toString 取不到文本）。用该 shadow 树自带的 getSelection（Chromium 有），
      // 老引擎没有再退回 window 的。
      const treeSel = (sr as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
      const sel = treeSel ?? window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(block);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      button.textContent = getLang() === 'en' ? 'Selected — press Ctrl+C' : '已选中，按 Ctrl+C 复制';
      button.dataset.copied = 'true';
      setTimeout(() => {
        button.textContent = idle();
        delete button.dataset.copied;
      }, 1600);
    });
  }

  function load(): void {
    addrEl.dataset.loading = 'true';
    barEl.dataset.phase = 'idle';
    hintEl.textContent = tr('载入中…');
    metaEl.textContent = '';

    const c = caseOf(current());
    if (c.custom) {
      showBlank(c);
      return;
    }
    blankEl.hidden = true;
    mountCase(c);
    addrEl.dataset.loading = 'false';
  }

  function offlineHint(): void {
    hintSay(
      say(
        '容器不联网：站外地址抓不进来，先看内置案例',
        'Offline container: external addresses cannot be fetched — pick a built-in case',
      ),
    );
    metaEl.textContent = '';
  }

  // 状态镜像每 200ms 覆写状态条：用户反馈类提示（离线、地址读不懂）要粘住几秒才看得清。
  let hintHoldUntil = 0;
  function hintSay(text: string, holdMs = 3000): void {
    hintEl.textContent = text;
    hintHoldUntil = performance.now() + holdMs;
  }

  function showBlank(c: Case): void {
    blankEl.hidden = false;
    // 案例内容会把 viewport 撑到几千像素高，blank 居中就跑到视口外了——新标签页限回可视高度。
    viewportEl.classList.add('is-blank');
    blankInput.value = c.url ?? '';
    addrEl.dataset.loading = 'false';
    hintSay(tr('新标签页：输入一个地址，回车就开工'));
    metaEl.textContent = '';
    if (!blankChips.childElementCount) {
      for (const chip of CHIPS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip';
        btn.textContent = tr(chip.label);
        btn.addEventListener('click', () => pickChip(chip.href));
        blankChips.append(btn);
      }
    }
    blankInput.focus();
  }

  /** chip：站内地址切到内置案例，公网地址只产出离线提示。 */
  function pickChip(href: string): void {
    const preset = CASES.find((c) => c.href === href);
    if (preset) {
      go(preset.key);
      return;
    }
    offlineHint();
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
    load();
    return key;
  }

  /** 同源相对地址直接切内置案例；其余地址校验后只留提示——容器不联网，抓不进来。 */
  function navigate(key: string, raw: string): void {
    const preset = CASES.find((c) => c.href === raw.trim());
    if (preset) {
      go(preset.key);
      return;
    }
    const c = caseOf(key);
    const url = normalize(raw);
    if (!url) {
      blankInput.dataset.bad = 'true';
      hintSay(tr('这个地址读不懂（只认 http/https，或站内相对路径）'));
      return;
    }
    delete blankInput.dataset.bad;
    c.url = url;
    c.title = tabTitle(url);
    const label = tabEls.get(key)?.querySelector('b');
    if (label) label.textContent = c.title;
    blankInput.value = url;
    paintChrome();
    offlineHint();
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
    if (wasCurrent) load();
  }

  function go(key: string): void {
    if (key === current()) {
      load();
      return;
    }
    stack.splice(cursor + 1, stack.length, key);
    cursor = stack.length - 1;
    paintChrome();
    load();
  }

  /** 只认 http(s)：`javascript:` 与 `data:` 绝不能进提示流程。 */
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

  backBtn.addEventListener('click', () => {
    if (cursor === 0) return;
    cursor -= 1;
    paintChrome();
    load();
  });
  fwdBtn.addEventListener('click', () => {
    if (cursor >= stack.length - 1) return;
    cursor += 1;
    paintChrome();
    load();
  });
  reloadBtn.addEventListener('click', () => load());
  newTabBtn.addEventListener('click', () => openBlank());
  blankForm.addEventListener('submit', (e) => {
    // 容器规范认可的表单写法：保表单、拦提交，输入由 JS 处理。
    e.preventDefault();
    navigate(current(), blankInput.value);
  });

  // 语言切换走整页重载：外壳静态文案、案例字典、面板语言都从 ?lang= 与 localStorage
  // 读一次，热切换要把这几处分别再跑一遍，不如重载可靠。母本是 location.href= 跳转，
  // 这里改成 replaceState + reload（location.href= 在容器禁令里）。
  langBtn.addEventListener('click', () => {
    const next = getLang() === 'en' ? 'zh' : 'en';
    setLang(next);
    const url = new URL(location.href);
    url.searchParams.set('lang', next);
    history.replaceState(null, '', `${url.pathname}?${url.searchParams}${url.hash}`);
    location.reload();
  });

  creatorBtn.addEventListener('click', () => {
    creatorOn = !creatorOn;
    creatorBtn.setAttribute('aria-pressed', String(creatorOn));
    if (!tuner) return;
    if (creatorOn) tuner.open();
    else tuner.close();
  });

  // 容器禁开新窗口与站外跳转：捕获阶段拦下所有链接——外壳与 shadow 内的案例都算。
  // composedPath 穿透 shadow 边界（document 层的 e.target 已被重定向到 host，closest 找不到）。
  document.addEventListener(
    'click',
    (e) => {
      const link = e
        .composedPath()
        .find((n): n is Element => n instanceof Element && n.tagName === 'A');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const href = link.getAttribute('href') ?? '';
      if (/^(?:https?:|\/\/)/i.test(href)) offlineHint();
    },
    true,
  );

  // 面板与外壳的状态互为镜像，像真浏览器反映页面状态那样。
  let overlayEverSeen = false;
  setInterval(() => {
    if (!tuner) return;
    barEl.dataset.phase = tuner.phase;
    // 粘住的反馈提示（离线等）未到期时不覆写。
    if (performance.now() > hintHoldUntil) {
      hintEl.textContent = `${tr(caseOf(current()).title)} · ${tuner.status}`;
    }
    const items = shadow?.querySelectorAll('.sb-item').length ?? 0;
    metaEl.textContent = items > 0 ? trf('{0} 个盒子在画', items) : '';

    // 顶栏展开（pre-build 进场态收尾）三路信号，先到先开、幂等：
    // ① 自然完成 / 跳过 / 空蓝图 → onComplete（mountCase 挂的 revealChrome，最快）；
    // ② Esc 中止与「恢复原状」走 stop()/destroy()，不回调 onComplete——
    //    以重建层 overlay「曾经在、现在没了」为准（reducedMotion skip 没挂过 overlay，
    //    由 ③ 兜）；
    // ③ 面板 HUD 的 done 相位（skip 路径 setResult 会置）。
    if (!chromeShown) {
      const overlay = shadow?.querySelector('.sb-overlay');
      if (overlay) overlayEverSeen = true;
      else if (overlayEverSeen || tuner.phase === 'done') revealChrome();
    }
  }, 200);

  // data-say 的新文案不在母本字典里：按当前语言二选一填。
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-say]'))) {
    el.textContent = getLang() === 'en' ? el.dataset.sayEn ?? '' : el.dataset.sayZh ?? '';
  }

  window.addEventListener('resize', measureChrome);
  measureChrome();
  readSafeTop();

  // 验收吊钩：让测试能直接驱动 API，不必点 UI（母本 browser.ts 同款）。
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

  // ?u= 让分享链接直接落到某个地址上——容器不联网，落成一句明示的离线提示。
  const bootUrl = params.get('u');
  if (bootUrl) {
    navigate(openBlank(), bootUrl);
  } else {
    paintChrome();
    load();
  }
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
    __tuner?: SwarmTuner | undefined;
    SwarmBuilder: typeof SwarmBuilder;
  }
}

// 母本 creator.ts 同款：验收 harness 用它直接驱动 API。
window.SwarmBuilder = SwarmBuilder;
