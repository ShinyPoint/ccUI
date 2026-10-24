import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// KaTeX's stylesheet offers each of its fonts as woff2, woff and ttf; Chromium only ever loads the woff2, so the
// others are left out of the build (before Vite's CSS step copies whatever the stylesheet names).
const katexWoff2Only = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id)) return null;
    return code.replace(/,\s*url\([^)]+\.woff\)\s*format\("woff"\)\s*,\s*url\([^)]+\.ttf\)\s*format\("truetype"\)/g, '');
  },
};

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [katexWoff2Only, preact()],
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5199 },
});
