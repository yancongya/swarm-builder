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
    snapped: bp.items.filter((i) => i.snapFrom).map((i) => `${i.id} dx=${Math.round(i.snapFrom)} @${i.x},${i.y} ${i.text?.slice(0, 12)}`),
    growing: bp.items.filter((i) => i.grow).length,
    guides: bp.items.filter((i) => i.kind === 'guide').map((i) => `${i.guide?.axis}=${i.guide?.pos} span ${Math.round(i.guide?.from)}..${Math.round(i.guide?.to)}`),
    masters: bp.items.filter((i) => i.dup && !i.consumed).length,    nested: bp.items.filter((i) => i.dup && i.consumed).length,
    consumed: bp.items.filter((i) => i.consumed).length,
    dups: bp.items
      .filter((i) => i.dup)
      .map((i) => `root=${i.dup.master} from ${i.dup.from.x},${i.dup.from.y} -> ${i.dup.to.x},${i.dup.to.y} items=${i.dup.items.length}`),
    media: bp.items
      .filter((i) => i.kind === 'media')
      .map((i) => `${i.media?.mode} @${i.x},${i.y} ${i.width}x${i.height}`),
    items: bp.items.map((i) => `${i.id} k=${i.kind} g=${i.group} d=${i.depth} @${i.x},${i.y} ${i.width}x${i.height} b=${i.blockers.join('|')}`),
  };
}, ROOTS[page]);

console.log(`${report.root} ${report.size} total=${report.total} dropped=${report.dropped} backdrop=${report.backdrop} groups=${report.groups}`);
console.log('kinds', JSON.stringify(report.byKind));
console.log(`duplicates: stamped=${report.masters} nestedInsideCopies=${report.nested} consumed=${report.consumed}`);
console.log(`guides=${report.guides.length} growing=${report.growing} snapped=${report.snapped.length}`);
if (report.guides.length) console.log(' lines', JSON.stringify(report.guides));
if (report.snapped.length) console.log(' snaps', JSON.stringify(report.snapped));
if (report.dups.length) console.log(report.dups.join('\n'));
console.log('media', JSON.stringify(report.media, null, 1));
if (process.argv[3] === '--items') console.log(report.items.join('\n'));
await browser.close();
