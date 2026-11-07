import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5199, open: '/demos/index.html' },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'SwarmBuilder',
      formats: ['es', 'iife'],
      fileName: (format) => `swarm-builder.${format}.js`,
    },
    rollupOptions: { output: { assetFileNames: 'swarm-builder.[ext]' } },
  },
});
