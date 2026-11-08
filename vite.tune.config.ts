import { defineConfig } from 'vite';

// The tuning panel ships separately: production pages never load it, so the main
// bundle keeps its single-script budget. It carries its own copy of the engine so
// one script tag is enough on a page that has no build step at all.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/tune/index.ts',
      name: 'SwarmBuilderTune',
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) => (format === 'cjs' ? 'swarm-builder.tune.cjs' : `swarm-builder.tune.${format}.js`),
    },
    rollupOptions: { output: { assetFileNames: 'swarm-builder.tune.[ext]' } },
  },
});