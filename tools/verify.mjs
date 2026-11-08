import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 门禁自己起服务器：以前它默认 5199 上有个别人手工开着的 vite。
// 那样有两个坑——没人开着就整片连不上，以及长跑的 dev server 会把 dist/ 里的
// 产物缓存住，改了 src/tune 重新 build 之后 cdn 页仍在跑旧字节。
// 端口给 0 让 vite 自己挑，从它的 stdout 里读回真实地址。
async function startServer() {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '0', '--host', '127.0.0.1'], {
    cwd: ROOT,
    // vite.config.ts 里写了 open：不关掉的话每次跑验收都会弹一个真浏览器。
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.on('exit', () => { try { child.kill(); } catch { /* 已经走了 */ } });
  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`dev server 30s 没报出地址：${out}`)), 30000);
    child.stdout.on('data', (buf) => {
      // 地址那一行可能被拆成多个 chunk，攒起来再找。
      // vite 给横幅上了颜色，"Local:" 和 URL 之间夹着 ANSI 转义码，
      // 不先抹掉的话 \\s+ 根本对不上。
      out += String(buf).replace(/\x1b\[[0-9;]*m/g, '');
      const m = /Local:\s+(http:\/\/[^\s]+?)\/?\s/m.exec(out + ' ');
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.stderr.on('data', (buf) => process.stderr.write(buf));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dev server 提前退出（code ${code}）`)); });
  });
  return { child, url };
}

const owned = process.env.BASE ? null : await startServer();
const BASE = process.env.BASE ?? owned?.url;
if (!BASE) throw new Error('没有可用的 BASE');
process.on('exit', () => owned?.child.kill());

const PAGES = ['simple', 'landing', 'dark-ui', 'cdn'];
const EXPECTED_MEDIA = { landing: 5, 'dark-ui': 1 };
const EXPECTED_COPIES = { simple: 3, landing: 9, 'dark-ui': 29 };
const EXPECTED_GUIDES = { simple: 3, landing: 5 };
const WIDTHS = [1280, 800];
const OUT = new URL('../.shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

function report(title, problems, lines) {
  const ok = problems.length === 0;
  console.log(`\n[${title}] ${ok ? 'PASS' : 'FAIL'}`);
  for (const line of lines) console.log(`  ${line}`);
  for (const p of problems) console.log(`  ! ${p}`);
  if (!ok) failures++;
  return ok;
}

// ---------------------------------------------------------------------------
// 创造者模式是唯一的改参数入口，而面板在 shadow root 里：页面自己的 querySelector
// 穿不进去，所以状态一律从 host.shadowRoot 读（下面每个 evaluate 里都要把它写全，
// evaluate 的函数体是序列化后在页面里执行的，Node 侧的辅助函数带不过去）。
// 点击可以放心交给 Playwright——它的选择器引擎会穿透 open shadow root——
// 但写控件值必须自己派发 input 事件。
// ---------------------------------------------------------------------------
const readStatus = (page) => page.evaluate(
  () => document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-status]')?.textContent ?? '',
);

const waitDone = (page, ms) => page.waitForFunction(
  () => document.querySelector('[data-sb-chrome]').shadowRoot
    .querySelector('[data-status]')?.textContent.startsWith('完成'),
  null,
  { timeout: ms, polling: 200 },
);

/** 写面板里的一个字段，返回「待生效」行数，用于确认改动被标了出来。 */
const setField = (page, key, value) => page.evaluate(
  ([k, v]) => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const el = sr.querySelector(`[data-key="${k}"]`);
    if (!el) throw new Error(`面板里没有 ${k} 这一项`);
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return sr.querySelectorAll('.row[data-dirty="true"]').length;
  },
  [key, value],
);

const fieldOf = (page, key) => page.evaluate(
  (k) => {
    const el = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector(`[data-key="${k}"]`);
    const row = el?.closest('.row');
    return {
      value: el?.type === 'checkbox' ? el.checked : el?.value,
      off: row?.dataset.off === 'true',
      disabled: !!el?.disabled,
      dirty: row?.dataset.dirty === 'true',
      title: row?.title ?? '',
    };
  },
  key,
);

/** 面板自身那一圈交互状态：进度条、待生效提示、按钮可用性、阶段。 */
const panelUi = (page) => page.evaluate(() => {
  const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
  const host = document.querySelector('[data-sb-chrome]');
  return {
    open: host?.dataset.open,
    phase: host?.dataset.phase,
    status: sr.querySelector('[data-status]')?.textContent ?? '',
    meter: sr.querySelector('[data-meter]')?.style.width ?? '',
    note: sr.querySelector('[data-note]')?.textContent ?? '',
    dirty: sr.querySelectorAll('.row[data-dirty="true"]').length,
    off: sr.querySelectorAll('.row[data-off="true"]').length,
    pauseDisabled: sr.querySelector('[data-pause]')?.disabled ?? null,
    skipDisabled: sr.querySelector('[data-skip]')?.disabled ?? null,
    overlay: !!document.querySelector('.sb-overlay'),
    hidden: document.querySelectorAll('.sb-hidden').length,
    items: document.querySelectorAll('.sb-item').length,
  };
});

for (const width of WIDTHS) {
  for (const name of PAGES) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`${BASE}/demos/${name}.html`, { waitUntil: 'load' });
    // Ghost boxes are transient, so count them as they appear rather than by sampling.
    await page.evaluate(() => {
      window.__stamps = 0;
      window.__guides = 0;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.classList.contains('sb-copy')) window.__stamps++;
            if (node.classList.contains('sb-guide')) window.__guides++;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.click('[data-apply]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${name}-${width}-mid.png` });

    // Sample repeatedly: a badge or a drag only exists for a few frames.
    const mid = { rects: 0, texts: 0, typedChars: 0, badges: 0, dragging: 0, caret: 0, hidden: 0, crosshair: 0, ibeam: 0, media: 0, mediaShown: 0, mediaFallback: 0, copies: 0, optionBadges: 0 };
    const sample = async () => {
      const s = await page.evaluate(() => ({
        rects: document.querySelectorAll('.sb-item').length,
        texts: document.querySelectorAll('.sb-text').length,
        typedChars: [...document.querySelectorAll('.sb-text')].reduce((n, e) => n + e.textContent.length, 0),
        badges: [...document.querySelectorAll('.sb-badge')].filter((e) => e.textContent).length,
        dragging: document.querySelectorAll('.sb-cursor.is-dragging').length,
        crosshair: document.querySelectorAll('.sb-cursor.is-crosshair').length,
        ibeam: document.querySelectorAll('.sb-cursor.is-ibeam').length,
        caret: document.querySelectorAll('.sb-caret').length,
        hidden: document.querySelectorAll('.sb-hidden').length,
        media: document.querySelectorAll('.sb-media').length,
        mediaShown: [...document.querySelectorAll('.sb-media')].filter((e) => e.querySelector('img,svg') && !e.classList.contains('sb-item--building')).length,
        mediaFallback: document.querySelectorAll('.sb-media--fallback').length,
        copies: document.querySelectorAll('.sb-copy').length,
        optionBadges: [...document.querySelectorAll('.sb-badge')].filter((e) => e.textContent.includes('\u2325')).length,
      }));
      mid.rects = Math.max(mid.rects, s.rects);
      mid.texts = Math.max(mid.texts, s.texts);
      mid.typedChars = Math.max(mid.typedChars, s.typedChars);
      mid.badges = Math.max(mid.badges, s.badges);
      mid.dragging = Math.max(mid.dragging, s.dragging);
      mid.crosshair = Math.max(mid.crosshair, s.crosshair);
      mid.ibeam = Math.max(mid.ibeam, s.ibeam);
      mid.caret = Math.max(mid.caret, s.caret);
      mid.hidden = Math.max(mid.hidden, s.hidden);
      mid.media = Math.max(mid.media, s.media);
      mid.mediaShown = Math.max(mid.mediaShown, s.mediaShown);
      mid.mediaFallback = Math.max(mid.mediaFallback, s.mediaFallback);
      mid.copies = Math.max(mid.copies, s.copies);
      mid.optionBadges = Math.max(mid.optionBadges, s.optionBadges);
    };

    // Sample for a fixed burst first: badges and drags only live a few frames.
    for (let i = 0; i < 10; i++) {
      await sample();
      await page.waitForTimeout(120);
    }

    // Then keep sampling while waiting so end-of-run counters are complete.
    const deadline = Date.now() + 30000;
    let finished = false;
    while (Date.now() < deadline) {
      await sample();
      finished = (await readStatus(page)).startsWith('完成');
      if (finished) break;
      await page.waitForTimeout(120);
    }

    const done = finished
      ? await page.evaluate(() => ({
          status: document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-status]').textContent,
          overlayGone: !document.querySelector('.sb-overlay'),
          originalVisible: document.querySelectorAll('.sb-hidden').length === 0,
          // 顶栏已经删干净：页面上不该再有 body > .bar，参数只在面板里改。
          toolbar: document.querySelectorAll('body > .bar').length,
          rows: document.querySelector('[data-sb-chrome]').shadowRoot.querySelectorAll('.row').length,
          // 参数都暴露 = 15 行不用滚动就全看得见。
          clipped: (() => {
            const f = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('.fields');
            return f.scrollHeight > f.clientHeight + 1;
          })(),
        }))
      : { status: 'TIMEOUT', toolbar: 0, rows: 0, clipped: true };

    await page.screenshot({ path: `${OUT}${name}-${width}.png`, fullPage: false });

    const problems = [];
    if (!finished) problems.push('未完成（引擎悬挂或死锁）');
    if (mid.rects === 0 && mid.texts === 0) problems.push('运行 600ms 后没有任何重建元素');
    if (mid.hidden === 0) problems.push('原页面没有被隔离层遮住');
    if (mid.mediaFallback > 0) problems.push(`${mid.mediaFallback} 个媒体项降级为占位框`);
    const expectedMedia = EXPECTED_MEDIA[name] ?? 0;
    if (mid.mediaShown < expectedMedia) problems.push(`媒体只呈现 ${mid.mediaShown}/${expectedMedia}`);
    const expectedCopies = EXPECTED_COPIES[name] ?? 0;
    const stamps = finished ? await page.evaluate(() => window.__stamps) : 0;
    const guides = finished ? await page.evaluate(() => window.__guides) : 0;
    if (stamps < expectedCopies) problems.push(`复制只发生 ${stamps}/${expectedCopies} 次`);
    const expectedGuides = EXPECTED_GUIDES[name] ?? 0;
    if (guides < expectedGuides) problems.push(`辅助线只画了 ${guides}/${expectedGuides} 条`);
    if (done.toolbar > 0) problems.push(`页面还留着 ${done.toolbar} 个顶栏工具条`);
    if (done.rows !== 15) problems.push(`创造者模式面板只有 ${done.rows} 行参数`);
    if (done.clipped) problems.push('面板参数列表要滚动才看得全');
    if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

    report(`${name} @${width}`, problems, [
      `过程: rects=${mid.rects} texts=${mid.texts} 已打字=${mid.typedChars} 徽章=${mid.badges} 拖框中=${mid.dragging} 准星=${mid.crosshair} I型=${mid.ibeam} caret=${mid.caret} 遮罩=${mid.hidden}`,
      `媒体: 槽位=${mid.media} 已呈现=${mid.mediaShown}/${expectedMedia} 降级=${mid.mediaFallback}`,
      `复制: 拖影=${mid.copies} 累计复制=${stamps}/${expectedCopies} ⌥ 徽章峰值=${mid.optionBadges}`,
      `辅助线: 累计=${guides}/${expectedGuides}`,
      `入口: 顶栏 ${done.toolbar} 个 · 面板 ${done.rows} 行${done.clipped ? '（需滚动）' : ' 全露'}`,
      `结果: ${done.status}${done.overlayGone === false ? ' · overlay 未清除' : ''}${done.originalVisible === false ? ' · 原页面未恢复' : ''}`,
    ]);

    await ctx.close();
  }
}

