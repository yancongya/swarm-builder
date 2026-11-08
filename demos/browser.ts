import type { SwarmTuner } from '../src/tune/index';

interface Case {
  key: string;
  title: string;
  href: string;
  /** The address the mockup shows, so a case reads like a site rather than a file. */
  origin: string;
}

const CASES: Case[] = [
  { key: 'simple', title: '简单页基准', href: './simple.html', origin: 'https://swarm.demo' },
  { key: 'console', title: '密集控制台', href: './console.html', origin: 'https://orbit.demo/console' },
  { key: 'landing', title: '深色落地页', href: './landing.html', origin: 'https://nova.demo' },
  { key: 'dark-ui', title: '复杂工作台', href: './dark-ui.html', origin: 'https://studio.demo' },
];

function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`mockup browser shell is missing ${selector}`);
  return el;
}

const tabsEl = need<HTMLElement>('[data-tabs]');
const frame = need<HTMLIFrameElement>('[data-frame]');
const addrEl = need<HTMLElement>('[data-addr]');
const urlEl = need<HTMLElement>('[data-url]');
const hintEl = need<HTMLElement>('[data-hint]');
const metaEl = need<HTMLElement>('[data-meta]');
const barEl = need<HTMLElement>('[data-statusbar]');
const creatorBtn = need<HTMLButtonElement>('[data-creator]');
const backBtn = need<HTMLButtonElement>('[data-back]');
const fwdBtn = need<HTMLButtonElement>('[data-fwd]');
const reloadBtn = need<HTMLButtonElement>('[data-reload]');

const params = new URLSearchParams(location.search);
const fromUrl = params.get('case') ?? '';
const stack: string[] = [CASES.some((c) => c.key === fromUrl) ? fromUrl : 'simple'];
let cursor = 0;
let generation = 0;
let tuner: SwarmTuner | null = null;
let creatorOn = true;

function caseOf(key: string): Case {
  const found = CASES.find((c) => c.key === key);
  if (!found) throw new Error(`unknown case ${key}`);
  return found;
}

function current(): string {
  return stack[cursor] as string;
}

function paintChrome(): void {
  const active = current();
  for (const tab of tabsEl.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.key === active));
  }
  urlEl.textContent = caseOf(active).origin;
  params.set('case', active);
  history.replaceState(null, '', `?${params}`);
  backBtn.disabled = cursor === 0;
  fwdBtn.disabled = cursor >= stack.length - 1;
}

for (const item of CASES) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tab';
  tab.dataset.key = item.key;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  const dot = document.createElement('span');
  dot.className = 'fav';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('b');
  label.textContent = item.title;
  tab.append(dot, label);
  tab.addEventListener('click', () => go(item.key));
  tabsEl.append(tab);
}

// The case page creates its own tuner from a module script, which lands after load.
function waitForTuner(limitMs: number): Promise<SwarmTuner | null> {
  const mine = generation;
  return new Promise((resolve) => {
    let waited = 0;
    const poll = () => {
      const win = frame.contentWindow as (Window & { __tuner?: SwarmTuner }) | null;
      if (win?.__tuner) resolve(win.__tuner);
      else if (mine !== generation || waited > limitMs) resolve(null);
      else {
        waited += 40;
        setTimeout(poll, 40);
      }
    };
    poll();
  });
}

async function load(): Promise<void> {
  const mine = ++generation;
  tuner = null;
  addrEl.dataset.loading = 'true';
  barEl.dataset.phase = 'idle';
  hintEl.textContent = '载入中…';
  metaEl.textContent = '';

  const settled = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  frame.src = caseOf(current()).href;
  await settled;

  const found = await waitForTuner(8000);
  if (mine !== generation) return;
  addrEl.dataset.loading = 'false';
  if (!found) {
    hintEl.textContent = '这一页没有装上创造者模式';
    return;
  }

  tuner = found;
  if (creatorOn) tuner.open();
  else tuner.close();
  tuner.apply();
}

function go(key: string): void {
  if (key === current()) {
    void load();
    return;
  }
  stack.splice(cursor + 1, stack.length, key);
  cursor = stack.length - 1;
  paintChrome();
  void load();
}

backBtn.addEventListener('click', () => {
  if (cursor === 0) return;
  cursor -= 1;
  paintChrome();
  void load();
});
fwdBtn.addEventListener('click', () => {
  if (cursor >= stack.length - 1) return;
  cursor += 1;
  paintChrome();
  void load();
});
reloadBtn.addEventListener('click', () => void load());

creatorBtn.addEventListener('click', () => {
  creatorOn = !creatorOn;
  creatorBtn.setAttribute('aria-pressed', String(creatorOn));
  if (!tuner) return;
  if (creatorOn) tuner.open();
  else tuner.close();
});

// Mirror the panel into the window chrome, the way a browser reflects its page.
setInterval(() => {
  if (!tuner) return;
  barEl.dataset.phase = tuner.phase;
  hintEl.textContent = `${caseOf(current()).title} · ${tuner.status}`;
  const items = frame.contentDocument?.querySelectorAll('.sb-item').length ?? 0;
  metaEl.textContent = items > 0 ? `${items} 个盒子在画` : '';
}, 200);

declare global {
  interface Window {
    __browser: { cases: string[]; current(): string; tuner(): SwarmTuner | null; go(key: string): void };
  }
}
window.__browser = { cases: CASES.map((c) => c.key), current, tuner: () => tuner, go };

paintChrome();
void load();
