import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [preact()],
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5199 },
});
