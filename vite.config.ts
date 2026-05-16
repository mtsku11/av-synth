import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],

  // Treat shader sources as raw strings: `import frag from './foo.frag?raw'`
  assetsInclude: ['**/*.glsl', '**/*.wgsl', '**/*.frag', '**/*.vert'],

  server: {
    // COOP/COEP isolate the page so SharedArrayBuffer is available
    // (needed if/when audio worklets share ring buffers with the main thread).
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  worker: {
    format: 'es',
  },

  build: {
    target: 'es2022',
    sourcemap: true,
  },

  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
});
