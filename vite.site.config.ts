import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** GitHub Pages 静态站：与 npm 库、小红书离线包共享 demos 源页面。 */
export default defineConfig({
  base: './',
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
