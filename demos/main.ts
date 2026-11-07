import { SwarmBuilder } from '../src/index';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('demo page needs #app');

const statusEl = document.querySelector<HTMLElement>('[data-status]');
const agentsEl = document.querySelector<HTMLSelectElement>('[data-agents]');
const speedEl = document.querySelector<HTMLSelectElement>('[data-speed]');
const maxEl = document.querySelector<HTMLSelectElement>('[data-max]');

let swarm: SwarmBuilder | null = null;

function say(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function replay(): void {
  swarm?.destroy();
  say('采蓝图中…');

  swarm = new SwarmBuilder({
    root: app as HTMLElement,
    agentCount: Number(agentsEl?.value ?? 6),
    speed: Number(speedEl?.value ?? 1),
    maxItems: Number(maxEl?.value ?? 400),
    onProgress: (built, total) => say(`重建中 ${built}/${total}`),
    onComplete: (result) => {
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

if (new URLSearchParams(location.search).has('auto')) replay();
