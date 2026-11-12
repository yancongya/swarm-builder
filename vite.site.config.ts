import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';

/** GitHub Pages 静态站：与 npm 库、小红书离线包共享 demos 源页面。 */
export default defineConfig({
  base: './',
  plugins: [{
    name: 'pages-case-routes',
    closeBundle() {
      const dist = resolve('site-dist');
      const shell = readFileSync(join(dist, 'demos', 'index.html'), 'utf8');
      // GitHub Pages 没有 SPA fallback。每个目录给它一份真实入口；base 指回
      // demos，让 iframe、favicon 和 Vite 的 ../assets 路径在三个入口都可用。
      for (const route of ['home', 'console', 'blender']) {
        const dir = join(dist, route);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), shell.replace('<head>', '<head>\n  <base href="../demos/" />'));
      }
    },
  }],
  build: {
    outDir: 'site-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve('index.html'),
        browser: resolve('demos/index.html'),
        home: resolve('demos/home.html'),
        console: resolve('demos/console.html'),
        blender: resolve('demos/blender.html'),
      },
    },
  },
});
