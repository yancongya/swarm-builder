/** * 小工具外壳的容器适配层：标签条、历史栈、空白页、地址校验、创造者钮与 __browser
 * 吊钩都在 demos/shell-core.ts（与母本 demos/browser.ts 共用骨架）。
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
import { createShellCore, need, say, normalize, tabTitle, type Case } from '../../demos/shell-core';
import { createBootIntro, decorateOrb, mountLogo } from '../../demos/boot-intro';
import { mountBlenderUi } from '../../demos/blender-ui';
import caseCss from 'minitool:case-css';
import panelCss from 'minitool:panel-css';
import homeHtml from 'minitool:case-html:home';
import consoleHtml from 'minitool:case-html:console';
import blenderHtml from 'minitool:case-html:blender';

/** 构建期已剥 script/link/_blank 的案例 HTML，key 与 demos/<key>.html 一致。 */
const CASE_HTML: Record<string, string> = {
  home: homeHtml,
  console: consoleHtml,
  blender: blenderHtml,
};

/**
 * home 提示词的英文整段（母本 demos/prompt.ts 的 PROMPT_EN 原样搬入——
 * 那个模块带 clipboard/execCommand，import 进包会被门禁拦；只取文本）。
 * 中文留在案例 HTML 里当源码，切 EN 时整段替换。
 */
