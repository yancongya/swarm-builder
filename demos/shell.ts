export {};

// 壳页：工具栏只有一份，案例内容从各演示页的 #app 里抽出来换，
// 这样每个案例的标记仍只有单一来源，验收脚本也能继续直接访问原页面。
const CASES: Record<string, string> = {
  simple: './simple.html',
  console: './console.html',
  landing: './landing.html',
  'dark-ui': './dark-ui.html',
};

const caseEl = document.querySelector<HTMLSelectElement>('[data-case]');
const appEl = document.querySelector<HTMLElement>('#app');
if (!caseEl || !appEl) throw new Error('shell page needs [data-case] and #app');

const params = new URLSearchParams(location.search);
const fromUrl = params.get('case') ?? '';
let current = CASES[fromUrl] ? fromUrl : 'simple';

async function transplant(key: string, into: HTMLElement): Promise<void> {
  const res = await fetch(CASES[key] ?? '');
  if (!res.ok) throw new Error(`${key} -> HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const src = doc.querySelector('#app');
  if (!src) throw new Error(`${key} 没有 #app`);
  into.innerHTML = src.innerHTML;
  document.body.dataset.demo = doc.body.dataset.demo ?? key;
  params.set('case', key);
  history.replaceState(null, '', `?${params}`);
}

function tap(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

// main.ts 抓住的是 #app 元素本身，之后只换它的 children，所以控制条不必重新绑定。
caseEl.value = current;
await transplant(current, appEl);
await import('./main');

caseEl.addEventListener('change', async () => {
  current = CASES[caseEl.value] ? caseEl.value : current;
  // 覆盖层挂在 #app 里面，换内容前要先让上一次运行自己清理干净。
  tap('[data-destroy]');
  try {
    await transplant(current, appEl);
  } catch (err) {
    const status = document.querySelector<HTMLElement>('[data-status]');
    if (status) status.textContent = `案例加载失败：${String(err)}`;
    return;
  }
  tap('[data-replay]');
});
