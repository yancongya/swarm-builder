import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5199, open: '/demos/index.html' },
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