// ---------------------------------------------------------------------------
// 批次 4：控制方法、ignore 数组、fixed 定位与重建中滚动
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });

  const readState = () =>
    page.evaluate(() => {
      const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
      return {
        status: sr.querySelector('[data-status]').textContent,
        phase: document.querySelector('[data-sb-chrome]').dataset.phase,
        meter: sr.querySelector('[data-meter]').style.width,
        pause: sr.querySelector('[data-pause]').disabled,
        skip: sr.querySelector('[data-skip]').disabled,
        items: document.querySelectorAll('.sb-item, .sb-text').length,
        cursors: [...document.querySelectorAll('.sb-cursor')].map((c) => c.style.transform).join('|'),
      };
    });

  const problems = [];
  const idle = await readState();
  if (!idle.pause || !idle.skip) problems.push('还没开跑就能暂停/跳过');
  if (idle.phase !== 'idle') problems.push(`未触发时阶段是 ${idle.phase}`);

  // pause / resume
  await page.click('[data-apply]');
  await page.waitForTimeout(900);
  const running = await readState();
  if (running.pause || running.skip) problems.push('跑起来了还不能暂停/跳过');
  if (running.phase !== 'running') problems.push(`运行中阶段是 ${running.phase}`);
  if (running.meter === '' || running.meter === '0%') problems.push(`运行中进度条没动：${running.meter || '空'}`);
  await page.click('[data-pause]');
  const frozen = await readState();
  await page.waitForTimeout(1000);
  const still = await readState();
  await page.screenshot({ path: `${OUT}controls-paused.png` });
  if (still.phase !== 'paused') problems.push(`暂停后阶段是 ${still.phase}`);
  await page.click('[data-pause]');
  await page.waitForTimeout(700);
  const resumed = await readState();

  if (frozen.status !== '已暂停') problems.push(`暂停后状态为 ${frozen.status}`);
  if (still.cursors !== frozen.cursors || still.items !== frozen.items) problems.push('暂停后画面仍在推进');
  if (resumed.cursors === frozen.cursors && resumed.items === frozen.items) problems.push('继续后没有任何变化');

  // 未设目标时长时，面板上的「速度」应当直接改到正在跑的这一局。
  const beforeLive = await page.evaluate(() => window.__tuner.phase);
  await setField(page, 'speed', 4);
  const speedDeadline = Date.now() + 20000;
  let finishedRun = false;
  while (Date.now() < speedDeadline) {
    const s = await readState();
    if (s.status.startsWith('完成')) { finishedRun = true; break; }
    await page.waitForTimeout(150);
  }
  if (!finishedRun) problems.push('提速后未完成');
  const done = await readState();
  if (done.phase !== 'done') problems.push(`跑完阶段是 ${done.phase}`);
  if (done.meter !== '100%') problems.push(`跑完进度条停在 ${done.meter}`);
  if (!done.pause || !done.skip) problems.push('已经结束了还能暂停/跳过');
  if (beforeLive !== 'running') problems.push(`提速前不该是 ${beforeLive}`);

  // skip
  await setField(page, 'speed', 1);
  await page.click('[data-apply]');
  await page.waitForTimeout(700);
  const beforeSkip = await readState();
  await page.screenshot({ path: `${OUT}controls-mid.png` });
  await page.click('[data-skip]');
  await page.waitForTimeout(300);
  const afterSkip = await page.evaluate(() => ({
    status: document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-status]').textContent,
    overlayGone: !document.querySelector('.sb-overlay'),
    restored: document.querySelectorAll('.sb-hidden').length === 0,
  }));
  const total = Number((beforeSkip.status.match(/\/(\d+)/) ?? [])[1] ?? 0);
  const builtAfterSkip = Number((afterSkip.status.match(/完成 (\d+)/) ?? [])[1] ?? 0);
  if (!afterSkip.status.startsWith('完成')) problems.push(`跳过后状态为 ${afterSkip.status}`);
  if (total > 0 && builtAfterSkip !== total) problems.push(`跳过只补齐到 ${builtAfterSkip}/${total}`);
  if (!afterSkip.overlayGone) problems.push('跳过后 overlay 未清除');
  if (!afterSkip.restored) problems.push('跳过后原页面未恢复');
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('controls @1280', problems, [
    `面板: 待触发 暂停/跳过=${idle.pause}/${idle.skip} → 运行中=${running.pause}/${running.skip} · 进度条 ${running.meter}`,
    `暂停: ${frozen.status} → 1s 后 ${still.status}（光标位移 ${still.cursors === frozen.cursors ? '为 0' : '仍在变'}）`,
    `继续: ${resumed.status} · 阶段 ${idle.phase}→${running.phase}→${still.phase}→${resumed.phase}→${done.phase}（收尾 ${done.meter}）`,
    `速度实时改 4x 后完成: ${finishedRun}`,
    `跳过: ${beforeSkip.status} → ${afterSkip.status}`,
  ]);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });

  const problems = [];
  await page.evaluate(() => {
    window.__total = 0;
    window.__result = null;
    const swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      agentCount: 8,
      speed: 1,
      onProgress: (built, total) => { window.__total = total; },
      onComplete: (result) => { window.__result = result; },
    });
    window.__swarm = swarm;
    swarm.start();
  });

  // Wait until the pinned block has been rebuilt, then scroll while still running.
  await page.waitForFunction(
    () => [...document.querySelectorAll('.sb-fixed .sb-text')].some((e) => e.textContent.includes('在线客服')),
    null,
    { timeout: 10000 },
  );
  const measure = () =>
    page.evaluate(() => {
      const fixed = [...document.querySelectorAll('.sb-fixed .sb-text')].find((e) => e.textContent.includes('在线客服'));
      const flow = document.querySelector('.sb-overlay > .sb-item, .sb-overlay > .sb-text');
      return {
        fixedTop: fixed ? Math.round(fixed.getBoundingClientRect().top) : -1,
        flowTop: flow ? Math.round(flow.getBoundingClientRect().top) : -1,
        fixedCount: document.querySelectorAll('.sb-fixed > *').length,
      };
    });
  const before = await measure();
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}fixed-scrolled.png` });
  const after = await measure();

  if (before.fixedCount < 3) problems.push(`fixed 层只有 ${before.fixedCount} 个元素`);
  if (Math.abs(after.fixedTop - before.fixedTop) > 2) problems.push(`fixed 元素跟着滚了 ${after.fixedTop - before.fixedTop}px`);
  if (before.flowTop >= 0 && after.flowTop > before.flowTop - 400) problems.push(`普通元素没有随页面滚动（${before.flowTop} → ${after.flowTop}）`);

  // The run must still finish correctly after the scroll.
  await page.waitForFunction(() => window.__result !== null, null, { timeout: 30000 });
  const outcome = await page.evaluate(() => ({ result: window.__result, total: window.__total }));
  if (outcome.result.built < outcome.total) problems.push(`滚动后只建了 ${outcome.result.built}/${outcome.total}`);

  report('fixed-scroll @1280', problems, [
    `fixed 层元素=${after.fixedCount} · 视口 top ${before.fixedTop} → ${after.fixedTop}`,
    `普通元素 top ${before.flowTop} → ${after.flowTop}（滚动 500px）`,
    `结果: ${outcome.result.built}/${outcome.total} 项 · ${(outcome.result.durationMs / 1000).toFixed(1)}s`,
  ]);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/simple.html`, { waitUntil: 'load' });

  const runOnce = (ignore) =>
    page.evaluate((sel) => {
      // Text elements are appended empty and filled while typing, so keep the
      // nodes and read them once the run is over.
      const nodes = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.classList.contains('sb-text')) nodes.push(node);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
      return new Promise((resolve) => {
        const swarm = new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 6,
          speed: 4,
          ...(sel ? { ignore: sel } : {}),
          onComplete: (result) => resolve({ built: result.built, seen: nodes.map((n) => n.textContent).join('\n') }),
        });
        swarm.start();
      });
    }, ignore);

  const all = await runOnce(null);
  const skipped = await runOnce(['.cards']);
  const problems = [];
  if (skipped.built >= all.built) problems.push(`ignore 数组没有减少任务：${skipped.built} vs ${all.built}`);
  if (skipped.seen.includes('Snapshot')) problems.push('被 ignore 的子树仍然被打字');
  if (!skipped.seen.includes('第一项')) problems.push('ignore 之外的内容没有照常重建');
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('ignore[] @1280', problems, [
    `不 ignore: ${all.built} 项`,
    `ignore ['.cards']: ${skipped.built} 项 · 少了 ${all.built - skipped.built}`,
  ]);
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/simple.html`, { waitUntil: 'load' });

  // Count what the synthesiser creates instead of trying to hear it.
  await page.evaluate(() => {
    window.__audio = { contexts: 0, voices: 0 };
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...args) {
        super(...args);
        window.__audio.contexts++;
        window.__audio.last = this;
      }
    };
    const create = Real.prototype.createOscillator;
    Real.prototype.createOscillator = function () {
      window.__audio.voices++;
      return create.apply(this, arguments);
    };
  });

  const runOnce = (sound) =>
    page.evaluate((on) => {
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      window.__audio.contexts = 0;
      window.__audio.voices = 0;
      return new Promise((resolve) => {
        const swarm = new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 6,
          speed: 4,
          sound: on,
          onComplete: () => resolve({
            ...window.__audio,
            state: window.__audio.last?.state ?? 'none',
            clock: Math.round((window.__audio.last?.currentTime ?? 0) * 100) / 100,
          }),
        });
        swarm.start();
      });
    }, sound);

  const off = await runOnce(false);
  const on = await runOnce(true);
  const problems = [];
  if (off.contexts !== 0) problems.push(`默认关闭时仍然建了 ${off.contexts} 个 AudioContext`);
  if (on.contexts < 1) problems.push('开启音效后没有创建 AudioContext');
  if (on.voices < 20) problems.push(`开启音效只发声 ${on.voices} 次，少于 20`);
  if (on.state !== 'running') problems.push(`AudioContext 状态是 ${on.state}，没有真正跑起来`);
  if (on.clock <= 0) problems.push('AudioContext 时钟没有推进');
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('sound @1280', problems, [
    `关闭: AudioContext=${off.contexts} 发声=${off.voices}`,
    `开启: AudioContext=${on.contexts} 发声=${on.voices} · 状态=${on.state} · 时钟=${on.clock}s`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 高级版：targetDuration 定速 与 performanceMode 裁剪
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__guides = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains('sb-guide')) window.__guides++;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  const runOnce = (opts) =>
    page.evaluate((options) => {
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      window.__guides = 0;
      return new Promise((resolve) => {
        const swarm = new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 6,
          ...options,
          onComplete: (result) => resolve({
            ...result,
            guides: window.__guides,
            dom: document.querySelector('#app').querySelectorAll('*').length,
          }),
        });
        swarm.start();
      });
    }, opts);

  const natural = await runOnce({});
  const quick = await runOnce({ targetDuration: 3 });
  const slow = await runOnce({ targetDuration: 10 });

  // Past the crowded threshold: 100 boxes is 200 nodes on top of the page.
  await page.evaluate(() => {
    const root = document.querySelector('#app');
    for (let i = 0; i < 100; i++) {
      const box = document.createElement('div');
      box.style.cssText = 'width:70px;height:40px;margin:6px;background:rgba(120,140,255,.35);border-radius:6px';
      const label = document.createElement('span');
      label.textContent = `cell ${i}`;
      box.appendChild(label);
      root.appendChild(box);
    }
  });
  const crowded = await runOnce({ speed: 8 });
  const forced = await runOnce({ speed: 8, performanceMode: 'high' });

  const problems = [];
  const within = (label, ms, target, tolerance) => {
    if (Math.abs(ms - target) > target * tolerance) problems.push(`${label} 实测 ${(ms / 1000).toFixed(1)}s，偏离 ${(target / 1000).toFixed(1)}s 超过 ${tolerance * 100}%`);
  };
  within('targetDuration 3', quick.durationMs, 3000, 0.35);
  within('targetDuration 10', slow.durationMs, 10000, 0.35);
  if (crowded.guides !== 0) problems.push(`拥挤页面 auto 模式仍画了 ${crowded.guides} 条辅助线`);
  if (forced.guides < 5) problems.push(`performanceMode 'high' 只画了 ${forced.guides} 条辅助线`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('pace-perf @1280', problems, [
    `自然速度: ${natural.built} 项 ${(natural.durationMs / 1000).toFixed(1)}s · 辅助线=${natural.guides}`,
    `targetDuration 3s: ${(quick.durationMs / 1000).toFixed(1)}s（${quick.built} 项）`,
    `targetDuration 10s: ${(slow.durationMs / 1000).toFixed(1)}s（${slow.built} 项）`,
    `拥挤页面 dom=${crowded.dom}: auto ${crowded.built} 项/辅助线=${crowded.guides}/${(crowded.durationMs / 1000).toFixed(1)}s · high ${forced.built} 项/辅助线=${forced.guides}/${(forced.durationMs / 1000).toFixed(1)}s`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 高级版：Flocking 光标避让
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });

  const measure = (flocking) =>
    page.evaluate((on) => {
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      const read = () =>
        [...document.querySelectorAll('.sb-cursor:not([hidden])')]
          .map((el) => {
            const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
            return { el, x: m ? Number(m[1]) : NaN, y: m ? Number(m[2]) : NaN };
          });
      return new Promise((resolve) => {
        let frames = 0;
        let crowded = 0;
        let near = 0;
        let minSum = 0;
        let minSeen = Infinity;
        let previous = null;
        let running = true;
        // Only cursors that are actually travelling can be in each other's way;
        // two agents finishing on the same coordinate is the layout, not a clash.
        const sample = () => {
          const points = read();
          const moving = previous
            ? points.filter((p) => {
                const before = previous.get(p.el);
                return before && Math.hypot(p.x - before.x, p.y - before.y) > 0.5;
              })
            : [];
          previous = new Map(points.map((p) => [p.el, { x: p.x, y: p.y }]));
          if (moving.length > 1) {
            let min = Infinity;
            for (let i = 0; i < moving.length; i++) {
              for (let j = i + 1; j < moving.length; j++) {
                min = Math.min(min, Math.hypot(moving[i].x - moving[j].x, moving[i].y - moving[j].y));
              }
            }
            frames++;
            minSum += min;
            minSeen = Math.min(minSeen, min);
            if (min < 18) crowded++;
            if (min < 40) near++;
          }
          if (running) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 8,
          speed: 2,
          flocking: on,
          onComplete: (result) => {
            running = false;
            resolve({
              built: result.built,
              durationMs: result.durationMs,
              frames,
              crowdedFrames: crowded,
              nearFrames: near,
              avgMin: Math.round(minSum / Math.max(1, frames)),
              minSeen: Math.round(minSeen),
            });
          },
        }).start();
      });
    }, flocking);

  const off = await measure(false);
  const on = await measure(true);
  await page.screenshot({ path: `${OUT}flocking.png` });

  const problems = [];
  if (off.built !== on.built) problems.push(`开避让后建成 ${on.built}/${off.built} 项`);
  // Two cursors converging on one coordinate is the layout, not a steering
  // failure, so the honest target is the near-miss frames, not the overlap.
  if (on.nearFrames > off.nearFrames) problems.push(`同行擦过帧变多了：${off.nearFrames} → ${on.nearFrames}`);
  if (Math.abs(on.durationMs - off.durationMs) > off.durationMs * 0.3) problems.push(`避让改变了节奏：${(off.durationMs / 1000).toFixed(1)}s → ${(on.durationMs / 1000).toFixed(1)}s`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('flocking @1280', problems, [
    `关闭: 同行帧=${off.frames} · <40px 擦过=${off.nearFrames}(${((off.nearFrames / Math.max(1, off.frames)) * 100).toFixed(0)}%) · <18px 重叠=${off.crowdedFrames} · 平均最近 ${off.avgMin}px · ${(off.durationMs / 1000).toFixed(1)}s`,
    `开启: 同行帧=${on.frames} · <40px 擦过=${on.nearFrames}(${((on.nearFrames / Math.max(1, on.frames)) * 100).toFixed(0)}%) · <18px 重叠=${on.crowdedFrames} · 平均最近 ${on.avgMin}px · ${(on.durationMs / 1000).toFixed(1)}s`,
    `建成: ${on.built} 项`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 高级版：Tour 自动滚动跟随
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });

  const start = (tour) =>
    page.evaluate((on) => {
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      window.scrollTo(0, 0);
      window.__t = { samples: 0, inView: 0, maxScroll: 0, done: null };
      let running = true;
      const probe = () => {
        const overlay = document.querySelector('.sb-overlay');
        if (overlay) {
          const top = overlay.getBoundingClientRect().top;
          const ys = [...document.querySelectorAll('.sb-cursor:not([hidden])')]
            .map((el) => {
              const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
              return m ? Number(m[2]) : NaN;
            })
            .filter(Number.isFinite);
          if (ys.length > 0) {
            window.__t.samples++;
            const mid = ys.reduce((a, b) => a + b, 0) / ys.length;
            if (top + mid > 0 && top + mid < window.innerHeight) window.__t.inView++;
          }
          window.__t.maxScroll = Math.max(window.__t.maxScroll, window.scrollY);
        }
        if (running) setTimeout(probe, 120);
      };
      setTimeout(probe, 0);
      new window.SwarmBuilder({
        root: document.querySelector('#app'),
        agentCount: 6,
        speed: 2,
        tour: on,
        onComplete: (result) => {
          // The camera hands the page back with a smooth scroll, so read the
          // resting position only once it has settled.
          setTimeout(() => {
            running = false;
            window.__t.done = {
              built: result.built,
              maxScroll: window.__t.maxScroll,
              finalScroll: Math.round(window.scrollY),
            };
          }, 1200);
        },
      }).start();
    }, tour);

  const read = () => page.evaluate(() => window.__t.samples + '|' + window.__t.inView + '|' + JSON.stringify(window.__t.done));

  await start(false);
  await page.waitForFunction(() => window.__t.done !== null, null, { timeout: 30000 });
  const off = JSON.parse((await read()).split('|')[2]);
  const offRatio = await page.evaluate(() => window.__t.inView / Math.max(1, window.__t.samples));

  await start(true);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}tour-mid.png` });
  await page.waitForFunction(() => window.__t.done !== null, null, { timeout: 30000 });
  const on = JSON.parse((await read()).split('|')[2]);
  const onRatio = await page.evaluate(() => window.__t.inView / Math.max(1, window.__t.samples));

  const problems = [];
  if (off.built !== on.built) problems.push(`跟随滚动改变了建成数：${off.built} → ${on.built}`);
  if (off.maxScroll !== 0) problems.push(`默认关闭时页面被滚动了 ${off.maxScroll}px`);
  if (on.maxScroll < 300) problems.push(`跟随滚动只滚到 ${on.maxScroll}px，镜头没跟上`);
  if (onRatio < 0.8) problems.push(`镜头跟随时光标只有 ${(onRatio * 100).toFixed(0)}% 时间在视口内`);
  if (onRatio <= offRatio) problems.push(`视口内占比没有提高：${(offRatio * 100).toFixed(0)}% → ${(onRatio * 100).toFixed(0)}%`);
  if (on.finalScroll > 120) problems.push(`结束后没有回到页首，scrollY=${on.finalScroll}`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('tour @1280', problems, [
    `关闭: 最大滚动 ${off.maxScroll}px · 光标在视口 ${(offRatio * 100).toFixed(0)}% · 建成 ${off.built}`,
    `开启: 最大滚动 ${on.maxScroll}px · 光标在视口 ${(onRatio * 100).toFixed(0)}% · 建成 ${on.built} · 结束回到 ${on.finalScroll}px`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 高级版：主题自适应（施工线墨色跟随页面底色）
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  const probe = (name, options) =>
    page.evaluate(async ({ pageName, opts }) => {
      location.hash = '';
      window.scrollTo(0, 0);
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      return await new Promise((resolve) => {
        const swarm = new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 6,
          speed: 2,
          ...opts,
          onComplete: (result) => resolve({ built: result.built }),
        });
        swarm.start();
        // Grab the ink of the first ghost box while it is still on screen.
        const watch = () => {
          const el = document.querySelector('.sb-item--building');
          if (el) {
            const overlay = document.querySelector('.sb-overlay');
            const [r, g, b] = getComputedStyle(el).outlineColor.match(/[\d.]+/g).map(Number);
            resolve({ theme: overlay?.dataset.sbTheme ?? 'none', ink: Math.round((r + g + b) / 3), luma: Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 2.55) });
            return;
          }
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      });
    }, { pageName: name, opts: options });

  const problems = [];
  const results = {};
  for (const [name, url] of [['simple', 'simple'], ['landing', 'landing'], ['dark-ui', 'dark-ui']]) {
    await page.goto(`${BASE}/demos/${url}.html`, { waitUntil: 'load' });
    results[name] = await probe(name, {});
    if (results[name].theme === 'none') problems.push(`${name} 没有拿到主题`);
    // 墨色要反向跟随底色：浅页用深墨，深页用浅墨（亮度 0-100）。
    if (results[name].theme === 'light' && results[name].luma > 40) problems.push(`${name} 判定为浅页但墨色偏亮：${results[name].luma}`);
    if (results[name].theme === 'dark' && results[name].luma < 60) problems.push(`${name} 判定为深页但墨色偏暗：${results[name].luma}`);
  }
  await page.goto(`${BASE}/demos/landing.html`, { waitUntil: 'load' });
  const forced = await probe('landing', { theme: 'light' });

  report('theme @1280', problems, [
    `simple（浅）: theme=${results.simple.theme} 墨色亮度=${results.simple.luma}`,
    `landing（深）: theme=${results.landing.theme} 墨色亮度=${results.landing.luma}`,
    `dark-ui（深）: theme=${results['dark-ui'].theme} 墨色亮度=${results['dark-ui'].luma}`,
    `landing + theme:'light' 强制: ${forced.theme} 墨色亮度=${forced.luma}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 17：mockup 浏览器——一个窗口切所有案例，参数全在创造者模式里改
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  // 案例页在 iframe 里跑：TourCam 读的是 window.scrollY / innerHeight，
  // 换成内联滚动容器会让镜头跟着错误的视口走，所以只能是真的 frame。
  const frameShape = () => page.evaluate(() => {
    const doc = document.querySelector('[data-frame]').contentDocument;
    const sr = doc?.querySelector('[data-sb-chrome]')?.shadowRoot;
    const status = sr?.querySelector('[data-status]')?.textContent.trim() ?? '';
    return {
      demo: doc?.body.dataset.demo ?? 'none',
      status,
      built: Number((status.match(/完成 (\d+) 项/) ?? [])[1] ?? 0),
      items: doc?.querySelectorAll('.sb-item').length ?? 0,
    };
  });
  const chromeShape = () => page.evaluate(() => {
    const need = (sel) => document.querySelector(sel);
    return {
      tab: need('.tab[aria-selected="true"]')?.dataset.key ?? 'none',
      url: need('[data-url]').textContent,
      addr: need('[data-addr]').dataset.loading,
      hint: need('[data-hint]').textContent,
      meta: need('[data-meta]').textContent,
      phase: need('[data-statusbar]').dataset.phase,
      back: need('[data-back]').disabled,
      fwd: need('[data-fwd]').disabled,
      creator: need('[data-creator]').getAttribute('aria-pressed'),
      case_: new URLSearchParams(location.search).get('case'),
      open: document.querySelector('[data-frame]').contentDocument
        .querySelector('[data-sb-chrome]')?.dataset.open,
    };
  });
  const waitFrameDone = (ms) => page.waitForFunction(
    () => (document.querySelector('[data-frame]').contentDocument
      .querySelector('[data-sb-chrome]')?.shadowRoot
      .querySelector('[data-status]')?.textContent.trim() ?? '').startsWith('完成'),
    null,
    { timeout: ms, polling: 200 },
  );
  /** 在 iframe 里的面板上改字段并按「应用并重跑」。 */
  const frameApply = (fields) => page.evaluate((list) => {
    const sr = document.querySelector('[data-frame]').contentDocument
      .querySelector('[data-sb-chrome]').shadowRoot;
    for (const [k, v] of list) {
      const el = sr.querySelector(`[data-key="${k}"]`);
      if (!el) throw new Error(`面板里没有 ${k}`);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    sr.querySelector('[data-apply]').click();
  }, fields);

  await page.goto(`${BASE}/demos/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-frame]')?.contentDocument
    ?.querySelector('[data-sb-chrome]') !== null, null, { timeout: 15000 });

  const problems = [];
  // 壳页自己开跑：mockup 浏览器载入案例后直接触发一局，不需要再去点顶栏。
  const first = await chromeShape();
  const firstFrame = await frameShape();
  if (first.tab !== 'simple' || first.case_ !== 'simple') problems.push(`初始标签页不对: ${JSON.stringify(first)}`);
  if (firstFrame.demo !== 'simple') problems.push(`第一个案例内容是 ${firstFrame.demo}`);
  if (first.url !== 'https://swarm.demo') problems.push(`地址栏显示 ${first.url}`);
  if (first.back !== true || first.fwd !== true) problems.push('首次进入时前进/后退应该都禁用');
  await waitFrameDone(30000);
  const simpleDone = await frameShape();
  if (simpleDone.built < 20) problems.push(`简单页只建成 ${simpleDone.built} 项`);
  // 顶层状态栏要如实镜像面板：用户不用展开面板也知道在跑什么。它是 200ms 轮询，
  // 所以等它追上，而不是拿面板那一瞬间的值去比。
  await page.waitForFunction(() => document.querySelector('[data-statusbar]').dataset.phase === 'done',
    null, { timeout: 5000 }).catch(() => {});
  const mirror = await chromeShape();
  if (mirror.phase !== 'done') problems.push(`跑完后状态栏阶段是 ${mirror.phase}`);
  if (!mirror.hint.includes('简单页基准') || !mirror.hint.includes('完成')) {
    problems.push(`状态栏没有镜像面板进度：${JSON.stringify(mirror.hint)}`);
  }

  // 切密集控制台：iframe 隔离案例样式，案例里的 .bar 不该再被任何全局规则命中。
  const t0 = Date.now();
  await page.click('.tab[data-key="console"]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'console', null, { timeout: 15000 });
  const switched = await chromeShape();
  if (switched.tab !== 'console' || switched.case_ !== 'console') problems.push(`切到 console 后外壳没跟上: ${JSON.stringify(switched)}`);
  if (switched.url !== 'https://orbit.demo/console') problems.push(`地址栏没换成 ${switched.url}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}browser-console-mid.png` });
  await waitFrameDone(120000);
  const naturalMs = Date.now() - t0;
  const natural = await frameShape();
  if (natural.built < 350) problems.push(`密集页面默认上限只建成 ${natural.built} 项`);
  const leaked = await page.evaluate(() => {
    const doc = document.querySelector('[data-frame]').contentDocument;
    const el = doc.querySelector('.page-console .chart .bar');
    const bar = el ? getComputedStyle(el).position : 'absent';
    // 顶栏规则整族删掉了，宿主页也不该再多出一个 .bar 工具条。
    return { bar, toolbars: doc.querySelectorAll('body > .bar').length };
  });
  if (leaked.bar !== 'static') problems.push(`案例里的 .bar 仍被规则命中：position=${leaked.bar}`);
  if (leaked.toolbars !== 0) problems.push(`案例页还留着 ${leaked.toolbars} 个顶栏工具条`);

  // 抬上限 + 定速：全走面板，不再有单独的顶栏下拉。
  // 两次都从面板起跑，比的是引擎自己报的时长，把载入和轮询都排除掉。
  await frameApply([['maxItems', 2000], ['targetDuration', 0]]);
  await waitFrameDone(120000);
  const opened = await frameShape();
  if (opened.built <= natural.built) problems.push(`抬到上限 2000 后建成数没有增加：${opened.built} <= ${natural.built}`);

  await frameApply([['maxItems', 2000], ['targetDuration', 10]]);
  await waitFrameDone(120000);
  const paced = await frameShape();
  const secondsOf = (status) => Number((status.match(/· ([\d.]+)s/) ?? [])[1] ?? 0);
  const openSeconds = secondsOf(opened.status);
  const pacedSeconds = secondsOf(paced.status);
  // 定速在默认这一档是准的（pace-perf 场景按 35% 卡死）。但估算器按条目线性计价，
  // 把上限抬到整页规模后真实成本是超线性的：实测 10s 目标要 ~20s 才跑完，
  // 所以这里只锁方向——定速确实把自然节奏压掉一半以上，偏差作为信息报出来。
  if (pacedSeconds >= openSeconds) problems.push(`定速没有变快：${openSeconds}s → ${pacedSeconds}s`);
  if (pacedSeconds > openSeconds * 0.6) problems.push(`定速压得不够：自然 ${openSeconds}s → 目标 10s 实测 ${pacedSeconds}s`);
  await page.screenshot({ path: `${OUT}browser-console-paced.png` });

  // 后退/前进：此刻历史是 simple → console，退一步应回到简单页。
  if ((await chromeShape()).back !== false) problems.push('已有两步历史时后退仍然禁用');
  await page.click('[data-back]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'simple', null, { timeout: 15000 });
  const wentBack = await chromeShape();
  if (wentBack.tab !== 'simple' || wentBack.fwd !== false) problems.push(`后退后外壳不对: ${JSON.stringify(wentBack)}`);
  await page.click('[data-fwd]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'console', null, { timeout: 15000 });
  const wentFwd = await chromeShape();
  if (wentFwd.tab !== 'console' || wentFwd.fwd !== true) problems.push(`前进后外壳不对: ${JSON.stringify(wentFwd)}`);

  // 创造者模式开关：关掉时面板收成按钮，页面本身不受影响。
  await page.click('[data-creator]');
  await page.waitForTimeout(200);
  const closed = await chromeShape();
  if (closed.creator !== 'false' || closed.open !== 'false') problems.push(`关闭创造者模式后面板没收起来: ${JSON.stringify(closed)}`);
  await page.screenshot({ path: `${OUT}browser-creator-off.png` });
  await page.click('[data-creator]');
  await page.waitForTimeout(200);
  const reopened = await chromeShape();
  if (reopened.open !== 'true') problems.push('重新打开创造者模式后面板没收回去');

  // 重新载入：iframe 真的重新取页，所以面板回到案例自带的默认值——这是浏览器的语义，
  // 面板不该自作主张把改动写进 URL 或 localStorage。
  await page.click('[data-reload]');
  await page.waitForTimeout(1500);
  const reloading = await frameShape();
  if (!/重建中|施工中|采蓝图|完成/.test(reloading.status)) problems.push(`重新载入后状态异常: ${reloading.status}`);
  await waitFrameDone(120000);
  const reloaded = await frameShape();
  if (reloaded.built !== natural.built) problems.push(`重载后没有回到案例自带默认：${reloaded.built} vs ${natural.built}`);

  // 切回落地页
  await page.click('.tab[data-key="landing"]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'landing', null, { timeout: 15000 });
  await waitFrameDone(60000);
  const back = await frameShape();
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);
  await page.screenshot({ path: `${OUT}browser-landing.png` });

  report('mockup-browser @1280', problems, [
    `外壳: 标签 ${first.tab} · 地址 ${first.url} · 后退/前进初始 ${first.back}/${first.fwd}`,
    `简单页: ${simpleDone.built} 项 · 状态栏 ${mirror.phase} · ${mirror.hint}`,
    `密集案例: 默认上限 ${natural.built} 项 · 墙钟 ${(naturalMs / 1000).toFixed(1)}s · ${natural.status}`,
    `面板抬上限: ${opened.built} 项 · 自然节奏 ${openSeconds}s`,
    `面板定速 10s: ${paced.built} 项 · 实测 ${pacedSeconds}s（估算器按条目线性计价，整页规模会低估，见 plan §13.15）`,
    `案例内 .bar 定位: ${leaked.bar}（应为 static）· 顶栏残留 ${leaked.toolbars} 个`,
    `后退/前进: ${wentBack.tab}(fwd=${wentBack.fwd}) → ${wentFwd.tab}(fwd=${wentFwd.fwd})`,
    `创造者模式: 关=${closed.open} 开=${reopened.open} · 重载回到默认 ${reloaded.built} 项`,
    `切回: landing · ${back.status}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 18：调参面板嵌进「别人家的站点」（shadow DOM 隔离 + 导出片段 + chrome 不被遮）
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  const panelState = () => page.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    const sr = host?.shadowRoot;
    const card = sr?.querySelector('.card');
    const btn = sr?.querySelector('[data-apply]');
    return {
      host: !!host,
      rows: sr?.querySelectorAll('.row').length ?? 0,
      font: card ? getComputedStyle(card).fontFamily : '',
      cardBg: card ? getComputedStyle(card).backgroundColor : '',
      btnBorder: btn ? getComputedStyle(btn).borderTopWidth : '',
      status: sr?.querySelector('[data-status]')?.textContent ?? '',
      hidden: host?.classList.contains('sb-hidden') ?? true,
      visibility: host ? getComputedStyle(host).visibility : '',
      overlay: !!document.querySelector('.sb-overlay'),
      items: document.querySelectorAll('.sb-item').length,
    };
  });
  const waitPanelDone = (ms) => page.waitForFunction(
    () => document.querySelector('[data-sb-chrome]')?.shadowRoot
      ?.querySelector('[data-status]')?.textContent.startsWith('完成'),
    { timeout: ms, polling: 200 },
  );

  await page.goto(`${BASE}/demos/tune.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const problems = [];
  const first = await panelState();
  if (!first.host || first.rows !== 15) problems.push(`面板没建起来：${JSON.stringify(first)}`);
  // 宿主页用 * { font-family: Georgia } 和 button{border:3px double} 故意撞面板。
  if (/Georgia/i.test(first.font)) problems.push(`宿主字体渗进面板：${first.font}`);
  if (first.cardBg !== 'rgb(20, 24, 33)') problems.push(`面板底色被宿主 .card 规则改掉：${first.cardBg}`);
  if (first.btnBorder !== '1px') problems.push(`面板按钮被宿主 button 规则改成 ${first.btnBorder} 边框`);

  await page.click('[data-apply]');
  await page.waitForTimeout(900);
  const mid = await panelState();
  if (mid.hidden || mid.visibility !== 'visible') problems.push(`运行中面板被隔离层遮掉：${JSON.stringify(mid)}`);
  if (!mid.overlay || mid.items === 0) problems.push(`面板触发的重建没跑起来：${JSON.stringify(mid)}`);
  await page.screenshot({ path: `${OUT}tune-mid.png` });
  await waitPanelDone(60000);
  const done = await panelState();
  if (!done.status.startsWith('完成') || done.overlay) problems.push(`面板这局没正常收尾：${JSON.stringify(done)}`);
  const leftover = await page.evaluate(() => document.querySelectorAll('.sb-hidden').length);
  if (leftover !== 0) problems.push(`结束后还有 ${leftover} 个元素带着 sb-hidden`);

  await page.evaluate(() => {
    const input = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-key="agentCount"]');
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // 蓝图在开始那一刻冻结：改了值只能标成「待生效」，不能假装立刻生效。
  const touched = await panelUi(page);
  if (touched.dirty !== 1) problems.push(`改光标数量后待生效行数=${touched.dirty}（应为 1）`);
  if (!touched.note.includes('1 项待生效')) problems.push(`待生效提示不对：${touched.note}`);
  if (!(await fieldOf(page, 'agentCount')).dirty) problems.push('「光标数量」这一行没被标成待生效');

  // 依赖关系：设了目标时长，速度倍率由估算器接管，那一行必须灰掉并说清原因。
  await setField(page, 'targetDuration', 8);
  const speedRow = await fieldOf(page, 'speed');
  if (!speedRow.off || !speedRow.disabled) problems.push(`设了目标时长，速度行没灰：off=${speedRow.off} disabled=${speedRow.disabled}`);
  if (!speedRow.title.includes('目标时长')) problems.push(`灰掉的行没解释原因：${speedRow.title}`);
  const dupRow = await fieldOf(page, 'maxCopies');
  if (dupRow.off !== !dupRow.value) problems.push(`「每组复制」跟着「复制盖章」的开关走：off=${dupRow.off}`);
  await setField(page, 'targetDuration', 0);
  const restoredSpeed = await fieldOf(page, 'speed');
  if (restoredSpeed.off || restoredSpeed.disabled) problems.push('目标时长归零后速度行仍然锁着');

  const snippet = await page.evaluate(() => window.__tuner.snippet());
  if (!snippet.includes('agentCount: 12')) problems.push('导出片段没跟上面板改动');
  if (!snippet.includes("document.querySelector('#site')")) problems.push('导出片段的 root 选择器不对');
  if (snippet.includes('data-sb-chrome')) problems.push('导出片段把面板自己的 ignore 选择器带进了生产配置');
  if (!snippet.includes('swarm.start();')) problems.push('导出片段不是可直接运行的代码');

  await page.click('[data-copy]');
  await page.waitForTimeout(200);
  // Windows 剪贴板会把 \n 归一成 \r\n，比较前先还原。
  const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  if (clip !== snippet) problems.push('剪贴板内容和 snippet() 不一致');
  await page.screenshot({ path: `${OUT}tune-panel.png` });

  // 重置只回默认值，不擅自重跑；改动依然标成待生效，由人决定什么时候应用。
  await page.click('[data-reset]');
  const afterReset = await panelUi(page);
  if (!afterReset.status.includes('已重置')) problems.push(`重置后状态是 ${afterReset.status}`);
  if ((await fieldOf(page, 'agentCount')).value !== '6') problems.push('重置后光标数量没回到 6');
  if (afterReset.dirty < 1) problems.push('重置后没有把与当前这局不一致的项标出来');

  // 恢复原状必须能在跑的过程中用：停掉施工，把页面原样交还。
  await page.click('[data-apply]');
  await page.waitForTimeout(900);
  const beforeRestore = await panelUi(page);
  if (!beforeRestore.overlay) problems.push('应用后没有跑起来');
  await page.click('[data-restore]');
  await page.waitForTimeout(300);
  const restored = await panelUi(page);
  if (restored.overlay) problems.push('恢复原状后 overlay 还在');
  if (restored.hidden !== 0) problems.push(`恢复原状后还有 ${restored.hidden} 个元素被遮住`);
  if (restored.phase !== 'idle') problems.push(`恢复原状后阶段是 ${restored.phase}`);
  if (!restored.status.includes('已恢复原状')) problems.push(`恢复原状后状态是 ${restored.status}`);
  if (restored.pauseDisabled !== true) problems.push('停掉后暂停按钮还亮着');

  // root=body 时面板是 body 的子节点：既不能被遮，也不能被当成内容重建。
  const bodyCase = await page.evaluate(async () => {
    const { tune } = await import('/src/tune/index.ts');
    const t = tune({ root: document.body, open: true, position: 'top-left' });
    t.apply();
    await new Promise((r) => setTimeout(r, 900));
    const hosts = [...document.querySelectorAll('[data-sb-chrome]')];
    const visible = hosts.every((h) => !h.classList.contains('sb-hidden') && getComputedStyle(h).visibility === 'visible');
    // 面板钉在左上角，正文从 #site 左缘才开始：落在正文左缘以左的 item 只可能是
    // 面板自己被重建了（真实内容的 item 不会越进这条左侧空栏）。
    const gutter = document.querySelector('#site').getBoundingClientRect().left - 8;
    const inPanelColumn = [...document.querySelectorAll('.sb-item')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left < gutter;
    }).length;
    t.destroy();
    return { visible, inPanelColumn, hostsLeft: document.querySelectorAll('[data-sb-chrome]').length };
  });
  if (!bodyCase.visible) problems.push('root=body 时面板被隔离层遮掉');
  if (bodyCase.inPanelColumn !== 0) problems.push(`面板自己被重建了：${bodyCase.inPanelColumn} 个 item 落在面板所在的左栏`);
  if (bodyCase.hostsLeft !== 1) problems.push(`destroy 后还剩 ${bodyCase.hostsLeft} 个面板宿主`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('tune-panel @1280', problems, [
    `面板: ${first.rows} 行控件 · 字体 ${first.font.split(',')[0]} · 底色 ${first.cardBg}`,
    `运行中: 面板可见=${!mid.hidden} · 途中元素=${mid.items} · ${done.status}`,
    `待生效: ${touched.dirty} 行 · ${touched.note}`,
    `依赖: 设时长后速度行 off=${speedRow.off} disabled=${speedRow.disabled} · 说明「${speedRow.title.slice(0, 24)}…」`,
    `导出: ${snippet.split('\n').length} 行 · 剪贴板一致=${clip === snippet}`,
    `重置: ${afterReset.status} · 光标数量=${(await fieldOf(page, 'agentCount')).value} · 待生效 ${afterReset.dirty} 行`,
    `恢复原状（途中）: ${beforeRestore.status} → ${restored.status} · 遮罩残留 ${restored.hidden}`,
    `root=body: 面板可见=${bodyCase.visible} · 落在面板左栏的 item=${bodyCase.inPanelColumn}`,
  ]);
  await ctx.close();
}

await browser.close();
owned?.child.kill();
console.log(`\n${failures === 0 ? '全部通过' : failures + ' 个场景有问题'} · 截图在 .shots/ · 服务 ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