const PROMPT_EN = `Add a Swarm Builder entrance animation to my project. Perform these steps, not just describe them.

1. Clone and build the source. The package is not on npm yet and dist is not committed. Do not use npm i swarm-builder or npm i github:yancongya/swarm-builder:
   git clone https://github.com/yancongya/swarm-builder.git
   cd swarm-builder
   npm install
   npm run build
2. Return to my project directory and install the locally built repository:
   npm i ../swarm-builder
   If the directories are not siblings, use the actual path to the swarm-builder repository. Alternatively, run npm pack in that repository and install the generated swarm-builder-0.1.0.tgz in my project.
3. After my target container mounts, integrate it:
   import { mount } from 'swarm-builder';
   mount({ root: document.querySelector('#app'), agentCount: 8, order: 'rows', tour: true });
   Replace #app with my real container. Use useEffect in React or onMounted in Vue.
4. Preserve the page structure and business logic. This is an entrance animation; temporary construction boxes are not interactive and the real DOM must be returned at the end. Check mobile viewports for horizontal overflow and verify the original interactions still work.`;

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
  const intro = createBootIntro(
    // 开场是独立的全屏场景，不跟随为原生按钮避让后的页面视口偏移。
    () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
    () => {
      const orb = activePanelHost?.shadowRoot?.querySelector<HTMLElement>('.orb');
      if (!orb) return null;
      if (!orb.querySelector('.logo-motion')) decorateOrb(orb);
      const rect = orb.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { orb, rect } : null;
    },
    () => { if (activePanelHost) activePanelHost.style.visibility = ''; },
  );
  const tabsEl = need<HTMLElement>('[data-tabs]');
  const navEl = need<HTMLElement>('.nav');
  const langBtn = need<HTMLButtonElement>('[data-lang]');
  const viewportEl = need<HTMLElement>('[data-viewport]');

  // flex gap 能力类：外壳 document 与案例 shadow 的 host 都要带（见 detectFlexGap 注释）。
  const flexGapOk = detectFlexGap();
  document.documentElement.classList.toggle('supports-flex-gap', flexGapOk);
  viewportEl.classList.toggle('supports-flex-gap', flexGapOk);

  let tuner: SwarmTuner | null = null;
  let cleanBlenderUi: (() => void) | null = null;
  let shadow: ShadowRoot | null = null;
  let activeCaseKey: string | null = null;
  let activePanelHost: HTMLElement | null = null;
  const cachedCases = new Map<string, { nodes: DocumentFragment; tuner: SwarmTuner; panelHost: HTMLElement | null }>();

  // 进场态：顶栏（tabs+nav）藏起、视口让到状态栏下沿，构建完成才落回（见 shell-extra.css）。
  document.documentElement.classList.add('pre-build');
  let chromeShown = false;
  function revealChrome(): void {
    if (chromeShown) return;
    // tour 用 smooth scroll 跟随施工，最后一段滚动可能还没停。
    // 在顶栏改变视口高度前取消滚动并回到首屏，避免交还真实页面时标题被截掉。
    viewportEl.scrollTop = 0;
    chromeShown = true;
    document.documentElement.classList.remove('pre-build');
  }

  /**
   * 顶部出血：容器里系统状态栏浮在 webview 上方，fixed top:0 会被盖住。
   * 官方 getWindowInfo()（9.49+，异步，文档明令禁止硬编码）写进 --sb-safe-top；
   * 浏览器直跑 / 旧客户端没有 window.xhs → 保持 0px 兜底（桌面本就没有状态栏）。
   * pre-build 期间顶栏本来就藏着，接口返回前不会有顶栏露出。
   *
   * 出血量取三者的最大值，而不是只看 statusBarHeight——真机上「盖住顶栏的」不止状态栏：
   * - safeArea.top：安全区矩形含刘海/挖孔，全屏 webview 里通常 ≥ 状态栏高度；
   * - menuButtons：容器原生的 back/me/share 按钮悬在标题栏那一带，可见时我们的
   *   标签条正好落在同一条水平带上，必须让到按钮底边之下；
   * - statusBarHeight：状态栏本身，作为前两者缺失时的兜底。
   * 文档另要求窗口形态变化（分屏、折叠、转屏）后重新读取，resize 时再跑一次。
   */
  function readSafeTop(): void {
    const xhs = (
      window as unknown as {
        xhs?: {
          miniTool?: {
            getWindowInfo?: () => Promise<{
              statusBarHeight?: number;
              safeArea?: { top?: number } | null;
              menuButtons?: { back?: { bottom?: number } | null; me?: { bottom?: number } | null; share?: { bottom?: number } | null } | null;
            }>;
          };
        };
      }
    ).xhs;
    const get = xhs?.miniTool?.getWindowInfo;
    if (typeof get !== 'function') return;
    void get()
      .then((info) => {
        const buttons = [info?.menuButtons?.back, info?.menuButtons?.me, info?.menuButtons?.share]
          .filter((b): b is { bottom?: number } => b != null)
          .map((b) => Number(b.bottom) || 0);
        const h = Math.max(
          Number(info?.statusBarHeight) || 0,
          Number(info?.safeArea?.top) || 0,
          ...buttons,
        );
        if (Number.isFinite(h) && h > 0) {
          document.documentElement.style.setProperty('--sb-safe-top', `${h}px`);
        }
      })
      .catch(() => {
        // 拿不到就不避让：接口不在（旧客户端/非容器）与读取失败同样按 0 处理。
      });
  }

  /** chrome 高度实测：双语换行、窄屏折行都会改它，viewport 开窗的 top/bottom 靠这三个变量对齐。 */
  function measureChrome(): void {
    const style = document.documentElement.style;
    style.setProperty('--sb-tabs-h', `${tabsEl.offsetHeight}px`);
    style.setProperty('--sb-chrome-h', `${tabsEl.offsetHeight + navEl.offsetHeight}px`);
    style.setProperty('--sb-status-h', `${core.barEl.offsetHeight}px`);
  }

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
      core.hintEl.textContent = tr('这一页没有装上创造者模式');
      return;
    }
    const parsed = new DOMParser().parseFromString(html, 'text/html');

    tuner?.destroy();
    cleanBlenderUi?.();
    cleanBlenderUi = null;
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
    mountLogo(shadow.querySelector<HTMLElement>('.page-home .logo-motion'));
    if (c.key === 'blender') cleanBlenderUi = mountBlenderUi(shadow);

    const root = shadow.querySelector<HTMLElement>('#app');
    if (!root) {
      core.hintEl.textContent = trf('这一页没有装上创造者模式：找不到 {0}', '#app');
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
      scan: 'single',
      onStatus: (status) => intro.phase(status.phase),
      onComplete: revealChrome,
    };

    tuner = tune({
      root,
      initial,
      open: core.creatorOn,
      position: 'bottom-right',
      lang: getLang(),
      // CSS 不跨 shadow 边界：引擎样式直接注进案例的 shadow 根（上游 styleRoot 选项），
      // 不再从 document.head 抄一份副本进来。
      styleRoot: shadow,
    });
    window.__tuner = tuner;
    const panelHosts = document.querySelectorAll<HTMLElement>('[data-sb-chrome]');
    activePanelHost = panelHosts[panelHosts.length - 1] ?? null;
    const orb = activePanelHost?.shadowRoot?.querySelector<HTMLElement>('.orb');
    if (orb) decorateOrb(orb);
    // 小工具面板与飞行层同属顶层文档，面板 z-index 更高。先藏整块面板
    // （包括旧名字牌），等中央 logo 真正飞到球位后再交接显示。
    if (activePanelHost && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      activePanelHost.style.visibility = 'hidden';
    }
    liftPanel();
    // 母本 loadPreset 每次挂载都显式开跑：面板只负责调参，不负责启动这一局。
    // 开场标识播满一圈才放行：资源是打包进来的、秒回，不等这一圈就只闪一下 logo。
    const mine = tuner;
    void intro.played().then(() => {
      // 这一圈里用户已经自己开过跑就别再补一发：Esc 中止后相位回 idle，
      // 只看当前相位会把「再盖一遍 → 立刻 Esc」那一局从头打断，所以也认 runEverSeen。
      if (!mine || tuner !== mine || runEverSeen || mine.runPhase !== 'idle') return;
      mine.apply();
      if (core.params.has('auto')) mine.apply();
    });

    // 面板 host 挂在 body 上（shadow 同步创建）：注入 Chrome 61 基线 compat + gap 能力类。
    const panelHost = activePanelHost;
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

    // home：「再盖一遍」= 面板的「应用并重跑」（母本 [data-replay] → __tuner.apply）。
    const replay = sr.querySelector<HTMLElement>('[data-replay]');
    if (replay) replay.addEventListener('click', () => tuner?.apply());

    // home：提示词一键复制。容器禁 clipboard/execCommand —— 降级为选中正文让用户自己复制。
    const copyBtn = sr.querySelector<HTMLButtonElement>('[data-copy-prompt]');
    const promptBlock = sr.querySelector<HTMLElement>('[data-prompt]');
    if (copyBtn && promptBlock) setupPrompt(sr, copyBtn, promptBlock);
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
    const c = core.caseOf(core.current());
    viewportEl.dataset.case = c.key;
    const switching = activeCaseKey !== null && activeCaseKey !== c.key;
    if (switching && shadow && tuner?.runPhase === 'done') {
      cleanBlenderUi?.();
      cleanBlenderUi = null;
      const nodes = document.createDocumentFragment();
      while (shadow.firstChild) nodes.append(shadow.firstChild);
      if (activePanelHost) activePanelHost.style.display = 'none';
      cachedCases.set(activeCaseKey as string, { nodes, tuner, panelHost: activePanelHost });
      tuner = null;
      activePanelHost = null;
    }
    if (switching) {
      const cached = cachedCases.get(c.key);
      if (cached && shadow) {
        tuner?.destroy();
        cleanBlenderUi?.();
        shadow.innerHTML = '';
        shadow.append(cached.nodes);
        tuner = cached.tuner;
        activePanelHost = cached.panelHost;
        if (activePanelHost) activePanelHost.style.display = '';
        window.__tuner = tuner;
        if (core.creatorOn) tuner.open();
        else tuner.close();
        if (c.key === 'blender') cleanBlenderUi = mountBlenderUi(shadow);
        cachedCases.delete(c.key);
        activeCaseKey = c.key;
        intro.dismiss();
        viewportEl.classList.remove('is-blank');
        core.beginLoad();
        core.addrEl.dataset.loading = 'false';
        return;
      }
    }
    activeCaseKey = c.key;
    intro.show();
    runEverSeen = false;
    core.beginLoad();
    if (c.custom) {
      tuner?.destroy();
      tuner = null;
      cleanBlenderUi?.();
      cleanBlenderUi = null;
      activePanelHost = null;
      window.__tuner = undefined;
      intro.dismiss();
      core.showBlank(c);
      return;
    }
    mountCase(c);
    core.addrEl.dataset.loading = 'false';
  }

  // 状态镜像每 200ms 覆写状态条：用户反馈类提示（离线、地址读不懂）要粘住几秒才看得清。
  let hintHoldUntil = 0;
  function hintSay(text: string, holdMs = 3000): void {
    core.hintEl.textContent = text;
    hintHoldUntil = performance.now() + holdMs;
  }

  function offlineHint(): void {
    hintSay(
      say(
        '容器不联网：站外地址抓不进来，先看内置案例',
        'Offline container: external addresses cannot be fetched — pick a built-in case',
      ),
    );
    core.metaEl.textContent = '';
  }

  /** chip：站内地址切到内置案例，公网地址只产出离线提示。 */
  function pickChip(href: string): void {
    const preset = core.cases.find((c) => c.href === href);
    if (preset) {
      core.go(preset.key);
      return;
    }
    offlineHint();
  }

  /** 同源相对地址直接切内置案例；其余地址校验后只留提示——容器不联网，抓不进来。 */
  function navigate(key: string, raw: string): void {
    const preset = core.cases.find((c) => c.href === raw.trim());
    if (preset) {
      core.go(preset.key);
      return;
    }
    const c = core.caseOf(key);
    const url = normalize(raw);
    if (!url) {
      core.blankInput.dataset.bad = 'true';
      hintSay(tr('这个地址读不懂（只认 http/https，或站内相对路径）'));
      return;
    }
    delete core.blankInput.dataset.bad;
    c.url = url;
    c.title = tabTitle(url);
    core.setTabTitle(key, c.title);
    core.blankInput.value = url;
    core.paintChrome();
    offlineHint();
  }

  const core = createShellCore({
    load,
    navigate,
    chip: pickChip,
    tuner: () => tuner,
    hint: (text) => hintSay(text),
    // 案例内容会把 viewport 撑到几千像素高，blank 居中就跑到视口外了——新标签页限回可视高度。
    blankShown: () => viewportEl.classList.add('is-blank'),
    // 创造者面板默认收起（用户要求）：顶栏「创造者模式」钮随时可展开。
    creatorDefault: false,
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
  let runEverSeen = false;
  setInterval(() => {
    if (!tuner) return;
    const run = tuner.runPhase;
    core.barEl.dataset.phase = tuner.phase;
    // 中途「恢复原状」/Esc 走 stop()，相位回 idle：onStatus 不再报 building，
    // 还停在聚群那一步的进场遮罩得有人收。
    if (run !== 'idle') runEverSeen = true;
    else if (runEverSeen) intro.dismiss();
    // 粘住的反馈提示（离线等）未到期时不覆写。
    if (performance.now() > hintHoldUntil) {
      core.hintEl.textContent = `${tr(core.caseOf(core.current()).title)} · ${tuner.status}`;
    }
    const items = shadow?.querySelectorAll('.sb-item').length ?? 0;
    core.metaEl.textContent = items > 0 ? trf('{0} 个盒子在画', items) : '';

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

  window.addEventListener('resize', () => {
    measureChrome();
    readSafeTop();
  });
  measureChrome();
  readSafeTop();

  // ?u= 让分享链接直接落到某个地址上——容器不联网，落成一句明示的离线提示。
  core.boot();
}

declare global {
  interface Window {
    __tuner?: SwarmTuner | undefined;
    SwarmBuilder: typeof SwarmBuilder;
  }
}

// 母本 creator.ts 同款：验收 harness 用它直接驱动 API。
window.SwarmBuilder = SwarmBuilder;
