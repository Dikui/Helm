import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: {
    '/api': 'http://127.0.0.1:4242', '/events': 'http://127.0.0.1:4242', '/mcp': 'http://127.0.0.1:4242',
  } },
});
