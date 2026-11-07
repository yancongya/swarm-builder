import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const page = process.argv[2] ?? 'landing';
const ROOTS = { simple: '.page-simple', landing: '.page-landing', 'dark-ui': '.page-blender' };

const CONFIGS = [
  { label: 'no dup / no guides', guides: false, duplicate: false },
  { label: 'dup only', guides: false, duplicate: true },
  { label: 'dup + guides', guides: true, duplicate: true },
];

const browser = await chromium.launch();
for (const cfg of CONFIGS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/demos/${page}.html`, { waitUntil: 'load' });
  await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));
  const r = await p.evaluate(async ({ root, guides, duplicate }) => {
    const { SwarmBuilder } = await import('/src/index.ts');
    const t0 = performance.now();
    const res = await new Promise((resolve) => {
      new SwarmBuilder({ root: document.querySelector(root), guides, duplicate, onComplete: resolve }).start();
    });
    return { secs: (performance.now() - t0) / 1000, built: res.built };
  }, { root: ROOTS[page], guides: cfg.guides, duplicate: cfg.duplicate });
  console.log(`${cfg.label.padEnd(22)} -> ${r.secs.toFixed(1)}s · ${r.built} 项`);
  await ctx.close();
}
await browser.close();
