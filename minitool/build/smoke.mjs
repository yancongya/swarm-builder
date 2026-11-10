/**
 * 外壳冒烟（Task #3/#4 共用）：
 *   node minitool/build/smoke.mjs [baseUrl]
 * 默认打 http://127.0.0.1:4173（先起 `npx vite preview --config minitool/vite.config.ts`）。
 * 断言外壳与案例挂载的关键路径，截图落在 build/smoke-*.png；有问题退出码 1。
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const shots = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
};

try {
  // 滚动归属探针（页面脚本前注入）：外壳文档必须全程 0，滚动只能落在 viewport
  // （它自己就是案例的滚动容器）。轮询采样两个极值，避免依赖事件时序。
  await page.addInitScript(() => {
    window.__winScrollMax = 0;
    window.__vpScrollMax = 0;
    setInterval(() => {
      window.__winScrollMax = Math.max(window.__winScrollMax, Math.abs(window.scrollY));
      const vp = document.querySelector('[data-viewport]');
      if (vp) window.__vpScrollMax = Math.max(window.__vpScrollMax, Math.abs(vp.scrollTop));
    }, 50);
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 1. 外壳骨架（locator 会穿透 open shadow：必须限定外壳自己的 [data-tabs]，否则数进案例内容）
  const tabs = await page.locator('[data-tabs] .tab').count();
  if (tabs !== 7) fail(`期望 7 个案例标签，实际 ${tabs}`);

  // 2. __browser 钩子与默认案例
  const boot = await page.evaluate(() => ({
    current: window.__browser?.current(),
    cases: window.__browser?.cases ?? [],
  }));
  if (boot.current !== 'home') fail(`默认案例应为 home，实际 ${boot.current}`);
  if (boot.cases.length !== 7) fail(`cases 应为 7，实际 ${boot.cases.length}`);

  // 2b. 进场态与默认态：顶栏藏起（构建完成才落回）、创造者面板默认收起。
  //     600ms 时一局不可能建完（home 335 项要十几秒），pre-build 必须还在。
  const entry = await page.evaluate(() => ({
    preBuild: document.documentElement.classList.contains('pre-build'),
    creatorPressed: document.querySelector('[data-creator]')?.getAttribute('aria-pressed'),
    panelExpanded: window.__tuner?.expanded ?? null,
  }));
  if (!entry.preBuild) fail('进场态缺失：html 没有 pre-build（顶栏应先藏起）');
  if (entry.creatorPressed !== 'false') fail(`创造者钮应默认未按下，实际 ${entry.creatorPressed}`);
  if (entry.panelExpanded !== false) fail(`创造者面板应默认收起，实际 expanded=${entry.panelExpanded}`);

  // 3. 案例挂进 shadow：有内容、有 #app、引擎开始画
  const shadow = await page.evaluate(() => {
    const sr = document.querySelector('[data-viewport]')?.shadowRoot;
    if (!sr) return { shadow: false };
    return {
      shadow: true,
      children: sr.children.length,
      hasApp: !!sr.querySelector('#app'),
      styles: sr.querySelectorAll('style').length,
      title: sr.querySelector('h1, h2')?.textContent?.slice(0, 30) ?? '',
    };
  });
  if (!shadow.shadow) fail('viewport 没有 shadowRoot');
  if (!shadow.hasApp) fail('shadow 里没有 #app');
  // home 没有案例内联 <style>（共享样式 + styleRoot 注入的引擎样式）；案例内联样式留给 tune 类案例验
  if (shadow.styles < 1) fail(`shadow 至少要有共享 style，实际 ${shadow.styles}`);

  // 4. 创造者面板（body 上的 host）+ 状态镜像 + 默认收起
  const panel = await page.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    return { exists: !!host, bottom: host?.style.bottom ?? '', expanded: window.__tuner?.expanded ?? null };
  });
  if (!panel.exists) fail('创造者面板 host 不在 document 上');
  if (!panel.bottom.includes('status')) fail(`面板未让开状态条：bottom=${panel.bottom}`);
  if (panel.expanded !== false) fail(`面板应默认收起：expanded=${panel.expanded}`);

  // 5. chrome 高度测量变量
  const vars = await page.evaluate(() => {
    const s = document.documentElement.style;
    return {
      tabs: s.getPropertyValue('--sb-tabs-h'),
      chrome: s.getPropertyValue('--sb-chrome-h'),
      status: s.getPropertyValue('--sb-status-h'),
    };
  });
  if (!vars.tabs || !vars.chrome || !vars.status) fail(`chrome 测量变量缺失：${JSON.stringify(vars)}`);

  // 6. 引擎真的在画：开场聚群阶段先出光标（.sb-cursor），盒子（.sb-item）随后、
  //    完成时 reveal 又会收走——断言光标最稳（挂载后 1s 内必有）。
  await page.waitForTimeout(1500);
  const engine = await page.evaluate(() => {
    const sr = document.querySelector('[data-viewport]')?.shadowRoot;
    return {
      cursors: sr?.querySelectorAll('.sb-cursor').length ?? 0,
      items: sr?.querySelectorAll('.sb-item').length ?? 0,
      status: window.__tuner?.status ?? '',
    };
  });
  if (engine.cursors < 1) fail(`shadow 里没有 .sb-cursor——引擎没画（${JSON.stringify(engine)}）`);

  // 6b. 引擎样式必须在 shadow 里生效：CSS 不跨 shadow 边界——外壳把 styleRoot
  //     指向案例 shadow，引擎 injectStyle 直接注进去（不再抄副本）。断言 computed position。
  const libStyles = await page.evaluate(() => {
    const sr = document.querySelector('[data-viewport]')?.shadowRoot;
    const overlay = sr?.querySelector('.sb-overlay');
    const cursor = sr?.querySelector('.sb-cursor');
    return {
      hasLib: !!sr?.querySelector('style#swarm-builder-style'),
      overlayPos: overlay ? getComputedStyle(overlay).position : null,
      cursorPos: cursor ? getComputedStyle(cursor).position : null,
    };
  });
  if (!libStyles.hasLib) fail('shadow 缺引擎样式 style#swarm-builder-style（styleRoot 未注入）');
  if (libStyles.overlayPos !== 'absolute') fail(`overlay position 应 absolute，实际 ${libStyles.overlayPos}`);
  if (libStyles.cursorPos !== 'absolute') fail(`cursor position 应 absolute，实际 ${libStyles.cursorPos}`);

  // 6c. 预扫描已按用户反馈关闭（mountCase 强制 scan:'single'）：打开后不该再有
  //     「先滚动一遍才构建」——外壳文档恒 0，viewport 也不该被预扫（阈值 100 容忍
  //     构建期 tour 的几像素微调；原预扫描一滚就是 4000+）。
  const scrolls = await page.evaluate(() => ({
    win: window.__winScrollMax ?? -1,
    vp: window.__vpScrollMax ?? -1,
    pos: getComputedStyle(document.querySelector('[data-viewport]')).position,
  }));
  if (scrolls.win > 1) fail(`打开后外壳文档被滚动：window scroll max=${scrolls.win}`);
  if (scrolls.vp > 100) fail(`预扫描仍发生了（应已强制 single）：viewport max=${scrolls.vp}`);
  if (scrolls.pos !== 'fixed') fail(`viewport 应为 fixed 外壳开窗，实际 ${scrolls.pos}`);

  await page.screenshot({ path: `${shots}smoke-home.png` });

  // 6d. 顶栏藏起期间标签在屏外点不到（进场态的预期行为）：先 Esc 结束首局 →
  //     onComplete 摘掉 pre-build → 顶栏落回，再走后续的标签点击路径。
  await page.keyboard.press('Escape');
  try {
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('pre-build'),
      { timeout: 8000 },
    );
  } catch {
    fail('首局结束后顶栏未展开（pre-build 未摘除）');
  }
  await page.waitForTimeout(600);
  const entryTabs = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.tabs')).transform;
    return { transform: t, pressed: document.querySelector('[data-creator]')?.getAttribute('aria-pressed') };
  });
  if (entryTabs.transform && entryTabs.transform !== 'none' && !/^matrix\(1, 0, 0, 1, 0, ?0\)$/.test(entryTabs.transform)) {
    fail(`顶栏未落回原位：transform=${entryTabs.transform}`);
  }

  // 7. 切标签（同步挂载）
  await page.click('[data-tabs] .tab[data-key="simple"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    current: window.__browser.current(),
    panels: document.querySelectorAll('[data-sb-chrome]').length,
    url: location.search,
  }));
  if (after.current !== 'simple') fail(`切标签失败，current=${after.current}`);
  if (after.panels !== 1) fail(`面板应只有 1 个（旧的要销毁），实际 ${after.panels}`);
  if (!after.url.includes('case=simple')) fail(`URL 未同步 case 参数：${after.url}`);

  // 8. 外链拦截：点 gh 链接不该导航，只提示离线
  const urlBefore = page.url();
  await page.click('[data-github]');
  await page.waitForTimeout(200);
  const hint = (await page.textContent('[data-hint]')) ?? '';
  if (page.url() !== urlBefore) fail(`外链点击导致导航：${page.url()}`);
  if (!/不联网|Offline/i.test(hint)) fail(`外链点击未给出离线提示：${hint}`);

  // 9. 新标签页 + 离线语义（example.com chip）
  await page.click('[data-newtab]');
  await page.waitForTimeout(200);
  const blankVisible = await page.evaluate(() => !document.querySelector('[data-blank]').hidden);
  if (!blankVisible) fail('新标签页 blank 未显示');
  const chipCount = await page.locator('.blank-chips .chip').count();
  if (chipCount !== 3) fail(`chips 应 3 条，实际 ${chipCount}`);
  await page.click('.blank-chips .chip:nth-child(3)'); // example.com
  await page.waitForTimeout(200);
  const hint2 = (await page.textContent('[data-hint]')) ?? '';
  if (!/不联网|Offline/i.test(hint2)) fail(`example.com chip 未给出离线提示：${hint2}`);

  // 10. 站内相对地址输入 → 切回内置案例（./simple.html）
  await page.fill('[data-blank-input]', './tall.html');
  await page.click('.blank-go');
  await page.waitForTimeout(500);
  const nav = await page.evaluate(() => window.__browser.current());
  if (nav !== 'tall') fail(`./tall.html 应切到内置案例，实际 ${nav}`);

  // 11. 容器滚动模型（tall 案例比窗口高：viewport 自己就是滚动容器，
  //     引擎 detectEnv 跨 shadow 找到它；外壳文档永不滚）
  const scroll = await page.evaluate(() => {
    const vp = document.querySelector('[data-viewport]');
    const tabsH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sb-tabs-h')) || 36;
    return {
      docScrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      vpPos: vp ? getComputedStyle(vp).position : null,
      vpOverflowY: vp ? getComputedStyle(vp).overflowY : null,
      scScrollH: vp?.scrollHeight ?? 0,
      scClientH: vp?.clientHeight ?? 0,
      tabsH,
      chromeTop: document.querySelector('.nav').getBoundingClientRect().top,
    };
  });
  if (scroll.vpPos !== 'fixed') fail(`viewport 应为 fixed 外壳开窗，实际 ${scroll.vpPos}`);
  if (scroll.vpOverflowY !== 'auto') fail(`viewport 应自己是滚动容器，实际 overflow-y=${scroll.vpOverflowY}`);
  if (scroll.scScrollH <= scroll.scClientH) fail(`tall 案例未超出 viewport：${scroll.scScrollH} <= ${scroll.scClientH}`);
  if (scroll.docScrollH > scroll.innerH) fail(`外壳文档不应可滚：${scroll.docScrollH} > ${scroll.innerH}`);
  if (Math.abs(scroll.chromeTop - scroll.tabsH) > 2) {
    fail(`nav 未固定在 tabs 下沿：top=${scroll.chromeTop}`);
  }
  await page.evaluate(() => {
    const vp = document.querySelector('[data-viewport]');
    if (vp) vp.scrollTop = 400;
  });
  await page.waitForTimeout(300);
  const scrolled = await page.evaluate(() => ({
    winY: window.scrollY,
    scY: document.querySelector('[data-viewport]')?.scrollTop ?? -1,
    navTop: document.querySelector('.nav').getBoundingClientRect().top,
    statusBottom: document.querySelector('.statusbar').getBoundingClientRect().bottom,
  }));
  if (scrolled.scY < 300) fail(`viewport 未滚动：scrollTop=${scrolled.scY}`);
  if (scrolled.winY > 1) fail(`外壳文档被滚动：window.scrollY=${scrolled.winY}`);
  if (Math.abs(scrolled.navTop - 36) > 30) fail(`滚动后 nav 脱位：top=${scrolled.navTop}`);
  if (Math.abs(scrolled.statusBottom - 800) > 2) fail(`滚动后 statusbar 脱位：bottom=${scrolled.statusBottom}`);

  await page.screenshot({ path: `${shots}smoke-tall.png` });

  // 11b. 7 案例逐个挂载：面板唯一、重建根在、current 同步
  for (const key of boot.cases) {
    await page.evaluate((k) => window.__browser.go(k), key);
    await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({
      panels: document.querySelectorAll('[data-sb-chrome]').length,
      hasRoot: !!document.querySelector('[data-viewport]')?.shadowRoot?.querySelector('#app, #site'),
      cur: window.__browser.current(),
    }));
    if (st.panels !== 1) fail(`${key}: 面板数应 1，实际 ${st.panels}`);
    if (!st.hasRoot) fail(`${key}: shadow 里没有重建根`);
    if (st.cur !== key) fail(`${key}: current=${st.cur}`);
  }

  // 11c. 案例 boot 代接：dark-ui canvas 画了、panel compat 注入了、能力类到位
  await page.evaluate(() => window.__browser.go('dark-ui'));
  await page.waitForTimeout(300);
  const gl = await page.evaluate(() => {
    const c = document.querySelector('[data-viewport]')?.shadowRoot?.querySelector('.gl-view');
    if (!c) return { ok: false, why: 'no canvas' };
    const d = c.getContext('2d').getImageData(0, 0, Math.min(c.width, 8), Math.min(c.height, 8)).data;
    let sum = 0;
    for (const v of d) sum += v;
    return { ok: sum > 0, w: c.width, h: c.height };
  });
  if (!gl.ok) fail(`dark-ui gl-view canvas 未画：${JSON.stringify(gl)}`);
  const boot2 = await page.evaluate(() => ({
    compat: !!document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('style[data-panel-compat]'),
    panelGapClass: document.querySelector('[data-sb-chrome]')?.classList.contains('supports-flex-gap') ?? false,
    htmlGapClass: document.documentElement.classList.contains('supports-flex-gap'),
  }));
  if (!boot2.compat) fail('面板 shadow 缺 compat style');
  if (!boot2.panelGapClass) fail('面板 host 缺 supports-flex-gap 类');
  if (!boot2.htmlGapClass) fail('html 缺 supports-flex-gap（现代 Chromium 应为 true）');

  // 11d. home 交互代接：replay 重跑 + copy 选中降级
  await page.evaluate(() => window.__browser.go('home'));
  await page.waitForTimeout(400);
  const homeBits = await page.evaluate(() => {
    const sr = document.querySelector('[data-viewport]')?.shadowRoot;
    return {
      replay: !!sr?.querySelector('[data-replay]'),
      copy: !!sr?.querySelector('[data-copy-prompt]'),
      prompt: !!sr?.querySelector('[data-prompt]'),
      statusBefore: window.__tuner?.status ?? '',
    };
  });
  if (!homeBits.replay) fail('home 缺 [data-replay]');
  if (!homeBits.copy) fail('home 缺 [data-copy-prompt]');
  if (!homeBits.prompt) fail('home 缺 [data-prompt]');
  await page.evaluate(() => {
    document.querySelector('[data-viewport]')?.shadowRoot?.querySelector('[data-replay]')?.click();
  });
  await page.waitForTimeout(350);
  const statusAfter = await page.evaluate(() => window.__tuner?.status ?? '');
  if (statusAfter === homeBits.statusBefore && !/采蓝图|聚群|蓝图/.test(statusAfter)) {
    fail(`replay 未触发重跑：status=${statusAfter}`);
  }
  // 关掉预扫描后构建提前开跑：prompt 正文会被引擎以 sb-hidden 藏进重建层，
  // 此时强行点复制选不中（display:none 的内容 toString 为空）。Esc 结束本局
  // → reveal 把真页面交回来 → 正文恢复可见后再测复制降级。
  await page.keyboard.press('Escape');
  try {
    await page.waitForFunction(
      () => {
        const b = document.querySelector('[data-viewport]')?.shadowRoot?.querySelector('[data-prompt]');
        return !!b && !b.classList.contains('sb-hidden');
      },
      { timeout: 8000 },
    );
  } catch {
    fail('Esc 结束后 prompt 正文未恢复可见（reveal 没把页面交回来）');
  }
  // 构建完成（Esc 中止也算）→ revealChrome 摘掉 pre-build，顶栏落回原位。
  // （首局已摘过一次，这里对 replay 局幂等：断言应立即通过。）
  try {
    await page.waitForFunction(
      () => !document.documentElement.classList.contains('pre-build'),
      { timeout: 8000 },
    );
  } catch {
    fail('构建完成后顶栏未展开（pre-build 未摘除）');
  }
  await page.evaluate(() => {
    document.querySelector('[data-viewport]')?.shadowRoot?.querySelector('[data-copy-prompt]')?.click();
  });
  await page.waitForTimeout(150);
  const copied = await page.evaluate(() => {
    const sr = document.querySelector('[data-viewport]')?.shadowRoot;
    const btn = sr?.querySelector('[data-copy-prompt]');
    // 正文在 shadow 树里：选中发生在该树自己的 selection 上（document 的取不到文本）。
    const sel = sr && 'getSelection' in sr ? sr.getSelection() : window.getSelection();
    return { btn: btn?.textContent ?? '', selLen: sel ? sel.toString().length : 0 };
  });
  if (copied.selLen < 10) fail(`copy 降级未选中提示词正文：${JSON.stringify(copied)}`);
  if (!/选中|Ctrl/i.test(copied.btn)) fail(`copy 按钮未反馈选中：${copied.btn}`);

  // 12. 双语：语言钮 → replaceState ?lang=en → reload → 外壳文案变 EN
  await page.click('[data-lang]');
  await page.waitForTimeout(800);
  const lang = await page.evaluate(() => ({
    search: location.search,
    htmlLang: document.documentElement.lang,
    hint: document.querySelector('[data-hint]')?.textContent ?? '',
    title: document.title,
  }));
  if (!lang.search.includes('lang=en')) fail(`语言切换未写 ?lang=en：${lang.search}`);
  if (lang.htmlLang !== 'en') fail(`html lang 未变 en：${lang.htmlLang}`);
  if (errors.length) fail(`console/page 错误：${errors.join(' | ')}`);

  console.log('SMOKE PASS');
  console.log(JSON.stringify({ tabs, boot, entry, entryTabs, shadow, panel, vars, engine, scrolls, after, hint, hint2, nav, scroll, scrolled, gl, boot2, homeBits, statusAfter, copied, lang }, null, 1));
} catch (err) {
  console.error('EXCEPTION:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
