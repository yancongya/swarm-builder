/**
 * 「给 AI 的提示词」这块的两件事：一键复制，以及切到 EN 时换成英文那份。
 *
 * 提示词正文不走 lang.ts 的字典——它是一整段带编号的说明，逐节点匹配太脆。
 * 中文留在 HTML 里当源码，英文写在这里，切换时整段替换，复制走的永远是屏幕上这一段。
 */
import { getLang } from './lang';

const PROMPT_EN = `Use swarm-builder to add a "swarm of cursors rebuilds this page" entrance animation to my project. It is a zero-dependency MIT library, shipped as ESM / CJS / IIFE.

1. Install: npm i swarm-builder. Before it is published, git clone https://github.com/yancongya/swarm-builder.git, run npm install && npm run build, then npm i the local path (or the tgz from npm pack) in your project. From a CDN, load dist/swarm-builder.iife.js — the global is SwarmBuilder. In a framework, start it after the container is mounted (useEffect / onMounted); deploying is just shipping those files, there is no server side.
2. Point it at one container; leave the rest of the page alone:
   import { mount } from 'swarm-builder';
   mount({ root: document.querySelector('#app'), agentCount: 8, order: 'rows', tour: true, sound: true });
3. Want to tune while watching? Use creator mode instead (floating ball in the corner; the 29 parameters are split into six purpose tabs - scale / order / cursors / capture / sound / look - with one tab open at a time and the current values in each tab's hover note; hit "Apply & rerun" after editing):
   import { tune } from 'swarm-builder/tune';
   tune({ root: '#app', initial: { order: 'depth', balance: true } });
4. Everyday parameters: agentCount = 1-24 cursors; order = group / rows / cols / snake / depth / radial / random; balance splits the bands by estimated work instead of item count; speed is a 0.25-8 multiplier, targetDuration hands the multiplier to the estimator so the whole run fits a fixed number of seconds; seed makes a random order replayable (0 = drawn per run); maxItems caps the blueprint and anything over it is reported as dropped; ignore takes a selector and skips whole subtrees; duplicate / maxCopies control how repeated modules get stamped; guides / maxGuides control the alignment lines; grow steps a heading up to its real font size; flocking keeps cursors from clipping through each other; tour follows the construction frontier while scrolling; sound is synthesised, no audio files; theme picks the guide ink from the page it is drawn on; performanceMode trims effects automatically on dense pages.
5. These eleven switches are on by default, matching the original; turn them off to fall back to the plainer mode: flight (live orbits while idle / idle stays where it landed), pointer (follow uses the mouse as the orbit centre / ignore / repel with a 48px ring - only does anything under live), agents (auto grows with scroll velocity and claimable backlog up to 48 / fixed), gather (open with the flock gathering before work / start immediately), pick (live prices every job each frame and the closest cursor takes it / queued sticks to pre-cut queues), trigger (scroll only opens what you have scrolled past / immediate opens the whole page on frame one), adaptiveSpeed (+45% per queued item, 4x at most), scan (pre-scroll runs the page end to end first so lazy content and images arrive - the one to use when rebuilding someone else's site / single walks it once), score (generative is the 104 BPM generative score / off is clicks only), reducedMotion (skip builds nothing and hands the real page straight back / run anyway), keys (Esc ends the run, M mutes, any key or tap unlocks audio / off leaves the host's keyboard alone).
6. Do not: do not restructure my markup for the sake of the animation; this is an entrance animation, the rebuilt boxes are not interactive and the real DOM is handed back when it ends.
7. Acceptance: no console errors, document width never exceeds the viewport, and after the animation the real page still works and is still interactive.`;

function need<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`home.html is missing ${selector}`);
  return el;
}

const block = need<HTMLElement>('[data-prompt]');
const button = need<HTMLButtonElement>('[data-copy-prompt]');

const zh = block.textContent ?? '';
const labels = { idle: button.textContent ?? '', done: '已复制', fail: '复制失败' };
const labelsEn = { idle: 'Copy', done: 'Copied', fail: 'Copy failed' };

function paint(): void {
  const en = getLang() === 'en';
  block.textContent = en ? PROMPT_EN : zh;
  labels.idle = en ? 'Copy prompt' : '一键复制';
  button.textContent = labels.idle;
}
paint();

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 没有用户手势、不是安全上下文、站点权限被拒——都落到下面的兜底。
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1px;left:-1px;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

button.addEventListener('click', () => {
  const dict = getLang() === 'en' ? labelsEn : labels;
  void writeClipboard(block.textContent ?? '').then((ok) => {
    button.textContent = ok ? dict.done : dict.fail;
    button.dataset.copied = String(ok);
    setTimeout(() => {
      button.textContent = dict.idle;
      delete button.dataset.copied;
    }, 1600);
  });
});
