/**
 * 构建期 CSS 兼容层生成器（只被 vite.config 引用，不进产物）。
 *
 * 输入 demos 的原始 CSS，输出三段式：
 *   1. baseline 块 —— Chrome 61 可用的回退声明：
 *        · 值级回退（clamp 取 min、dvh→vh、min()→width+max-width、inset→物理属性）
 *          挂原选择器，前置让「新值在后」的层叠规则成立；
 *        · flex gap → 子项 margin，挂 `<sel> > * + *`，无条件生效。
 *   2. 原规则 —— 只做「处处等价」的重写（:is 展开、grid gap→grid-gap 别名）；
 *      gap 声明留在原规则里，现代内核直接生效。
 *   3. enhancement 块 —— `.supports-flex-gap`（外壳）/ `:host(.supports-flex-gap)`（shadow）
 *      下把 margin 基线清零；类由包内经典脚本实测 Flex 布局后加，不靠语法检测。
 *
 * 归类不确定（规则里没有 display、也查不到）时构建失败并列出选择器——
 * 猜错的代价不对称：grid 被当 flex 会给单元格加 margin，现代内核也一起坏。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CssMode = 'shell' | 'shadow';

export interface FixOptions {
  /** 报错信息里带上来源文件名。 */
  sourceName?: string;
  /** 人工归类表：selector 分支文本 → 'flex' | 'grid'（自动归类失败时兜底）。 */
  known?: Record<string, 'flex' | 'grid'> | undefined;
}

export interface Fixed {
  css: string;
  /** 构建日志：丢失的 gap、人工归类命中等。 */
  notes: string[];
}

interface Decl {
  name: string;
  value: string;
  raw: string;
}

interface Rule {
  type: 'rule';
  selector: string;
  decls: Decl[];
}

interface AtBlock {
  type: 'at';
  /** `@media (max-width: 760px)`，不含花括号。 */
  header: string;
  body: Node[];
}

/** 不解析内部结构的 at-rule（@keyframes / @font-face 等）：整段原样透传。 */
interface RawAt {
  type: 'raw';
  header: string;
  /** 花括号内的原文。 */
  body: string;
}

type Node = Rule | AtBlock | RawAt;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(HERE, '..', '..', 'demos');

/* ------------------------------------------------------------------ 解析 */

/** 按顶层花括号切出 @ 块与规则；跳过注释与字符串。@media 递归，其余 @ 块透传。 */
function parseBlocks(css: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (/\s/.test(css[i] as string)) {
      i++;
      continue;
    }
    let depth = 0;
    const start = i;
    let blockStart = -1;
    let inStr: string | null = null;
    while (i < n) {
      const ch = css[i] as string;
      if (inStr) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === inStr) inStr = null;
        i++;
        continue;
      }
      if (css.startsWith('/*', i)) {
        const end = css.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        i++;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) blockStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    if (blockStart === -1) {
      const rest = css.slice(start).trim();
      if (rest) throw new Error(`cssfix: 无法解析的顶层内容：${rest.slice(0, 80)}`);
      break;
    }
    const header = css.slice(start, blockStart).trim();
    const body = css.slice(blockStart + 1, i);
    i++; // 跳过 '}'
    if (header.startsWith('@')) {
      if (header.startsWith('@media')) {
        nodes.push({ type: 'at', header, body: parseBlocks(body) });
      } else {
        // @keyframes / @font-face 等：内部不是常规规则，整段透传不做改写。
        nodes.push({ type: 'raw', header, body });
      }
    } else {
      nodes.push(parseRule(header, body));
    }
  }
  return nodes;
}

