import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const PAGES = ['simple', 'landing', 'dark-ui', 'cdn'];
const WIDTHS = [1280, 800];
const OUT = new URL('../.shots/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

for (const width of WIDTHS) {
  for (const name of PAGES) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto(`${BASE}/demos/${name}.html`, { waitUntil: 'load' });
    await page.click('[data-replay]');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${name}-${width}-mid.png` });

    // Sample repeatedly: a badge or a drag only exists for a few frames.
    const mid = { rects: 0, texts: 0, typedChars: 0, badges: 0, dragging: 0, caret: 0, hidden: 0, crosshair: 0, ibeam: 0 };
    for (let i = 0; i < 10; i++) {
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
      await page.waitForTimeout(120);
    }

    const finished = await page
      .waitForFunction(() => document.querySelector('[data-status]').textContent.startsWith('完成'), { timeout: 30000 })
      .then(() => true)
      .catch(() => false);

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
    if (errors.length) problems.push(`控制台报错 ${errors.length} 条: ${errors[0]}`);
    if (problems.length) failures++;

    console.log(`\n[${name} @${width}] ${problems.length ? 'FAIL' : 'PASS'}`);
    console.log(`  过程: rects=${mid.rects} texts=${mid.texts} 已打字=${mid.typedChars} 徽章=${mid.badges} 拖框中=${mid.dragging} 准星=${mid.crosshair} I型=${mid.ibeam} caret=${mid.caret} 遮罩=${mid.hidden}`);
    console.log(`  结果: ${done.status}${done.overlayGone === false ? ' · overlay 未清除' : ''}${done.originalVisible === false ? ' · 原页面未恢复' : ''}`);
    for (const p of problems) console.log(`  ! ${p}`);

    await ctx.close();
  }
}

await browser.close();
console.log(`\n${failures === 0 ? '全部通过' : failures + ' 个场景有问题'} · 截图在 .shots/`);
process.exit(failures === 0 ? 0 : 1);
