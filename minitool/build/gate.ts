/**
 * 产物门禁（只被 vite.config 与 gate-cli 引用，不进 zip）。
 *
 * 构建收尾对 dist 做两层检查，任一不过就让构建失败：
 *
 * 1. **ES2017 语法门禁** —— 把最终 JS 解析成 AST，逐节点比对 ES2018+ 语法
 *    （可选链、空值合并、class 字段、对象 spread……）。语法不兼容在解析阶段
 *    直接崩、没有运行时兜底，必须在构建时拦住。解析本身失败也算红。
 * 2. **容器违禁扫描** —— device-capabilities §6 清单：网络请求、动态执行、
 *    剪贴板、新开窗口、站外跳转、外链资源。JS 走 AST 扫调用点（不误伤注释），
 *    HTML/CSS 走文本模式。
 *
 * 检查对象是**构建产物**（renderChunk 修复之后），不是源码——源码里允许
 * 出现被构建链转译或替换掉的写法。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/* ------------------------------------------------------------- AST 工具 */

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface Placed {
  node: AstNode;
  parent: AstNode | null;
}

/** 深度优先收集全部节点及其父节点（产物只有百 KB 级，直接全量收集）。 */
function collect(root: unknown): Placed[] {
  const out: Placed[] = [];
  const visit = (value: unknown, parent: AstNode | null): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v, parent);
      return;
    }
    if (value && typeof value === 'object') {
      const n = value as AstNode;
      if (typeof n.type === 'string') {
        out.push({ node: n, parent });
        for (const [k, v] of Object.entries(n)) {
          if (k !== 'type') visit(v, n);
        }
      } else {
        for (const v of Object.values(value)) visit(v, parent);
      }
    }
  };
  visit(root, null);
  return out;
}

/** 把成员表达式拍平成点分路径（`window.open`）；含动态段则以 `.*` 结尾。 */
function memberPath(raw: unknown): string {
  const n = raw as AstNode | null;
  if (!n || typeof n.type !== 'string') return '';
  if (n.type === 'Identifier') return String(n.name ?? '');
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'ChainExpression') return memberPath(n.expression);
  if (n.type === 'MemberExpression') {
    const obj = memberPath(n.object);
    if (!obj) return '';
    let prop: string;
    if (n.computed) {
      const p = n.property as AstNode | null;
      prop =
        p && p.type === 'Literal' && typeof p.value === 'string'
          ? `.${p.value}`
          : '.*';
    } else {
      const p = n.property as AstNode | null;
      prop = p ? `.${String(p.name ?? '')}` : '';
    }
    return obj + prop;
  }
  return '';
}

/** 路径是否命中禁用表：全等，或命中前缀后继续向下（`navigator.serviceWorker.register`）。 */
function pathBanned(path: string, banned: readonly string[]): boolean {
  if (!path) return false;
  return banned.some((b) => path === b || path.startsWith(`${b}.`));
}

/* ------------------------------------------------- 1. ES2017 语法门禁 */

/** 收集超出 ES2017 的语法点；返回问题描述列表。 */
function syntaxIssues(code: string, file: string): string[] {
  const out: string[] = [];
  let program: AstNode;
  try {
    program = parseAst(code) as unknown as AstNode;
  } catch (err: unknown) {
    return [`${file}: 最终产物解析失败——${err instanceof Error ? err.message.split('\n')[0] : String(err)}`];
  }
  const nodes = collect(program);

  const say = (n: AstNode, what: string): void => {
    const line = typeof n.start === 'number' ? `@${n.start}` : '';
    out.push(`${file}: ${what}${line}`);
  };

  for (const { node: n, parent } of nodes) {
    switch (n.type) {
      case 'ChainExpression':
        say(n, '可选链 ?.（ES2020）');
        break;
      case 'ImportExpression':
        say(n, '动态 import()（ES2020）');
        break;
      case 'LogicalExpression':
        if (n.operator === '??') say(n, '空值合并 ??（ES2020）');
        break;
      case 'AssignmentExpression':
        if (n.operator === '??=' || n.operator === '||=' || n.operator === '&&=') {
          say(n, `逻辑赋值 ${String(n.operator)}（ES2021）`);
        }
        break;
      case 'CatchClause':
        if (n.param == null) say(n, 'optional catch binding（ES2019）');
        break;
      case 'PropertyDefinition':
      case 'ClassProperty':
        say(n, 'class 字段声明（ES2022）');
        break;
      case 'PrivateIdentifier':
        say(n, 'class 私有字段 #（ES2022）');
        break;
      case 'StaticBlock':
        say(n, 'class static {}（ES2022）');
        break;
      case 'ForOfStatement':
        if (n.await === true) say(n, 'for await（ES2018）');
        break;
      case 'SpreadElement':
        if (parent?.type === 'ObjectExpression') say(n, '对象 spread（ES2018）');
        break;
      case 'VariableDeclaration':
        if (n.kind === 'using' || n.kind === 'await using') say(n, 'using 声明（提案）');
        break;
      case 'AwaitExpression':
        if (parent?.type === 'Program') say(n, 'top-level await（ES2022）');
        break;
      case 'Literal': {
        // BigInt 字面量：ESTree 下 value 为 bigint；oxc 也可能只填 bigint 字段。
        if (typeof n.value === 'bigint' || n.bigint != null) say(n, 'BigInt 字面量（ES2020）');
        if (typeof n.value === 'number' && typeof n.raw === 'string' && n.raw.includes('_')) {
          say(n, '数字分隔符（ES2021）');
        }
        const regex = n.regex as { pattern?: string; flags?: string } | undefined;
        if (regex) {
          const pattern = regex.pattern ?? '';
          const flags = regex.flags ?? '';
          if (pattern.includes('(?<')) say(n, '正则命名捕获组/环视（ES2018）');
          if (flags.includes('s')) say(n, '正则 dotAll 标志 s（ES2018）');
          if (flags.includes('v')) say(n, '正则 v 标志（ES2024）');
        }
        break;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (n.generator === true && subtreeHasAwait(n)) {
          say(n, 'async generator（ES2018）');
        }
        break;
      default:
        break;
    }
  }
  return out;
}

/** 子树里是否有 await（判断 async generator 用）。 */
function subtreeHasAwait(root: AstNode): boolean {
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      stack.push(...cur);
      continue;
    }
    if (cur && typeof cur === 'object') {
      const n = cur as AstNode;
      if (n.type === 'AwaitExpression') return true;
      for (const v of Object.values(n)) stack.push(v);
    }
  }
  return false;
}

