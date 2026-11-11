import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
    // SB_VERIFY 让那台服务器关掉 HMR：整页重载是广播的，中途来一次就把正在跑的那一局打断。
    env: { ...process.env, BROWSER: 'none', SB_VERIFY: '1' },
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

const PAGES = ['home', 'simple', 'landing', 'dark-ui', 'cdn'];
const EXPECTED_MEDIA = { landing: 5, 'dark-ui': 1 };
const EXPECTED_COPIES = { home: 12, simple: 3, landing: 9, 'dark-ui': 29 };
const EXPECTED_GUIDES = { home: 12, simple: 3, landing: 5 };
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
// 两处读取都对 `[data-sb-chrome]` 用了可选链：dev server 中途广播一次整页重载是真实存在的
// （第一次 import 某个还没进依赖图的 /src 模块、或 dist 产物刚被重写），那一瞬间面板还没挂回来。
// 读成空串就是「还没跑完」，循环继续轮询；面板真的一直不出现，照样会在 deadline 上判红。
const readStatus = (page) => page.evaluate(
  () => document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-status]')?.textContent ?? '',
);

const waitDone = (page, ms) => page.waitForFunction(
  () => document.querySelector('[data-sb-chrome]')?.shadowRoot
    ?.querySelector('[data-status]')?.textContent.startsWith('完成'),
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
      tip: row?.dataset.tip ?? '',
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
      ? await page.evaluate(async () => {
          const { DEFAULT_CONFIG } = await import('/src/tune/snippet.ts');
          const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
          const keys = [...sr.querySelectorAll('.row')].map((el) => el.dataset.rowKey);
          return {
            status: sr.querySelector('[data-status]').textContent,
            overlayGone: !document.querySelector('.sb-overlay'),
            originalVisible: document.querySelectorAll('.sb-hidden').length === 0,
            // 顶栏已经删干净：页面上不该再有 body > .bar，参数只在面板里改。
            toolbar: document.querySelectorAll('body > .bar').length,
            rows: keys.length,
            // 参数都暴露 = 配置面里的每一个键都有自己的一行。行数由库自己给出，
            // 加参数时不必再回来改一个手写的数字（上一批就是这么过期的）。
            missing: Object.keys(DEFAULT_CONFIG).filter((key) => !keys.includes(key)),
            // 而且不用滚动就全看得见。
            clipped: (() => {
              const f = sr.querySelector('.fields');
              return f.scrollHeight > f.clientHeight + 1;
            })(),
          };
        })
      : { status: 'TIMEOUT', toolbar: 0, rows: 0, missing: [], clipped: true };

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
    if (done.missing.length) problems.push(`配置面有 ${done.missing.length} 个参数在面板里没有行：${done.missing.join(', ')}`);
    if (done.clipped) problems.push('面板参数列表要滚动才看得全');
    if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

    report(`${name} @${width}`, problems, [
      `过程: rects=${mid.rects} texts=${mid.texts} 已打字=${mid.typedChars} 徽章=${mid.badges} 拖框中=${mid.dragging} 准星=${mid.crosshair} I型=${mid.ibeam} caret=${mid.caret} 遮罩=${mid.hidden}`,
      `媒体: 槽位=${mid.media} 已呈现=${mid.mediaShown}/${expectedMedia} 降级=${mid.mediaFallback}`,
      `复制: 拖影=${mid.copies} 累计复制=${stamps}/${expectedCopies} ⌥ 徽章峰值=${mid.optionBadges}`,
      `辅助线: 累计=${guides}/${expectedGuides}`,
      `入口: 顶栏 ${done.toolbar} 个 · 面板 ${done.rows} 行 · 当前页${done.clipped ? '需滚动' : '不滚动'}`,
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
  // 默认 scan:'pre-scroll'：开局要先等字体图片、把全页滚一遍再采。采完才有第一件
  // sb-item，那之前引擎还没进时钟，点暂停不会生效。等真正的施工出来再量。
  await page.waitForFunction(
    () => document.querySelectorAll('.sb-item, .sb-text').length > 0,
    null,
    { timeout: 60000, polling: 150 },
  );
  await page.waitForTimeout(300);
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
  // 默认 trigger:'scroll' 的解锁线是视口底边：只滚 500px 盖不到页底，把这一局读到底。
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

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

  // 密集页必须同样出声：auto 性能模式以前会顺手把 sound 关掉，于是「复杂网页没有音效」
  // 看起来像音效坏了，其实是性能裁剪清单收错了对象。
  const crowded = await (async () => {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await c2.newPage();
    p2.on('pageerror', (err) => errors.push(String(err)));
    await p2.goto(`${BASE}/demos/console.html`, { waitUntil: 'load' });
    await p2.evaluate(() => {
      window.__audio = { contexts: 0, voices: 0 };
      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        constructor(...args) { super(...args); window.__audio.contexts++; window.__audio.last = this; }
      };
      const create = Real.prototype.createOscillator;
      Real.prototype.createOscillator = function () { window.__audio.voices++; return create.apply(this, arguments); };
    });
    const out = await p2
      .evaluate(() =>
        new Promise((resolve) => {
          new window.SwarmBuilder({
            root: document.querySelector('#app'),
            agentCount: 6,
            speed: 4,
            maxItems: 400,
            sound: true,
            trigger: 'immediate',
            onComplete: () => resolve({ ...window.__audio, guides: window.__guides ?? -1 }),
          }).start();
        }),
      )
      .catch(() => ({ contexts: 0, voices: 0 }));
    await c2.close();
    return out;
  })();
  if (crowded.contexts < 1) problems.push(`密集页面没有创建 AudioContext（音效被性能模式吃掉了）`);
  if (crowded.voices < 20) problems.push(`密集页面只发声 ${crowded.voices} 次，少于 20`);

  report('sound @1280', problems, [
    `关闭: AudioContext=${off.contexts} 发声=${off.voices}`,
    `开启: AudioContext=${on.contexts} 发声=${on.voices} · 状态=${on.state} · 时钟=${on.clock}s`,
    `密集页(399 项): AudioContext=${crowded.contexts} 发声=${crowded.voices}`,
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
          trigger: 'immediate',
          // 这一场测的是估算器把整局压进 targetDuration 的能力。默认的积压提速会
          // 按 backlog 把时钟拧到 4 倍，targetDuration 于是只剩「下限」——那是另一条
          // 已写进文档的语义，不是估算器失准。auto 班组同样会按积压多招人，把整局
          // 提前一半跑完。开场聚群那 2.4 秒也不归估算器算。测定速必须把这三样都关掉。
          adaptiveSpeed: false,
          gather: false,
          agents: 'fixed',
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
        let near90 = 0;
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
            let inside = 0;
            for (let i = 0; i < moving.length; i++) {
              for (let j = i + 1; j < moving.length; j++) {
                const d = Math.hypot(moving[i].x - moving[j].x, moving[i].y - moving[j].y);
                min = Math.min(min, d);
                // 90px 是 dodge 的作用半径：这一列数的是「它有没有活可干」。
                if (d < 90) inside++;
              }
            }
            frames++;
            minSum += min;
            minSeen = Math.min(minSeen, min);
            if (inside > 0) near90++;
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
          trigger: 'immediate',
          // 比的是避让本身：开场那 18 只聚群光标和自动增减的班组都会改「同场有几个人」，
          // 把重叠帧数搅成噪声。人数钉死、不聚群、不积压提速，两局才是同一张考卷。
          // 性格也钉死：每局种子不同，抽出来的急性子/摸鱼会改赶路打字快慢，
          // 把 ±2 帧的擦过容差搅成噪声——性格有自己的考卷（personality 场景）。
          gather: false,
          agents: 'fixed',
          adaptiveSpeed: false,
          personality: false,
          onComplete: (result) => {
            running = false;
            resolve({
              built: result.built,
              durationMs: result.durationMs,
              frames,
              crowdedFrames: crowded,
              nearFrames: near,
              near90Frames: near90,
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
  //
  // 而且这条只能测「不许变糟」：dodge 在落点前那 1/5 段被 ease 归零，光标终究要落在
  // 自己被派到的那个坐标上，所以「擦过几次」本来就不归避让管。同一份代码连跑六遍，
  // 开与关都是 138/139 帧里 10 帧擦过——差值是 ±1 帧的抖动，不是效果。给 2 帧容差，
  // 真退化了（擦过翻倍）照样红。
  if (on.nearFrames > off.nearFrames + 2) problems.push(`同行擦过帧明显变多：${off.nearFrames} → ${on.nearFrames}`);
  if (on.crowdedFrames > off.crowdedFrames + 2) problems.push(`<18px 重叠帧明显变多：${off.crowdedFrames} → ${on.crowdedFrames}`);
  // 反向兜底：开了避让却连平均最近距离和采样帧数都一像素不动，那是 dodge 没参与运算。
  if (on.frames === off.frames && on.avgMin === off.avgMin) {
    problems.push(`避让开了却和关着一帧不差（${on.frames} 帧 / 平均最近 ${on.avgMin}px）：dodge 没参与运算`);
  }
  if (Math.abs(on.durationMs - off.durationMs) > off.durationMs * 0.3) problems.push(`避让改变了节奏：${(off.durationMs / 1000).toFixed(1)}s → ${(on.durationMs / 1000).toFixed(1)}s`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('flocking @1280', problems, [
    `关闭: 同行帧=${off.frames} · <40px 擦过=${off.nearFrames}(${((off.nearFrames / Math.max(1, off.frames)) * 100).toFixed(0)}%) · <18px 重叠=${off.crowdedFrames} · 平均最近 ${off.avgMin}px · ${(off.durationMs / 1000).toFixed(1)}s`,
    `开启: 同行帧=${on.frames} · <40px 擦过=${on.nearFrames}(${((on.nearFrames / Math.max(1, on.frames)) * 100).toFixed(0)}%) · <18px 重叠=${on.crowdedFrames} · 平均最近 ${on.avgMin}px · ${(on.durationMs / 1000).toFixed(1)}s`,
    `建成: ${on.built} 项 · 这一条测「不许更挤」（±2 帧），两档的 90px 内相遇帧本来就同为 ${off.near90Frames}/${on.near90Frames}——擦过次数由派单决定，不由避让决定`,
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
        trigger: on ? 'scroll' : 'immediate',
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
      dropped: Number((status.match(/丢弃 (\d+)/) ?? [])[1] ?? 0),
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
  // 跑完有两拍：最后一次 HUD 轮询先说「完成 N 项」，onComplete 到了才补上光标数、用时和丢弃。
  // 只认 `用时` 才算真收尾，否则面板重跑会在那条半成品状态上被误读成 0.0s。
  const waitFrameDone = (ms) => page.waitForFunction(
    () => {
      const text = (document.querySelector('[data-frame]').contentDocument
        .querySelector('[data-sb-chrome]')?.shadowRoot
        .querySelector('[data-status]')?.textContent.trim() ?? '');
      return text.startsWith('完成') && text.includes('用时');
    },
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
  // 第一页是产品自己的说明页——它同时也是 README 之外的一份「它到底能做什么」。
  const first = await chromeShape();
  const firstFrame = await frameShape();
  if (first.tab !== 'home' || first.case_ !== 'home') problems.push(`初始标签页不对: ${JSON.stringify(first)}`);
  if (firstFrame.demo !== 'home') problems.push(`第一个案例内容是 ${firstFrame.demo}`);
  if (first.url !== 'https://swarm-builder.dev') problems.push(`地址栏显示 ${first.url}`);
  if (first.back !== true || first.fwd !== true) problems.push('首次进入时前进/后退应该都禁用');
  await waitFrameDone(60000);
  const homeDone = await frameShape();
  if (homeDone.built < 120) problems.push(`产品说明页只建成 ${homeDone.built} 项`);
  // 顶层状态栏要如实镜像面板：用户不用展开面板也知道在跑什么。它是 200ms 轮询，
  // 所以等它追上，而不是拿面板那一瞬间的值去比。
  await page.waitForFunction(() => document.querySelector('[data-statusbar]').dataset.phase === 'done',
    null, { timeout: 5000 }).catch(() => {});
  const mirror = await chromeShape();
  if (mirror.phase !== 'done') problems.push(`跑完后状态栏阶段是 ${mirror.phase}`);
  if (!mirror.hint.includes('产品说明页') || !mirror.hint.includes('完成')) {
    problems.push(`状态栏没有镜像面板进度：${JSON.stringify(mirror.hint)}`);
  }
  // 说明页顶栏的 GitHub 入口是真链接：新标签打开，且不把 referrer 带出去。
  const gh = await page.evaluate(() => {
    const el = document.querySelector('[data-github]');
    return el ? { href: el.href, target: el.target, rel: el.rel } : null;
  });
  if (!gh || !gh.href.startsWith('https://github.com/')) problems.push(`顶栏没有可用的 GitHub 链接: ${JSON.stringify(gh)}`);
  if (gh && (gh.target !== '_blank' || !gh.rel.includes('noreferrer'))) {
    problems.push(`GitHub 链接没有在新标签打开并屏蔽 referrer: ${JSON.stringify(gh)}`);
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

  // 默认上限就是扩展的 4000：这个 440 项的密集页全部在蓝图里，没有可丢的。
  if (natural.dropped !== 0) problems.push(`默认上限就报了丢弃 ${natural.dropped} 项`);
  // 上限压到 200：面板这条线必须真的接进蓝图，而不是只改了个数字。
  // 压完再抬回去，后面的定速比的是整页规模，不是被截断的 200 项。
  await frameApply([['maxItems', 200], ['targetDuration', 0]]);
  await waitFrameDone(120000);
  const capped = await frameShape();
  if (capped.built <= 0 || capped.built > 200) problems.push(`上限压到 200 却建了 ${capped.built} 项`);
  if (capped.dropped < 1) problems.push(`上限压到 200 没报丢弃，maxItems 没接进蓝图：${capped.status}`);
  if (capped.built >= natural.built) problems.push(`压上限后建成数没有变少：${capped.built} >= ${natural.built}`);

  await frameApply([['maxItems', 4000], ['targetDuration', 10]]);
  await waitFrameDone(120000);
  const paced = await frameShape();
  const secondsOf = (status) => Number((status.match(/用时\s*([\d.]+)s/) ?? [])[1] ?? 0);
  const openSeconds = secondsOf(natural.status);
  const pacedSeconds = secondsOf(paced.status);
  // 定速的准头由 pace-perf 场景按 35% 卡死（那里关掉积压提速和开场聚群，估算器说了算）。
  // 这里开着默认的 auto 班组与积压提速，targetDuration 只是下限，倍率还在动，
  // 所以只确认「这一局确实按整页规模跑完、报了有效时长」，具体快慢只作为信息记下来。
  if (paced.built !== natural.built) problems.push(`定速那局建成数不再是整页规模：${paced.built} vs ${natural.built}`);
  if (pacedSeconds <= 0) problems.push(`定速那局没报出时长：${paced.status}`);
  await page.screenshot({ path: `${OUT}browser-console-paced.png` });

  // 后退/前进：此刻历史是 home → console，退一步应回到第一页。
  if ((await chromeShape()).back !== false) problems.push('已有两步历史时后退仍然禁用');
  await page.click('[data-back]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'home', null, { timeout: 15000 });
  const wentBack = await chromeShape();
  if (wentBack.tab !== 'home' || wentBack.fwd !== false) problems.push(`后退后外壳不对: ${JSON.stringify(wentBack)}`);
  await page.click('[data-fwd]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'console', null, { timeout: 15000 });
  const wentFwd = await chromeShape();
  if (wentFwd.tab !== 'console' || wentFwd.fwd !== true) problems.push(`前进后外壳不对: ${JSON.stringify(wentFwd)}`);

  // 创造者模式开关：关掉时面板收成一颗悬浮球，页面本身不受影响。
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
  if (!/采蓝图|开场聚群|个光标|完成/.test(reloading.status)) problems.push(`重新载入后状态异常: ${reloading.status}`);
  await waitFrameDone(120000);
  const reloaded = await frameShape();
  if (reloaded.built !== natural.built) problems.push(`重载后没有回到案例自带默认：${reloaded.built} vs ${natural.built}`);

  // 切回落地页
  await page.click('.tab[data-key="landing"]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'landing', null, { timeout: 15000 });
  await waitFrameDone(60000);
  const back = await frameShape();
  await page.screenshot({ path: `${OUT}browser-landing.png` });

  // 全部预设都要「音效 + 镜头跟随」开着。查的是面板上真正打勾的控件，
  // 不是 HTML 里那串 data-swarm——字符串写了但没接进配置也算不过。
  const presets = [];
  for (const [key, demo] of [
    ['home', 'home'], ['simple', 'simple'], ['console', 'console'], ['landing', 'landing'],
    ['dark-ui', 'blender'], ['tall', 'tall'], ['tune', 'tune'],
  ]) {
    await page.click(`.tab[data-key="${key}"]`);
    await page.waitForFunction((d) => document.querySelector('[data-frame]').contentDocument
      .body?.dataset.demo === d, demo, { timeout: 15000 });
    await page.waitForTimeout(300);
    const on = await page.evaluate(() => {
      const sr = document.querySelector('[data-frame]').contentDocument
        .querySelector('[data-sb-chrome]')?.shadowRoot;
      const checked = (k) => sr?.querySelector(`[data-key="${k}"]`)?.checked ?? null;
      return { sound: checked('sound'), tour: checked('tour') };
    });
    if (on.sound !== true || on.tour !== true) problems.push(`${key} 的预设没同时开音效/跟随: ${JSON.stringify(on)}`);
    presets.push(`${key} 音效=${on.sound} 跟随=${on.tour}`);
  }

  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('mockup-browser @1280', problems, [
    `外壳: 标签 ${first.tab} · 地址 ${first.url} · 后退/前进初始 ${first.back}/${first.fwd}`,
    `GitHub 入口: ${gh ? `${gh.target} ${gh.rel} ${gh.href}` : '缺失'}`,
    `产品说明页: ${homeDone.built} 项 · 状态栏 ${mirror.phase} · ${mirror.hint}`,
    `密集案例: 默认上限 ${natural.built} 项 / 丢弃 ${natural.dropped} · 墙钟 ${(naturalMs / 1000).toFixed(1)}s · ${natural.status}`,
    `面板压上限 200: ${capped.built} 项 / 丢弃 ${capped.dropped} · 自然节奏 ${openSeconds}s`,
    `面板定速 10s: ${paced.built} 项 · 实测 ${pacedSeconds}s（估算器按条目线性计价，整页规模会低估，见 plan §13.15）`,
    `案例内 .bar 定位: ${leaked.bar}（应为 static）· 顶栏残留 ${leaked.toolbars} 个`,
    `后退/前进: ${wentBack.tab}(fwd=${wentBack.fwd}) → ${wentFwd.tab}(fwd=${wentFwd.fwd})`,
    `创造者模式: 关=${closed.open} 开=${reopened.open} · 重载回到默认 ${reloaded.built} 项`,
    `切回: landing · ${back.status}`,
    `预设: ${presets.join(' · ')}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 17b：自定义站点标签——标签条末尾的加号开新标签，输入地址就地重建
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];

  const shell = () => page.evaluate(() => {
    const frame = document.querySelector('[data-frame]');
    const sr = frame.contentDocument?.querySelector('[data-sb-chrome]')?.shadowRoot;
    const q = new URLSearchParams(location.search);
    const status = sr?.querySelector('[data-status]')?.textContent.trim() ?? '';
    return {
      tabs: document.querySelectorAll('.tab').length,
      title: document.querySelector('.tab[aria-selected="true"] b')?.textContent ?? '',
      closable: !!document.querySelector('.tab[aria-selected="true"] .close'),
      url: document.querySelector('[data-url]').textContent,
      hint: document.querySelector('[data-hint]').textContent,
      case_: q.get('case'),
      u: q.get('u'),
      blank: document.querySelector('[data-blank]')?.hidden === false,
      focused: document.activeElement?.hasAttribute('data-blank-input') ?? false,
      // 重建的那一页走 blob: 文档（srcdoc 会被浏览器的本地网络检查挡掉外链图），
      // 认 wrapForRebuild 打的 data-sb-rebuild 标记，而不是回头看 srcdoc 属性。
      rebuild: frame.contentDocument?.documentElement?.dataset.sbRebuild === '1',
      blob: frame.src.startsWith('blob:'),
      status,
      // 建成数从面板状态里读：跑完之后 .sb-item 那些幽灵盒已经撤了，数 DOM 会误判成 0。
      built: Number((status.match(/完成 (\d+) 项/) ?? [])[1] ?? 0),
      items: frame.contentDocument?.querySelectorAll('.sb-item').length ?? 0,
      rows: sr?.querySelectorAll('.row').length ?? 0,
    };
  });
  // 等重建出来的那一页跑完，而不是等旧文档残留的「完成」——外壳换 frame 是异步的，
  // 只看状态文本会在上一页的结论上直接通过。重建文档靠 data-sb-rebuild 认。
  const waitRebuilt = (demo, ms) => page.waitForFunction(
    ([d, t]) => {
      const frame = document.querySelector('[data-frame]');
      const sr = frame.contentDocument?.querySelector('[data-sb-chrome]')?.shadowRoot;
      const text = sr?.querySelector('[data-status]')?.textContent.trim() ?? '';
      return frame.contentDocument?.documentElement?.dataset.sbRebuild === '1'
        && frame.contentDocument?.body?.dataset.demo === d
        && text.startsWith(t)
        && text.includes('用时');
    },
    [demo, '完成'], { timeout: ms, polling: 200 },
  );

  await page.goto(`${BASE}/demos/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-frame]')?.contentDocument
    ?.querySelector('[data-sb-chrome]') !== null, null, { timeout: 15000 });
  const start = await shell();
  if (start.tabs !== 7 || start.closable) problems.push(`预设标签条不对: ${start.tabs} 个，可关闭=${start.closable}`);

  // 加号开新标签：语义和真浏览器一致——空白页 + 输入框自己拿到焦点。
  await page.click('[data-newtab]');
  await page.waitForTimeout(400);
  const blank = await shell();
  if (!blank.blank) problems.push('点加号没有打开空白新标签');
  if (!blank.focused) problems.push('空白页的输入框没有自动聚焦');
  if (blank.tabs !== 8 || !blank.closable) problems.push(`新标签没带上关闭钮: ${blank.tabs} 个 / closable=${blank.closable}`);

  // javascript:/data: 会被写进重建文档，等于让外壳执行任意脚本，必须挡在门口。
  await page.fill('[data-blank-input]', 'javascript:alert(1)');
  await page.click('.blank-go');
  await page.waitForTimeout(300);
  const bad = await shell();
  if (!bad.blank) problems.push('非法地址不该把页面换掉');
  if (!bad.hint.includes('读不懂')) problems.push(`非法地址没给说明: ${bad.hint}`);
  if (bad.u) problems.push(`非法地址被写进了 URL: ${bad.u}`);

  // 同源页面：取 HTML → 剥脚本 → 同源 blob 重建，参数面板照旧是唯一入口。
  await page.fill('[data-blank-input]', './tune.html');
  await page.click('.blank-go');
  await waitRebuilt('tune', 60000);
  const rebuilt = await shell();
  if (!rebuilt.rebuild || !rebuilt.blob) problems.push('同源自定义页没有走本地重建文档');
  if (rebuilt.built < 5) problems.push(`重建出来的页面只建成 ${rebuilt.built} 项（状态「${rebuilt.status}」）`);
  if (!/tune\.html/.test(rebuilt.title)) problems.push(`标签名没跟着地址换: ${rebuilt.title}`);
  if (!rebuilt.url.includes('/demos/tune.html')) problems.push(`地址栏没显示自定义地址: ${rebuilt.url}`);
  if (!rebuilt.u?.endsWith('/demos/tune.html')) problems.push(`自定义地址没写回 URL: ${rebuilt.u}`);
  if (rebuilt.rows === 0) problems.push('重建页里没有创造者模式面板');
  await page.screenshot({ path: `${OUT}browser-custom.png` });

  // 取不到的站点：诚实降级为直接嵌，状态条要把「读不到 DOM」说出来。
  await page.evaluate(() => window.__browser.navigate(window.__browser.current(), 'http://127.0.0.1:1/nope'));
  await page.waitForFunction(() => document.querySelector('[data-hint]').textContent.includes('读不到'),
    null, { timeout: 25000 }).catch(() => {});
  const framed = await shell();
  if (!framed.hint.includes('读不到')) problems.push(`取不到的地址没有如实说明: ${framed.hint}`);
  if (framed.rebuild) problems.push('取不到的站点不该假装成重建');

  // 关掉自定义标签：回到预设轨道，历史与 URL 都不留孤儿。
  await page.click('.tab[aria-selected="true"] .close');
  await page.waitForTimeout(800);
  const closed = await shell();
  if (closed.tabs !== 7) problems.push(`关闭自定义标签后剩 ${closed.tabs} 个标签`);
  if (closed.closable) problems.push('预设标签不该有关闭钮');
  if (closed.u) problems.push(`关闭后 URL 还留着 u 参数: ${closed.u}`);

  // ?u= 直达：分享链接和验收都不必先点加号再打字。
  await page.goto(`${BASE}/demos/index.html?u=${encodeURIComponent('./simple.html')}`, { waitUntil: 'load' });
  await waitRebuilt('simple', 60000);
  const deep = await shell();
  if (deep.tabs !== 8 || !deep.rebuild) problems.push(`?u= 直达没开出重建标签: ${deep.tabs} 个 / rebuild=${deep.rebuild}`);
  if (deep.case_ !== 'custom-1') problems.push(`?u= 直达后活动标签是 ${deep.case_}`);

  report('custom-tab @1280', problems, [
    `标签条: 预设 ${start.tabs} 个 · 加号后 ${blank.tabs} 个（空白页聚焦=${blank.focused}）`,
    `非法地址: ${bad.hint}`,
    `同源重建: ${rebuilt.title} · 建成 ${rebuilt.built} 项 · 面板 ${rebuilt.rows} 行 · 状态「${rebuilt.status}」`,
    `取不到时: ${framed.hint}`,
    `关闭后: ${closed.tabs} 个标签 · case=${closed.case_} · u=${closed.u ?? '（已清）'}`,
    `?u= 直达: ${deep.title} · rebuild=${deep.rebuild} · 建成 ${deep.built} 项`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 17c：案例页铺满视口——纸色/工作台不许在屏幕边上留一条与页面不同的边
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  const notes = [];

  const cover = () => page.evaluate(() => {
    const root = document.querySelector('#app > div') || document.querySelector('#app');
    const b = root.getBoundingClientRect();
    return {
      cls: root.className,
      w: Math.round(b.width),
      left: Math.round(b.left),
      bottom: Math.round(b.bottom),
      innerW: document.documentElement.clientWidth,
      innerH: window.innerHeight,
      docH: document.documentElement.scrollHeight,
      bg: getComputedStyle(root).backgroundColor,
    };
  });

  for (const [w, h] of [[1280, 900], [390, 740]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const name of ['home', 'dark-ui', 'tall', 'console', 'landing']) {
      await page.goto(`${BASE}/demos/${name}.html`, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      const c = await cover();
      const opaque = c.bg !== 'rgba(0, 0, 0, 0)' && c.bg !== 'transparent';
      if (opaque && c.w < c.innerW - 1) problems.push(`${name} @${w} 两侧留了 ${c.innerW - c.w}px 与页面不同的边（${c.bg}）`);
      if (opaque && c.docH <= c.innerH + 1 && c.bottom < c.innerH - 1) {
        problems.push(`${name} @${w} 文档不足一屏，底部空了 ${c.innerH - c.bottom}px`);
      }
      notes.push(`${name}@${w} ${c.w}/${c.innerW}×${c.bottom}/${c.innerH}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/demos/dark-ui.html`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}fill-dark-ui-1280.png` });

  report('case-fill @1280/@390', problems, [
    `根元素宽/视口宽、底边/视口高: ${notes.join(' · ')}`,
    'simple 是有意留窄的基准文章页（底色透明，边上不会露出另一种颜色），不进这条断言',
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 18：创造者模式嵌进「别人家的站点」（shadow DOM 隔离 + 导出片段 + chrome 不被遮）
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
      rowKeys: [...(sr?.querySelectorAll('.row') ?? [])].map((el) => el.dataset.rowKey),
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
  // 期望的行数不写死：拿库自己的配置面（DEFAULT_CONFIG 的键）当尺子，
  // 上一批那个 17 就是这么过期的——加了 balance 之后它是 18，报的却是「面板没建起来」。
  const configKeys = await page.evaluate(async () => {
    const { DEFAULT_CONFIG } = await import('/src/tune/snippet.ts');
    return Object.keys(DEFAULT_CONFIG);
  });
  const first = await panelState();
  const missingRows = configKeys.filter((key) => !first.rowKeys.includes(key));
  if (!first.host || missingRows.length) problems.push(`面板没建起来 / 参数行对不上配置面：host=${first.host} 行数=${first.rows} 缺行=${missingRows.join(',') || '无'}`);
  // 宿主页用 * { font-family: Georgia } 和 button{border:3px double} 故意撞面板。
  if (/Georgia/i.test(first.font)) problems.push(`宿主字体渗进面板：${first.font}`);
  // 断言的是「不等于宿主 .card 的底色」，不是「等于库自己的底色」——后者会把面板配色
  // 写死进验收，改一次视觉语言就得改一次测试。
  if (first.cardBg === 'rgb(255, 217, 160)') problems.push(`面板底色被宿主 .card 规则改掉：${first.cardBg}`);
  if (first.btnBorder !== '1px') problems.push(`面板按钮被宿主 button 规则改成 ${first.btnBorder} 边框`);

  await page.click('[data-apply]');
  // 默认采集方式是「预滚动」：先等字体图片、再把懒加载滚出来，才轮到第一笔施工。
  // 不能拿固定 900ms 当「跑起来了」，要等第一件重建元素真的落进 DOM。
  await page.waitForFunction(() => document.querySelectorAll('.sb-item').length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const mid = await panelState();
  if (mid.hidden || mid.visibility !== 'visible') problems.push(`运行中面板被隔离层遮掉：${JSON.stringify(mid)}`);
  if (!mid.overlay || mid.items === 0) problems.push(`面板触发的重建没跑起来：${JSON.stringify(mid)}`);

  // 工具条对齐扩展 HUD：Tour / 倍速 / 声音 / 暂停 / 跳过 / 重播改的是这一局。
  const tools = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const btn = (sel) => sr.querySelector(sel);
    return {
      tour: btn('[data-tour]').textContent,
      tourOn: btn('[data-tour]').dataset.on,
      speed: btn('[data-speed]').textContent,
      sound: btn('[data-sound]').textContent,
      disabled: ['[data-tour]', '[data-speed]', '[data-sound]', '[data-pause]', '[data-skip]', '[data-replay]']
        .map((sel) => btn(sel).disabled),
    };
  });
  if (tools.tour !== '跟随中' || tools.tourOn !== 'true') problems.push(`Tour 没跟着这一局亮：${tools.tour}/${tools.tourOn}`);
  if (!/×$/.test(tools.speed)) problems.push(`倍速钮没显示倍率：${tools.speed}`);
  if (!['声音', '解锁', '静音'].includes(tools.sound)) problems.push(`声音钮状态不对：${tools.sound}`);
  if (tools.disabled.slice(0, 5).some(Boolean) || tools.disabled[5]) problems.push(`运行中工具条按钮可用性不对：${tools.disabled.join('/')}`);

  // 班组点：最近 5 个忙碌光标，颜色 + 名字首字母，和扩展 HUD 一样。
  await page.waitForFunction(() => document.querySelector('[data-sb-chrome]').shadowRoot.querySelectorAll('.dot').length > 0, null, { timeout: 15000 });
  const crew = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const dots = [...sr.querySelectorAll('.dot')];
    return { count: dots.length, color: dots[0].style.background, letter: dots[0].textContent, name: dots[0].title };
  });
  if (crew.count < 1 || crew.count > 5) problems.push(`班组点应有 1~5 个，实测 ${crew.count}`);
  if (!crew.color || !crew.letter || !crew.name) problems.push(`班组点没画颜色/首字母/名字：${JSON.stringify(crew)}`);

  // Tour 钮运行中能关能开，标签跟着走。
  const clickTool = (sel) => page.evaluate((s) => document.querySelector('[data-sb-chrome]').shadowRoot.querySelector(s).click(), sel);
  await clickTool('[data-tour]');
  await page.waitForTimeout(300);
  const tourOff = await page.evaluate(() => {
    const b = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-tour]');
    return { text: b.textContent, on: b.dataset.on };
  });
  if (tourOff.text !== '镜头' || tourOff.on !== 'false') problems.push(`Tour 关了没变回「镜头」：${tourOff.text}/${tourOff.on}`);
  await clickTool('[data-tour]');
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
  if (!speedRow.tip.includes('目标时长')) problems.push(`灰掉的行没解释原因：${speedRow.tip}`);
  const dupRow = await fieldOf(page, 'maxCopies');
  if (dupRow.off !== !dupRow.value) problems.push(`「每组复制」跟着「复制盖章」的开关走：off=${dupRow.off}`);
  await setField(page, 'targetDuration', 0);
  const restoredSpeed = await fieldOf(page, 'speed');
  if (restoredSpeed.off || restoredSpeed.disabled) problems.push('目标时长归零后速度行仍然锁着');

  // 依赖的另一条：种子只在「随机」下参与排程，其他顺序要把这一行灰掉并说明为什么。
  await setField(page, 'order', 'group');
  const seedRow = await fieldOf(page, 'seed');
  if (!seedRow.off || !seedRow.disabled) problems.push(`顺序不是随机时种子行没灰：off=${seedRow.off} disabled=${seedRow.disabled}`);
  if (!seedRow.tip.includes('随机')) problems.push(`灰掉的种子行没解释原因：${seedRow.tip}`);
  await setField(page, 'order', 'random');
  const liveSeed = await fieldOf(page, 'seed');
  if (liveSeed.off || liveSeed.disabled) problems.push('切回随机后种子行还锁着');

  // 「每个参数都有 hover 提示」是逐行的硬要求，不是有一句总体说明就算。
  const hints = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const noTip = (sel) => [...sr.querySelectorAll(sel)].filter((el) => !(el.dataset.tip ?? '').length).length;
    return { rows: sr.querySelectorAll('.row').length, bare: noTip('.row'), buttons: noTip('header button,footer button,.util button,.grip,.orb,.tab'), title: sr.querySelectorAll('[title]').length };
  });
  if (hints.bare > 0) problems.push(`${hints.bare} 行参数没有 hover 提示`);
  if (hints.buttons > 0) problems.push(`${hints.buttons} 个按钮没有 hover 提示`);
  if (hints.title > 0) problems.push(`还剩 ${hints.title} 处用原生 title：和自绘提示会撞成两个气泡`);

  // 参数按用途分六页。一次只摊开一页——最长的一页七行，面板不会再拉成一列长表；
  // 页签悬停里带这一页的实时值，翻到别页也知道另一头设成了什么。行始终留在 DOM 里，
  // 上面「每个 DEFAULT_CONFIG 的键都有一行」和验收改值都靠它。
  const fold = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const secs = [...sr.querySelectorAll('.sec')];
    const tabs = [...sr.querySelectorAll('.tab')];
    const rows = [...sr.querySelectorAll('.row')];
    const shown = rows.filter((el) => el.getBoundingClientRect().height > 0);
    return {
      secKeys: secs.map((el) => el.dataset.sec),
      active: secs.filter((el) => el.dataset.active === 'true').map((el) => el.dataset.sec),
      activeTab: tabs.filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.dataset.tab),
      rows: rows.length,
      shown: shown.length,
      hidden: rows.length - shown.length,
      tips: tabs.map((el) => el.dataset.tip ?? ''),
      labels: tabs.map((el) => el.textContent),
      height: sr.querySelector('.fields').clientHeight,
      scroll: sr.querySelector('.fields').scrollHeight,
    };
  });
  if (fold.secKeys.join(',') !== 'scale,order,cursors,capture,sound,look') problems.push(`六页顺序不对：${fold.secKeys.join(',')}`);
  if (fold.labels.join(',') !== '规模,顺序,光标,采集,声音,外观') problems.push(`页签短名不对：${fold.labels.join(',')}`);
  if (fold.active.join(',') !== 'scale' || fold.activeTab.join(',') !== 'scale') problems.push(`默认停在「规模」页不对：${fold.active.join(',')}/${fold.activeTab.join(',')}`);
  if (fold.shown !== 6 || fold.hidden !== fold.rows - 6) problems.push(`默认只该露出「规模」6 行、其余收起，实测 ${fold.shown}/${fold.hidden}（共 ${fold.rows}）`);
  if (fold.tips.some((tip) => !tip.length)) problems.push('有页签没有 hover 提示');
  if (!fold.tips[1].includes('自上而下') || !fold.tips[1].includes('随滚动解锁')) problems.push(`顺序页签的提示没写当前值：${fold.tips[1]}`);
  if (!fold.tips[4].includes('开') || !fold.tips[4].includes('生成式配乐')) problems.push(`声音页签的提示没写当前值：${fold.tips[4]}`);
  if (fold.scroll > fold.height + 1) problems.push(`只剩一页参数时参数区就要滚：${fold.scroll}/${fold.height}`);

  // 翻到「光标」页：这一页的行露出来，其余页的全部收起。
  const cursors = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    sr.querySelector('[data-tab="cursors"]').click();
    const sec = sr.querySelector('.sec[data-sec="cursors"]');
    const rows = [...sec.querySelectorAll('.row')];
    return {
      active: sec.dataset.active,
      aria: sr.querySelector('[data-tab="cursors"]').getAttribute('aria-selected'),
      rows: rows.length,
      shown: rows.filter((el) => el.getBoundingClientRect().height > 0).length,
      scaleShown: [...sr.querySelectorAll('.sec[data-sec="scale"] .row')]
        .filter((el) => el.getBoundingClientRect().height > 0).length,
    };
  });
  if (cursors.active !== 'true' || cursors.aria !== 'true') problems.push(`点「光标」页没切过去：${cursors.active}/${cursors.aria}`);
  if (cursors.shown !== cursors.rows) problems.push(`切到光标页后只露出 ${cursors.shown}/${cursors.rows} 行`);
  if (cursors.scaleShown !== 0) problems.push(`切到光标页后规模页还露着 ${cursors.scaleShown} 行`);

  // 改当前页的一项：页签提示立刻跟着变；没翻到的页改了值，页签上要留一个待生效点。
  await setField(page, 'flight', 'idle');
  const flightTip = await page.evaluate(() => document.querySelector('[data-sb-chrome]').shadowRoot
    .querySelector('[data-tab="cursors"]').dataset.tip);
  if (!flightTip.includes('停在落点')) problems.push(`页签提示没跟上改动：${flightTip}`);
  await setField(page, 'order', 'group');
  // 上面改过的光标数留在「规模」页，它也应当带点；这里拿还没动过的「声音」页当
  // 「没有待生效就不该点」的对照，别把更早的合法改动当成面板算错。
  const dot = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    return { order: sr.querySelector('[data-tab="order"]').dataset.dirty, sound: sr.querySelector('[data-tab="sound"]').dataset.dirty };
  });
  if (dot.order !== 'true' || dot.sound !== 'false') problems.push(`没翻到的页改了值，页签没标待生效：${JSON.stringify(dot)}`);
  await page.evaluate(() => document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-tab="scale"]').click());

  // 提示是面板自己画的：立刻出现、字号受控，而且不能溢出视口。
  const rowBox = await page.evaluate(() => {
    const el = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-key="speed"]').closest('.row');
    const r = el.getBoundingClientRect();
    return { x: r.left + 8, y: r.top + r.height / 2 };
  });
  await page.mouse.move(rowBox.x, rowBox.y);
  await page.waitForTimeout(150);
  const tipShown = await page.evaluate(() => {
    const tip = document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('.tip');
    const box = tip.getBoundingClientRect();
    return {
      show: tip.dataset.show,
      text: tip.textContent,
      size: getComputedStyle(tip).fontSize,
      inView: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
    };
  });
  if (tipShown.show !== 'true' || !tipShown.text.includes('倍率')) problems.push(`悬停参数行没弹出对应提示：${JSON.stringify(tipShown)}`);
  if (!tipShown.inView) problems.push('提示气泡溢出视口');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(150);
  if ((await page.evaluate(() => document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('.tip').dataset.show)) !== 'false') {
    problems.push('移开后提示气泡没收起');
  }

  // 拖表头换位置：宿主自己的控件挡住参数时不用改代码，也躲得开。
  const anchored = await page.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    const r = host.getBoundingClientRect();
    const h = host.shadowRoot.querySelector('header').getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), x: h.left + h.width / 2, y: h.top + h.height / 2 };
  });
  await page.mouse.move(anchored.x, anchored.y);
  await page.mouse.down();
  await page.mouse.move(anchored.x - 320, anchored.y - 200, { steps: 8 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    const r = host.getBoundingClientRect();
    return { pos: host.dataset.pos, left: Math.round(r.left), top: Math.round(r.top), inline: host.style.left };
  });
  if (dragged.pos !== 'free') problems.push(`拖过表头后位置还是 ${dragged.pos}（应为 free）`);
  if (dragged.left > anchored.left - 100 || dragged.top > anchored.top - 100) problems.push(`面板没被拖走：${anchored.left},${anchored.top} → ${dragged.left},${dragged.top}`);
  if (!dragged.inline) problems.push('位置没写成内联样式：宿主页面的规则能覆盖 :host，覆盖不了内联');

  // 拉右下角把手变大：拉高以后参数行不用滚就能看全。
  const fieldsBefore = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const f = sr.querySelector('.fields');
    const g = sr.querySelector('.grip').getBoundingClientRect();
    return { height: sr.querySelector('.card').offsetHeight, clipped: f.scrollHeight > f.clientHeight + 1, x: g.left + 6, y: g.top + 6 };
  });
  await page.mouse.move(fieldsBefore.x, fieldsBefore.y);
  await page.mouse.down();
  await page.mouse.move(fieldsBefore.x + 70, fieldsBefore.y + 200, { steps: 6 });
  await page.mouse.up();
  const resized = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const card = sr.querySelector('.card');
    const f = sr.querySelector('.fields');
    return { width: card.offsetWidth, height: card.offsetHeight, clipped: f.scrollHeight > f.clientHeight + 1 };
  });
  if (resized.height <= fieldsBefore.height + 100) problems.push(`拉把手没变高：${fieldsBefore.height} → ${resized.height}`);
  if (resized.width < 300) problems.push(`拉把手没变宽：${resized.width}`);
  if (resized.clipped) problems.push('拉到 200px 以上还需要滚动才看得全参数');

  // 收起态的入口是一颗悬浮球：自绘 logo、名字写在球下面，按住能拖走，拖完不会顺手展开。
  await page.evaluate(() => window.__tuner.close());
  await page.waitForTimeout(120);
  const ball = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const orb = sr.querySelector('.orb');
    const r = orb.getBoundingClientRect();
    const cs = getComputedStyle(orb);
    return {
      round: cs.borderRadius,
      radiusPx: parseFloat(cs.borderTopLeftRadius) || 0,
      width: Math.round(r.width), height: Math.round(r.height),
      logo: orb.querySelectorAll('svg path, svg circle').length,
      tag: (sr.querySelector('.tag')?.textContent ?? '').trim(),
      tip: orb.dataset.tip ?? '',
      aria: orb.getAttribute('aria-label') ?? '',
      cardShown: getComputedStyle(sr.querySelector('.card')).display !== 'none',
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      left: Math.round(r.left), top: Math.round(r.top),
    };
  });
  if (ball.cardShown) problems.push('close() 以后卡片还露着，入口没收成球');
  if (ball.width !== ball.height || ball.radiusPx < ball.width / 2 - 1) problems.push(`入口不是正圆球：${ball.width}×${ball.height} · 圆角 ${ball.round}`);
  if (ball.logo < 3) problems.push(`悬浮球里没有自绘 logo（图元只有 ${ball.logo} 个）`);
  if (ball.tag !== '创造者模式' || ball.aria !== '创造者模式') problems.push(`入口名字是「${ball.tag}」/「${ball.aria}」`);
  if (!ball.tip.includes('创造者模式')) problems.push(`悬浮球提示没写入口名：${ball.tip}`);
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  // 往右下拖：球这时贴在视口上沿，往左上拖会立刻撞到钳位，量不出真实位移。
  await page.mouse.move(ball.x + 190, ball.y + 150, { steps: 6 });
  await page.mouse.up();
  const ballMoved = await page.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    const r = host.getBoundingClientRect();
    return { pos: host.dataset.pos, open: host.dataset.open, dragging: host.dataset.dragging ?? '', left: Math.round(r.left), top: Math.round(r.top) };
  });
  if (ballMoved.pos !== 'free') problems.push(`拖过悬浮球后位置还是 ${ballMoved.pos}`);
  if (ballMoved.open !== 'false') problems.push('拖完悬浮球松手就自动展开了——拖被当成了点');
  if (ballMoved.dragging) problems.push('松手后还停在 dragging 状态');
  if (ballMoved.left < ball.left + 100 || ballMoved.top < ball.top + 100) problems.push(`悬浮球没被拖走：${ball.left},${ball.top} → ${ballMoved.left},${ballMoved.top}`);
  await page.waitForTimeout(300);
  await page.click('.orb');
  await page.waitForTimeout(120);
  const openedByBall = await page.evaluate(() => document.querySelector('[data-sb-chrome]').dataset.open);
  if (openedByBall !== 'true') problems.push('轻点悬浮球没有展开创造者模式');
  // 拖到贴近下沿再展开：卡片必须自己夹回视口，不然底部按钮永远点不到。
  const fits = await page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
    const b = sr.querySelector('[data-copy]').getBoundingClientRect();
    return { bottom: Math.round(b.bottom), right: Math.round(b.right), vh: window.innerHeight, vw: window.innerWidth };
  });
  if (fits.bottom > fits.vh || fits.right > fits.vw) {
    problems.push(`拖到边上再展开后卡片顶出视口：复制按钮底边 ${fits.bottom} / 视口高 ${fits.vh}，右 ${fits.right} / 宽 ${fits.vw}`);
  }
  await page.screenshot({ path: `${OUT}tune-panel-moved.png` });

  const snippet = await page.evaluate(() => window.__tuner.snippet());
  if (!snippet.includes('agentCount: 12')) problems.push('导出片段没跟上面板改动');
  if (!snippet.includes("document.querySelector('#site')")) problems.push('导出片段的 root 选择器不对');
  if (!snippet.includes("flight: 'idle'")) problems.push('导出片段漏了收起分节里改过的那项');
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
  if ((await fieldOf(page, 'agentCount')).value !== '8') problems.push('重置后光标数量没回到库默认值 8');
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
    `运行中: 面板可见=${!mid.hidden} · 途中元素=${mid.items} · 工具条 ${tools.tour}/${tools.speed}/${tools.sound} · 班组点 ${crew.count} 个 · ${done.status}`,
    `待生效: ${touched.dirty} 行 · ${touched.note}`,
    `依赖: 设时长后速度行 off=${speedRow.off} disabled=${speedRow.disabled} · 提示「${speedRow.tip.slice(0, 24)}…」`,
    `提示: ${hints.rows} 行 + 按钮全部有 hover 气泡 · 弹出=${tipShown.show}「${tipShown.text.slice(0, 14)}…」@${tipShown.size} · 视口内=${tipShown.inView} · 种子行灰掉=${seedRow.off}`,
    `几何: 拖表头 ${anchored.left},${anchored.top} → ${dragged.left},${dragged.top}（pos=${dragged.pos}） · 拉把手 ${fieldsBefore.height}px → ${resized.height}px × ${resized.width}px`,
    `入口: ${ball.width}×${ball.height} 圆球（圆角 ${ball.round}）· logo ${ball.logo} 个图元 · 名字「${ball.tag}」· 拖球 ${ball.left},${ball.top} → ${ballMoved.left},${ballMoved.top}（没收成展开=${ballMoved.open}）· 轻点展开=${openedByBall} · 展开后按钮底边 ${fits.bottom} ≤ 视口 ${fits.vh}`,
    `导出: ${snippet.split('\n').length} 行 · 剪贴板一致=${clip === snippet}`,
    `重置: ${afterReset.status} · 光标数量=${(await fieldOf(page, 'agentCount')).value} · 待生效 ${afterReset.dirty} 行`,
    `恢复原状（途中）: ${beforeRestore.status} → ${restored.status} · 遮罩残留 ${restored.hidden}`,
    `root=body: 面板可见=${bodyCase.visible} · 落在面板左栏的 item=${bodyCase.inPanelColumn}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 构建顺序 + 种子：长页面是唯一能把「从上到下」看出来的场景，所以跑在 tall.html 上。
// 观测点是 DOM 里 item 的出现顺序。注意这一列是「画出来」的时刻，不是「认领」的时刻：
// 从认领到落 DOM 之间隔着光标飞行时间，所以同一个光标的第二件可能比隔壁的第一件先到。
// 「自上而下」卡三条真实保证：6 个光标开工首轮就横跨 ≥1500px（光标铺在整页上，不是挤在一坨）；
// 前两轮（前 12 件）六条横带全部有人开工；1 个光标时整条创建序列单调往下（没有并发横带互相穿插）。
// 「落在几条带」不拿 y 值去等分——密集的一排里相邻两条带的开工线可以只差几个像素，等分必然
// 把两条折成一条；这里直接问排程本身要 item → 带号 的映射，看这几件各属于哪条队列。
// 前 6 件「到达 DOM 的先后」不卡：那一列里掺了飞行时间，改版式会让某条带的第一件晚到一步，
// 而排程没变。带内 y 区间互不重叠这种确定性保证由 order-more 直接读排程队列来卡。
// 全局创建顺序的 y 中位数不卡：6 条带同时在盖，前 1/4 和后 1/4 都横跨整页，那个指标恒不成立。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });

  // 带边界由排程自己给：同一份蓝图、同样的 agentCount，队列里第 i 条就是第 i 个光标的带。
  // 键是 item id，正是 DOM 上 data-item 写的那个。
  // 读映射另开一页：这几个 /src 模块在本页是第一次 import，vite 会顺带重新预打包依赖并整页
  // 重载——发生在主页面上就是把下面那一串 run() 打断（Execution context was destroyed），
  // 现象长得像引擎坏了，实际是测试撞上了开发服务器的一次冷启动。
  const mapPage = await ctx.newPage();
  await mapPage.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
  await mapPage.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
  const readBands = () => mapPage.evaluate(async () => {
    const { snapshot } = await import('/src/core/snapshot.ts');
    const { normalizeOptions } = await import('/src/core/config.ts');
    const { Scheduler } = await import('/src/core/scheduler.ts');
    const opts = normalizeOptions({ maxItems: 400, agentCount: 6, order: 'rows' });
    const bp = snapshot(document.querySelector('#app'), opts);
    const map = {};
    new Scheduler(bp, { agentCount: 6, order: 'rows', seed: 7, balance: false, cost: () => 1 })
      .agentQueues.forEach((q, i) => q.forEach((it) => { if (map[it.id] === undefined) map[it.id] = i; }));
    return map;
  });
  // 撞上一次重载就等它重载完再读一遍，第二次的 import 已经是热的了。
  const bandOf = await readBands().catch(async () => {
    await mapPage.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    await mapPage.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
    return readBands();
  });
  await mapPage.close();
  // 主页再走一次：整页重载是广播给所有连接的客户端的，让它落在这一步而不是某一局施工中。
  await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });

  const runOnce = (options) => page.evaluate((opts) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.__seq = [];
    if (!window.__observed) {
      window.__observed = true;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.dataset.item) window.__seq.push([node.dataset.item, parseFloat(node.style.top) || 0]);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    return new Promise((resolve) => {
      const swarm = new window.SwarmBuilder({
        root: document.querySelector('#app'),
        agentCount: 6,
        speed: 3,
        maxItems: 400,
        trigger: 'immediate',
        // 顺序是纯分发问题：开场聚群、临时工和积压提速都会改「谁在第几毫秒领到活」，
        // 把「首轮铺开几条带」搅成计时噪声。尤其单光标那局，auto 班会偷偷招人。
        // 运行时定价（pick:'live'）会绕开预切队列，按光标距离当场挑活，种子和 rows
        // 的队列分配就都不作数了；这一场量的正是队列本身，所以钉回 queued。
        gather: false,
        agents: 'fixed',
        adaptiveSpeed: false,
        pick: 'queued',
        ...opts,
        onComplete: (result) => resolve({
          head: window.__seq.slice(0, (opts && opts.agentCount) || 6).map(([id]) => id),
          headYs: window.__seq.slice(0, (opts && opts.agentCount) || 6).map(([, y]) => y),
          rec: window.__seq.slice(),
          built: result.built,
          seed: result.seed,
        }),
      });
      swarm.start();
    });
  }, options);

  // 每一局都是「先清场、再重放」，所以中途被整页重载打断是可以补救的。dev server 会广播
  // reload（这一页第一次 import /src 模块、或 dist 产物刚被重写），现象是 Execution context
  // was destroyed——像引擎坏了，实际是这一局的观测者连着页面一起没了。
  const run = async (options) => runOnce(options).catch(async () => {
    await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    return runOnce(options);
  });

  const sweepOf = (rec, tol) => {
    const seen = new Set();
    const ys = rec.filter((r) => !seen.has(r[0]) && (seen.add(r[0]), true)).map(([, y]) => y);
    let forward = 0, back = 0, worst = 0;
    for (let i = 1; i < ys.length; i++) {
      const step = ys[i] - ys[i - 1];
      if (step >= -tol) forward++;
      else { back++; worst = Math.max(worst, -step); }
    }
    return { items: ys.length, pairs: forward + back, ratio: forward / Math.max(1, forward + back), worst };
  };

  const problems = [];
  const group = await run({ order: 'group', tour: false });
  const rows = await run({ order: 'rows', tour: false });
  const solo = await run({ order: 'rows', agentCount: 1, speed: 6, tour: false });
  const soloSweep = sweepOf(solo.rec, 60);

  const seedA = await run({ order: 'random', seed: 12345, tour: false });
  const seedB = await run({ order: 'random', seed: 12345, tour: false });
  const seedC = await run({ order: 'random', seed: 67890, tour: false });
  const freeA = await run({ order: 'random', tour: false });
  const freeB = await run({ order: 'random', tour: false });

  const span = (ys) => Math.round(Math.max(...ys) - Math.min(...ys));
  // 前 agentCount 件「各落一条带」不是引擎的承诺：某条带头一件的父在更靠上的带里，
  // 那一刻还没建成，take() 只能先别条带里挑一件 ready 的（不抢就干等，这是设计如此）。
  // 画面层真正要保的是「每条带都在开工头两轮里有人盖起来」——迟到一步可以，整条带没人管不行。
  // 带边界来自排程本身（纯函数，不受飞行时间影响），所以这里量的是分发归属，不是到达次序。
  const firstBands = (list, n) => [...new Set(list.slice(0, n).map((id) => bandOf[id]).filter((b) => b !== undefined))];
  const rowsBandOfHead = rows.head.map((id) => bandOf[id]);
  const rowsBands = firstBands(rows.head, 6).length;
  const rowsBandsTwoRounds = firstBands(rows.rec.map((r) => r[0]), 12).length;
  if (rowsBandOfHead.some((b) => b === undefined)) problems.push(`开工的 6 件里有对不上排程队列的 id：${rows.head.join(' ')}`);
  if (rowsBandsTwoRounds !== 6) problems.push(`两轮之后仍有横带没开工：前 12 件只落在 ${rowsBandsTwoRounds} 条带上（带号 ${firstBands(rows.rec.map((r) => r[0]), 12).join(' ')}）`);
  if (span(rows.headYs) < 1500) problems.push(`开工前 6 件只跨了 ${span(rows.headYs)}px，光标没铺到整页的各条带上`);
  if (soloSweep.ratio < 0.9) problems.push(`单光标自上而下不成立：${soloSweep.items} 件的 ${soloSweep.pairs} 对里回跳 ${Math.round((1 - soloSweep.ratio) * soloSweep.pairs)} 对，最大回跳 ${Math.round(soloSweep.worst)}px`);
  if (seedA.head.join(',') !== seedB.head.join(',')) problems.push(`同一颗种子排出的开工顺序不一样：${seedA.head.join(' ')} vs ${seedB.head.join(' ')}`);
  if (seedA.head.join(',') === seedC.head.join(',')) problems.push('换种子顺序完全没变，种子没参与排程');
  if (freeA.head.join(',') === freeB.head.join(',')) problems.push('种子填 0 却每次抽出同一个顺序');
  if (!(seedA.seed > 0) || seedA.seed !== 12345) problems.push(`完成状态没回显用到的种子：${seedA.seed}`);
  if (!(freeA.seed > 0) || freeA.seed === freeB.seed) problems.push(`种子填 0 时没各抽一个：${freeA.seed} / ${freeB.seed}`);
  if (rows.built < 60) problems.push(`长页面只建成 ${rows.built} 项，蓝图可能被上限砍掉`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('order-seed @1280', problems, [
    `自上而下（6 光标）: 开工 ${rows.headYs.length} 件 y=${rows.headYs.map(Math.round).join(' ')} · 跨 ${span(rows.headYs)}px · 首轮铺开 ${rowsBands}/6 条带（带号 ${rowsBandOfHead.join(' ')}），两轮内 ${rowsBandsTwoRounds}/6 条带开工（到达先后掺飞行时间，不卡）`,
    `自上而下（1 光标）: ${soloSweep.items} 件 · 顺 ${soloSweep.pairs - Math.round((1 - soloSweep.ratio) * soloSweep.pairs)}/${soloSweep.pairs} 对（容 60px 回跳）· 最大回跳 ${Math.round(soloSweep.worst)}px`,
    `子树并行（6 光标）: 开工 ${group.headYs.map(Math.round).join(' ')} · 跨 ${span(group.headYs)}px · 对照，不卡门槛`,
    `种子 12345 两次开工: ${seedA.head.join(' ')} = ${seedB.head.join(' ')}`,
    `种子 67890 开工: ${seedC.head.join(' ')}`,
    `种子 0 现抽: ${freeA.seed} ≠ ${freeB.seed}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 另外四种分布顺序（竖列 / 蛇形 / 逐层 / 由内向外）+ 工时均衡。
// 这里卡的是「排程发出去的那份队列」本身：它是纯函数，不受飞行时间和 work
// stealing 影响，所以能逐条对上算法的承诺。画面层的观测交给 order-seed 和跑完性。
//   cols   —— 先看这页有没有真的沟：dark-ui 有 4 块，按 x 切且带间不重叠；
//             tall 是单栏，必须退回按 y 切（切出来的队列和 rows 一模一样）。
//   snake  —— 每条带内部改按 x 排，奇数带反着走：首尾 x 差正负交替。
//   depth  —— 每个光标的队列里 DOM 深度只增不减：先骨架后叶子。
//   radial —— 按到蓝图中心的距离切带，队列的半径中位数递增。
//   balance —— 等工时切带用的是 painters partition DP，最优连续切分，
//              「等件数」也是连续切分的一种，所以开了只会更平不会更差。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  const dist = (url, maxItems) => page.goto(url, { waitUntil: 'load' })
    .then(() => page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null)))))
    .then(() => page.evaluate(async (limit) => {
      const { snapshot } = await import('/src/core/snapshot.ts');
      const { normalizeOptions } = await import('/src/core/config.ts');
      const { Scheduler } = await import('/src/core/scheduler.ts');
      const { itemWeight } = await import('/src/core/estimate.ts');
      const cx = (i) => i.x + i.width / 2;
      const cy = (i) => i.y + i.height / 2;
      const base = normalizeOptions({ maxItems: limit, agentCount: 6 });
      const bp = snapshot(document.querySelector('#app'), base);
      const sched = (order, balance) => {
        const opts = normalizeOptions({ maxItems: limit, agentCount: 6, order, balance });
        return [...new Scheduler(bp, {
          agentCount: 6, order, seed: 7, balance, cost: (it) => itemWeight(it, opts),
        }).agentQueues.map((q) => q.slice())];
      };
      const ids = (queues) => queues.map((q) => q.map((it) => it.id).join(',')).join('|');
      const med = (q, key) => q.map(key).sort((a, b) => a - b)[Math.floor(q.length / 2)] ?? 0;
      const asc = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);
      // 相邻两带在某个轴上不许重叠：max(带 i) <= min(带 i+1)
      const contiguous = (queues, key) => queues.slice(0, -1).every(
        (q, i) => Math.max(...q.map(key)) <= Math.min(...queues[i + 1].map(key)) + 0.5,
      );
      const spread = (queues, weight) => {
        const loads = queues.map((q) => q.reduce((s, it) => s + weight(it), 0)).filter((v) => v > 0);
        return Math.max(...loads) / Math.min(...loads);
      };
      const orders = ['rows', 'cols', 'snake', 'depth', 'radial'];
      // 一条队列里不许出现「子元素排在它的父前面」：那样子元素认领时父还没落地，
      // take() 只能跳过它去后面拿，跑完再回头补——自上而下就变成来回跳。
      const depsOk = (queues) => queues.every((q) => {
        const inQueue = new Set(q.map((it) => it.id));
        const claimed = new Set();
        for (const it of q) {
          if (it.blockers.some((b) => inQueue.has(b) && !claimed.has(b))) return false;
          claimed.add(it.id);
        }
        return true;
      });
      const out = { items: bp.items.filter((i) => !i.consumed).length, width: bp.width, orders: {}, balance: {}, snakeEnds: [], depthMonotone: [], rowsDeps: false, colsDeps: false, radialAsc: false, colsLikeRows: false };
      for (const order of orders) {
        const queues = sched(order, false);
        out.orders[order] = {
          yAsc: asc(queues.map((q) => med(q, cy))),
          // 横带族的承诺轴是顶边：带与带之间按 y 不重叠，各带的顶边中位数递增。
          topAsc: asc(queues.map((q) => med(q, (i) => i.y))),
          topContiguous: contiguous(queues, (i) => i.y),
          xContiguous: contiguous(queues, cx),
          yContiguous: contiguous(queues, cy),
        };
        if (order === 'rows') out.rowsDeps = depsOk(queues);
        if (order === 'cols') out.colsDeps = depsOk(queues);
        const weight = (it) => itemWeight(it, normalizeOptions({ maxItems: limit, order }));
        out.balance[order] = { off: spread(queues, weight), on: spread(sched(order, true), weight) };
      }
      out.snakeEnds = sched('snake', false).map((q) => cx(q[0]) - cx(q[q.length - 1]));
      out.depthMonotone = sched('depth', false).map((q) => q.every((it, i) => i === 0 || it.depth >= q[i - 1].depth));
      const rings = sched('radial', false);
      out.radialAsc = asc(rings.map((q) => med(q, (it) => Math.hypot(cx(it) - bp.width / 2, cy(it) - bp.height / 2))));
      out.colsLikeRows = ids(sched('cols', false)) === ids(sched('rows', false));
      return out;
    }, maxItems));

  const problems = [];

  // 多栏页：dark-ui 有真的沟，竖列带必须按 x 分开互不重叠。
  const wide = await dist(`${BASE}/demos/dark-ui.html`, 200);
  if (wide.colsLikeRows) problems.push('dark-ui 明明有左右两栏，竖列却退回成了横带（沟检测没认出来）');
  if (!wide.orders.cols.xContiguous) problems.push('竖列带之间在 x 上互相重叠：光标分的不是一个个区域');
  if (!wide.orders.rows.topAsc) problems.push('多栏页上 rows 各带按顶边排不再递增（cols 的改动串到了 rows）');
  if (!wide.rowsDeps) problems.push('多栏页 rows 的队列里存在子元素排在它自己的父前面');

  // 单栏页：没有沟就必须退回按 y 切，画面不能被竖着劈开。
  const tall = await dist(`${BASE}/demos/tall.html`, 400);
  if (!tall.colsLikeRows) problems.push('长页面是单栏，竖列没有退回成自上而下');
  if (!tall.orders.cols.topContiguous) problems.push('长页面退回横带后，带与带之间在顶边上仍然重叠');
  if (!tall.rowsDeps) problems.push('长页面 rows 的队列里存在子元素排在它自己的父前面');
  if (!tall.colsDeps) problems.push('长页面 cols 退回横带后队列里的父子序仍然倒着');

  // 蛇形：带内按 x 排，奇数带反走 → 首尾 x 差正负交替
  const flips = tall.snakeEnds.map((v) => (v > 0 ? 1 : -1));
  const alternates = flips.every((v, i) => i === 0 || v !== flips[i - 1]);
  if (!alternates) problems.push(`蛇形没有左右交替：首尾 x 差 ${tall.snakeEnds.map(Math.round).join(' ')}`);

  // 逐层：每个光标的队列里深度只增不减
  if (!tall.depthMonotone.every(Boolean)) problems.push('逐层顺序里存在某条队列先盖叶子再盖容器');

  // 由内向外：半径中位数一条比一条远
  if (!tall.radialAsc) problems.push('由内向外不是从中心一圈圈往外盖：各队列半径中位数没有递增');

  // 均衡：DP 是最优连续切分，开了 balance 的散布不许比不开更差
  const spreadOf = (page, order) => [page.balance[order].off, page.balance[order].on];
  const wins = [];
  for (const [name, dist2] of [['长页面', tall], ['多栏页', wide]]) {
    for (const order of ['rows', 'cols', 'snake', 'depth', 'radial']) {
      const [off, on] = spreadOf(dist2, order);
      if (on > off + 1e-6) problems.push(`${name} ${order}：开了工时均衡反而更 uneven（${off.toFixed(3)} → ${on.toFixed(3)}）`);
      if (off - on > 0.15) wins.push(`${name} ${order} ${off.toFixed(2)}→${on.toFixed(2)}`);
    }
  }
  if (wins.length < 3) problems.push(`工时均衡在两张页面上只压平了 ${wins.length} 组散布，可能压根没起作用`);

  // 跑完性：七种顺序都得把整页盖完，而且盖掉的件数一模一样（新算法只在分发上动刀）
  await page.goto(`${BASE}/demos/simple.html`, { waitUntil: 'load' });
  const built = {};
  for (const order of ['group', 'rows', 'cols', 'snake', 'depth', 'radial', 'random']) {
    built[order] = await page.evaluate((o) => {
      document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
      document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
      return new Promise((resolve) => {
        new window.SwarmBuilder({
          root: document.querySelector('#app'),
          agentCount: 6,
          speed: 6,
          order: o,
          balance: o === 'rows',
          tour: false,
          // 这一条只比「七种分发是否把同样多的件盖完」：聚群与招人会拖长每一局，
          // 对建成数没有影响，关掉它们七趟才跑得干净。
          gather: false,
          agents: 'fixed',
          onComplete: (r) => resolve(r.built),
        }).start();
      });
    }, order);
  }
  const counts = Object.values(built);
  if (counts.some((v) => v !== counts[0])) {
    problems.push(`七种顺序建成的件数不一致：${Object.entries(built).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  if ((counts[0] ?? 0) < 10) problems.push(`简单页只建成 ${counts[0]} 项，跑完性判定不成立`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

  report('order-more @1280', problems, [
    `竖列（dark-ui ${wide.items} 件）: 按 x 切带互不重叠=${wide.orders.cols.xContiguous} · 与横带分布不同=${!wide.colsLikeRows}`,
    `竖列（长页面 ${tall.items} 件）: 单栏无沟 → 退回横带=${tall.colsLikeRows}`,
    `横带族切分轴: 顶边（不是中线）· 队列内父先于子 rows=${tall.rowsDeps}/${wide.rowsDeps} cols 退横带=${tall.colsDeps} · 带间顶边不重叠=${tall.orders.cols.topContiguous}`,
    `蛇形: 首尾 x 差 ${tall.snakeEnds.map(Math.round).join(' ')} · 左右交替=${alternates}`,
    `逐层: 6 条队列深度单调=${tall.depthMonotone.filter(Boolean).length}/6 · 骨架先于叶子`,
    `由内向外: 各队列半径中位数递增=${tall.radialAsc}`,
    `工时均衡: ${wins.join(' · ')}`,
    `跑完性: ${Object.entries(built).map(([k, v]) => k + '=' + v).join(' · ')}（rows 那趟带着 balance）`,
  ]);
  await ctx.close();
}

// 镜头必须自己往下滚跟着施工前沿，收尾再把页面交还页首。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/tall.html?auto`, { waitUntil: 'load' });

  const shape = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewport: innerHeight,
    tour: JSON.parse(document.body.dataset.swarm ?? '{}').tour === true,
  }));

  const scrolls = [];
  const problems = [];
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      building: [...document.querySelectorAll('.sb-item')]
        .filter((el) => el.classList.contains('sb-item--building'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return r.top > -200 && r.bottom < innerHeight + 200;
        }),
      status: document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-status]').textContent.trim(),
    }));
    scrolls.push({ y: sample.y, inView: sample.building.filter(Boolean).length });
    if (sample.status.startsWith('完成')) break;
    await page.waitForTimeout(200);
  }
  // 交还页首走的也是平滑滚动，等它落定再判定；超时不报错，交给下面的断言说结果。
  await page.waitForFunction(() => window.scrollY < 120, null, { timeout: 6000, polling: 200 }).catch(() => {});
  const settled = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    status: document.querySelector('[data-sb-chrome]').shadowRoot.querySelector('[data-status]').textContent.trim(),
  }));

  const maxScroll = Math.max(...scrolls.map((s) => s.y));
  // 平滑滚动本身是一段动画，逐帧的增量会把它算成很多次，所以「停下再起步」只能当信息。
  // 真要看的是「镜头有没有在页中停过」：一次性跳到页底的那局只会在页首和页底出现采样，
  // 而跟着前沿走的那局（无论一段连续滚还是分几段）一定会留下页中的位置。
  let bursts = 0;
  for (let i = 1; i < scrolls.length; i++) {
    const calm = i < 2 || scrolls[i - 1].y - scrolls[i - 2].y < 20;
    if (scrolls[i].y - scrolls[i - 1].y > 120 && calm) bursts++;
  }
  const midway = scrolls.filter((s) => s.y > 200 && s.y < maxScroll - 200).length;
  const followed = scrolls.filter((s) => s.y > 200 && s.inView > 0).length;

  if (shape.docHeight < shape.viewport * 2.5) problems.push(`这一页只有 ${shape.docHeight}px，比视口高不到 2.5 倍，镜头没东西可跟`);
  if (!shape.tour) problems.push('长页面案例没默认打开镜头跟随');
  if (maxScroll < 600) problems.push(`镜头最多只滚到 ${maxScroll}px，没跟着走到页面深处`);
  if (midway < 1) problems.push(`镜头只在页首和页底各停一次，中途采样 ${midway} 个，不像跟随更像是跳过去`);
  if (followed === 0) problems.push('滚动之后没有把正在施工的元素留在视野里');
  if (!settled.status.startsWith('完成')) problems.push(`长页面没跑完：${settled.status}`);
  if (settled.y > 120) problems.push(`结束后镜头没交还页首，停在 ${settled.y}px`);
  if (errors.length) problems.push(`页面报错 ${errors.length} 条: ${errors[0]}`);

  report('tall-tour @1280', problems, [
    `页面 ${shape.docHeight}px · 视口 ${shape.viewport}px · 默认 tour=${shape.tour}`,
    `镜头: 最深 ${maxScroll}px · 页中采样 ${midway} 个 · 停下再起步 ${bursts} 次（平滑滚动会抹平次数，仅记录）· ${followed} 次采样里正在建的元素在视野内`,
    `收尾: ${settled.status} · 回到 ${settled.y}px`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 22：手机模式（390×740）——每一页都不许把文档撑出横向滚动，
// 壳的标签条自己横滚、地址栏换行、GitHub 入口在，面板当前这一页不滚动也全露。
// 断点定在 760：验收矩阵的 @800 一档仍是桌面版，它锁的建成数不用跟着改。
// ---------------------------------------------------------------------------
{
  const PHONE = ['home', 'simple', 'console', 'landing', 'dark-ui', 'tall', 'tune'];
  const problems = [];
  const lines = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 740 } });

  for (const name of PHONE) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${BASE}/demos/${name}.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
    const shape = await page.evaluate(() => {
      const sr = document.querySelector('[data-sb-chrome]').shadowRoot;
      const fields = sr.querySelector('.fields');
      const card = sr.querySelector('.card');
      const box = card?.getBoundingClientRect();
      return {
        inner: window.innerWidth,
        innerH: window.innerHeight,
        doc: document.documentElement.scrollWidth,
        cardRight: box ? Math.round(box.right) : 0,
        cardBottom: box ? Math.round(box.bottom) : 0,
        scroll: fields ? fields.scrollHeight : 0,
        client: fields ? fields.clientHeight : 0,
        widest: (() => {
          let best = null;
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (!best || r.right > best.right) {
              best = { tag: el.tagName, cls: String(el.className?.toString?.() ?? '').slice(0, 28), right: Math.round(r.right) };
            }
          }
          return best;
        })(),
      };
    });
    if (shape.doc > shape.inner + 1) {
      problems.push(`${name} 在手机上撑出横向滚动：文档 ${shape.doc}px > 视口 ${shape.inner}px（最右 ${JSON.stringify(shape.widest)}）`);
    }
    // 面板自己也不许伸出屏幕：它是唯一的改参数入口。
    if (shape.cardRight > shape.inner + 1) problems.push(`${name} 的面板伸出屏幕右沿: ${shape.cardRight}px`);
    if (shape.cardBottom > shape.innerH + 1) problems.push(`${name} 的面板伸出屏幕下沿: ${shape.cardBottom}/${shape.innerH}px`);
    if (shape.scroll > shape.client + 1) problems.push(`${name} 的参数列表要滚动才看得全（${shape.scroll}/${shape.client}）`);
    if (errors.length) problems.push(`${name} 报错 ${errors.length} 条: ${errors[0]}`);
    lines.push(`${name}: 文档 ${shape.doc}/${shape.inner} · 面板右下 ${shape.cardRight}/${shape.cardBottom} · 参数 ${shape.scroll}/${shape.client}`);
    if (name === 'home' || name === 'console') await page.screenshot({ path: `${OUT}mobile-${name}.png` });
    await page.close();
  }

  // 壳在手机上：不溢出 + GitHub 入口 + 标签条横滚而不是撑宽窗口 + 施工中文档仍不撑宽。
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-frame]')?.contentDocument
    ?.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
  const shell = await page.evaluate(() => {
    const gh = document.querySelector('[data-github]');
    const tabs = document.querySelector('[data-tabs]');
    const active = document.querySelector('.tab[aria-selected="true"]');
    const rect = (el) => (el ? Math.round(el.getBoundingClientRect().right) : 0);
    // 壳里的案例视口比手机屏幕矮一截（标签条 + 顶栏 + 状态栏都要占高度），
    // 面板那一屏参数到底装得下，得以 iframe 自己的 innerHeight 为准。
    const frameEl = document.querySelector('[data-frame]');
    const doc = frameEl.contentDocument;
    const sr = doc?.querySelector('[data-sb-chrome]')?.shadowRoot;
    const fields = sr?.querySelector('.fields');
    const cardBox = sr?.querySelector('.card')?.getBoundingClientRect();
    return {
      inner: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      tabs: { scroll: tabs.scrollWidth, client: tabs.clientWidth },
      activeRight: rect(active),
      gh: gh ? { href: gh.href, target: gh.target, rel: gh.rel, right: rect(gh) } : null,
      navRows: Math.round(document.querySelector('.nav').getBoundingClientRect().height),
      panel: fields && cardBox
        ? {
          scroll: fields.scrollHeight,
          client: fields.clientHeight,
          bottom: Math.round(cardBox.bottom),
          innerH: Math.round(doc.defaultView.innerHeight),
        }
        : null,
    };
  });
  if (shell.doc > shell.inner + 1) problems.push(`壳在手机上撑出横向滚动：${shell.doc}px > ${shell.inner}px`);
  if (!(shell.tabs.scroll > shell.tabs.client)) problems.push('标签条没有横向滚动起来，说明它把窗口撑宽了');
  if (shell.activeRight > shell.inner + 1) problems.push(`当前标签页伸出屏幕: ${shell.activeRight}px`);
  if (shell.navRows > 90) problems.push(`顶栏在手机上挤成了 ${shell.navRows}px 高`);
  if (!shell.gh) problems.push('壳的顶栏没有 GitHub 入口');
  if (!shell.panel) problems.push('壳里的案例页没有创造者模式面板');
  else {
    if (shell.panel.scroll > shell.panel.client + 1) {
      problems.push(`壳里（案例视口只有 ${shell.panel.innerH}px 高）参数列表要滚动才看得全：${shell.panel.scroll}/${shell.panel.client}`);
    }
    if (shell.panel.bottom > shell.panel.innerH + 1) {
      problems.push(`壳里的面板伸出案例视口：${shell.panel.bottom}/${shell.panel.innerH}`);
    }
  }
  // 施工中最容易出问题：光标箭头和名字标签贴着右边缘时会不会撑宽文档。
  const during = [];
  for (let i = 0; i < 8; i++) {
    during.push(await page.evaluate(() => {
      const doc = document.querySelector('[data-frame]').contentDocument;
      return doc.documentElement.scrollWidth - doc.defaultView.innerWidth;
    }));
    await page.waitForTimeout(500);
  }
  const worst = Math.max(...during);
  if (worst > 1) problems.push(`施工中文档被撑宽了 ${worst}px（光标层的装饰伸出了画框）`);
  // 密集页同样走一遍：条目多，右边缘的光标更多。
  await page.click('.tab[data-key="console"]');
  await page.waitForFunction(() => document.querySelector('[data-frame]').contentDocument
    .body?.dataset.demo === 'console', null, { timeout: 15000 });
  const dense = [];
  for (let i = 0; i < 8; i++) {
    dense.push(await page.evaluate(() => {
      const doc = document.querySelector('[data-frame]').contentDocument;
      return doc.documentElement.scrollWidth - doc.defaultView.innerWidth;
    }));
    await page.waitForTimeout(500);
  }
  const worstDense = Math.max(...dense);
  if (worstDense > 1) problems.push(`密集页施工中文档被撑宽了 ${worstDense}px`);
  if (errors.length) problems.push(`壳报错 ${errors.length} 条: ${errors[0]}`);
  await page.screenshot({ path: `${OUT}mobile-shell.png` });

  report('mobile @390', problems, [
    `案例页: ${lines.length} 页全部量过，最宽的一格见 .shots/mobile-*.png`,
    ...lines,
    `壳: 文档 ${shell.doc}/${shell.inner} · 标签条 ${shell.tabs.scroll}/${shell.tabs.client}（横滚）· 顶栏 ${shell.navRows}px`,
    `壳里的面板: 案例视口 ${shell.panel?.innerH ?? 0}px 高 · 参数 ${shell.panel ? `${shell.panel.scroll}/${shell.panel.client}` : '缺失'} · 卡片底边 ${shell.panel?.bottom ?? 0}`,
    `GitHub: ${shell.gh ? `${shell.gh.href} ${shell.gh.target}/${shell.gh.rel}` : '缺失'}`,
    `施工中溢出: 说明页最多 ${worst}px · 密集页最多 ${worstDense}px`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 23：双语。中文是源语言，英文是启动时按「整节点」替换上去的，
// 少一行字典就会在这里露出来——所以露馅判据不是「有没有 key」，而是
// 「渲染后的 DOM 里还能不能找到中日韩文字」。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // 码点区间在页面里手写，不抄字面量：U+3000 是全角空格，抄进字符集会退化成
  // 普通空格、把区间上界一路撑到整段 ASCII（上一批就是这么把所有字符串都判成中文的）。
  const sweep = (page) => page.evaluate(() => {
    const isCJK = (s) => {
      for (const ch of s) {
        const c = ch.codePointAt(0);
        if ((c >= 0x3001 && c <= 0x303f) || (c >= 0x3400 && c <= 0x4dbf)
          || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xff01 && c <= 0xffef)) return true;
      }
      return false;
    };
    const hits = new Set();
    const walk = (n) => {
      if (n.nodeType === 3) {
        const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t && isCJK(t)) hits.add(t);
        return;
      }
      if (n.nodeType === 1) {
        if (n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
        for (const a of ['data-tip', 'title', 'aria-label', 'placeholder', 'alt']) {
          const v = n.getAttribute?.(a);
          if (v && isCJK(v)) hits.add(`${n.tagName.toLowerCase()}[${a}] ${v.replace(/\s+/g, ' ').trim()}`);
        }
        // 外壳的案例就在 iframe 里：它是一整份同源文档，语言有没有跟进去只能这样钻进去看。
        const nested = n.tagName === 'IFRAME' ? (n.contentDocument ?? null) : null;
        if (nested?.documentElement) {
          walk(nested.documentElement);
          const inner = nested.querySelector('[data-sb-chrome]');
          if (inner?.shadowRoot) walk(inner.shadowRoot);
        }
      }
      for (const c of Array.from(n.childNodes ?? [])) walk(c);
    };
    walk(document.documentElement);
    const host = document.querySelector('[data-sb-chrome]');
    if (host?.shadowRoot) walk(host.shadowRoot);
    return {
      lang: window.__sbI18n?.lang,
      missed: window.__sbI18n?.missed ?? [],
      cjk: [...hits],
      status: host?.shadowRoot?.querySelector('[data-status]')?.textContent ?? '',
    };
  });

  const problems = [];
  const lines = [];
  for (const name of ['home', 'simple', 'landing', 'dark-ui', 'tall', 'console', 'tune', 'cdn']) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`${BASE}/demos/${name}.html?lang=en`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
    // 跑完才判：状态行、「已继续」这类提示、完成后的丢弃计数都是运行过程中才写进面板的。
    await setField(page, 'speed', 8);
    await page.click('[data-apply]');
    await page.waitForFunction(
      () => document.querySelector('[data-sb-chrome]').shadowRoot
        .querySelector('[data-status]')?.textContent.startsWith('Done'),
      null, { timeout: 90000, polling: 200 },
    ).catch(() => {});
    const got = await sweep(page);
    if (got.lang !== 'en') problems.push(`${name}: 语言键是 ${got.lang}，?lang=en 没生效`);
    if (got.missed.length) problems.push(`${name}: 字典漏 ${got.missed.length} 条：${got.missed.slice(0, 3).join(' / ')}`);
    if (got.cjk.length) problems.push(`${name}: 页面上还露着 ${got.cjk.length} 处中文：${got.cjk.slice(0, 3).join(' / ')}`);
    if (!got.status.startsWith('Done')) problems.push(`${name}: 英文状态行没跑到头：${got.status}`);
    if (errors.length) problems.push(`${name} 报错 ${errors.length} 条: ${errors[0]}`);
    lines.push(`${name}: 命中 ${got.missed.length ? '漏' + got.missed.length : '全译'} · 露中文 ${got.cjk.length} · ${got.status}`);
    if (name === 'home') await page.screenshot({ path: `${OUT}i18n-home.png` });
    await page.close();
  }

  // 外壳同样要跟着走：标签名、地址栏、状态栏，还有 iframe 里那一页。
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demos/index.html?case=simple&lang=en`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-frame]')?.contentDocument
    ?.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
  // 元信息行只在施工中存在（「N 个盒子在画」），跑完就清空了，所以趁在飞的时候取样；
  // 等 Done 之后再读会读到空串，那是设计如此，不是 bug。
  const metaSeen = await page.waitForFunction(() => {
    const text = (document.querySelector('[data-meta]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 0 ? text : false;
  }, null, { timeout: 30000, polling: 100 }).then((h) => h.jsonValue()).catch(() => '');
  await page.waitForFunction(() => (document.querySelector('[data-frame]').contentDocument
    .querySelector('[data-sb-chrome]')?.shadowRoot
    .querySelector('[data-status]')?.textContent ?? '').startsWith('Done'), null, { timeout: 90000 }).catch(() => {});
  const shell = await page.evaluate(() => {
    const doc = document.querySelector('[data-frame]').contentDocument;
    const flat = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      tab: flat(document.querySelector('.tab[aria-selected="true"]')),
      hint: flat(document.querySelector('[data-hint]')),
      frameLang: doc.documentElement.lang,
      frameStatus: flat(doc.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-status]')),
    };
  });
  const shellSweep = await sweep(page);
  if (shell.frameLang !== 'en') problems.push(`壳里的案例页语言还是 ${shell.frameLang}：?lang= 没传进 iframe`);
  if (shellSweep.cjk.length) problems.push(`壳（连着 iframe 里那一页和它的面板）还露着 ${shellSweep.cjk.length} 处中文：${shellSweep.cjk.slice(0, 4).join(' / ')}`);
  if (!/^[A-Za-z]/.test(shell.tab) || !shell.tab.length) problems.push(`活动标签名没跟着换：${shell.tab}`);
  if (!shell.frameStatus.startsWith('Done')) problems.push(`壳里的案例没走英文：${shell.frameStatus}`);
  if (!metaSeen.length) problems.push('壳的元信息行空了');
  await page.screenshot({ path: `${OUT}i18n-shell.png` });
  await page.close();

  report('i18n @1280', problems, [
    `案例页: ${lines.join(' · ')}`,
    `外壳: 标签「${shell.tab}」· 状态栏「${shell.hint}」· 施工中元信息「${metaSeen}」· iframe lang=${shell.frameLang}`,
    '中文仍是源语言：字典按整节点替换，默认档留在中文，验收矩阵其余场景因此不必跟着改断言',
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 24：第三方网页。跨源 fetch 读不到正文（没有 Access-Control-Allow-Origin
// 就直接抛），以前外壳遇到这个异常只是安静地把页面原样嵌进去——用户看到的
// 就是「我输了地址，它只给我打开了一个普通网页」。现在按 直连 → 同源转发 → 诚实降级
// 三级走，转发口是 dev server 上的 /__page。这里用第二个本地端口当「别人的站点」，
// 它和外壳同源不同端口、且不带任何 CORS 头，正好复现真实失败路径而不依赖外网。
//
// 这一页故意做成「又长又懒」：图片全在折叠线以下、带 loading=lazy，正文高过两屏。
// 那是用户报的两个症状的源头——单次采集只看见第一屏，下面的盒子内框是 0×0 被丢掉，
// 页面塌成一屏就滚不动；图片没下载完就抓拍，重建出来全是空槽。
// ---------------------------------------------------------------------------
{
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAeUlEQVR42u3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAIC3YbIP'
    + 'AAB2ZUBJZ29yYXl0aGVhZGVyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADoTqdpAAAAAXNSR0IArs4c6QAAAARnQU1'
    + 'BAACxjwv8YQUAAAAJcEhZcwAAEnQAABJ0Ad5mH3gAAABZSURBVHhe7cEBDQAAAMIg/nbZDgbgvQcAAAAAALw1QAsQDdACxAK0ALEArUAsQCsQC'
    + '9AKxAK0ArEArUAsQCsQC9AKxAK0ArEArUAsQCsQC9AKxAK0ArEArUAsQCsQC9AKxAK0ArEArUAsQCsQC9AKfD1oegABzGJp9QAAAABJRU5ErkJg'
    + 'gg==', 'base64');
  const foreign = createServer((req, res) => {
    if (req.url.startsWith('/img/')) {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(PNG);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>外部站点</title>
<style>body{margin:0;background:#f4f1ea;color:#1c1b18;font:14px/1.6 system-ui}#app{padding:40px}h1{font-size:34px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}.b{height:96px;border-radius:10px;background:#e3ddd0}
.strip{margin-top:28px}.strip img{display:block;width:100%;height:120px;object-fit:cover;background:#d8d2c4}
.tail{margin-top:28px;height:120px;border-radius:10px;background:#cfc8b8}</style>
</head><body data-demo="relay"><main id="app"><h1>来自另一个源的页面</h1><p>它没有给出任何 Access-Control-Allow-Origin，所以浏览器不让外壳直连读它。</p>
<div class="grid">${'<div class="b"></div>'.repeat(8)}</div>
${'<div class="strip"><img loading="lazy" width="320" height="120" src="/img/x.png" alt="远处的一张图"></div>'.repeat(10)}
<div class="tail">页脚：要滚两屏才看得见这句话</div></main></body></html>`);
  });
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  const FOREIGN = `http://127.0.0.1:${foreign.address().port}/`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];

  // 先确认「外部站点」真的是跨源不可读：这一条不成立，下面那条通过就毫无意义。
  const direct = await page.goto(`${BASE}/demos/index.html`, { waitUntil: 'load' })
    .then(() => page.evaluate(async (url) => {
      try {
        const r = await fetch(url);
        return { ok: true, status: r.status };
      } catch (err) {
        return { ok: false, why: String(err instanceof Error ? err.message : err) };
      }
    }, FOREIGN));

  const relay = await page.evaluate(async (url) => {
    const r = await fetch(`${location.origin}/__page?url=${encodeURIComponent(url)}`);
    return { status: r.status, html: await r.text(), final: r.headers.get('x-relay-final-url') ?? '' };
  }, FOREIGN);
  const refused = await page.evaluate(async () => {
    const r = await fetch(`${location.origin}/__page?url=${encodeURIComponent('javascript:alert(1)')}`);
    return { status: r.status, body: (await r.text()).slice(0, 40) };
  });

  await page.goto(`${BASE}/demos/index.html?u=${encodeURIComponent(FOREIGN)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-frame]');
    const text = (frame.contentDocument?.querySelector('[data-sb-chrome]')?.shadowRoot
      .querySelector('[data-status]')?.textContent ?? '');
    return frame.contentDocument?.documentElement?.dataset.sbRebuild === '1'
      && frame.contentDocument?.body?.dataset.demo === 'relay'
      && text.startsWith('完成')
      && text.includes('用时');
  }, null, { timeout: 60000, polling: 200 }).catch(() => {});
  const rebuilt = await page.evaluate(() => {
    const frame = document.querySelector('[data-frame]');
    const doc = frame.contentDocument;
    const sr = doc?.querySelector('[data-sb-chrome]')?.shadowRoot;
    const status = sr?.querySelector('[data-status]')?.textContent.trim() ?? '';
    const imgs = [...(doc?.querySelectorAll('#app img') ?? [])];
    return {
      rebuild: doc?.documentElement?.dataset.sbRebuild === '1',
      url: document.querySelector('[data-url]').textContent,
      hint: document.querySelector('[data-hint]').textContent,
      status,
      built: Number((status.match(/完成 (\d+) 项/) ?? [])[1] ?? 0),
      rows: sr?.querySelectorAll('.row').length ?? 0,
      title: doc?.title ?? '',
      lang: doc?.documentElement.lang ?? '',
      host: doc?.querySelector('#app h1')?.textContent ?? '',
      // 缺图的症状是「槽位是空的」：图元素在，但一张都没解码。
      imgs: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      // 塌页的症状是「滚不动」：页高被 0×0 的丢件吃掉，一屏就到底。
      page: doc?.documentElement.scrollHeight ?? 0,
      vh: doc?.documentElement.clientHeight ?? 0,
      // 开局脚本里没带 pre-scroll，就等于这一页根本没做预滚动采集。
      scan: (doc?.querySelector('script[type=module]')?.textContent ?? '').includes("scan: 'pre-scroll'"),
    };
  });
  // 「不能上下滚动」要正面量一次：把内框滚到 800，读回来。塌页的另一种死法是
  // overflow 被谁锁住——页高够，但 scrollTop 死活不动，这条能把它和塌页分开。
  const scrolls = await page.evaluate(() => {
    const doc = document.querySelector('[data-frame]').contentDocument;
    const se = doc.scrollingElement ?? doc.documentElement;
    se.scrollTop = 800;
    return { got: Math.round(se.scrollTop), max: se.scrollHeight - se.clientHeight };
  });
  await page.screenshot({ path: `${OUT}relay-remote.png` });

  if (direct.ok) problems.push(`「外部站点」竟然直连读得到（status ${direct.status}）——这一场景没在测跨源`);
  if (relay.status !== 200 || !relay.html.includes('来自另一个源的页面')) problems.push(`同源转发没取到正文：${relay.status} ${relay.html.slice(0, 60)}`);
  if (!relay.final.startsWith('http')) problems.push(`转发口没回最终地址：${relay.final}`);
  if (refused.status !== 400) problems.push(`转发口没有拒绝非 http(s) 地址：${refused.status} ${refused.body}`);
  if (!rebuilt.rebuild) problems.push(`跨源页面仍然只是原样嵌：${rebuilt.hint}`);
  if (rebuilt.built < 5) problems.push(`跨源页面重建只建成 ${rebuilt.built} 项（状态「${rebuilt.status}」）`);
  if (rebuilt.rows === 0) problems.push('跨源重建出来的页面没有创造者模式面板');
  if (!rebuilt.url.includes('127.0.0.1')) problems.push(`地址栏没显示第三方地址: ${rebuilt.url}`);
  if (!rebuilt.host.includes('来自另一个源的页面')) problems.push(`重建的不是取回来的那一页：${rebuilt.host}`);
  if (rebuilt.lang !== 'zh') problems.push(`重建文档的 lang 没跟着外壳走：${rebuilt.lang}`);
  if (!rebuilt.scan) problems.push('第三方页那局没带 scan: pre-scroll（用户报的缺图 + 滚不动就是它没开）');
  if (rebuilt.imgs === 0) problems.push('外部页夹具里没有图，这一场景没在测缺图');
  if (rebuilt.loaded !== rebuilt.imgs) problems.push(`第三方页还缺图：${rebuilt.imgs} 张里只解码了 ${rebuilt.loaded} 张`);
  if (rebuilt.page < rebuilt.vh + 400) problems.push(`重建完的第三方页塌成一屏了：页高 ${rebuilt.page} / 视口 ${rebuilt.vh}`);
  if (scrolls.got < 700) problems.push(`第三方页仍然滚不动：让它滚到 800，实际停在 ${scrolls.got}（可滚余量 ${scrolls.max}）`);

  report('remote-rebuild @1280', problems, [
    `跨源前提: 直连 ${direct.ok ? '竟然成功' : `失败（${direct.why.slice(0, 40)}…）`}`,
    `转发口: /__page ${relay.status} · ${relay.html.length} 字节 · 最终地址 ${relay.final || '（无）'} · 非 http 地址 ${refused.status}`,
    `重建: rebuild=${rebuilt.rebuild} · 建成 ${rebuilt.built} 项 · 面板 ${rebuilt.rows} 行 · 标题「${rebuilt.title}」· lang=${rebuilt.lang}`,
    `懒图与页高: 图 ${rebuilt.loaded}/${rebuilt.imgs} 已解码 · 页高 ${rebuilt.page}（视口 ${rebuilt.vh}）· 开局脚本 scan=${rebuilt.scan} · 实滚 scrollTop=${scrolls.got}/${scrolls.max}`,
    `地址栏: ${rebuilt.url}`,
    '静态托管上没有这个转发口：仍然诚实降级为直接嵌，并说明「读不到 DOM」',
  ]);
  await ctx.close();
  await new Promise((resolve) => foreign.close(resolve));
}

// ---------------------------------------------------------------------------
// 场景 25：代码块读得清。上一版 `.page-home li code` 把 <pre><code> 一起命中了，
// 于是终端样式的深色块里被刷出一条条米色横杠，字和底同色——用户看到的是「白横条」。
// 光看 CSS 选不出来（选择器对不对要落到计算样式上），这里直接量对比度。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demos/home.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const codes = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).map(Number).map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const opaqueOver = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent') return { bg, from: n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : '') };
      }
      return { bg: 'rgba(0, 0, 0, 0)', from: 'none' };
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const measure = (el) => {
      const cs = getComputedStyle(el);
      const back = opaqueOver(el);
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 22),
        color: cs.color,
        own: cs.backgroundColor,
        back: back.bg,
        backFrom: back.from,
        contrast: Math.round(ratio(cs.color, back.bg === 'rgba(0, 0, 0, 0)' ? 'rgb(255,255,255)' : back.bg) * 100) / 100,
      };
    };
    const blockCode = [...document.querySelectorAll('.page-home pre code')].map(measure);
    const inlineCode = [...document.querySelectorAll('.page-home :not(pre) > code')].map(measure);
    const pre = [...document.querySelectorAll('.page-home pre')].map((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    return { blockCode, inlineCode, pre };
  });

  const problems = [];
  for (const m of codes.blockCode) {
    // 「白色横条」的成因就是这条：pre 里的 code 被刷成了和正文底色同族的浅底。
    if (m.own !== 'rgba(0, 0, 0, 0)' && m.own !== 'transparent') problems.push(`代码块里的 <code> 仍自带底色（${m.own}），会把深色块刷成横条：「${m.text}」`);
    if (m.contrast < 4.5) problems.push(`代码块文字对比度只有 ${m.contrast}:1：「${m.text}」${m.color} on ${m.back}(${m.backFrom})`);
  }
  if (codes.blockCode.length < 3) problems.push(`代码块只找到 ${codes.blockCode.length} 段，说明页的示例可能被删空了`);
  for (const m of codes.inlineCode) {
    if (m.contrast < 4.5) problems.push(`行内代码对比度只有 ${m.contrast}:1：「${m.text}」${m.color} on ${m.back}(${m.backFrom})`);
  }
  const darkPre = codes.pre.every((p) => {
    const [r, g, b] = p.bg.match(/[\d.]+/g).map(Number);
    return (r + g + b) / 3 < 90;
  });
  if (!darkPre) problems.push(`终端块底色不再是深色：${codes.pre.map((p) => p.bg).join(' / ')}`);

  report('code-ink @1280', problems, [
    `深色代码块 ${codes.pre.length} 个（底色 ${codes.pre[0]?.bg ?? '无'}）· 块内 <code> 自带底色的有 ${codes.blockCode.filter((m) => m.own !== 'rgba(0, 0, 0, 0)' && m.own !== 'transparent').length} 个`,
    `块内对比度: ${codes.blockCode.map((m) => m.contrast).join(' ')}（门槛 4.5:1）`,
    `行内代码 ${codes.inlineCode.length} 处，最低对比度 ${Math.min(...codes.inlineCode.map((m) => m.contrast))}:1`,
    '修复本身是把 `.page-home li code` 收窄成 `:not(pre) > code`：横条是被选错的规则刷出来的，不是配色问题',
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 26：默认就是参考扩展，每个开关反向都能真的关掉。
// 判据不是「代码写了没」，而是每局跑完交回来的观测数：默认那局必须有姿态、有聚群、
// 有镜头跟随、有声音和配乐；把某一项交给它对应的开关关掉以后，那件事必须消失。
{
  const MEASURE = (options) => new Promise((resolve) => {
    for (const el of document.querySelectorAll('.sb-overlay')) el.remove();
    for (const el of document.querySelectorAll('.sb-hidden')) el.classList.remove('sb-hidden');
    window.scrollTo(0, 0);
    // 计数器每局清零：不然上一局的混响会记到下一局头上，「只出点击声不建混响」永远红。
    window.__audio = { contexts: 0, convolver: 0, filters: 0, comps: 0, voices: 0 };
    const m = { tilt: 0, press: 0, cursors: 0, scroll: 0, firstAgent: -1, firstBuild: -1 };
    const t0 = performance.now();
    let raf = 0;
    const finish = (extra) => {
      cancelAnimationFrame(raf);
      resolve({
        ...m,
        ...window.__audio,
        ...extra,
        page: document.querySelector('#app').scrollHeight,
        vh: window.innerHeight,
      });
    };
    const sample = () => {
      const list = [...document.querySelectorAll('.sb-cursor')];
      for (const el of list) {
        if (el.hidden) continue;
        // --tilt 带单位，直接 Number() 会得到 NaN，于是「有没有歪过」永远读成 0。
        m.tilt = Math.max(m.tilt, Math.abs(Number((el.style.getPropertyValue('--tilt') || '0').replace('deg', '')) || 0));
        m.press = Math.max(m.press, Number(el.style.getPropertyValue('--press') || 0) || 0);
      }
      m.cursors = Math.max(m.cursors, list.filter((el) => !el.hidden).length);
      // 采集前那一遍预滚动也在动窗口，那时候还没有光标。光标出现以后的滚动才算镜头/读者的。
      if (list.length > 0) m.scroll = Math.max(m.scroll, window.scrollY);
      if (m.firstAgent < 0 && list.length > 0) m.firstAgent = Math.round(performance.now() - t0);
      // 第一件施工出现在第几毫秒：开场聚群开着时，从光标进场到第一件必然等满 2.4s。
      if (m.firstBuild < 0 && document.querySelector('.sb-item')) m.firstBuild = Math.round(performance.now() - t0);
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    const swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      // 测试台只钉住可比性需要的三样：人数、倍速、种子；其余一律走默认。
      agentCount: 6,
      speed: 2,
      seed: 7,
      ...options,
      onComplete: (r) => finish({ built: r.built, dropped: r.dropped, ms: Math.round(r.durationMs) }),
    });
    swarm.start();
    setTimeout(() => finish({ built: -1, dropped: -1, ms: -1 }), 90000);
  });

  const audioHook = () => {
    window.__audio = { contexts: 0, convolver: 0, filters: 0, comps: 0, voices: 0 };
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...args) { super(...args); window.__audio.contexts++; }
      createConvolver() { window.__audio.convolver++; return super.createConvolver(); }
      createBiquadFilter() { window.__audio.filters++; return super.createBiquadFilter(); }
      createDynamicsCompressor() { window.__audio.comps++; return super.createDynamicsCompressor(); }
    };
    const create = Real.prototype.createOscillator;
    Real.prototype.createOscillator = function () { window.__audio.voices++; return create.apply(this, arguments); };
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
  await page.evaluate(audioHook);

  const once = (options) => page.evaluate(MEASURE, options);
  // 默认那局不开任何开关：姿态、班组、聚群、滚动、声音、配乐全靠默认值。
  // tour 交给它，默认的 scroll 触发才走得完——参考版里读者自己滚，测试里由镜头代劳。
  const aligned = await once({ tour: true });
  // 反向：姿态、班组、聚群全部收成固定档，各自必须真的消失。
  // gather 必须一起关：开场聚群会按蓝图条目数放一批光标进来（大页封顶 18 只），不关就看不到固定人数。
  const calm = await once({
    tour: true, flight: 'idle', pointer: 'ignore', agents: 'fixed', gather: false,
  });
  // 立即放行：不滚也必须建完。gather:false 同时证明开场聚群可以关。
  const immediate = await once({
    tour: false, trigger: 'immediate', agents: 'fixed', flight: 'idle', gather: false,
  });
  // 同一页关掉积压提速：默认应该明显更快。
  const slow = await once({
    tour: false, trigger: 'immediate', agents: 'fixed', flight: 'idle', gather: false, adaptiveSpeed: false,
  });
  const scoreOff = await once({ tour: true, score: 'off' });
  const muted = await once({ tour: true, sound: false });

  // 减动效那一档要在真的声明了 prefers-reduced-motion 的上下文里跑，库读的是媒体查询。
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const rpage = await rctx.newPage();
  rpage.on('pageerror', (err) => errors.push(String(err)));
  await rpage.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
  await rpage.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
  await rpage.evaluate(audioHook);
  const skipped = await rpage.evaluate(MEASURE, { tour: true });
  const kept = await rpage.evaluate(MEASURE, {
    tour: false, trigger: 'immediate', agents: 'fixed', flight: 'idle', gather: false, reducedMotion: 'run',
  });

  const problems = [];
  const named = [['默认', aligned], ['收着跑', calm], ['立即放行', immediate], ['关掉积压提速', slow],
    ['只有点击', scoreOff], ['静音', muted], ['减动效交还', skipped], ['减动效照跑', kept]];
  for (const [name, r] of named) if (r.built < 0) problems.push(`${name} 那局 90 秒没跑完`);

  // 默认 = 参考扩展：待时飞行会歪、开场按条目数聚群（大页封顶 18 只）、镜头跟着施工前沿、声音和配乐都在。
  if (aligned.tilt <= 0) problems.push('默认那局箭头从未朝行进方向歪过：飞行姿态没生效');
  if (aligned.cursors <= 6) problems.push(`默认那局峰值只有 ${aligned.cursors} 个光标：开场聚群/自动班组没生效`);
  if (aligned.firstAgent < 0 || aligned.firstBuild < 0 || aligned.firstBuild - aligned.firstAgent < 1800) {
    problems.push(`默认那局从光标进场到第一件只隔 ${aligned.firstBuild - aligned.firstAgent}ms：开场聚群没等满`);
  }
  if (aligned.scroll < 300) problems.push(`默认那局只滚了 ${Math.round(aligned.scroll)}px：镜头没跟着施工前沿`);
  if (aligned.built < 10) problems.push(`默认那局只建成 ${aligned.built} 项`);
  if (aligned.contexts === 0) problems.push('默认那局没建 AudioContext：声音默认应该是开的');
  if (aligned.convolver === 0) problems.push('默认那局没建 ConvolverNode：默认配乐应该是生成式');
  if (aligned.comps !== 1) problems.push(`默认那局建了 ${aligned.comps} 个压限器，应为总线上那 1 个`);

  if (calm.tilt > 0 || calm.press > 0) problems.push(`flight:'idle' 仍写了姿态：倾角 ${calm.tilt.toFixed(1)}° 按下 ${calm.press.toFixed(2)}`);
  if (calm.cursors !== 6) problems.push(`agents:'fixed' 那局峰值 ${calm.cursors}，应恰好等于 agentCount 给的 6`);
  if (calm.scroll < 300) problems.push(`收着跑那局只滚了 ${Math.round(calm.scroll)}px：关掉姿态不该把镜头也关掉`);

  if (immediate.built < 10) problems.push(`trigger:'immediate' 那局只建成 ${immediate.built} 项`);
  if (immediate.scroll > 0) problems.push(`trigger:'immediate' + tour off 那局却滚了 ${Math.round(immediate.scroll)}px`);
  if (immediate.firstAgent < 0 || immediate.firstBuild < 0 || immediate.firstBuild - immediate.firstAgent > 1200) {
    problems.push(`gather:false 那局光标进场后还等了 ${immediate.firstBuild - immediate.firstAgent}ms 才出第一件：聚群没被跳过`);
  }

  if (immediate.built !== slow.built) problems.push(`积压提速那局建成 ${immediate.built} 项，关掉那局 ${slow.built} 项`);
  if (immediate.ms * 1.25 > slow.ms) {
    problems.push(`积压提速只把 ${slow.ms}ms 压到 ${immediate.ms}ms，要求至少快两成半`);
  }

  // 配乐和点击声的分界不在「有没有发声」，在图里那些只有配乐才会建的节点：
  // 房间混响（convolver）、每声部的带通（biquad）、总线的压限（compressor）。
  if (scoreOff.convolver !== 0 || scoreOff.filters !== 0 || scoreOff.comps !== 0) {
    problems.push(`score:'off' 那局多建了节点：混响 ${scoreOff.convolver} / 带通 ${scoreOff.filters} / 压限 ${scoreOff.comps}`);
  }
  if (scoreOff.voices === 0) problems.push(`score:'off' 那局一次都没发声：点击声也归它管`);
  if (scoreOff.contexts === 0) problems.push(`score:'off' 但 sound 还开着，却没建 AudioContext`);
  if (muted.contexts !== 0 || muted.voices !== 0) {
    problems.push(`sound:false 那局却碰了音频图：AudioContext ${muted.contexts} 发声 ${muted.voices}`);
  }

  if (skipped.built !== 0 || skipped.cursors !== 0) problems.push(`减动效直接交还那局建成 ${skipped.built} 项、亮过 ${skipped.cursors} 个光标`);
  if (skipped.ms > 200) problems.push(`减动效交还那局耗时 ${skipped.ms}ms，应该几乎为 0`);
  if (kept.built <= 0) problems.push(`减动效但照跑那局没建东西（建成 ${kept.built}）：reducedMotion:'run' 应压过媒体查询`);
  const hidden = await rpage.evaluate(() => document.querySelectorAll('.sb-hidden').length);
  if (hidden !== 0) problems.push(`交还以后还有 ${hidden} 个元素带着 sb-hidden`);

  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('replica @1280', problems, [
    `默认: 倾角=${aligned.tilt.toFixed(1)}° 峰值人数=${aligned.cursors} 聚群=${aligned.firstBuild - aligned.firstAgent}ms 滚到 ${Math.round(aligned.scroll)} · 混响=${aligned.convolver} 压限=${aligned.comps} 耗时=${aligned.ms}ms`,
    `收着跑（idle/fixed）: 倾角=${calm.tilt.toFixed(1)}° 峰值人数=${calm.cursors} 滚到 ${Math.round(calm.scroll)} 耗时=${calm.ms}ms`,
    `立即放行: 建成 ${immediate.built} 项 聚群=${immediate.firstBuild - immediate.firstAgent}ms 滚到 ${Math.round(immediate.scroll)} 耗时=${immediate.ms}ms`,
    `积压提速: 关掉 ${slow.ms}ms → 默认 ${immediate.ms}ms（建成 ${slow.built}/${immediate.built}）`,
    `配乐: 混响=${aligned.convolver} 带通=${aligned.filters} 压限=${aligned.comps} 发声=${aligned.voices} · 关掉配乐: 混响=${scoreOff.convolver} 带通=${scoreOff.filters} 发声=${scoreOff.voices}`,
    `减动效: skip 建成 ${skipped.built} 项耗时 ${skipped.ms}ms · run 建成 ${kept.built} 项`,
  ]);
  await rctx.close();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 27：面板变短以后，640–900 的宿主里默认那一页都不许滚
// ---------------------------------------------------------------------------
{
  const problems = [];
  const notes = [];
  // 每一档都量「刚好装得下」与「刚被压到下一档」这两格：死区只会出现在交界处。
  // 案例视口高度 = 宿主高度 - 111（mockup 外壳自己的表头与地址栏）。
  for (const h of [984, 983, 933, 932, 841, 840, 733, 732, 640]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/demos/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(
      () => document.querySelector('[data-frame]')?.contentDocument?.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-fields]'),
      null, { timeout: 20000 },
    );
    const m = await page.evaluate(() => {
      const doc = document.querySelector('[data-frame]').contentDocument;
      const sr = doc.querySelector('[data-sb-chrome]').shadowRoot;
      const card = sr.querySelector('.card').getBoundingClientRect();
      const fields = sr.querySelector('[data-fields]');
      const rows = [...sr.querySelectorAll('.row')].filter((el) => el.getBoundingClientRect().height > 0).length;
      const vh = doc.documentElement.clientHeight;
      return {
        vh,
        tier: vh <= 621 ? 'T4' : vh <= 729 ? 'T3' : vh <= 821 ? 'T2' : vh <= 872 ? 'T1' : 'T0',
        rows,
        secs: sr.querySelectorAll('.sec').length,
        tabs: sr.querySelectorAll('.tab').length,
        content: fields.scrollHeight,
        client: fields.clientHeight,
        chrome: Math.round(card.height - fields.clientHeight),
        bottom: Math.round(card.bottom),
      };
    });
    // 分档压缩的唯一目的：当前那一页的 6 行不交给滚动条。滚 1px 也算没铺开。
    if (m.content > m.client + 1) problems.push(`宿主高 ${h}（案例视口 ${m.vh}，${m.tier} 档）参数区滚了 ${m.content - m.client}px：${m.content}/${m.client}`);
    if (m.rows !== 6 || m.secs !== 6 || m.tabs !== 6) problems.push(`宿主高 ${h} 默认应露出 6 行 + 6 个页签，实测 ${m.rows} 行 / ${m.secs} 节 / ${m.tabs} 页签`);
    if (m.bottom > m.vh + 1) problems.push(`宿主高 ${h} 面板底边 ${m.bottom} 掉到案例视口 ${m.vh} 外面`);
    notes.push(`${h}px 宿主 → 案例视口 ${m.vh} · ${m.tier} · 常驻 ${m.rows} 行 + ${m.tabs} 页签 ${m.content}/${m.client} · 卡外框 ${m.chrome}px`);
    await ctx.close();
  }

  report('panel-fit @1280', problems, [
    notes.join(' · '),
    '默认只摊开一组：整张卡在 1280×900 下约 423px 高，比六节全开时矮了近一半',
    '案例视口低于 ~514px（宿主不足 625）才是交给可见滚动条的区间，面板可以用右下角把手拉大',
  ]);
}

// ---------------------------------------------------------------------------
// 场景 28：shadow 宿主——样式进 shadow、滚动层在 shadow 外、前沿量实际矩形
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/demos/shadow.html`, { waitUntil: 'load' });

  const injection = await page.evaluate(() => {
    const sr = document.querySelector('#mount')?.shadowRoot;
    return {
      inShadow: !!sr?.querySelector('#swarm-builder-style'),
      inHead: !!document.head.querySelector('#swarm-builder-style'),
    };
  });

  let overlaySeen = true;
  try {
    await page.waitForFunction(
      () => !!document.querySelector('#mount')?.shadowRoot?.querySelector('.sb-overlay'),
      null, { timeout: 15000 },
    );
  } catch { overlaySeen = false; }
  const mid = await page.evaluate(() => {
    const sr = document.querySelector('#mount').shadowRoot;
    const ov = sr.querySelector('.sb-overlay');
    return {
      position: ov ? getComputedStyle(ov).position : '',
      cursors: sr.querySelectorAll('.sb-cursor').length,
      inDoc: !!document.querySelector('.sb-overlay'),
    };
  });

  let finished = true;
  try {
    await page.waitForFunction(() => window.__shadowDone === true, null, { timeout: 60000, polling: 200 });
  } catch { finished = false; }
  const done = await page.evaluate(() => {
    const sr = document.querySelector('#mount').shadowRoot;
    return {
      scrollMax: window.__shadowScrollMax ?? 0,
      winY: window.__shadowWinY ?? 0,
      cursors: sr.querySelectorAll('.sb-cursor').length,
      overlay: !!sr.querySelector('.sb-overlay'),
      hidden: sr.querySelectorAll('.sb-hidden').length,
      built: window.__shadowResult?.built ?? 0,
    };
  });
  await page.screenshot({ path: `${OUT}shadow-1280.png` });

  const problems = [];
  if (!injection.inShadow) problems.push('样式没注入 shadow root');
  if (injection.inHead) problems.push('样式漏进了 document.head');
  if (!overlaySeen) problems.push('overlay 没出现');
  if (mid.position !== 'absolute') problems.push(`overlay 定位是 ${mid.position}，应为 absolute`);
  if (mid.cursors === 0) problems.push('运行中没有光标上场');
  if (mid.inDoc) problems.push('overlay 挂到了 shadow 外');
  if (!finished) problems.push('60s 未完成（前沿死锁？）');
  if (done.scrollMax < 300) problems.push(`外层滚动层只滚了 ${Math.round(done.scrollMax)}px：detectEnv 没跨过 shadow`);
  if (done.winY > 0) problems.push(`窗口被滚了 ${Math.round(done.winY)}px：应只滚 #host`);
  if (done.cursors !== 0 || done.overlay) problems.push('完成后光标/overlay 没清掉');
  if (done.hidden !== 0) problems.push('交还后原页面没恢复');
  if (done.built < 10) problems.push(`只建成 ${done.built} 项`);
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);
  report('shadow @1280', problems, [
    `注入: shadow=${injection.inShadow} head=${injection.inHead} · overlay 定位=${mid.position} 在外=${mid.inDoc}`,
    `滚动: #host 峰值 ${Math.round(done.scrollMax)}px · 窗口 ${Math.round(done.winY)}px · 建成 ${done.built} 项 · 完成=${finished}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 29：极简 HUD——移动端触摸跳过；滚动提示出现、滚动后消失
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/demos/hud.html`, { waitUntil: 'load' });

  let hintSeen = true;
  try {
    await page.waitForFunction(() => {
      const h = document.querySelector('.sb-hud__hint');
      return !!h && !h.hidden;
    }, null, { timeout: 20000 });
  } catch { hintSeen = false; }

  const before = await page.evaluate(() => {
    const bar = document.querySelector('.sb-hud__bar');
    const r = bar?.getBoundingClientRect();
    return {
      hud: !!document.querySelector('.sb-hud'),
      progress: document.querySelector('.sb-hud__progress')?.textContent ?? '',
      bar: r ? { w: r.width, h: r.height, bottom: r.bottom } : null,
    };
  });

  let hintGone = false;
  if (hintSeen) {
    await page.evaluate(() => window.scrollTo(0, 900));
    try {
      await page.waitForFunction(() => document.querySelector('.sb-hud__hint')?.hidden === true, null, { timeout: 5000 });
      hintGone = true;
    } catch { /* 判红 */ }
  }

  let skipped = false;
  if (before.hud) {
    await page.tap('.sb-hud__skip');
    try {
      await page.waitForFunction(() => window.__hudDone === true, null, { timeout: 10000 });
      skipped = true;
    } catch { /* 判红 */ }
  }
  const after = await page.evaluate(() => ({
    hud: !!document.querySelector('.sb-hud'),
    overlay: !!document.querySelector('.sb-overlay'),
    hidden: document.querySelectorAll('.sb-hidden').length,
  }));
  await page.screenshot({ path: `${OUT}hud-390.png` });

  const problems = [];
  if (!before.hud) problems.push('hud:true 没渲染 .sb-hud');
  if (!hintSeen) problems.push('活被锁住时滚动提示没出现');
  if (hintSeen && !hintGone) problems.push('滚动后提示没消失');
  if (before.bar && (before.bar.h < 40 || before.bar.bottom > 844)) problems.push(`跳过条触摸区不够或出屏：${Math.round(before.bar.h)}px / bottom ${Math.round(before.bar.bottom)}`);
  if (!skipped) problems.push('触摸跳过没让运行收工');
  if (after.hud || after.overlay) problems.push('跳过后 HUD/overlay 没清掉');
  if (after.hidden !== 0) problems.push('跳过后原页面没恢复');
  if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);
  report('hud @390', problems, [
    `HUD=${before.hud} 进度=${before.progress} 跳过条=${before.bar ? `${Math.round(before.bar.w)}x${Math.round(before.bar.h)}` : '无'}`,
    `提示: 出现=${hintSeen} 滚后消失=${hintGone} · 触摸跳过=${skipped} · 清场 hud=${after.hud} overlay=${after.overlay}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 30：开场光标数按蓝图条目数缩放（1.3）——小页保底 3、大页封顶 18、固定班组不变、种子仍可回放。
// 开场人数只在聚群阶段量：第一件施工出现前 building=false，班组不招临时工，这段峰值就是 introCount。
// ---------------------------------------------------------------------------
{
  const MEASURE = (options) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    window.__seq = [];
    if (!window.__introObserved) {
      window.__introObserved = true;
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.dataset.item) window.__seq.push(node.dataset.item);
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    const m = { opening: 0, peak: 0, total: 0 };
    let raf = 0;
    let swarm;
    const finish = (extra) => { cancelAnimationFrame(raf); resolve({ ...m, ...extra }); };
    const sample = () => {
      const n = [...document.querySelectorAll('.sb-cursor')].filter((el) => !el.hidden).length;
      m.peak = Math.max(m.peak, n);
      // 只在聚群阶段量开场人数：phase 翻到 building 后班组才招临时工，那以后的人数不算开场。
      const phase = swarm?.status.phase;
      if (phase === 'gathering' || phase === 'scanning') m.opening = Math.max(m.opening, n);
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 4, tour: false, trigger: 'immediate',
      ...options,
      onStatus: (s) => { m.total = s.total; },
      onComplete: (r) => finish({ head: window.__seq.slice(0, 6), built: r.built, seed: r.seed }),
    });
    swarm.start();
    setTimeout(() => finish({ head: [], built: -1, seed: -1 }), 60000);
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const on = async (demo, options) => {
    await page.goto(`${BASE}/demos/${demo}.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
    return page.evaluate(MEASURE, options);
  };
  const formula = (n) => Math.min(18, Math.max(3, Math.ceil(n / 12)));

  const simple = await on('simple', {});
  const home = await on('home', { performanceMode: 'high', maxItems: 4000 });
  const tall = await on('tall', {});
  const fixed = await on('tall', { agents: 'fixed', gather: false, agentCount: 6 });
  const seedOpts = { order: 'random', pick: 'queued', adaptiveSpeed: false, agentCount: 6, gather: true, agents: 'auto' };
  const seedA = await on('tall', { ...seedOpts, seed: 12345 });
  const seedB = await on('tall', { ...seedOpts, seed: 12345 });
  const seedC = await on('tall', { ...seedOpts, seed: 67890 });

  const problems = [];
  for (const [name, r] of [['simple', simple], ['home', home], ['tall', tall], ['fixed', fixed]]) {
    if (r.built < 0) problems.push(`${name} 那局 60 秒没跑完`);
  }
  if (simple.opening > 3) problems.push(`simple（${simple.total} 项）开场 ${simple.opening} 只，小页应 ≤3`);
  if (simple.opening !== formula(simple.total)) problems.push(`simple 开场 ${simple.opening} ≠ 公式 ${formula(simple.total)}（${simple.total} 项）`);
  if (home.total < 216) problems.push(`home 只采到 ${home.total} 项，不足以封顶 18（需 ≥216）`);
  if (home.opening !== 18) problems.push(`home（${home.total} 项）开场 ${home.opening} 只，大页应封顶 18`);
  if (tall.opening !== formula(tall.total)) problems.push(`tall 开场 ${tall.opening} ≠ 公式 ${formula(tall.total)}（${tall.total} 项）`);
  if (fixed.peak !== 6) problems.push(`agents:'fixed' 峰值 ${fixed.peak}，缩放不该动固定班组（应 6）`);
  if (seedA.head.join(',') !== seedB.head.join(',')) problems.push(`聚群+auto 同种子开工顺序变了：${seedA.head.join(' ')} vs ${seedB.head.join(' ')}`);
  if (seedA.head.join(',') === seedC.head.join(',')) problems.push('聚群+auto 换种子顺序没变，种子没参与缩放后的排程');
  if (seedA.seed !== 12345) problems.push(`完成状态没回显种子：${seedA.seed}`);
  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('intro-scale @1280', problems, [
    `simple: ${simple.total} 项 → 开场 ${simple.opening} 只（≤3）· home: ${home.total} 项 → 开场 ${home.opening} 只（封顶 18）· tall: ${tall.total} 项 → 开场 ${tall.opening} 只`,
    `公式 min(18,max(3,ceil(items/12))): simple=${formula(simple.total)} tall=${formula(tall.total)} · 固定班组峰值=${fixed.peak}（不变）`,
    `种子回放（聚群+auto）: 12345 两次 ${seedA.head.join(' ')} = ${seedB.head.join(' ')} · 67890 ${seedC.head.join(' ')} · 回显=${seedA.seed}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 31：光标性格 + 开场点名（创意 1+6）。
// 性格从这一局的种子抽：同种子回放同一支队伍，关掉则全员稳当当、一个随机数都不抽。
// 点名是纯装饰：聚群那几秒挂领班牌、名牌逐个弹，开工那一帧就拆——不加减人、不改聚群时长。
// ---------------------------------------------------------------------------
{
  const MEASURE = (options) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    const m = { chip: false, chipText: '', rolling: 0, crew: 0, map: '', traitsOk: true, chipAfter: true, built: -1, seed: -1,
      trailSeen: 0, trailMax: 0, trailLit: 0, trailZero: false, dirs: [], trailSize: '' };
    let captured = false;
    let raf = 0;
    let swarm;
    const readMap = () => {
      const rows = [...document.querySelectorAll('.sb-cursor')].map((el) => {
        const kind = el.classList.contains('sb-p-rush') ? 'rush'
          : el.classList.contains('sb-p-tidy') ? 'tidy'
          : el.classList.contains('sb-p-drift') ? 'drift' : 'steady';
        // 性格必须和它戴的配件对上：急性子有速度线、强迫症有校准环、摸鱼有气泡，稳当当什么都没有。
        const trait = kind === 'rush' ? !!el.querySelector('.sb-trail')
          : kind === 'tidy' ? !!el.querySelector('.sb-ring')
          : kind === 'drift' ? !!el.querySelector('.sb-idle')
          : !el.querySelector('.sb-trail, .sb-ring, .sb-idle');
        if (!trait) m.traitsOk = false;
        return `${el.dataset.cursor}:${kind}`;
      });
      return rows.sort().join(',');
    };
    const sample = () => {
      const phase = swarm?.status.phase;
      const chip = document.querySelector('.sb-rollcall');
      if (phase === 'gathering') {
        if (chip) { m.chip = true; m.chipText = chip.textContent ?? ''; }
        m.rolling = Math.max(m.rolling, document.querySelectorAll('.sb-name.sb-rolling').length);
        m.crew = Math.max(m.crew, document.querySelectorAll('.sb-cursor:not([hidden])').length);
      }
      if (phase === 'building' && !captured) { captured = true; m.map = readMap(); }
      if (phase === 'building') {
        // 速度线不是摆设：移动时要够亮、方向要跟着位移转，停下来要归零。
        for (const trail of document.querySelectorAll('.sb-p-rush .sb-trail')) {
          m.trailSeen++;
          const op = parseFloat(getComputedStyle(trail).opacity) || 0;
          if (op > m.trailMax) m.trailMax = op;
          if (op >= 0.1) {
            m.trailLit++;
            // 两个变量写在光标根节点上、由 .sb-trail 继承，读 trail 自己的 inline 只会读到空。
            const dir = trail.parentElement?.style.getPropertyValue('--sb-dir') ?? '';
            if (dir && !m.dirs.includes(dir)) m.dirs.push(dir);
          } else if (op === 0) {
            m.trailZero = true;
          }
          if (!m.trailSize) {
            const line = trail.querySelector('i');
            if (line) {
              const box = getComputedStyle(line);
              m.trailSize = `${box.height}/${box.width}`;
            }
          }
        }
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    const finish = (extra) => { cancelAnimationFrame(raf); resolve({ ...m, ...extra }); };
    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 4, tour: false, trigger: 'immediate',
      gather: true, agents: 'fixed', agentCount: 8, adaptiveSpeed: false,
      ...options,
      onComplete: (r) => finish({ chipAfter: !document.querySelector('.sb-rollcall'), built: r.built, seed: r.seed }),
    });
    swarm.start();
    setTimeout(() => finish({}), 60000);
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const on = async (options) => {
    await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
    return page.evaluate(MEASURE, options);
  };

  const a = await on({ seed: 12345 });
  const b = await on({ seed: 12345 });
  const c = await on({ seed: 67890 });
  const off = await on({ seed: 12345, personality: false });
  await page.screenshot({ path: `${OUT}personality.png` });

  const problems = [];
  for (const [name, r] of [['a', a], ['b', b], ['c', c], ['off', off]]) {
    if (r.built < 0) problems.push(`${name} 那局 60 秒没跑完`);
  }
  if (!a.chip) problems.push('聚群阶段没挂出点名领班牌');
  if (!/领班/.test(a.chipText) || !/Ava/.test(a.chipText)) problems.push(`领班牌文案不对：${a.chipText}`);
  if (a.rolling !== a.crew || a.crew !== 8) problems.push(`点名没让全部名牌弹：rolling=${a.rolling} crew=${a.crew}（应同为 8）`);
  if (!a.traitsOk) problems.push('有光标的性格和它戴的配件对不上');
  if (a.trailSeen < 1) problems.push('这局没有急性子，速度线没测到');
  if (a.trailMax < 0.5) problems.push(`速度线太淡：亮度峰值 ${a.trailMax}`);
  if (!a.trailLit) problems.push('移动时速度线从没亮过');
  if (!a.dirs.length || !a.dirs.some((dir) => dir !== '0deg')) {
    problems.push(`速度线没跟着位移方向转：${a.dirs.join(' ') || '没有方向'}`);
  }
  if (a.trailSize !== '2px/28px') problems.push(`速度线尺寸 ${a.trailSize}（应 2px/28px）`);
  if (!a.trailZero) problems.push('停下来后速度线没有归零');
  if (a.map !== b.map) problems.push(`同种子性格变了：${a.map} vs ${b.map}`);
  if (a.map === c.map) problems.push('换种子性格没变，种子没参与抽性格');
  if (!a.chipAfter) problems.push('开工后领班牌没拆掉');
  if (off.map.split(',').some((row) => !row.endsWith(':steady'))) problems.push(`personality:false 还有不是稳当当的：${off.map}`);
  if (!off.chip) problems.push('关掉性格后开场点名也没了（点名不该依赖性格）');
  if (a.seed !== 12345) problems.push(`完成状态没回显种子：${a.seed}`);
  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('personality @1280', problems, [
    `点名: 领班牌=${a.chip}「${a.chipText}」· 弹名牌=${a.rolling}/${a.crew} · 开工后已拆=${a.chipAfter}`,
    `性格: 12345 两次 ${a.map} = ${b.map} · 67890 ${c.map} · 配件齐全=${a.traitsOk}`,
    `速度线: 亮 ${a.trailLit}/${a.trailSeen} 帧 · 峰值 ${a.trailMax} · 方向 ${a.dirs.length} 种「${a.dirs.slice(0, 3).join(' ')}」· 尺寸 ${a.trailSize} · 静止归零=${a.trailZero}`,
    `关闭: 全员稳当当=${off.map.split(',').every((row) => row.endsWith(':steady'))} · 点名仍在=${off.chip} · 回显种子=${a.seed}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 32：交接仪式 + 竣工印章（创意 2+4）。
// 交接是完成事件上的纯装饰：两只光标在 90px 内一起收活，中点冒火花、纯 CSS 自删、成对冷却；
// 印章是每件活的竣工标记，辅助线不盖、不碰 ⌥ 徽章；性能模式裁剪的密集页不盖。
// ---------------------------------------------------------------------------
{
  const MEASURE = (options) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    const m = {
      sparks: 0, sparksAtPause: -1, sparksAfterPause: -1, paused: false,
      stamps: 0, guides: 0, polluted: 0, badges: 0, stampAsBadge: 0,
      title: '', built: -1,
    };
    let raf = 0;
    let swarm;
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains('sb-handoff')) {
            m.sparks++;
            if (node.hasAttribute('data-item')) m.polluted++;
          }
          if (node.classList.contains('sb-guide')) m.guides++;
          if (node.classList.contains('sb-stamp')) {
            m.stamps++;
            if (!m.title) m.title = node.getAttribute('title') ?? '';
            if (node.hasAttribute('data-item')) m.polluted++;
            if (node.classList.contains('sb-badge')) m.stampAsBadge++;
          }
        }
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });

    // 攒到三记火花再暂停：时钟停住就没人竣工，暂停期间不该再冒新的。
    const sample = () => {
      if (swarm?.status.phase === 'building') {
        m.badges = Math.max(m.badges, document.querySelectorAll('.sb-badge').length);
        if (!m.paused && m.sparks >= 3) {
          m.paused = true;
          swarm.pause();
          m.sparksAtPause = m.sparks;
          window.setTimeout(() => {
            m.sparksAfterPause = m.sparks;
            swarm.resume();
          }, 700);
        }
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    const finish = (extra) => {
      cancelAnimationFrame(raf);
      watch.disconnect();
      resolve({ ...m, ...extra });
    };
    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 4, tour: false, trigger: 'immediate',
      gather: false, agents: 'fixed', agentCount: 8, adaptiveSpeed: false,
      performanceMode: 'high', seed: 12345,
      ...options,
      // onComplete 之前 overlay 已经交还，印章只能靠监听增量数；延一拍让最后一批记录落地。
      onComplete: (r) => window.setTimeout(() => finish({ built: r.built }), 0),
    });
    swarm.start();
    window.setTimeout(() => finish({}), 60000);
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const on = async (options) => {
    await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
    return page.evaluate(MEASURE, options);
  };

  const sealed = await on({});
  const bare = await on({ stamps: false });
  const trimmed = await on({ performanceMode: 'low' });
  await page.screenshot({ path: `${OUT}stamps.png` });

  const problems = [];
  for (const [name, r] of [['seals', sealed], ['bare', bare], ['trimmed', trimmed]]) {
    if (r.built < 0) problems.push(`${name} 那局 60 秒没跑完`);
  }
  if (sealed.sparks <= 0) problems.push('一局下来没有一记交接火花');
  if (!sealed.paused) problems.push('火花没攒到三记，暂停那一段没测到');
  if (sealed.sparksAfterPause !== sealed.sparksAtPause) {
    problems.push(`暂停期间还在冒火花：${sealed.sparksAtPause} → ${sealed.sparksAfterPause}`);
  }
  if (sealed.polluted > 0) problems.push(`火花或印章带上了 data-item：${sealed.polluted} 个`);
  if (sealed.stamps !== sealed.built - sealed.guides) {
    problems.push(`印章 ${sealed.stamps} ≠ 建成 ${sealed.built} - 辅助线 ${sealed.guides}`);
  }
  if (sealed.badges !== 8) problems.push(`⌥ 徽章容器峰值 ${sealed.badges}（应每个光标一个 = 8）`);
  if (sealed.stampAsBadge > 0) problems.push('印章混进了尺寸徽章');
  if (!/·/.test(sealed.title) || !/急性子|强迫症|摸鱼中|稳当当/.test(sealed.title)) {
    problems.push(`印章名牌不对：${sealed.title}`);
  }
  if (bare.stamps !== 0) problems.push(`stamps:false 还盖了 ${bare.stamps} 枚`);
  if (bare.sparks <= 0) problems.push('关掉印章连带交接火花也没了（两者应独立）');
  if (trimmed.stamps !== 0) problems.push(`performanceMode:low 还盖了 ${trimmed.stamps} 枚`);
  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('handoff+stamps @1280', problems, [
    `交接: 火花 ${sealed.sparks} 记 · 暂停 ${sealed.sparksAtPause} → ${sealed.sparksAfterPause}（应不变）· data-item 污染 ${sealed.polluted}`,
    `印章: ${sealed.stamps} = 建成 ${sealed.built} - 辅助线 ${sealed.guides} · 徽章 ${sealed.badges} 个 · 名牌「${sealed.title}」`,
    `关闭: stamps:false ${bare.stamps} 枚（火花 ${bare.sparks} 记）· 精简模式 ${trimmed.stamps} 枚`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 33：观众是总监（创意 3）。
// 施工期间点一下 = 催工（1.8x 施工时钟 + 光环窗口），拖走松手 = 改派（下一件活取离落点最近的）。
// 只有光标接指针，重建出来的盒子仍然不可交互；聚群、暂停、收工、director:false 都不接管。
// ---------------------------------------------------------------------------
{
  const MAIN = (options) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    const m = {
      directing: false, overlayEvents: '', cursorEvents: '', pad: '',
      urgedNow: false, halo: '', urgedMid: false, urgedAfter: false,
      dragTarget: 0, dragDirecting: 0, dragCursor: '', assign: null, drop: null,
      claim: null, claimDistance: -1, baselineNearest: null, baselineCount: -1, inBaseline: false,
      nextStamp: null,
      boxUrged: -1,
      pausePhase: '', pauseDirecting: true, pauseEvents: '', pauseUrged: -1,
      resumeDirecting: false, resumeEvents: '', built: -1, early: '',
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const when = async (fn, timeout = 20000) => {
      const t0 = performance.now();
      while (!fn()) {
        if (performance.now() - t0 > timeout) return false;
        await sleep(50);
      }
      return true;
    };
    const idOf = (el) => Number(el.dataset.cursor);
    const padCenter = (el) => {
      const r = el.querySelector('.sb-cursor__hit').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 };
    };
    const pick = () => [...document.querySelectorAll('.sb-cursor')].find((el) => padCenter(el).ok) ?? null;
    const fire = (target, type, x, y, buttons, pointerId) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      pointerId, pointerType: 'mouse', isPrimary: true, button: 0, buttons,
    }));
    let raf = 0;
    let swarm;
    const finish = (extra) => {
      cancelAnimationFrame(raf);
      resolve({ ...m, ...extra });
    };

    // 印章要按名字对上「拖过的那只」，记录首字与落点距离。
    const stamps = [];
    const watch = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains('sb-stamp')) continue;
          stamps.push({
            name: (node.getAttribute('title') ?? '').split(' · ')[0],
            x: parseFloat(node.style.left),
            y: parseFloat(node.style.top),
            at: performance.now(),
          });
        }
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });

    const driver = async () => {
      if (!await when(() => swarm.status.phase === 'building' && stamps.length >= 2)) {
        m.early = '没进施工或印章不足';
        return;
      }
      const overlay = document.querySelector('.sb-overlay');
      const first = pick();
      if (!overlay || !first) { m.early = '没有可见光标'; return; }
      m.directing = overlay.classList.contains('is-directing');
      m.overlayEvents = getComputedStyle(overlay).pointerEvents;
      m.cursorEvents = getComputedStyle(first).pointerEvents;
      m.pad = getComputedStyle(first.querySelector('.sb-cursor__hit')).display;

      // 1) 点一下 = 催工，光环约 2.2s 后自己收。
      const at = padCenter(first);
      fire(document.elementFromPoint(at.x, at.y) ?? first, 'pointerdown', at.x, at.y, 1, 21);
      fire(window, 'pointerup', at.x, at.y, 0, 21);
      await sleep(100);
      m.urgedNow = first.classList.contains('is-urged');
      m.halo = getComputedStyle(first.querySelector('.sb-urge')).display;
      await sleep(1200);
      m.urgedMid = first.classList.contains('is-urged');
      await sleep(1400);
      m.urgedAfter = first.classList.contains('is-urged');

      // 2) 拖走 = 改派：挑一只闲着的（它的下一次认领就是被改派的那件），
      //    落点记下来，下一枚印章应该落在附近。
      let idleAgent = null;
      await when(() => {
        idleAgent = (swarm.agents ?? []).find((a) => !a.busy && !a.isFinished) ?? null;
        return !!idleAgent;
      }, 3000);
      if (swarm.status.phase !== 'building') { m.early = '拖拽前已收工'; return; }
      const drag = idleAgent ? document.querySelector(`.sb-cursor[data-cursor="${idleAgent.info.id}"]`) : pick();
      if (!drag) { m.early = '拖拽前没有可拖的光标'; return; }
      m.dragCursor = drag.querySelector('.sb-name')?.textContent ?? '';
      const rect = overlay.getBoundingClientRect();
      const client = { x: 640, y: 520 };
      const drop = { x: client.x - rect.left, y: client.y - rect.top };
      m.drop = { x: Math.round(drop.x), y: Math.round(drop.y) };

      // 改派该挑的是「落点那一刻就能动工」里最近的一件。直接问调度器的池/队列，
      // 和 take() 走同一套 ready() 判据——印章盖在条目角上，拿它当距离代理会偏。
      const scheduler = swarm.scheduler;
      const originalTake = scheduler.take;
      let baseline = null;
      const snapshot = () => {
        const source = scheduler.pool ?? (scheduler.queues ?? []).flatMap((queue) => queue);
        const out = [];
        for (const item of source) {
          if (!scheduler.ready(item)) continue;
          const x = item.x + item.width / 2;
          const y = item.y + item.height / 2;
          out.push({ id: item.id, d: Math.round(Math.hypot(x - drop.x, y - drop.y)) });
        }
        return out;
      };
      scheduler.take = (claimer) => {
        if (claimer.index === idleAgent.index) baseline = snapshot();
        return originalTake.call(scheduler, claimer);
      };

      const from = padCenter(drag);
      const beforeClaim = idleAgent.currentItem ?? null;
      fire(document.elementFromPoint(from.x, from.y) ?? drag, 'pointerdown', from.x, from.y, 1, 22);
      for (let i = 1; i <= 6; i++) {
        fire(window, 'pointermove', from.x + (client.x - from.x) * i / 6, from.y + (client.y - from.y) * i / 6, 1, 22);
      }
      m.dragTarget = document.querySelectorAll('.sb-target').length;
      m.dragDirecting = document.querySelectorAll('.sb-cursor.is-directing').length;
      fire(window, 'pointerup', client.x, client.y, 0, 22);
      m.assign = [...document.querySelectorAll('.sb-assign')].map((el) => ({
        x: Math.round(parseFloat(el.style.left)), y: Math.round(parseFloat(el.style.top)),
      }))[0] ?? null;
      const releaseAt = performance.now();

      await when(() => idleAgent.currentItem != null && idleAgent.currentItem !== beforeClaim, 4000);
      const claimed = idleAgent.currentItem;
      if (claimed) {
        const x = claimed.x + claimed.width / 2;
        const y = claimed.y + claimed.height / 2;
        m.claim = { id: claimed.id, x: Math.round(x), y: Math.round(y) };
        m.claimDistance = Math.round(Math.hypot(x - drop.x, y - drop.y));
      }
      if (baseline) {
        m.baselineCount = baseline.length;
        m.baselineNearest = baseline.reduce(
          (a, b) => (a.d <= b.d ? a : b),
          { id: '', d: Number.POSITIVE_INFINITY },
        );
        if (!Number.isFinite(m.baselineNearest.d)) m.baselineNearest = null;
        m.inBaseline = m.claim ? baseline.some((c) => c.id === m.claim.id) : false;
      }
      await when(() => stamps.some((s) => s.name === m.dragCursor && s.at >= releaseAt), 8000);
      const after = stamps.filter((s) => s.name === m.dragCursor && s.at >= releaseAt)[0];
      if (after) m.nextStamp = { x: Math.round(after.x), y: Math.round(after.y) };

      // 3) 重建出来的盒子不吃指针：离光标够远的盒子点一下，谁都不该被催。
      const beforeUrged = document.querySelectorAll('.sb-cursor.is-urged').length;
      const box = await (async () => {
        const anchors = [...document.querySelectorAll('.sb-cursor')].map(padCenter);
        const candidate = [...document.querySelectorAll('.sb-item--live, .sb-text')].find((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 20 || r.bottom < 0 || r.top > innerHeight) return false;
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          return anchors.every((a) => Math.hypot(a.x - x, a.y - y) > 90);
        });
        if (!candidate) return null;
        const r = candidate.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        fire(document.elementFromPoint(x, y) ?? document.body, 'pointerdown', x, y, 1, 23);
        fire(window, 'pointerup', x, y, 0, 23);
        return { cls: candidate.className, x: Math.round(x), y: Math.round(y) };
      })();
      await sleep(100);
      m.boxUrged = document.querySelectorAll('.sb-cursor.is-urged').length - beforeUrged;
      m.box = box;

      // 4) 暂停交还指针，继续后恢复接管。
      swarm.pause();
      await sleep(150);
      const some = document.querySelector('.sb-cursor');
      m.pausePhase = swarm.status.phase;
      m.pauseDirecting = document.querySelectorAll('.sb-overlay.is-directing').length;
      m.pauseEvents = some ? getComputedStyle(some).pointerEvents : 'none';
      const pausedUrged = document.querySelectorAll('.sb-cursor.is-urged').length;
      if (some) {
        fire(some, 'pointerdown', 10, 10, 1, 24);
        fire(window, 'pointerup', 10, 10, 0, 24);
      }
      await sleep(80);
      m.pauseUrged = document.querySelectorAll('.sb-cursor.is-urged').length - pausedUrged;
      swarm.resume();
      await sleep(150);
      const live = document.querySelector('.sb-cursor');
      m.resumeDirecting = !!document.querySelector('.sb-overlay.is-directing');
      m.resumeEvents = live ? getComputedStyle(live).pointerEvents : 'none';
    };

    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 0.8, tour: false, trigger: 'immediate',
      gather: false, agents: 'fixed', agentCount: 8, adaptiveSpeed: false,
      performanceMode: 'high', seed: 12345,
      ...options,
      onComplete: (r) => window.setTimeout(() => { watch.disconnect(); finish({ built: r.built }); }, 0),
    });
    swarm.start();
    driver().catch((error) => { m.early = String(error); });
    window.setTimeout(() => { watch.disconnect(); finish({}); }, 60000);
  });

  const INERT = ([options, phaseName]) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    const m = { phase: '', directing: 0, events: '', pad: '', urged: -1, target: 0, assign: 0, early: true };
    let swarm;
    const poll = window.setInterval(() => {
      if (!swarm || swarm.status.phase !== phaseName) return;
      window.clearInterval(poll);
      m.early = false;
      const overlay = document.querySelector('.sb-overlay');
      const el = document.querySelector('.sb-cursor');
      m.phase = swarm.status.phase;
      m.directing = document.querySelectorAll('.sb-overlay.is-directing').length;
      m.events = el ? getComputedStyle(el).pointerEvents : '';
      m.pad = el ? getComputedStyle(el.querySelector('.sb-cursor__hit')).display : '';
      const base = { bubbles: true, cancelable: true, composed: true, clientX: 10, clientY: 10, pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0 };
      if (el) el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
      if (el) el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: 300, clientY: 300, buttons: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: 300, clientY: 300, buttons: 0 }));
      window.setTimeout(() => {
        m.urged = document.querySelectorAll('.sb-cursor.is-urged').length;
        m.target = document.querySelectorAll('.sb-target').length;
        m.assign = document.querySelectorAll('.sb-assign').length;
        swarm.skip();
        resolve(m);
      }, 120);
    }, 50);
    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 4, tour: false, trigger: 'immediate',
      agents: 'fixed', agentCount: 6, adaptiveSpeed: false, performanceMode: 'high', seed: 12345,
      ...options,
    });
    swarm.start();
    window.setTimeout(() => { window.clearInterval(poll); resolve(m); }, 60000);
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // page.evaluate 只收一个参数：成组喂进去，场景自己解构。
  const on = async (measure, args) => {
    await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
    return page.evaluate(measure, args);
  };

  const main = await on(MAIN, {});
  const off = await on(INERT, [{ director: false }, 'building']);
  const gather = await on(INERT, [{ gather: true }, 'gathering']);
  await page.screenshot({ path: `${OUT}director.png` });

  const problems = [];
  if (main.built < 0) problems.push('默认那局 60 秒没跑完');
  if (main.early) problems.push(`默认那局中断：${main.early}`);
  if (!main.directing) problems.push('施工中光标没有接管指针（缺少 is-directing）');
  if (main.overlayEvents !== 'none') problems.push(`重建层不该吃指针：pointer-events=${main.overlayEvents}`);
  if (main.cursorEvents !== 'auto') problems.push(`施工中光标 pointer-events=${main.cursorEvents}（应 auto）`);
  if (main.pad !== 'block') problems.push(`光标热区 ${main.pad}（应 block）`);
  if (!main.urgedNow || !main.urgedMid) problems.push(`点一下没催工：now=${main.urgedNow} mid=${main.urgedMid}`);
  if (main.halo !== 'block') problems.push(`催工光环没出现：display=${main.halo}`);
  if (main.urgedAfter) problems.push('催工光环过了 2.5 秒还挂着');
  if (main.dragTarget !== 1) problems.push(`拖动时准星 ${main.dragTarget} 个（应 1）`);
  if (main.dragDirecting !== 1) problems.push(`拖动时抓取态 ${main.dragDirecting} 个（应 1）`);
  if (!main.assign) problems.push('松手后没有改派落点（.sb-assign）');
  else if (main.drop && (Math.abs(main.assign.x - main.drop.x) > 2 || Math.abs(main.assign.y - main.drop.y) > 2)) {
    problems.push(`改派落点 ${main.assign.x},${main.assign.y} ≠ 松手点 ${main.drop.x},${main.drop.y}`);
  }
  if (main.claimDistance < 0) problems.push(`改派后 ${main.dragCursor} 没领到活`);
  if (main.baselineCount < 0) problems.push('没读到改派那一刻的可领清单');
  else if (!main.baselineNearest) problems.push('改派那一刻没有任何可领的活');
  if (main.claim && main.baselineNearest) {
    if (!main.inBaseline) problems.push(`改派领的 ${main.claim.id} 不在可领清单里`);
    else if (main.claimDistance > main.baselineNearest.d + 2) {
      problems.push(`改派没取最近的一件：领了 ${main.claimDistance}px 的 ${main.claim.id}，最近的是 ${main.baselineNearest.d}px 的 ${main.baselineNearest.id}`);
    }
  }
  if (!main.nextStamp) problems.push(`改派后 ${main.dragCursor} 一直没再竣工`);
  if (main.boxUrged !== 0) problems.push(`点重建盒子催到了 ${main.boxUrged} 只光标`);
  if (main.pausePhase !== 'paused') problems.push(`暂停后阶段=${main.pausePhase}`);
  if (main.pauseDirecting !== 0) problems.push('暂停时还在接管指针');
  if (main.pauseEvents !== 'none') problems.push(`暂停时光标 pointer-events=${main.pauseEvents}（应 none）`);
  if (main.pauseUrged !== 0) problems.push('暂停时直接发给光标的事件仍被当成催工');
  if (!main.resumeDirecting) problems.push('继续后没有恢复接管');
  if (main.resumeEvents !== 'auto') problems.push(`继续后光标 pointer-events=${main.resumeEvents}（应 auto）`);
  for (const [name, r] of [['off', off], ['gather', gather]]) {
    if (r.early) problems.push(`${name} 那局没等到目标阶段`);
    if (r.directing !== 0) problems.push(`${name} 还在接管指针`);
    if (r.urged !== 0) problems.push(`${name} 直接事件仍催了 ${r.urged} 只`);
    if (r.target || r.assign) problems.push(`${name} 直接事件留下了准星/落点`);
  }
  if (off.events !== 'none' || gather.events !== 'none') {
    problems.push(`非施工状态 pointer-events: off=${off.events} gather=${gather.events}（应全为 none）`);
  }
  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('director @1280', problems, [
    `接管: is-directing=${main.directing} · 重建层=${main.overlayEvents} · 光标=${main.cursorEvents} · 热区=${main.pad}`,
    `催工: 按下 ${main.urgedNow}/${main.halo} · 1.3s=${main.urgedMid} · 2.7s=${main.urgedAfter}`,
    `改派: 准星=${main.dragTarget} 抓取态=${main.dragDirecting} · 落点=${main.assign ? main.assign.x + ',' + main.assign.y : '无'} → 领 ${main.claim ? main.claim.id : '无'} 距 ${main.claimDistance}px（最近 ${main.baselineNearest ? main.baselineNearest.d : '—'}px / 候选 ${main.baselineCount}）· 印章=${main.nextStamp ? '有' : '无'} · 盒子误触=${main.boxUrged}`,
    `交还: 暂停 ${main.pausePhase} 接管=${main.pauseDirecting} 事件=${main.pauseEvents} 催工=${main.pauseUrged} → 继续接管=${main.resumeDirecting}`,
    `关闭: director:false ${off.directing} 接管/${off.urged} 催工 · 聚群 ${gather.phase} ${gather.directing} 接管/${gather.urged} 催工`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 34：班组名片（创意 5）。
// 「名片」只在收工后亮：点开是面板里一张内联 PNG，每位竣过工的光标一行，
// 顶部记总件数/用时/种子。换一局就收图并重新灰掉。库内不出现下载与剪贴板（minitool 门禁）。
// ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const state = (target) => target.evaluate(() => {
    const host = document.querySelector('[data-sb-chrome]');
    const sr = host?.shadowRoot;
    const btn = sr?.querySelector('[data-card]');
    const sheet = sr?.querySelector('[data-sheet]');
    const img = sr?.querySelector('[data-sheet-img]');
    const tuner = window.__tuner;
    const scale = img?.naturalWidth ? img.naturalWidth / 960 : 0;
    return {
      phase: host?.dataset.phase ?? '',
      status: sr?.querySelector('[data-status]')?.textContent ?? '',
      disabled: btn?.disabled ?? null,
      label: (btn?.textContent ?? '').trim(),
      tip: btn?.getAttribute('data-tip') ?? '',
      sheet: sheet ? !sheet.hidden : null,
      png: !!img && img.src.startsWith('data:image/png'),
      alt: img?.alt ?? '',
      natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      closeTip: sr?.querySelector('[data-sheet-close]')?.getAttribute('data-tip') ?? '',
      crew: tuner?.result?.crew?.length ?? -1,
      // 画出来的行数：卡片高度 = 头 158 + 行×44 + 脚 64，再乘 dpr 缩放。
      rows: scale > 0 ? Math.round((img.naturalHeight / scale - 222) / 44) : -1,
    };
  });

  const waitCard = (target, timeout = 5000) => target.waitForFunction(() => {
    const img = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-sheet-img]');
    return !!img && img.naturalWidth > 0;
  }, null, { timeout }).then(() => true).catch(() => false);

  const start = async (url) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
    await setField(page, 'speed', 8);
    await page.click('[data-apply]');
  };

  const isCJK = (text) => [...String(text)].some((ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x3001 && c <= 0x303f) || (c >= 0x3400 && c <= 0x4dbf)
      || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xff01 && c <= 0xffef);
  });

  await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
  const before = await state(page);

  await setField(page, 'speed', 8);
  await page.click('[data-apply]');
  await waitDone(page, 90000);
  const enabled = await page.waitForFunction(() => {
    const btn = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-card]');
    return !!btn && !btn.disabled;
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  const done = await state(page);

  await page.click('[data-card]');
  const drew = await waitCard(page);
  const shown = await state(page);
  const paint = await page.evaluate(() => {
    const img = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-sheet-img]');
    if (!img?.naturalWidth) return 0;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0);
    const seen = new Set();
    for (let i = 0; i < 64; i++) {
      const x = Math.min(img.naturalWidth - 1, Math.floor(((i % 8) + 0.5) * img.naturalWidth / 8));
      const y = Math.min(img.naturalHeight - 1, Math.floor((Math.floor(i / 8) + 0.5) * img.naturalHeight / 8));
      const d = g.getImageData(x, y, 1, 1).data;
      seen.add(`${d[0]},${d[1]},${d[2]}`);
    }
    return seen.size;
  });
  await page.screenshot({ path: `${OUT}crew-card.png` });

  await page.click('[data-sheet-close]');
  const closed = await state(page);

  // 图还开着就重开一局：上一局的图要跟着收掉，按钮重新灰。
  // 图盖住整个面板，应用钮点不到，所以这一下直接走 tuner 的公开入口。
  await page.click('[data-card]');
  await page.waitForFunction(() => {
    const sheet = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-sheet]');
    return !!sheet && !sheet.hidden;
  }, null, { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => window.__tuner.apply());
  await page.waitForTimeout(400);
  const restarted = await state(page);

  // 英文页：按钮、提示、图注都得跟着字典走。
  await page.goto(`${BASE}/demos/tall.html?lang=en`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
  const beforeEn = await state(page);
  await setField(page, 'speed', 8);
  await page.click('[data-apply]');
  await page.waitForFunction(() => {
    const st = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-status]')?.textContent ?? '';
    return st.startsWith('Done');
  }, null, { timeout: 90000, polling: 200 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-sb-chrome]')?.shadowRoot?.querySelector('[data-card]');
    return !!btn && !btn.disabled;
  }, null, { timeout: 5000 }).catch(() => {});
  await page.click('[data-card]');
  const drewEn = await waitCard(page);
  const shownEn = await state(page);

  const problems = [];
  if (before.disabled !== true) problems.push('还没开局，名片钮就不是灰的');
  if (before.label !== '名片') problems.push(`名片钮文字「${before.label}」`);
  if (!enabled) problems.push('收工后名片钮没亮');
  if (done.crew < 1) problems.push(`收工结果里没有班组（crew=${done.crew}）`);
  if (!drew) problems.push('点名片后图没画出来（naturalWidth=0）');
  if (shown.sheet !== true) problems.push('名片图没盖在面板上');
  if (!shown.png) problems.push('名片图不是内联 PNG（data:image/png）');
  if (shown.alt !== '班组名片') problems.push(`名片图 alt「${shown.alt}」`);
  if (!(shown.natural.w > 0)) problems.push('名片图尺寸为 0');
  if (shown.rows !== done.crew) problems.push(`名片画了 ${shown.rows} 行，参建光标 ${done.crew} 位`);
  if (paint < 3) problems.push(`名片图几乎是一块纯色（采样到 ${paint} 种颜色）`);
  if (!shown.status.startsWith('班组名片已生成')) problems.push(`生成后状态行：「${shown.status}」`);
  if (closed.sheet !== false) problems.push('关闭钮没收掉名片图');
  if (restarted.sheet !== false) problems.push('新一局开始后上一张名片还盖着');
  if (restarted.disabled !== true) problems.push('新一局开始后名片钮还是亮的');

  if (beforeEn.disabled !== true) problems.push('EN 页开局前名片钮没灰');
  if (beforeEn.label !== 'Crew card') problems.push(`EN 名片钮文字「${beforeEn.label}」`);
  if (beforeEn.closeTip !== 'Close card') problems.push(`EN 关闭提示「${beforeEn.closeTip}」`);
  if (isCJK(beforeEn.tip)) problems.push(`EN 名片提示还露中文：${beforeEn.tip}`);
  if (!drewEn) problems.push('EN 页名片图没画出来');
  if (shownEn.alt !== 'Crew card') problems.push(`EN 名片图 alt「${shownEn.alt}」`);
  if (shownEn.rows !== shownEn.crew) problems.push(`EN 名片画了 ${shownEn.rows} 行，参建光标 ${shownEn.crew} 位`);
  if (!shownEn.status.startsWith('Crew card ready')) problems.push(`EN 生成后状态行：「${shownEn.status}」`);

  await page.screenshot({ path: `${OUT}crew-card-en.png` });
  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('crew-card @1280', problems, [
    `按钮: 开局前灰=${before.disabled}「${before.label}」→ 收工后亮=${!done.disabled}`,
    `出图: ${shown.png ? 'PNG' : '非 PNG'} ${shown.natural.w}×${shown.natural.h} · 行 ${shown.rows} = 参建 ${done.crew} · 采样色 ${paint} 种`,
    `收放: 关闭=${closed.sheet === false} · 新一局收图=${restarted.sheet === false} 重灰=${restarted.disabled}`,
    `EN: 「${beforeEn.label}」/「${beforeEn.closeTip}」/ alt「${shownEn.alt}」· ${shownEn.status}`,
  ]);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 场景 35：光标拖尾（接口 + 面板）。
