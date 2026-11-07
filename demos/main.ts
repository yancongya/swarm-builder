import { SwarmBuilder } from '../src/index';

declare global {
  interface Window {
    SwarmBuilder: typeof SwarmBuilder;
  }
}

// Exposed so the acceptance harness can drive the API without the toolbar.
window.SwarmBuilder = SwarmBuilder;

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('demo page needs #app');

const statusEl = document.querySelector<HTMLElement>('[data-status]');
const agentsEl = document.querySelector<HTMLSelectElement>('[data-agents]');
const speedEl = document.querySelector<HTMLSelectElement>('[data-speed]');
const maxEl = document.querySelector<HTMLSelectElement>('[data-max]');

let swarm: SwarmBuilder | null = null;
let paused = false;

function say(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function setPauseLabel(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-pause]');
  if (btn) btn.textContent = paused ? '继续' : '暂停';
}

function replay(): void {
  swarm?.destroy();
  paused = false;
  setPauseLabel();
  say('采蓝图中…');

  swarm = new SwarmBuilder({
    root: app as HTMLElement,
    agentCount: Number(agentsEl?.value ?? 6),
    speed: Number(speedEl?.value ?? 1),
    maxItems: Number(maxEl?.value ?? 400),
    onProgress: (built, total) => say(`重建中 ${built}/${total}`),
    onComplete: (result) => {
      paused = false;
      setPauseLabel();
      const dropped = result.dropped > 0 ? ` · 超限丢弃 ${result.dropped}` : '';
      say(`完成 ${result.built} 项 · ${(result.durationMs / 1000).toFixed(1)}s${dropped}`);
    },
  });
  swarm.start();
}

document.querySelector('[data-replay]')?.addEventListener('click', replay);
document.querySelector('[data-destroy]')?.addEventListener('click', () => {
  swarm?.destroy();
  say('已销毁，页面恢复原状');
});
document.querySelector('[data-pause]')?.addEventListener('click', () => {
  if (!swarm) return;
  paused = !paused;
  if (paused) swarm.pause();
  else swarm.resume();
  setPauseLabel();
  say(paused ? '已暂停' : '已继续');
});
document.querySelector('[data-skip]')?.addEventListener('click', () => swarm?.skip());

// Changing speed mid-run is allowed: the whole run is one scaled clock.
speedEl?.addEventListener('change', () => {
  if (speedEl.value) swarm?.setSpeed(Number(speedEl.value));
});

if (new URLSearchParams(location.search).has('auto')) replay();