function parseRule(selector: string, body: string): Rule {
  // 注释先剥：中文注释里出现 ASCII 分号会打断声明切分。
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls: Decl[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let buf = '';
  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (!text) return;
    const colon = text.indexOf(':');
    if (colon === -1) throw new Error(`cssfix: 声明缺冒号：${text.slice(0, 80)} @ ${selector.slice(0, 60)}`);
    decls.push({ name: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim(), raw: text.replace(/\s+/g, ' ') });
  };
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i] as string;
    if (inStr) {
      buf += ch;
      if (ch === '\\' && i + 1 < clean.length) {
        buf += clean[i + 1];
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return { type: 'rule', selector: normalizeSelector(selector), decls };
}

function normalizeSelector(sel: string): string {
  return sel.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

/* ------------------------------------------------------- 选择器工具 */

/** 按顶层逗号（跳过括号/字符串）拆分支。 */
function splitTop(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let buf = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i] as string;
    if (inStr) {
      buf += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** shadow 模式下把文档级选择器映射进 shadow：:root / html / body → :host。 */
function remapShadowSelector(sel: string): string {
  return splitTop(sel)
    .map((branch) => {
      if (branch === ':root' || branch === 'html' || branch === 'body') return ':host';
      const m = /^(body|html)(\s+)/.exec(branch);
      if (m) {
        const word = m[1] ?? '';
        const gap = m[2] ?? '';
        return `:host${gap}${branch.slice(word.length)}`;
      }
      return branch;
    })
    .join(', ');
}

/** 选择器每支都加上同一前缀（增强层要逐支生效）。 */
function prefixSelector(sel: string, prefix: string): string {
  return splitTop(sel)
    .map((branch) => `${prefix} ${branch}`)
    .join(', ');
}

/** 展开选择器里的 :is(a, b)（笛卡尔积）；嵌套 :is 报错交人工。 */
function expandIs(sel: string): string {
  if (!sel.includes(':is(')) return sel;
  return splitTop(sel).map(expandIsBranch).join(', ');
}

function expandIsBranch(branch: string): string {
  const at = branch.indexOf(':is(');
  if (at === -1) return branch;
  let depth = 0;
  let end = -1;
  for (let i = at + 4; i < branch.length; i++) {
    const ch = branch[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  if (end === -1) throw new Error(`cssfix: :is() 括号不配对：${branch}`);
  const inner = branch.slice(at + 4, end);
  if (inner.includes(':is(')) throw new Error(`cssfix: 嵌套 :is() 需人工处理：${branch}`);
  const before = branch.slice(0, at);
  const after = branch.slice(end + 1);
  return splitTop(inner)
    .map((one) => expandIsBranch(`${before}${one}${after}`))
    .join(', ');
}

/* ------------------------------------------------------------ 值工具 */

/**
 * 把值里每一段 `clamp(MIN, IDEAL, MAX)` 替换为 MIN，得到 Chrome 61 的基线值。
 * 复合值（`0 clamp(...) 44px`）按段替换；参数含嵌套函数时报错交人工。
 */
function stripClamp(value: string): string {
  let out = '';
  let rest = value;
  for (;;) {
    const at = rest.indexOf('clamp(');
    if (at === -1) return out + rest;
    out += rest.slice(0, at);
    let depth = 0;
    let end = -1;
    for (let i = at + 6; i < rest.length; i++) {
      const ch = rest[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      }
    }
    if (end === -1) throw new Error(`cssfix: clamp() 括号不配对：${value}`);
    const inner = rest.slice(at + 6, end);
    if (inner.includes('clamp(') || inner.includes('calc(')) {
      throw new Error(`cssfix: clamp 参数含嵌套函数，需人工处理：${value}`);
    }
    const parts = splitTop(inner);
    if (parts.length !== 3) throw new Error(`cssfix: clamp 不是三参：${value}`);
    out += (parts[0] as string).trim();
    rest = rest.slice(end + 1);
  }
}

function hasViewportUnit(value: string): boolean {
  return /\b\d+(?:\.\d+)?(?:d|s|l)vh\b/.test(value);
}

function toStaticVh(value: string): string {
  return value.replace(/\b(\d+(?:\.\d+)?)(?:d|s|l)vh\b/g, '$1vh');
}

/* ---------------------------------------------------- display 归类 */

interface ClassifyCtx {
  exact: Map<string, string>;
  tail: Map<string, string[]>;
  known: Record<string, 'flex' | 'grid'>;
  unresolved: Set<string>;
}

function collectDisplays(nodes: Node[], ctx: ClassifyCtx): void {
  for (const node of nodes) {
    if (node.type === 'raw') continue; // @keyframes 等无 display 语义
    if (node.type === 'at') {
      collectDisplays(node.body, ctx);
      continue;
    }
    const disp = node.decls.find((d) => d.name === 'display')?.value;
    if (!disp) continue;
    for (const branch of splitTop(node.selector)) {
      ctx.exact.set(branch, disp);
      const tail = branch.split(/[\s>+~]/).pop() ?? branch;
      const list = ctx.tail.get(tail) ?? [];
      list.push(disp);
      ctx.tail.set(tail, list);
    }
  }
}

function displayOf(selector: string, ctx: ClassifyCtx): string | null {
  for (const branch of splitTop(selector)) {
    const known = ctx.known[branch];
    if (known) return known;
    const exact = ctx.exact.get(branch);
    if (exact) return exact;
    const tail = branch.split(/[\s>+~]/).pop() ?? branch;
    const candidates = ctx.tail.get(tail);
    if (candidates && candidates.length > 0) {
      const unique = [...new Set(candidates)];
      if (unique.length === 1) return unique[0] as string;
      return null;
    }
  }
  return null;
}

/* -------------------------------------------------------- gap 处理 */

interface GapPlan {
  /** 挂原选择器的值级回退（grid-gap 别名在重写时处理）。 */
  sameDecl: Decl[];
  /** 挂 `<sel> > * + *` 的 margin 基线。 */
  childBase: Decl[];
  /** 挂 `<enhPrefix> <sel> > * + *` 的清零。 */
  childClear: Decl[];
  /** 原规则内的属性名重写（grid 别名）。 */
  rename: Map<string, string>;
  lost: string[];
}

function planGap(
  decls: Decl[],
  direction: 'row' | 'column',
  wrapped: boolean,
  isGrid: boolean,
  selector: string,
): GapPlan {
  const plan: GapPlan = { sameDecl: [], childBase: [], childClear: [], rename: new Map(), lost: [] };

  if (isGrid) {
    // Chrome 61 只认 grid-gap 族；别名在现代内核等价，原样重写即可。
    for (const d of decls) {
      if (d.name === 'gap' && d.value !== '0') plan.rename.set('gap', 'grid-gap');
      if (d.name === 'row-gap') plan.rename.set('row-gap', 'grid-row-gap');
      if (d.name === 'column-gap') plan.rename.set('column-gap', 'grid-column-gap');
    }
    return plan;
  }

  const two = decls.find((d) => d.name === 'gap')?.value.includes(' ') ?? false;
  const gapValue = decls.find((d) => d.name === 'gap')?.value ?? '';
  const rowLong = decls.find((d) => d.name === 'row-gap');
  const colLong = decls.find((d) => d.name === 'column-gap');
  const rowVal = rowLong ? rowLong.value : two ? (gapValue.split(/\s+/)[0] as string) : gapValue;
  const colVal = colLong ? colLong.value : two ? (gapValue.split(/\s+/)[1] as string) : gapValue;
  const hasGapShorthand = decls.some((d) => d.name === 'gap');

  const marginSide = direction === 'row' ? 'margin-left' : 'margin-top';
  const addMargin = (value: string): void => {
    const v = value.trim();
    if (!v || v === '0') return;
    plan.childBase.push({ name: marginSide, value: v, raw: `${marginSide}: ${v}` });
    plan.childClear.push({ name: marginSide, value: '0', raw: `${marginSide}: 0` });
  };

  if (direction === 'row') {
    // 行内子项间距是 column-gap；row-gap 只在换行时有意义。
    if ((hasGapShorthand || colLong) && colVal) addMargin(colVal);
    if ((hasGapShorthand || rowLong) && rowVal && rowVal !== '0' && wrapped) {
      plan.lost.push(`row-gap ${rowVal}（flex-wrap 行距，Chrome 61 无回退）`);
    }
  } else {
    if ((hasGapShorthand || rowLong) && rowVal) addMargin(rowVal);
    if ((hasGapShorthand || colLong) && colVal && colVal !== '0' && wrapped) {
      plan.lost.push(`column-gap ${colVal}（flex-wrap 列距，Chrome 61 无回退）`);
    }
  }

  if (plan.childBase.length > 0 && !selector) plan.lost.push('空选择器');
  return plan;
}

/* -------------------------------------------------------- 主流程 */

interface Sink {
  baseSame: string[];
  baseChild: string[];
  body: string[];
  enhChild: string[];
}

/** 是否还剩真正的 @import 语句（跳过注释——说明性注释里出现 @import 字样不算）。 */
function hasImportStmt(css: string): boolean {
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css.startsWith('@import', i)) return true;
    i++;
  }
  return false;
}

/** 剥离真正的 @import 语句，保留注释原样（demo.css 首行注释里含 @import 字样）。 */
function stripImportStmts(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (css.startsWith('@import', i)) {
      const semi = css.indexOf(';', i);
      if (semi === -1) throw new Error('cssfix: @import 缺少分号');
      i = semi + 1;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

export function fixCss(source: string, mode: CssMode, opts: FixOptions = {}): Fixed {
  const where = opts.sourceName ?? 'css';
  if (hasImportStmt(source)) {
    throw new Error(`cssfix[${where}]: 残留 @import，应由调用方先内联`);
  }
  const ctx: ClassifyCtx = {
    exact: new Map(),
    tail: new Map(),
    known: opts.known ?? {},
    unresolved: new Set(),
  };
  const nodes = parseBlocks(source);
  collectDisplays(nodes, ctx);

  const notes: string[] = [];
  const enhPrefix = mode === 'shadow' ? ':host(.supports-flex-gap)' : '.supports-flex-gap';
  const sink: Sink = { baseSame: [], baseChild: [], body: [], enhChild: [] };

  const emitRule = (selector: string, decls: Decl[]): string =>
    `${selector} {\n${decls.map((d) => `  ${d.raw};`).join('\n')}\n}`;

  const processList = (list: Node[], s: Sink): void => {
    for (const node of list) {
      if (node.type === 'raw') {
        s.body.push(`${node.header} {\n${node.body}\n}`);
        continue;
      }
      if (node.type === 'at') {
        const inner: Sink = { baseSame: [], baseChild: [], body: [], enhChild: [] };
        processList(node.body, inner);
        const wrap = (rows: string[]): string[] =>
          rows.length ? [`${node.header} {\n${rows.join('\n')}\n}`] : [];
        s.baseSame.push(...wrap(inner.baseSame));
        s.baseChild.push(...wrap(inner.baseChild));
        s.body.push(...wrap(inner.body));
        s.enhChild.push(...wrap(inner.enhChild));
        continue;
      }
      processRule(node, s);
    }
  };

  const processRule = (rule: Rule, s: Sink): void => {
    const expanded = expandIs(rule.selector);
    const selector = mode === 'shadow' ? remapShadowSelector(expanded) : expanded;

    const baseSame: Decl[] = [];
    const baseChild: Decl[] = [];
    const enhChild: Decl[] = [];
    const bodyDecls: Decl[] = [];
    const rename = new Map<string, string>();

    const hasGap = rule.decls.some((d) => d.name === 'gap' || d.name === 'row-gap' || d.name === 'column-gap');
    if (hasGap) {
      const disp = displayOf(expanded, ctx);
      if (disp === null) {
        ctx.unresolved.add(expanded);
      } else if (disp.includes('grid')) {
        const plan = planGap(rule.decls, 'row', false, true, selector);
        for (const lost of plan.lost) notes.push(`${where} ${selector}: ${lost}`);
        for (const [from, to] of plan.rename) rename.set(from, to);
        baseSame.push(...plan.sameDecl);
      } else if (disp.includes('flex')) {
        const dirDecl = rule.decls.find((d) => d.name === 'flex-direction')?.value ?? '';
        const direction = dirDecl.includes('column') ? 'column' : 'row';
        const wrapDecl = rule.decls.find((d) => d.name === 'flex-wrap')?.value ?? '';
        const wrapped = wrapDecl.includes('wrap') && !wrapDecl.includes('nowrap');
        const plan = planGap(rule.decls, direction, wrapped, false, selector);
        for (const lost of plan.lost) notes.push(`${where} ${selector}: ${lost}`);
        for (const [from, to] of plan.rename) rename.set(from, to);
        baseSame.push(...plan.sameDecl);
        baseChild.push(...plan.childBase);
        enhChild.push(...plan.childClear);
      }
      // display 存在但既非 flex 也非 grid：gap 是无效声明，原样保留。
    }

    for (const decl of rule.decls) {
      if (decl.name === 'user-select') {
        // Chrome 61 只认带前缀的写法：基线补一份 -webkit-，原声明随后照常生效。
        baseSame.push({ name: '-webkit-user-select', value: decl.value, raw: `-webkit-user-select: ${decl.value}` });
        bodyDecls.push(decl);
        continue;
      }
      if (decl.name === 'inset') {
        const parts = decl.value.split(/\s+/).filter(Boolean);
        const [t, r, b, l] =
          parts.length === 1
            ? [parts[0], parts[0], parts[0], parts[0]]
            : parts.length === 2
              ? [parts[0], parts[1], parts[0], parts[1]]
              : parts.length === 3
                ? [parts[0], parts[1], parts[2], parts[1]]
                : parts;
        baseSame.push(
          { name: 'top', value: t as string, raw: `top: ${t}` },
          { name: 'right', value: r as string, raw: `right: ${r}` },
          { name: 'bottom', value: b as string, raw: `bottom: ${b}` },
          { name: 'left', value: l as string, raw: `left: ${l}` },
        );
        bodyDecls.push(decl);
        continue;
      }
      if (hasViewportUnit(decl.value)) {
        const back = toStaticVh(decl.value);
        baseSame.push({ name: decl.name, value: back, raw: `${decl.name}: ${back}` });
        bodyDecls.push(decl);
        continue;
      }
      if (decl.value.includes('clamp(')) {
        const back = stripClamp(decl.value);
        baseSame.push({ name: decl.name, value: back, raw: `${decl.name}: ${back}` });
        bodyDecls.push(decl);
        continue;
      }
      if ((decl.name === 'width' || decl.name === 'height') && decl.value.startsWith('min(')) {
        const inner = decl.value.slice(4, decl.value.lastIndexOf(')'));
        const parts = splitTop(inner);
        if (parts.length !== 2) throw new Error(`cssfix[${where}]: 无法解析 ${decl.raw}`);
        const a = (parts[0] as string).trim();
        const b = (parts[1] as string).trim();
        baseSame.push(
          { name: decl.name, value: a, raw: `${decl.name}: ${a}` },
          { name: 'max-width', value: b, raw: `max-width: ${b}` },
        );
        bodyDecls.push(decl);
        continue;
      }
      if (/\b(?:min|max)\(/.test(decl.value)) {
        throw new Error(`cssfix[${where}]: 未处理的 ${decl.name}: ${decl.value} @ ${selector}`);
      }
      const renamed = rename.get(decl.name);
      bodyDecls.push(renamed ? { name: renamed, value: decl.value, raw: `${renamed}: ${decl.value}` } : decl);
    }

    if (baseSame.length) s.baseSame.push(emitRule(selector, baseSame));
    if (baseChild.length) s.baseChild.push(emitRule(`${selector} > * + *`, baseChild));
    s.body.push(emitRule(selector, bodyDecls));
    if (enhChild.length) s.enhChild.push(emitRule(`${prefixSelector(selector, enhPrefix)} > * + *`, enhChild));
  };

  processList(nodes, sink);

  if (ctx.unresolved.size > 0) {
    throw new Error(
      `cssfix[${where}]: 以下含 gap 的规则无法归类 flex/grid（补 known 注解或修正源）：\n  ${[...ctx.unresolved].join('\n  ')}`,
    );
  }

  const parts: string[] = [];
  const baseAll = [...sink.baseSame, ...sink.baseChild];
  if (baseAll.length) parts.push(`/* minitool baseline (Chrome 61) */\n${baseAll.join('\n')}`);
  parts.push(sink.body.join('\n'));
  if (sink.enhChild.length) {
    parts.push(`/* minitool flex-gap enhancement */\n${sink.enhChild.join('\n')}`);
  }
  return { css: parts.join('\n\n'), notes };
}

/* ------------------------------------------------- demo.css 拼接入口 */

/** 案例页共用样式：console.css 内联（替代 demo.css 头部的 @import）后整体修复。 */
export function buildCaseCss(known?: Record<string, 'flex' | 'grid'>): Fixed {
  const consoleCss = readFileSync(join(DEMO_DIR, 'console.css'), 'utf8');
  const demoCss = readFileSync(join(DEMO_DIR, 'demo.css'), 'utf8');
  const stripped = stripImportStmts(demoCss);
  return fixCss(`${consoleCss}\n${stripped}`, 'shadow', { sourceName: 'demo.css+console.css', known });
}

export function buildShellCss(known?: Record<string, 'flex' | 'grid'>): Fixed {
  const css = readFileSync(join(DEMO_DIR, 'browser.css'), 'utf8');
  return fixCss(css, 'shell', { sourceName: 'browser.css', known });
}