/* --------------------------------------------- 2. 容器违禁扫描（JS/AST） */

/** §6 清单：成员路径禁用（全等或继续向下取属性）。 */
const BANNED_MEMBERS: readonly string[] = [
  'navigator.geolocation',
  'navigator.clipboard.readText',
  'navigator.clipboard.writeText',
  'navigator.bluetooth',
  'navigator.usb',
  'navigator.hid',
  'navigator.serial',
  'navigator.getBattery',
  'navigator.connection',
  'navigator.credentials',
  'navigator.locks',
  'navigator.mediaDevices.enumerateDevices',
  'navigator.mediaDevices.getDisplayMedia',
  'navigator.storage.persist',
  'navigator.serviceWorker',
  'window.open',
  'window.prompt',
  'location.assign',
  'document.execCommand',
];

/** §6 清单：禁止 new 的构造器。 */
const BANNED_CTORS: ReadonlySet<string> = new Set([
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'Worker',
  'SharedWorker',
  'Accelerometer',
  'Gyroscope',
  'Magnetometer',
  'XMLHttpRequest',
  'PaymentRequest',
  'Function', // new Function() —— 动态执行
  'DeviceMotionEvent',
  'DeviceOrientationEvent',
]);

/** §6 清单：禁止裸调用的函数名（eval / fetch / Function(...)）。 */
const BANNED_CALLS: ReadonlySet<string> = new Set(['fetch', 'eval', 'Function']);

/** 标识符一出现就违规（动态执行 / 图形上下文之外的 WASM / 传感器事件）。 */
const BANNED_IDENTIFIERS: ReadonlySet<string> = new Set([
  'WebAssembly',
  'DeviceMotionEvent',
  'DeviceOrientationEvent',
]);

/** addEventListener 的事件名禁用。 */
const BANNED_EVENTS: ReadonlySet<string> = new Set(['devicemotion', 'deviceorientation']);

/** 全屏 API 后缀（容器统一管理全屏）。 */
const BANNED_FULLSCREEN = [
  '.requestFullscreen',
  '.webkitRequestFullscreen',
  '.mozRequestFullScreen',
  '.msRequestFullscreen',
];

