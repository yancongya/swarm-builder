import { defineConfig, type Plugin } from 'vite';

/**
 * 预览壳里的「第三方网页」要能重建，只差一步：浏览器不让跨源 fetch 读正文
 * （没有 Access-Control-Allow-Origin 就抛），拿不到 HTML 就只能原样嵌。
 * 这里在本地开发服务器上开一个同源转发口，把这一页的正文取回来。
 * 只在 dev server 生效，产物里不带它——静态托管上仍然只能降级为直接嵌。
 */
function pageRelay(): Plugin {
  return {
    name: 'sb-page-relay',
    configureServer(server) {
      server.middlewares.use('/__page', (req, res) => {
        // connect 的句柄类型在本仓的 lib 组合里拿不到 url / statusCode，这里按形状取用。
        const raw = String((req as { url?: unknown }).url ?? '');
        const out = res as {
          statusCode: number;
          setHeader(key: string, value: string): void;
          end(body?: string): void;
        };
        const target = new URL(raw, 'http://127.0.0.1').searchParams.get('url') ?? '';
        const parsed = (() => {
          try {
            return new URL(target);
          } catch {
            return null;
          }
        })();
        if (!parsed || !/^https?:$/.test(parsed.protocol)) {
          out.statusCode = 400;
          out.end('only http(s)');
          return;
        }
        // 不带访问者凭据，也不把上游的 Set-Cookie 回给页面：这是个只读正文的转发口。
        fetch(parsed.href, { redirect: 'follow', headers: { accept: 'text/html' } })
          .then(async (up) => {
            out.statusCode = up.status;
            out.setHeader('content-type', up.headers.get('content-type') ?? 'text/html; charset=utf-8');
            out.setHeader('x-relay-final-url', up.url);
            out.end(await up.text());
          })
          .catch((err: unknown) => {
            out.statusCode = 502;
            out.end(String(err instanceof Error ? err.message : err));
          });
      });
    },
  };
}

/**
 * 验收模式（tools/verify.mjs 自己起的那台）关掉热更新：它一次跑二十多分钟、开几十个页面，
 * 而 vite 的整页重载是**广播**的——第一次 import 某个还没进依赖图的模块、或 dist 产物刚被
 * 重写，所有连着的客户端都会重载，正在施工的那一局当场变成
 * 「Execution context was destroyed」，看着像引擎坏了，实际是测试被服务器打断了。
 * 人手动开的那台照旧带 HMR。
 */
// 本仓不装 @types/node，而这里只要一个环境变量：按形状从 globalThis 取，不声明全局 process。
const verifying = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.SB_VERIFY) === '1';

export default defineConfig({
  plugins: [pageRelay()],
  server: {
    port: 5199,
    open: '/demos/index.html',
    ...(verifying ? { hmr: false } : {}),
    // vite 默认把 **/dist/** 排除在 watch 之外：dev server 会一直发它缓存过的旧字节，
    // cdn.html 的面板就"莫名其妙不双语"。重新 watch 它，build 完刷新页面即见新产物。
    watch: { ignored: ['**/node_modules/**'] },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'SwarmBuilder',
      // cjs 用 .cjs 后缀：包本身是 "type": "module"，.js 会被当成 ESM 而无法 require。
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) => (format === 'cjs' ? 'swarm-builder.cjs' : `swarm-builder.${format}.js`),
    },
    rollupOptions: { output: { assetFileNames: 'swarm-builder.[ext]' } },
  },
});
