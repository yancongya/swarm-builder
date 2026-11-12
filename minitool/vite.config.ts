/**
 * minitool（小红书小工具）构建配置。
 *
 * 与仓库主站**完全并行**：主站的 src/demos 一行不改，这里只读取它们作为
 * 母本，产出独立的 minitool/dist。产物形态由容器规范锁定：
 *
 * - 单入口 index.html 在 zip 根，全资源相对路径（app.js / app.css）；
 * - 脚本必须是经典脚本（IIFE，无 type=module、无内联 script）；
 * - JS 转译到 ES2017 / Chrome 61，CSS 双层（基线 + 能力增强）；
 * - 构建收尾跑产物门禁（ES2017 语法 + 容器违禁清单），不过不算建成。
 *
 * 三类「不能靠运行时兜底」的处理都在构建期完成：
 *   1. 案例 HTML —— 剥脚本/外链/目标窗口，内联 <style> 过 Chrome 61 基线；
 *   2. 外壳 CSS —— browser.css 走 fixCss('shell') 三段式改写；
 *   3. 库内嵌 CSS / 剪贴板调用 —— renderChunk 精确替换（带计数日志）。
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { buildCaseCss, buildShellCss, fixCss } from './build/cssfix.ts';
import { checkArtifact } from './build/gate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(HERE, '..', 'demos');
const DIST_DIR = join(HERE, 'dist');

/** 案例清单：demos/<key>.html → 虚拟模块 minitool:case-html:<key>。 */
const CASE_KEYS = ['home', 'console', 'blender'] as const;

/** JSON.stringify 后补转义 U+2028/2029：ES2017 里它们是字符串字面量的语法错误（ES2019 才合法）。 */
const jsString = (value: string): string =>
  JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

interface CaseHtmlResult {
  html: string;
  notes: string[];
}

/**
 * 构建期处理案例 HTML：
 * 剥 `<script>`（src 脚本指向的 lang/creator 不进包；内联脚本逻辑由 mount 表用 TS 重写）、
 * 剥 `<link>`（共享样式走 minitool:case-css）、剥 `target="_blank"`（容器禁开新窗口）、
 * 内联 `<style>` 就地过 fixCss('shadow')（页内样式保持自己的作用域）。
 * 处理后残留任何一项都直接失败——把关不能靠「应该剥干净了」。
 */
function processCaseHtml(key: string): CaseHtmlResult {
  const raw = readFileSync(join(DEMO_DIR, `${key}.html`), 'utf8');
  const notes: string[] = [];

  // HTML 解析器遇到第一个 </script 就结束脚本（JS 字符串里的 </script 也一样），
  // 非贪婪正则与浏览器行为一致。
  let html = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link\b[^>]*>/gi, '');
  html = html.replace(/\s+target\s*=\s*(['"])_blank\1/gi, '');
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m: string, attrs: string, css: string) => {
    const fixed = fixCss(css, 'shadow', { sourceName: `${key}.html <style>` });
    notes.push(...fixed.notes);
    return `<style${attrs}>${fixed.css}</style>`;
  });

  const residue: [RegExp, string][] = [
    [/<script\b/i, '<script>'],
    [/<link\b/i, '<link>'],
    [/\starget\s*=/i, 'target='],
    [/\son[a-z]+\s*=/i, '行内事件处理器'],
    [/<iframe\b/i, '<iframe>'],
    [/<object\b/i, '<object>'],
  ];
  for (const [re, what] of residue) {
    if (re.test(html)) throw new Error(`minitool: ${key}.html 处理后残留 ${what}`);
  }
  return { html, notes };
}

/** 案例虚拟模块：minitool:case-css（共享样式）与 minitool:case-html:<key>（各页 HTML）。 */
function caseModules(): Plugin {
  return {
    name: 'minitool:case-modules',
    resolveId(id) {
      if (id === 'minitool:case-css' || id === 'minitool:panel-css' || id.startsWith('minitool:case-html:')) {
        return `\0${id}`;
      }
      return null;
    },
    load(id) {
      if (!id.startsWith('\0')) return null;
      const real = id.slice(1);

      if (real === 'minitool:case-css') {
        const fixed = buildCaseCss();
        for (const note of fixed.notes) this.warn(`[case-css] ${note}`);
        return `export default ${jsString(fixed.css)};`;
      }

      // 创造者面板的 CSS 是 src/tune/panel.ts 里的模板串（源码属主站，一行不改）：
      // 构建期抽出过 fixCss('shadow')，运行时由 shell 注入面板自己的 shadow 根。
      if (real === 'minitool:panel-css') {
        const panelTs = readFileSync(join(HERE, '..', 'src', 'tune', 'panel.ts'), 'utf8');
        const marker = 'const CSS = `';
        const s = panelTs.indexOf(marker);
        const e = s < 0 ? -1 : panelTs.indexOf('`', s + marker.length);
        if (s < 0 || e < 0) throw new Error('minitool: 未找到 panel.ts 的 CSS 模板串');
        const fixed = fixCss(panelTs.slice(s + marker.length, e), 'shadow', { sourceName: 'panel.ts CSS' });
        for (const note of fixed.notes) this.warn(`[panel-css] ${note}`);
        return `export default ${jsString(fixed.css)};`;
      }

      const prefix = 'minitool:case-html:';
      if (real.startsWith(prefix)) {
        const key = real.slice(prefix.length);
        if (!(CASE_KEYS as readonly string[]).includes(key)) {
          throw new Error(`minitool: 未知案例 "${key}"，可选：${CASE_KEYS.join(', ')}`);
        }
        const { html, notes } = processCaseHtml(key);
        for (const note of notes) this.warn(`[case-html:${key}] ${note}`);
        return `export default ${jsString(html)};`;
      }
      return null;
    },
  };
}

