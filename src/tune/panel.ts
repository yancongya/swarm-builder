import { DEFAULT_CONFIG, type PlainConfig } from './snippet';

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

interface Field {
  key: keyof PlainConfig;
  label: string;
  kind: 'range' | 'number' | 'check' | 'select' | 'text';
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
  placeholder?: string;
  /** Disabled while this predicate holds, with `why` shown as the row's tooltip. */
  offWhen?: (config: PlainConfig) => boolean;
  why?: string;
}

const FIELDS: Field[] = [
  { key: 'agentCount', label: '光标数量', kind: 'range', min: 1, max: 24, step: 1, hint: '同时施工的光标数。越多越快，画面也越吵。' },
  {
    key: 'speed', label: '速度', kind: 'range', min: 0.25, max: 8, step: 0.25,
    hint: '全局时间倍率。未设目标时长时，运行中拖动立即生效。',
    offWhen: (c) => (c.targetDuration ?? 0) > 0,
    why: '已设目标时长，倍率由估算器接管。把目标时长改回 0 才能手调速度。',
  },
  { key: 'targetDuration', label: '目标时长', kind: 'number', min: 0, max: 120, step: 1, hint: '秒。0 = 自然节奏；填了就会覆盖速度，由估算器反推倍率。' },
  { key: 'maxItems', label: '条目上限', kind: 'number', min: 1, max: 5000, step: 50, hint: '蓝图条目上限，超出的计入「丢弃」。长页面先看这个数。' },
  { key: 'duplicate', label: '复制盖章', kind: 'check', hint: '重复的兄弟节点只真做一个，其余用 Option 拖拽盖章。' },
  {
    key: 'maxCopies', label: '每组复制', kind: 'number', min: 1, max: 48, step: 1, hint: '每组重复最多盖几个。',
    offWhen: (c) => !c.duplicate, why: '「复制盖章」已关，这个数不参与施工。',
  },
  { key: 'guides', label: '辅助线', kind: 'check', hint: '画出布局本来就存在的对齐辅助线。' },
  {
    key: 'maxGuides', label: '辅助线数', kind: 'number', min: 0, max: 64, step: 1, hint: '每次运行的辅助线数量。',
    offWhen: (c) => !c.guides, why: '「辅助线」已关，这个数不参与施工。',
  },
  { key: 'grow', label: '标题步进', kind: 'check', hint: '大标题一边打字一边长到真实字号。' },
  { key: 'flocking', label: '光标避让', kind: 'check', hint: '光标在途中互相绕行。' },
  { key: 'tour', label: '镜头跟随', kind: 'check', hint: '滚动跟着施工前沿走，结束交还页首。页面比视口高时打开。' },
  { key: 'sound', label: '音效', kind: 'check', hint: '合成音效，无音频文件。浏览器要求页面已有用户手势。' },
  {
    key: 'theme', label: '施工线色', kind: 'select', hint: 'auto 按页面底色判断明暗。',
    choices: [['auto', '跟随页面'], ['light', '浅色'], ['dark', '深色']],
  },
  {
    key: 'performanceMode', label: '性能模式', kind: 'select', hint: 'auto 在容器内元素超过 250 时关掉辅助线、标题步进、音效并压低复制数。',
    choices: [['auto', '自动'], ['high', '完整'], ['low', '精简']],
  },
  { key: 'ignore', label: '跳过', kind: 'text', placeholder: '.ad, #chat-widget', hint: '逗号分隔的 CSS 选择器，命中的元素连同子树整块跳过。' },
];

