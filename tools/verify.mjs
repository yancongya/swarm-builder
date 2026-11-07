import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
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
    await page.click('[data-replay]');
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
      finished = await page.evaluate(() => document.querySelector('[data-status]').textContent.startsWith('完成'));
      if (finished) break;
      await page.waitForTimeout(120);
    }

    const done = finished
      ? await page.evaluate(() => ({
          status: document.querySelector('[data-status]').textContent,
          overlayGone: !document.querySelector('.sb-overlay'),
          originalVisible: document.querySelectorAll('.sb-hidden').length === 0,
        }))
      : { status: 'TIMEOUT' };

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
    if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);

    report(`${name} @${width}`, problems, [
      `过程: rects=${mid.rects} texts=${mid.texts} 已打字=${mid.typedChars} 徽章=${mid.badges} 拖框中=${mid.dragging} 准星=${mid.crosshair} I型=${mid.ibeam} caret=${mid.caret} 遮罩=${mid.hidden}`,
      `媒体: 槽位=${mid.media} 已呈现=${mid.mediaShown}/${expectedMedia} 降级=${mid.mediaFallback}`,
      `复制: 拖影=${mid.copies} 累计复制=${stamps}/${expectedCopies} ⌥ 徽章峰值=${mid.optionBadges}`,
      `辅助线: 累计=${guides}/${expectedGuides}`,
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
    page.evaluate(() => ({
      status: document.querySelector('[data-status]').textContent,
      items: document.querySelectorAll('.sb-item, .sb-text').length,
      cursors: [...document.querySelectorAll('.sb-cursor')].map((c) => c.style.transform).join('|'),
    }));

  // pause / resume
  await page.click('[data-replay]');
  await page.waitForTimeout(900);
  await page.click('[data-pause]');
  const frozen = await readState();
  await page.waitForTimeout(1000);
  const still = await readState();
  await page.screenshot({ path: `${OUT}controls-paused.png` });
  await page.click('[data-pause]');
  await page.waitForTimeout(700);
  const resumed = await readState();

  const problems = [];
  if (frozen.status !== '已暂停') problems.push(`暂停后状态为 ${frozen.status}`);
  if (still.cursors !== frozen.cursors || still.items !== frozen.items) problems.push('暂停后画面仍在推进');
  if (resumed.cursors === frozen.cursors && resumed.items === frozen.items) problems.push('继续后没有任何变化');

  // setSpeed mid-run
  await page.selectOption('[data-speed]', '4');
  const speedDeadline = Date.now() + 20000;
  let finishedRun = false;
  while (Date.now() < speedDeadline) {
    const s = await readState();
    if (s.status.startsWith('完成')) { finishedRun = true; break; }
    await page.waitForTimeout(150);
  }
  if (!finishedRun) problems.push('提速后未完成');

  // skip
  await page.selectOption('[data-speed]', '1');
  await page.click('[data-replay]');
  await page.waitForTimeout(700);
  const beforeSkip = await readState();
  await page.screenshot({ path: `${OUT}controls-mid.png` });
  await page.click('[data-skip]');
  await page.waitForTimeout(300);
  const afterSkip = await page.evaluate(() => ({
    status: document.querySelector('[data-status]').textContent,
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
    `暂停: ${frozen.status} → 1s 后 ${still.status}（光标位移 ${still.cursors === frozen.cursors ? '为 0' : '仍在变'}）`,
    `继续: ${resumed.status}`,
    `提速 4x 后完成: ${finishedRun}`,
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

await browser.close();
console.log(`\n${failures === 0 ? '全部通过' : failures + ' 个场景有问题'} · 截图在 .shots/`);
process.exit(failures === 0 ? 0 : 1);
