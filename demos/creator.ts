import { SwarmBuilder } from '../src/index';
import type { SwarmBuilderOptions } from '../src/types';
import { tune } from '../src/tune/index';
import { mountLogo } from './boot-intro';
import type { SwarmTuner } from '../src/tune/index';

declare global {
  interface Window {
    SwarmBuilder: typeof SwarmBuilder;
    __tuner: SwarmTuner;
  }
}

// Still exposed so the acceptance harness can drive the API with no UI in the way.
window.SwarmBuilder = SwarmBuilder;

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('demo page needs #app');
mountLogo(app.querySelector<HTMLElement>('.page-home .logo-motion'));

// Each case states its own starting values on <body data-swarm>, so the page stays the
// single source and the panel opens on the numbers that case was always demoed with.
const initial = JSON.parse(document.body.dataset.swarm ?? '{}') as SwarmBuilderOptions;
// Bundled examples are static and have no lazy images. Avoid the visible
// full-page pre-scroll before the first cursor appears; fetched pages keep it.
initial.scan = 'single';

const tuner = tune({ root: app, initial, open: false, position: 'bottom-right' });
window.__tuner = tuner;

if (new URLSearchParams(location.search).has('auto')) tuner.apply();