const CSS = `
:host{position:fixed;z-index:2147483646;
  --card:#141821;--line:#262c38;--ink:#e8ecf3;--dim:#98a2b3;--accent:#5b9dff}
/* Outer-page rules beat :host, and inherited props flow in from the host element,
   so the type reset lives on inner nodes the page's selectors cannot reach. */
.card,.fab{font:12px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif;letter-spacing:normal;
  text-transform:none;text-align:left;color:var(--ink)}
:host([data-pos="bottom-right"]){right:16px;bottom:16px}
:host([data-pos="bottom-left"]){left:16px;bottom:16px}
:host([data-pos="top-right"]){right:16px;top:16px}
:host([data-pos="top-left"]){left:16px;top:16px}
*{box-sizing:border-box}
button{font:inherit;color:inherit;cursor:pointer}
.fab{display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:999px;
  background:var(--card);color:var(--ink);box-shadow:0 6px 20px rgba(0,0,0,.28)}
.fab:hover{border-color:var(--accent)}
.fab i{width:7px;height:7px;border-radius:50%;background:var(--accent);font-style:normal}
.card{width:298px;max-width:calc(100vw - 32px);border:1px solid var(--line);border-radius:12px;
  background:var(--card);color:var(--ink);box-shadow:0 14px 40px rgba(0,0,0,.4);overflow:hidden}
:host([data-open="false"]) .card{display:none}
:host([data-open="true"]) .fab{display:none}
header{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid var(--line)}
header b{font-size:12px;letter-spacing:.01em}
header .sub{color:var(--dim);font-size:11px}
header .sp{flex:1}
.icon{width:20px;height:20px;border:1px solid var(--line);border-radius:6px;background:transparent;
  color:var(--dim);line-height:1;padding:0}
.icon:hover{color:var(--ink);border-color:var(--accent)}
.status{margin:0;padding:7px 10px 6px;color:var(--dim);font-size:11px;
  font-variant-numeric:tabular-nums;min-height:28px}
.meter{height:2px;background:#0e1219;overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--accent);transition:width .18s linear}
:host([data-phase="idle"]) .meter i{background:var(--line)}
/* 58vh 是量出来的：15 行 × 24px 刚好在一台 800px 宽的宿主里全露出来，
   再矮就交给滚动条——所以滚动条必须看得见，不然参数等于没暴露。 */
.fields{padding:4px 10px;max-height:58vh;overflow-y:auto;border-top:1px solid var(--line);scrollbar-width:thin}
.fields::-webkit-scrollbar{width:8px}
.fields::-webkit-scrollbar-thumb{background:#2a3140;border-radius:8px}
.row{display:flex;align-items:center;gap:8px;padding:2px 0}
.row .k{flex:0 0 74px;color:var(--dim)}
.row .v{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.row:hover .k{color:var(--ink)}
.row[data-dirty="true"] .k{color:var(--accent)}
.row[data-dirty="true"] .k::after{content:"·";margin-left:3px;font-weight:700}
.row[data-off="true"]{opacity:.4}
.row[data-off="true"] .k{color:var(--dim)}
input:disabled,select:disabled{cursor:not-allowed}
input[type=range]{flex:1;min-width:0;accent-color:var(--accent);height:16px}
output{flex:0 0 34px;text-align:right;color:var(--ink);font-variant-numeric:tabular-nums}
input[type=number]{width:64px}
input[type=text]{width:100%}
input[type=number],input[type=text],select{padding:2px 5px;border:1px solid var(--line);border-radius:6px;
  background:#0e1219;color:var(--ink);font:inherit;min-width:0}
select{flex:1}
input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;margin:0}
.note{margin:0;padding:7px 10px;color:var(--dim);font-size:11px;border-top:1px solid var(--line);min-height:29px}
.note[data-pending="true"]{color:var(--accent)}
footer{display:flex;gap:6px;padding:9px 10px;border-top:1px solid var(--line);flex-wrap:wrap}
footer button{padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:#0e1219;color:var(--ink)}
footer button:hover:not(:disabled){border-color:var(--accent)}
footer button:disabled{opacity:.4;cursor:not-allowed}
footer .primary{background:var(--accent);border-color:var(--accent);color:#08111f;font-weight:600;flex:1}
footer .primary:hover{filter:brightness(1.08)}
.util{display:flex;gap:6px;padding:0 10px 9px}
.util button{flex:1;padding:4px 6px;border:1px solid var(--line);border-radius:7px;background:transparent;
  color:var(--dim);font-size:11px}
.util button:hover{color:var(--ink);border-color:var(--accent)}
.code{display:block;width:calc(100% - 20px);margin:0 10px 10px;height:132px;resize:vertical;
  padding:7px;border:1px solid var(--line);border-radius:7px;background:#0e1219;color:#c9d4e3;
  font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}
.code[hidden]{display:none}
`;

export type Phase = 'idle' | 'running' | 'paused' | 'done';

export interface PanelHandlers {
  onChange(config: PlainConfig): void;
  onApply(): void;
  onPause(): void;
  onSkip(): void;
  onCopy(): void;
  onReset(): void;
  onRestore(): void;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.join(',') === b.join(',');
  return a === b;
}

