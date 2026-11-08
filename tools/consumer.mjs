// 发布前的消费端冒烟：把 tarball 装进一个独立目录，按真实消费者的入口各走一遍。
// 仓库内的验收跑的是源码，这里跑的是「装完包之后拿到的东西」。
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.consumer');
const problems = [];
const lines = [];

function quote(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// 走 shell 是因为 Windows 上 npm 是 npm.cmd，execFileSync 直接拒绝它；参数自己加引号。
function run(cmd, args, cwd) {
  try {
    return { ok: true, out: execSync([cmd, ...args].map(quote).join(' '), { cwd, encoding: 'utf8' }).trim() };
  } catch (err) {
    return { ok: false, out: `${String(err.stdout ?? '')}${String(err.stderr ?? '')}${String(err.message)}` };
  }
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
writeFileSync(join(DIR, 'package.json'), '{\n  "name": "consumer-check",\n  "private": true,\n  "type": "module"\n}\n');

const packed = run('npm', ['pack', '--pack-destination', '.consumer'], ROOT);
const tarball = packed.out.split(/\r?\n/).pop().trim();
if (!packed.ok || !tarball.endsWith('.tgz')) problems.push(`npm pack 没产出 tarball：${packed.out.slice(0, 160)}`);
const installed = run('npm', ['install', '--no-audit', '--no-fund', `./${tarball}`], DIR);
if (!installed.ok) problems.push(`安装 tarball 失败：${installed.out.slice(0, 200)}`);

const PKG = join(DIR, 'node_modules', 'swarm-builder');
const needed = [
  'dist/swarm-builder.es.js', 'dist/swarm-builder.cjs', 'dist/swarm-builder.iife.js',
  'dist/swarm-builder.tune.es.js', 'dist/swarm-builder.tune.cjs', 'dist/swarm-builder.tune.iife.js',
  'dist/types/index.d.ts', 'dist/types/tune/index.d.ts', 'LICENSE', 'README.md', 'package.json',
];
const missing = needed.filter((f) => !existsSync(join(PKG, f)));
if (missing.length) problems.push(`包里缺文件：${missing.join(', ')}`);
lines.push(`包内容: ${needed.length - missing.length}/${needed.length} 个关键文件在位`);

const esm = run('node', ['--input-type=module', '-e',
  "const m = await import('swarm-builder'); console.log(Object.keys(m).join(',') + '|' + (typeof m.SwarmBuilder));"], DIR);
if (!esm.ok || !esm.out.includes('SwarmBuilder,mount') || !esm.out.endsWith('function')) {
  problems.push(`ESM import 异常：${esm.out.slice(0, 160)}`);
}
lines.push(`ESM import: ${esm.out}`);

const cjs = run('node', ['--input-type=commonjs', '-e',
  "const m = require('swarm-builder'); console.log(Object.keys(m).join(',') + '|' + (typeof m.SwarmBuilder));"], DIR);
if (!cjs.ok || !cjs.out.includes('SwarmBuilder,mount') || !cjs.out.endsWith('function')) {
  problems.push(`CJS require 异常：${cjs.out.slice(0, 160)}`);
}
lines.push(`CJS require: ${cjs.out}`);

const tuneEsm = run('node', ['--input-type=module', '-e',
  "const m = await import('swarm-builder/tune'); console.log(Object.keys(m).sort().join(',') + '|' + (typeof m.tune));"], DIR);
if (!tuneEsm.ok || !tuneEsm.out.includes('SwarmTuner,tune') || !tuneEsm.out.endsWith('function')) {
  problems.push(`tune 子入口 ESM 异常：${tuneEsm.out.slice(0, 160)}`);
}
const tuneCjs = run('node', ['--input-type=commonjs', '-e',
  "const m = require('swarm-builder/tune'); console.log(Object.keys(m).sort().join(',') + '|' + (typeof m.tune));"], DIR);
if (!tuneCjs.ok || !tuneCjs.out.includes('SwarmTuner,tune') || !tuneCjs.out.endsWith('function')) {
  problems.push(`tune 子入口 CJS 异常：${tuneCjs.out.slice(0, 160)}`);
}
lines.push(`tune 子入口: ESM ${tuneEsm.out} · CJS ${tuneCjs.out}`);

// 声明文件要真的能约束：正例必须过，反例必须被拦。
writeFileSync(join(DIR, 'good.ts'), [
  'import { SwarmBuilder, mount } from "swarm-builder";',
  'import { tune } from "swarm-builder/tune";',
  'const sb = new SwarmBuilder({ root: document.body, agentCount: 6, targetDuration: 8, tour: true, theme: "light" });',
  'sb.start(); void mount; void tune;',
  '',
].join('\n'));
writeFileSync(join(DIR, 'bad.ts'), 'import { SwarmBuilder } from "swarm-builder";\nnew SwarmBuilder({ agentCount: "6" });\n');
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const tscArgs = [TSC, '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', '--lib', 'es2022,dom'];
const good = run(process.execPath, [...tscArgs, 'good.ts'], DIR);
if (!good.ok) problems.push(`正例类型检查没过：${good.out.slice(0, 200)}`);
const bad = run(process.execPath, [...tscArgs, 'bad.ts'], DIR);
if (bad.ok) problems.push('反例（agentCount 传字符串）没有被类型拦住，声明文件形同虚设');
lines.push(`类型: 正例 ${good.ok ? '通过' : '失败'} · 反例 ${bad.ok ? '未被拦截' : '被拦截'}`);

// 最后一关：一个普通项目的页面，从 node_modules 里 import 产物并真跑一场。
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
writeFileSync(join(DIR, 'page.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  '#target{max-width:640px;margin:40px auto;font:15px/1.6 system-ui}#target h1{font-size:32px}',
  '.box{height:60px;margin:10px 0;border:1px solid #d7deea;border-radius:10px;background:#f7f9fc}',
  '</style></head><body><div id="target"><h1>装完包之后的页面</h1><p>这一段应当被打字重建出来。</p>',
  '<div class="box"></div><div class="box"></div><ul><li>第一条</li><li>第二条</li></ul></div>',
  '<script type="module">',
  'import { SwarmBuilder } from "/node_modules/swarm-builder/dist/swarm-builder.es.js";',
  '// autoStart 默认是 true，这里关掉，让测试来决定起跑时刻。',
  'window.__sb = new SwarmBuilder({ root: document.querySelector("#target"), agentCount: 3, speed: 1, autoStart: false });',
  '</script></body></html>',
  '',
].join('\n'));

// CDN 那条路径单独一页：全局是命名空间对象，不是类本身，文档必须写对。
writeFileSync(join(DIR, 'iife.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  '#target{max-width:520px;margin:32px auto;font:15px/1.6 system-ui}.box{height:48px;margin:8px 0;border:1px solid #d7deea;background:#f7f9fc}',
  '</style></head><body><div id="target"><h2>无构建产物</h2><p>这一页只用一个 script 标签。</p><div class="box"></div></div>',
  '<script src="/node_modules/swarm-builder/dist/swarm-builder.iife.js"></script>',
  '<script>',
  'const NS = window.SwarmBuilder;',
  'window.__shape = { ns: typeof NS, cls: typeof NS?.SwarmBuilder, mount: typeof NS?.mount };',
  'if (typeof NS?.SwarmBuilder === "function") {',
  '  window.__sb2 = new NS.SwarmBuilder({ root: document.querySelector("#target"), agentCount: 2, speed: 1, autoStart: false });',
  '}',
  '</script></body></html>',
  '',
].join('\n'));

// 调参面板那一档：独立 IIFE 产物，一个 script 标签就能在任意页面上开面板。
writeFileSync(join(DIR, 'tune.html'), [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  '#target{max-width:520px;margin:32px auto;font:15px/1.6 system-ui}.box{height:48px;margin:8px 0;border:1px solid #d7deea;background:#f7f9fc}',
  '</style></head><body><div id="target"><h2>调参面板宿主</h2><p>面板应当浮在这一页上。</p><div class="box"></div></div>',
  '<script src="/node_modules/swarm-builder/dist/swarm-builder.tune.iife.js"></script>',
  '<script>',
  'const NS = window.SwarmBuilderTune;',
  'window.__tuneShape = { ns: typeof NS, tune: typeof NS?.tune, cls: typeof NS?.SwarmTuner };',
  'if (typeof NS?.tune === "function") { window.__tuner = NS.tune({ root: "#target", open: true }); }',
  '</script></body></html>',
  '',
].join('\n'));

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'page.html';
  const file = resolve(DIR, rel);
  if (!file.startsWith(DIR + sep) && file !== join(DIR, 'page.html')) {
    res.statusCode = 403;
    res.end('outside the consumer dir');
    return;
  }
  try {
    const body = await readFile(file);
    res.setHeader('content-type', MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
const errors = [];
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto(`http://127.0.0.1:${port}/page.html`, { waitUntil: 'load' });

// 起跑由测试按下，这样截图能落在运行途中，而不是等跑完才去看一个已经撤掉的覆盖层。
const ranPromise = page.evaluate(async () => {
  let items = 0, texts = 0, cursors = 0;
  window.__sb.start();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    items = Math.max(items, document.querySelectorAll('.sb-item').length);
    texts = Math.max(texts, document.querySelectorAll('.sb-text').length);
    cursors = Math.max(cursors, document.querySelectorAll('.sb-cursor').length);
    if (!document.querySelector('.sb-overlay')) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return { items, texts, cursors, overlayGone: !document.querySelector('.sb-overlay') };
});
await page.waitForTimeout(700);
await page.screenshot({ path: join(ROOT, '.shots', 'consumer-page.png') });
const ran = await ranPromise;

// script 标签那一档：全局是命名空间对象，文档若写成「全局就是类」，CDN 用户第一行就抛。
await page.goto(`http://127.0.0.1:${port}/iife.html`, { waitUntil: 'load' });
const shape = await page.evaluate(() => window.__shape);
if (shape?.ns !== 'object' || shape?.cls !== 'function' || shape?.mount !== 'function') {
  problems.push(`IIFE 全局形状和文档不符：${JSON.stringify(shape)}`);
}
const errorsBefore = errors.length;
const iife = await page.evaluate(async () => {
  if (!window.__sb2) return { built: false, items: 0, overlayGone: false };
  let items = 0;
  window.__sb2.start();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    items = Math.max(items, document.querySelectorAll('.sb-item').length);
    if (!document.querySelector('.sb-overlay')) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return { built: true, items, overlayGone: !document.querySelector('.sb-overlay') };
});
if (!iife.built || iife.items === 0 || !iife.overlayGone) problems.push(`script 标签页跑不起来：${JSON.stringify({ shape, iife })}`);
if (errors.length > errorsBefore) problems.push(`script 标签页控制台报错：${errors[errorsBefore]}`);
lines.push(`script 标签: 全局形状 ${JSON.stringify(shape)} · 途中元素=${iife.items} · 覆盖层已清除=${iife.overlayGone}`);

// 调参面板：独立产物在真实页面上开面板、跑一局、导出片段。
await page.goto(`http://127.0.0.1:${port}/tune.html`, { waitUntil: 'load' });
const tuneShape = await page.evaluate(() => window.__tuneShape);
if (tuneShape?.ns !== 'object' || tuneShape?.tune !== 'function' || tuneShape?.cls !== 'function') {
  problems.push(`tune IIFE 全局形状不对：${JSON.stringify(tuneShape)}`);
}
const tuneErrorsBefore = errors.length;
await page.click('[data-apply]');
const tuneRan = await page.evaluate(async () => {
  const host = document.querySelector('[data-sb-chrome]');
  if (!host) return { panel: false, done: false, snippet: '' };
  let items = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    items = Math.max(items, document.querySelectorAll('.sb-item').length);
    if (!document.querySelector('.sb-overlay')) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return {
    panel: true,
    items,
    done: host.shadowRoot.querySelector('[data-status]').textContent.startsWith('完成'),
    snippet: window.__tuner.snippet(),
  };
});
if (!tuneRan.panel || tuneRan.items === 0 || !tuneRan.done) problems.push(`tune 面板在消费端跑不起来：${JSON.stringify(tuneRan).slice(0, 200)}`);
if (!tuneRan.snippet.includes("document.querySelector('#target')")) problems.push('tune 导出的 root 选择器不对');
if (errors.length > tuneErrorsBefore) problems.push(`tune 页面控制台报错：${errors[tuneErrorsBefore]}`);
lines.push(`调参面板: 全局 ${JSON.stringify(tuneShape)} · 途中元素=${tuneRan.items} · 收尾=${tuneRan.done} · 导出含 root=${tuneRan.snippet.includes('#target')}`);

await browser.close();
await new Promise((done) => server.close(done));

if (!ran.overlayGone || ran.items === 0 || ran.texts === 0) problems.push(`页面里跑不起来：${JSON.stringify(ran)}`);
if (errors.length) problems.push(`浏览器控制台报错 ${errors.length} 条：${errors[0]}`);
lines.push(`真实页面: 途中峰值 元素=${ran.items} 文本=${ran.texts} 光标=${ran.cursors} · 结束覆盖层已清除=${ran.overlayGone} · 控制台报错=${errors.length}`);

console.log(`\n[consumer] ${problems.length === 0 ? 'PASS' : 'FAIL'}`);
for (const l of lines) console.log(`  ${l}`);
for (const p of problems) console.log(`  ! ${p}`);
if (problems.length === 0) rmSync(DIR, { recursive: true, force: true });
process.exit(problems.length === 0 ? 0 : 1);