// 每个光标身后一道同色渐隐曲线，按真实时间淡出；但画出来的路程有上限，8× 也只留一小截，
// 不会横穿整页。trailLife 0 一个节点都不建；面板里要有这一行（0–2.5 秒），英文页跟着字典走。
// ---------------------------------------------------------------------------
{
  const MEASURE = (options) => new Promise((resolve) => {
    document.querySelectorAll('.sb-overlay').forEach((el) => el.remove());
    document.querySelectorAll('.sb-hidden').forEach((el) => el.classList.remove('sb-hidden'));
    window.scrollTo(0, 0);
    const m = { built: -1, maxTails: 0, maxPts: 0, maxLen: 0, moved: 0, curved: false, boxes: 0, stroke: '', grads: 0, stops: 0, after: -1 };
    let raf = 0;
    let swarm;
    const sample = () => {
      if (swarm?.status.phase === 'building') {
        m.maxTails = Math.max(m.maxTails, document.querySelectorAll('.sb-tail').length);
        for (const svg of document.querySelectorAll('.sb-tail')) {
          const line = svg.querySelector('path');
          const d = line?.getAttribute('d') ?? '';
          // 曲线只由 M / Q / L 组成，一个绘制命令对应一个采样点。
          const pts = (d.match(/[MLQ]/g) ?? []).length;
          if (pts > m.maxPts) m.maxPts = pts;
          if (pts > 1) m.moved++;
          if (d.includes('Q')) m.curved = true;
          try { m.maxLen = Math.max(m.maxLen, Math.round(line.getTotalLength())); } catch { /* 空路径 */ }
          if (!m.stroke) m.stroke = `${getComputedStyle(line).strokeWidth}/${line.getAttribute('stroke')}`;
          if ((line?.getAttribute('stroke') ?? '').startsWith('url(#sb-tail-')) m.grads++;
          if (!m.stops) m.stops = svg.querySelectorAll('linearGradient stop').length;
          const box = svg.getBoundingClientRect();
          if (box.width > 1 && box.height > 1) m.boxes++;
        }
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    const finish = (extra) => { cancelAnimationFrame(raf); resolve({ ...m, ...extra }); };
    swarm = new window.SwarmBuilder({
      root: document.querySelector('#app'),
      sound: false, speed: 8, tour: false, trigger: 'immediate',
      gather: false, agents: 'fixed', agentCount: 8, adaptiveSpeed: false,
      performanceMode: 'high', seed: 12345, personality: false,
      ...options,
      onComplete: (r) => finish({ built: r.built, after: document.querySelectorAll('.sb-tail').length }),
    });
    swarm.start();
    setTimeout(() => finish({}), 60000);
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const load = async (url) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-sb-chrome]') !== null, null, { timeout: 20000 });
  };
  const on = async (options) => {
    await page.goto(`${BASE}/demos/tall.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.SwarmBuilder === 'function', null, { timeout: 20000 });
    return page.evaluate(MEASURE, options);
  };
  const panel = () => page.evaluate(() => {
    const sr = document.querySelector('[data-sb-chrome]')?.shadowRoot;
    const row = sr?.querySelector('[data-row-key="trailLife"]');
    const el = row?.querySelector('[data-key="trailLife"]');
    return {
      label: row?.querySelector('.k')?.textContent ?? '',
      tip: row?.dataset.tip ?? '',
      type: el?.type ?? '',
      min: el?.min ?? '', max: el?.max ?? '', step: el?.step ?? '', value: el?.value ?? '',
      row: el?.closest('.row')?.dataset.dirty ?? '',
    };
  });
  const isCJK = (text) => [...String(text)].some((ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x3001 && c <= 0x303f) || (c >= 0x3400 && c <= 0x4dbf)
      || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xff01 && c <= 0xffef);
  });

  await load(`${BASE}/demos/tall.html`);
  const zh = await panel();
  // 「待生效」是相对上一局说的：先真的跑一局，再看改这一行有没有被标出来。
  await page.click('[data-apply]');
  const dirty = await setField(page, 'trailLife', 1.8);
  const zhDirty = await panel();

  const off = await on({ trailLife: 0 });
  const short = await on({ trailLife: 0.4 });
  const longRun = page.evaluate(MEASURE, { trailLife: 2.5 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}trail.png` });
  const long = await longRun;

  await load(`${BASE}/demos/tall.html?lang=en`);
  const en = await panel();

  const problems = [];
  if (zh.label !== '光标拖尾') problems.push(`面板行名「${zh.label}」`);
  if (zh.type !== 'range' || zh.min !== '0' || zh.max !== '2.5' || zh.step !== '0.1') {
    problems.push(`面板控件 ${zh.type} ${zh.min}–${zh.max}/${zh.step}（应 range 0–2.5/0.1）`);
  }
  if (zh.value !== '0.3') problems.push(`面板默认值 ${zh.value}（应 0.3 秒）`);
  if (!zh.tip.includes('真实时间')) problems.push(`面板说明没讲按真实时间淡出：${zh.tip}`);
  if (!dirty) problems.push('改光标拖尾没有标成待生效');
  if (zhDirty.row !== 'true' || zhDirty.value !== '1.8') problems.push(`面板没接住改动：dirty=${zhDirty.row} value=${zhDirty.value}`);

  if (off.built < 0) problems.push('trailLife:0 那局 60 秒没跑完');
  if (off.maxTails !== 0 || off.after !== 0) problems.push(`trailLife:0 还建了拖尾节点：施工中 ${off.maxTails} / 收工 ${off.after}`);
  if (short.built < 0) problems.push('短拖尾那局 60 秒没跑完');
  if (short.maxTails !== 8) problems.push(`短拖尾那局只给 ${short.maxTails} 只光标建了拖尾（应 8）`);
  if (!short.moved) problems.push('短拖尾那局曲线一直是空的');
  if (!short.curved) problems.push('拖尾拐弯处还是硬折角（路径里没有二次曲线）');
  if (!short.stroke.startsWith('2.5px/url(#sb-tail-')) problems.push(`拖尾描边 ${short.stroke}（应 2.5px + 同色渐变）`);
  if (short.stops !== 3) problems.push(`渐变有 ${short.stops} 个色标（应 3：透明 → 半透明 → 本色）`);
  if (!short.grads) problems.push('曲线没有引用内联渐变');
  if (!short.boxes) problems.push('拖尾 SVG 的盒子一直是 0×0');
  if (long.built < 0) problems.push('长拖尾那局 60 秒没跑完');
  if (long.maxLen < 100) problems.push(`高速下拖尾太短，几乎看不见（${long.maxLen}px）`);
  // 画出来的路程上限是 300px；平滑曲线会略超一点，留 20% 余量。
  if (long.maxLen > 360) problems.push(`高速下拖尾仍被拉长：${long.maxLen}px（上限 300px）`);
  if (short.maxLen > 360) problems.push(`高速下短拖尾也超上限：${short.maxLen}px`);
  if (en.label !== 'Cursor trail') problems.push(`EN 面板行名「${en.label}」`);
  if (isCJK(en.tip)) problems.push(`EN 拖尾说明还露中文：${en.tip}`);

  if (errors.length) problems.push(`报错 ${errors.length} 条：${errors[0]}`);
  report('trail @1280', problems, [
    `面板: 「${zh.label}」${zh.type} ${zh.min}–${zh.max}/${zh.step} 默认 ${zh.value} · 改动待生效=${dirty} · 接住=${zhDirty.value}`,
    `节点: 关=${off.maxTails} · 开=${short.maxTails} · 描边 ${short.stroke || '—'} · 色标 ${short.stops} · 有盒 ${short.boxes} · 曲线=${short.curved}`,
    `长度: 8× 下 0.4s 峰值 ${short.maxLen}px / 2.5s ${long.maxLen}px（画出来最多 300px）· 点数 ${short.maxPts}/${long.maxPts}`,
    `EN: 「${en.label}」· 说明无中文=${!isCJK(en.tip)}`,
  ]);
  await ctx.close();
}

await browser.close();
owned?.child.kill();
console.log(`\n${failures === 0 ? '全部通过' : failures + ' 个场景有问题'} · 截图在 .shots/ · 服务 ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
