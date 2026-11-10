import { SwarmBuilder } from '../src/index';
import type { SwarmResult } from '../src/types';

declare global {
  interface Window {
    __shadowDone: boolean;
    __shadowScrollMax: number;
    __shadowWinY: number;
    __shadowResult: SwarmResult | null;
  }
}

const host = document.querySelector<HTMLElement>('#host');
const mountEl = document.querySelector<HTMLElement>('#mount');
if (!host || !mountEl) throw new Error('shadow demo needs #host / #mount');

const cards = Array.from({ length: 10 }, (_, i) => `
  <div class="card">
    <h3>块 ${i + 1}</h3>
    <p>滚动层在 shadow 外，样式走 styleRoot，前沿量实际可见矩形。</p>
    <div class="swatch" style="background:hsl(${i * 36} 45% 82%)"></div>
  </div>`).join('');

const sr = mountEl.attachShadow({ mode: 'open' });
sr.innerHTML = `
  <style>
    #app { padding: 24px; font: 14px/1.6 system-ui, sans-serif; color: #222; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .card { box-sizing: border-box; height: 240px; margin: 16px 0; padding: 16px;
      background: #fff; border: 1px solid #ddd; border-radius: 8px; }
    .card h3 { margin: 0 0 8px; }
    .card p { margin: 0 0 12px; }
    .swatch { height: 110px; border-radius: 6px; }
  </style>
  <div id="app">
    <h1>shadow 宿主基准</h1>
    <p>表头与滚动层在光 DOM，案例在 shadow：三个环境假设都要跨边界成立。</p>
    ${cards}
  </div>`;

const app = sr.querySelector<HTMLElement>('#app');
if (!app) throw new Error('shadow demo needs #app in shadow');

window.__shadowDone = false;
window.__shadowScrollMax = 0;
window.__shadowWinY = 0;
window.__shadowResult = null;
host.addEventListener('scroll', () => {
  window.__shadowScrollMax = Math.max(window.__shadowScrollMax, host.scrollTop);
}, { passive: true });
window.addEventListener('scroll', () => {
  window.__shadowWinY = Math.max(window.__shadowWinY, window.scrollY);
}, { passive: true });

const swarm = new SwarmBuilder({
  root: app,
  styleRoot: sr,
  autoStart: false,
  sound: false,
  theme: 'light',
  tour: true,
  trigger: 'scroll',
  gather: false,
  agents: 'fixed',
  agentCount: 4,
  speed: 2,
  seed: 7,
  onComplete: (result) => {
    window.__shadowResult = result;
    window.__shadowDone = true;
  },
});
swarm.start();