export class Panel {
  readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private readonly rows = new Map<string, HTMLElement>();
  private readonly status: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly code: HTMLTextAreaElement;
  private config: PlainConfig;
  private applied: PlainConfig | null = null;
  private phase: Phase = 'idle';
  private shown = '待触发';

  constructor(config: PlainConfig, handlers: PanelHandlers, position: Corner, expanded: boolean) {
    this.host = document.createElement('div');
    // Chrome marker: the overlay must not hide it, and the snapshot must not rebuild it.
    this.host.setAttribute('data-sb-chrome', '');
    this.host.dataset.pos = position;
    this.host.dataset.open = String(expanded);
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    const fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.title = '展开 swarm-builder 调参面板';
    fab.innerHTML = '<i></i>调参';
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = [
      '<header><b>Swarm Builder</b><span class="sub">创造者模式</span><span class="sp"></span>',
      '<button class="icon" type="button" data-info title="蓝图在开始那一刻冻结，所以除「速度」外都要下一局才生效；待生效的项会用蓝色标出。导出的片段只含与默认值不同的选项，可直接粘进代码或交给 agent。">i</button>',
      '<button class="icon" type="button" data-fold title="收起">×</button></header>',
      '<p class="status" data-status>待触发</p>',
      '<div class="meter"><i data-meter></i></div>',
      '<div class="fields" data-fields></div>',
      '<p class="note" data-note></p>',
      '<footer><button class="primary" type="button" data-apply>应用并重跑</button>',
      '<button type="button" data-pause disabled>暂停</button>',
      '<button type="button" data-skip disabled title="立刻结束并交还真实页面">跳过</button></footer>',
      '<div class="util"><button type="button" data-copy title="复制成可粘贴的代码片段">复制配置</button>',
      '<button type="button" data-reset title="全部退回库默认值">重置</button>',
      '<button type="button" data-restore title="停掉施工，把页面原样交还">恢复原状</button></div>',
      '<textarea class="code" data-code readonly hidden spellcheck="false"></textarea>',
    ].join('');
    this.shadow.append(style, fab, card);

    const fields = card.querySelector<HTMLElement>('[data-fields]') as HTMLElement;
    for (const field of FIELDS) fields.append(this.row(field, config, handlers));

    this.status = card.querySelector<HTMLElement>('[data-status]') as HTMLElement;
    this.pauseBtn = card.querySelector<HTMLButtonElement>('[data-pause]') as HTMLButtonElement;
    this.skipBtn = card.querySelector<HTMLButtonElement>('[data-skip]') as HTMLButtonElement;
    this.applyBtn = card.querySelector<HTMLButtonElement>('[data-apply]') as HTMLButtonElement;
    this.note = card.querySelector<HTMLElement>('[data-note]') as HTMLElement;
    this.meter = card.querySelector<HTMLElement>('[data-meter]') as HTMLElement;
    this.code = card.querySelector<HTMLTextAreaElement>('[data-code]') as HTMLTextAreaElement;

    fab.addEventListener('click', () => this.setExpanded(true));
    card.querySelector<HTMLButtonElement>('[data-fold]')?.addEventListener('click', () => this.setExpanded(false));
    this.applyBtn.addEventListener('click', handlers.onApply);
    this.pauseBtn.addEventListener('click', handlers.onPause);
    this.skipBtn.addEventListener('click', handlers.onSkip);
    card.querySelector<HTMLButtonElement>('[data-copy]')?.addEventListener('click', handlers.onCopy);
    card.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener('click', handlers.onReset);
    card.querySelector<HTMLButtonElement>('[data-restore]')?.addEventListener('click', handlers.onRestore);
    this.config = config;
    this.host.dataset.phase = 'idle';
    this.sync();
  }

  private row(field: Field, config: PlainConfig, handlers: PanelHandlers): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row';
    row.title = field.hint;
    const key = document.createElement('span');
    key.className = 'k';
    key.textContent = field.label;
    const box = document.createElement('span');
    box.className = 'v';
    const value = config[field.key] ?? DEFAULT_CONFIG[field.key];