function jsIssues(code: string, file: string): string[] {
  const out: string[] = [];
  let program: AstNode;
  try {
    program = parseAst(code) as unknown as AstNode;
  } catch (err: unknown) {
    return [`${file}: 无法解析——${err instanceof Error ? err.message.split('\n')[0] : String(err)}`];
  }
  const nodes = collect(program);

  for (const { node: n } of nodes) {
    // 裸调用：fetch() / eval() / Function()
    if (n.type === 'CallExpression') {
      const callee = n.callee as AstNode | undefined;
      const path = memberPath(callee);
      if (callee?.type === 'Identifier' && BANNED_CALLS.has(String(callee.name))) {
        out.push(`${file}: 禁用调用 ${String(callee.name)}()`);
      } else if (pathBanned(path, BANNED_MEMBERS)) {
        out.push(`${file}: 禁用 API ${path}()`);
      } else if (path.endsWith('.requestFullscreen') || BANNED_FULLSCREEN.some((s) => path.endsWith(s))) {
        out.push(`${file}: 禁用全屏 API ${path}()`);
      }
      // addEventListener('devicemotion' | 'deviceorientation')
      if (path.endsWith('.addEventListener')) {
        const ev = (n.arguments as unknown[] | undefined)?.[0] as AstNode | undefined;
        if (ev?.type === 'Literal' && typeof ev.value === 'string' && BANNED_EVENTS.has(ev.value)) {
          out.push(`${file}: 禁用事件监听 addEventListener('${ev.value}')`);
        }
      }
    }
    // new WebSocket() / new Worker() / new Function() …
    if (n.type === 'NewExpression') {
      const callee = n.callee as AstNode | undefined;
      if (callee?.type === 'Identifier' && BANNED_CTORS.has(String(callee.name))) {
        out.push(`${file}: 禁用构造 new ${String(callee.name)}()`);
      }
    }
    // 任意形态引用禁用标识符：WebAssembly 等
    if (n.type === 'Identifier' && BANNED_IDENTIFIERS.has(String(n.name))) {
      out.push(`${file}: 禁用标识符 ${String(n.name)}`);
    }
    // 纯成员访问（不调用）也算命中：navigator.geolocation、navigator.serviceWorker …
    if (n.type === 'MemberExpression') {
      const path = memberPath(n);
      if (pathBanned(path, BANNED_MEMBERS)) {
        out.push(`${file}: 禁用 API 访问 ${path}`);
      }
    }
    // location.href = …（站外跳转）
    if (n.type === 'AssignmentExpression') {
      const left = memberPath(n.left);
      if (left === 'location.href' || left === 'location') {
        out.push(`${file}: 禁用跳转赋值 ${left} =`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------ 2b. 违禁扫描（文本） */

interface TextPattern {
  re: RegExp;
  what: string;
}

/** HTML 文本模式（产物里的 index.html 与内嵌的案例 HTML 字符串都过这套）。 */
const HTML_PATTERNS: readonly TextPattern[] = [
  { re: /target\s*=\s*["']_blank["']/i, what: 'target="_blank"（禁开新窗口）' },
  { re: /<iframe\b/i, what: '<iframe>（容器禁内嵌）' },
  { re: /<object\b/i, what: '<object>（容器禁内嵌）' },
  { re: /<embed\b/i, what: '<embed>（容器禁内嵌）' },
  { re: /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i, what: '外链 <script src>' },
  { re: /<link\b[^>]*\bhref\s*=\s*["'](?:https?:)?\/\//i, what: '外链 <link href>' },
  { re: /<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i, what: '外链媒体 src' },
  { re: /\son[a-z]+\s*=\s*["']/i, what: '行内事件处理器（onclick= 等）' },
  { re: /<a\b[^>]*\bdownload\b/i, what: 'a[download]（禁文件下载）' },
  { re: /\bform\b[^>]*\baction\s*=\s*["'](?:https?:)?\/\//i, what: 'form action 站外提交' },
];

/** CSS 文本模式：外链 url()。 */
const CSS_PATTERNS: readonly TextPattern[] = [
  { re: /url\(\s*["']?(?:https?:)?\/\//i, what: 'CSS 外链 url()' },
];

function textIssues(content: string, file: string, patterns: readonly TextPattern[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const m = p.re.exec(content);
    if (m) {
      const at = content.slice(Math.max(0, m.index - 30), m.index + 60).replace(/\s+/g, ' ');
      out.push(`${file}: ${p.what} —— …${at}…`);
    }
  }
  return out;
}

/**
 * 取 JS 里的全部字符串与模板字面量内容。
 * 案例 HTML 以字符串内嵌在产物里，HTML 模式只该扫这些字面量——
 * 扫全文会把解释「为什么要剥 <iframe>」的注释也当成违规。
 */
function stringLiterals(code: string): string {
  try {
    const nodes = collect(parseAst(code));
    const parts: string[] = [];
    for (const { node: n } of nodes) {
      if (n.type === 'Literal' && typeof n.value === 'string') {
        parts.push(String(n.value));
      } else if (n.type === 'TemplateLiteral') {
        const quasis = n.quasis as AstNode[] | undefined;
        for (const q of quasis ?? []) {
          const v = q.value as { cooked?: string; raw?: string } | undefined;
          parts.push(v?.cooked ?? v?.raw ?? '');
        }
      }
    }
    return parts.join('\n');
  } catch {
    // 解析失败不在此重复报：syntaxIssues / jsIssues 会给出根因。
    return '';
  }
}

/* ------------------------------------------------------------ 对外入口 */

/** 扫一个目录下的全部 .js / .html / .css 产物；返回问题列表（空 = 通过）。 */
export function checkArtifact(dir: string): string[] {
  const issues: string[] = [];
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);

  if (files.length === 0) issues.push(`${dir}: 没有任何产物文件`);

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    if (file.endsWith('.js')) {
      issues.push(...syntaxIssues(code, file));
      issues.push(...jsIssues(code, file));
      // 内嵌的案例 HTML 以 JS 字符串存在：只扫字面量，避开注释误伤。
      issues.push(...textIssues(stringLiterals(code), file, HTML_PATTERNS));
    } else if (file.endsWith('.html')) {
      issues.push(...textIssues(code, file, HTML_PATTERNS));
    } else if (file.endsWith('.css')) {
      issues.push(...textIssues(code, file, CSS_PATTERNS));
    }
  }
  return issues;
}
