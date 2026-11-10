import { SwarmBuilder } from '../src/index';

declare global {
  interface Window {
    __hudDone: boolean;
  }
}

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('hud demo needs #app');

window.__hudDone = false;
const swarm = new SwarmBuilder({
  root: app,
  hud: true,
  autoStart: false,
  sound: false,
  tour: false,
  trigger: 'scroll',
  gather: false,
  agents: 'fixed',
  agentCount: 4,
  speed: 2,
  onComplete: () => {
    window.__hudDone = true;
  },
});
swarm.start();