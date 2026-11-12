/**
 * 「给 AI 的提示词」这块的两件事：一键复制，以及切到 EN 时换成英文那份。
 *
 * 提示词正文不走 lang.ts 的字典——它是一整段带编号的说明，逐节点匹配太脆。
 * 中文留在 HTML 里当源码，英文写在这里，切换时整段替换，复制走的永远是屏幕上这一段。
 */
import { getLang } from './lang';

const PROMPT_EN = `Add a Swarm Builder entrance animation to my project. Perform these steps, not just describe them.

1. Clone and build the source. The package is not on npm yet and dist is not committed. Do not use npm i swarm-builder or npm i github:yancongya/swarm-builder:
   git clone https://github.com/yancongya/swarm-builder.git
   cd swarm-builder
   npm install
   npm run build
2. Return to my project directory and install the locally built repository:
   npm i ../swarm-builder
   If the directories are not siblings, use the actual path to the swarm-builder repository. Alternatively, run npm pack in that repository and install the generated swarm-builder-0.1.0.tgz in my project.
3. After my target container mounts, integrate it:
   import { mount } from 'swarm-builder';
   mount({ root: document.querySelector('#app'), agentCount: 8, order: 'rows', tour: true });
   Replace #app with my real container. Use useEffect in React or onMounted in Vue.
4. Preserve the page structure and business logic. This is an entrance animation; temporary construction boxes are not interactive and the real DOM must be returned at the end. Check mobile viewports for horizontal overflow and verify the original interactions still work.`;

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
