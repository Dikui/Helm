import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { server: { deps: { external: [/\/dist\//] } }, include: ['frontend/tests/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['frontend/tests/setup.ts'],
    environmentOptions: { jsdom: { url: 'http://localhost/' } }, testTimeout: 15_000, hookTimeout: 15_000 },
});
