import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', assetsInlineLimit: 0 },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': 'http://localhost:3000', '/covers': 'http://localhost:3000' }
  }
});
