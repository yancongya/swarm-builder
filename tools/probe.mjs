import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const page = process.argv[2] ?? 'landing';
const ROOTS = {
  simple: '.page-simple',
  landing: '.page-landing',
  'dark-ui': '.page-blender',
  cdn: '.page-cdn',
};

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(`${BASE}/demos/${page}.html`, { waitUntil: 'load' });
await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => null))));

const report = await p.evaluate(async (selector) => {
  const { snapshot } = await import('/src/core/snapshot.ts');
  const { normalizeOptions } = await import('/src/core/config.ts');
  const root = document.querySelector(selector) ?? document.body;
  const bp = snapshot(root, normalizeOptions({}));
  const byKind = {};
  for (const item of bp.items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  return {
    root: root.className,
    size: [Math.round(bp.width), Math.round(bp.height)],
    total: bp.items.length,
    dropped: bp.dropped,
    backdrop: !!bp.backdrop,
    byKind,
    groups: new Set(bp.items.map((i) => i.group)).size,
    media: bp.items
      .filter((i) => i.kind === 'media')
      .map((i) => `${i.media?.mode} @${i.x},${i.y} ${i.width}x${i.height}`),
    items: bp.items.map((i) => `${i.id} k=${i.kind} g=${i.group} d=${i.depth} @${i.x},${i.y} ${i.width}x${i.height} b=${i.blockers.join('|')}`),
  };
}, ROOTS[page]);

console.log(`${report.root} ${report.size} total=${report.total} dropped=${report.dropped} backdrop=${report.backdrop} groups=${report.groups}`);
console.log('kinds', JSON.stringify(report.byKind));
console.log('media', JSON.stringify(report.media, null, 1));
if (process.argv[3] === '--items') console.log(report.items.join('\n'));
await browser.close();