    let control: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select') {
      const select = document.createElement('select');
      for (const [val, text] of field.choices ?? []) {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = text;
        select.append(option);
      }
      select.value = String(value);
      control = select;
    } else {
      const input = document.createElement('input');
      if (field.kind === 'check') {
        input.type = 'checkbox';
        input.checked = Boolean(value);
      } else if (field.kind === 'text') {
        input.type = 'text';
        input.value = Array.isArray(value) ? value.join(', ') : '';
        input.placeholder = field.placeholder ?? '';
      } else {
        input.type = field.kind;
        input.min = String(field.min ?? 0);
        input.max = String(field.max ?? 100);
        input.step = String(field.step ?? 1);
        input.value = String(value);
      }
      control = input;
    }
    control.setAttribute('data-key', field.key);
    box.append(control);

    let out: HTMLOutputElement | null = null;
    if (field.kind === 'range') {
      out = document.createElement('output');
      out.textContent = String(value);
      box.append(out);
    }
    control.addEventListener('input', () => {
      if (out) out.textContent = (control as HTMLInputElement).value;
      this.config = this.readConfig();
      handlers.onChange(this.config);
      this.sync();
    });
    this.controls.set(field.key, control);
    this.rows.set(field.key, row);
    row.append(key, box);
    return row;
  }

  readConfig(): PlainConfig {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      if (field.kind === 'check') {
        out[field.key] = (control as HTMLInputElement).checked;
      } else if (field.kind === 'select') {
        out[field.key] = control.value;
      } else if (field.kind === 'text') {
        out[field.key] = control.value.split(',').map((part) => part.trim()).filter(Boolean);
      } else {
        const raw = Number(control.value);
        const min = field.min ?? 0;
        const max = field.max ?? Number.MAX_SAFE_INTEGER;
        out[field.key] = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : DEFAULT_CONFIG[field.key];
      }
    }
    return out as PlainConfig;
  }

  setExpanded(open: boolean): void {
    this.host.dataset.open = String(open);
  }

  get expanded(): boolean {
    return this.host.dataset.open === 'true';
  }

  /** Re-points the dependency greys and the 「待生效」 marks; runs after every edit and every apply. */
  private sync(): void {
    let dirty = 0;
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      const row = this.rows.get(field.key);
      if (!control || !row) continue;
      const off = field.offWhen?.(this.config) ?? false;
      control.disabled = off;
      row.dataset.off = String(off);
      row.title = off && field.why ? `${field.hint}（${field.why}）` : field.hint;
      const changed = this.applied !== null && !same(this.config[field.key], this.applied[field.key]);
      row.dataset.dirty = String(changed);
      if (changed) dirty++;
    }
    this.note.dataset.pending = String(dirty > 0);
    this.note.textContent = dirty > 0
      ? `${dirty} 项待生效 · 点「应用并重跑」`
      : (this.applied ? '已与正在跑的这一局一致' : '改完点「应用并重跑」；未设目标时长时「速度」可运行中改');
  }

  /** A run is starting with these values, so 「待生效」 now measures against them. */
  markApplied(config: PlainConfig): void {
    this.applied = { ...config };
    this.sync();
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    this.host.dataset.phase = phase;
    const live = phase === 'running' || phase === 'paused';
    this.pauseBtn.disabled = !live;
    this.skipBtn.disabled = !live;
    this.pauseBtn.textContent = phase === 'paused' ? '继续' : '暂停';
    if (phase === 'done') this.meter.style.width = '100%';
    if (phase === 'idle') this.meter.style.width = '0';
  }

  setProgress(built: number, total: number): void {
    this.meter.style.width = total > 0 ? `${Math.min(100, (built / total) * 100).toFixed(1)}%` : '0';
  }

  /** Writes a whole config back into the controls, for 「重置」. */
  setConfig(config: PlainConfig): void {
    this.config = config;
    for (const field of FIELDS) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      const value = config[field.key] ?? DEFAULT_CONFIG[field.key];
      if (field.kind === 'check') {
        (control as HTMLInputElement).checked = Boolean(value);
      } else if (field.kind === 'text') {
        control.value = Array.isArray(value) ? value.join(', ') : '';
      } else {
        control.value = String(value);
        const out = this.rows.get(field.key)?.querySelector('output');
        if (out) out.textContent = String(value);
      }
    }
    this.sync();
  }

  setStatus(text: string): void {
    this.shown = text;
    this.status.textContent = text;
  }

  get statusText(): string {
    return this.shown;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  showSnippet(code: string): void {
    this.code.hidden = false;
    this.code.value = code;
  }

  selectSnippet(): void {
    this.code.focus();
    this.code.select();
  }

  destroy(): void {
    this.host.remove();
  }
}