/**
 * 外壳样式：entry 里 import 的 demos/browser.css 先过 fixCss('shell') 再进管线。
 * enforce: 'pre' 保证跑在 vite:css 之前，拿到的已是三段式成品。
 */
function shellCss(): Plugin {
  return {
    name: 'minitool:shell-css',
    enforce: 'pre',
    transform(_code, id) {
      const clean = id.replace(/[?#].*$/, '').replace(/\\/g, '/');
      if (!clean.endsWith('demos/browser.css')) return null;
      const fixed = buildShellCss();
      for (const note of fixed.notes) this.warn(`[shell-css] ${note}`);
      return { code: fixed.css, map: null };
    },
  };
}

/**
 * renderChunk 精确替换（源码属主站、一行不改，兼容处理只能发生在产物层）：
 * - overlay 的 `overflow-x:clip` Chrome 61 不认：前置 hidden 做基线，新值在后照常生效；
 * - 容器禁用剪贴板 API：`navigator.clipboard` 换成空对象，writeText 调用抛
 *   TypeError 落进已有的「选中文本」降级分支。
 * 替换各带计数日志；残留与否最终由产物门禁复核。
 */
const CHUNK_FIXES: { from: string; to: string; why: string }[] = [
  {
    from: 'overflow-x:clip;overflow-clip-margin:4px;',
    to: 'overflow-x:hidden;overflow-x:clip;overflow-clip-margin:4px;',
    why: 'clip 基线',
  },
  {
    from: 'navigator.clipboard',
    // 用 undefined 而非 ({})：属性访问抛 TypeError 落进已有的「选中文本」降级；
    // 且标识符在语句位/表达式位都合法（对象字面量在语句位会被解析成块）。
    to: 'undefined',
    why: '剪贴板降级',
  },
  {
    // render/styles.ts 的 crosshair：Chrome 61 不认 inset shorthand。
    // 等价性：crosshair 是空盒（十字线全在 ::before/::after），auto 尺寸的
    // top/left:0 与 inset:0 撑满后的定位效果一致。带上下文保证唯一命中。
    from: 'display:none;inset:0}',
    to: 'display:none;top:0;right:0;bottom:0;left:0}',
    why: 'crosshair inset 基线',
  },
];

function chunkFixes(): Plugin {
  return {
    name: 'minitool:chunk-fixes',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.js')) return null;
      let out = code;
      const applied: string[] = [];
      for (const fix of CHUNK_FIXES) {
        const count = out.split(fix.from).length - 1;
        if (count === 0) continue;
        out = out.split(fix.from).join(fix.to);
        applied.push(`${fix.why} x${count}`);
      }
      if (applied.length) this.warn(`[chunk-fixes] ${chunk.fileName}: ${applied.join('，')}`);
      return { code: out, map: null };
    },
  };
}

/** 产物门禁：dist 落盘后跑 ES2017 语法检查 + 容器违禁扫描，不过就让构建失败。 */
function artifactGate(): Plugin {
  return {
    name: 'minitool:artifact-gate',
    closeBundle() {
      const issues = checkArtifact(DIST_DIR);
      if (issues.length > 0) {
        throw new Error(`minitool 产物门禁未过（${issues.length} 项）：\n  ${issues.join('\n  ')}`);
      }
    },
  };
}

/** 案例 HTML 在 JS 字符串中挂载，Vite 不会自动追踪其中的相对图片路径。 */
function copyCaseAssets(): Plugin {
  return {
    name: 'minitool:case-assets',
    closeBundle() {
      const source = join(DEMO_DIR, 'assets', 'blender');
      const target = join(DIST_DIR, 'assets', 'blender');
      mkdirSync(target, { recursive: true });
      for (const file of readdirSync(source)) {
        if (!/\.(?:svg|webp|png|jpe?g)$/i.test(file)) continue;
        copyFileSync(join(source, file), join(target, file));
      }
    },
  };
}

export default defineConfig({
  root: HERE,
  publicDir: 'public',
  plugins: [shellCss(), caseModules(), chunkFixes(), copyCaseAssets(), artifactGate()],
  build: {
    target: ['es2017', 'chrome61'],
    minify: false, // 产物要能被 grep 审计，不压缩
    cssMinify: false,
    sourcemap: false,
    lib: {
      entry: 'src/entry.ts',
      name: 'SwarmMinitool',
      formats: ['iife'], // 容器要求经典脚本：单文件 IIFE，无 module、无内联
      fileName: () => 'app.js',
    },
    rollupOptions: { output: { assetFileNames: 'app.[ext]' } },
  },
});
