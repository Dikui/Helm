import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Each integration file runs helmd and Git; bound file concurrency to avoid starving readiness/SSE waits.
  test: { maxWorkers: 4, server: { deps: { external: [/\/dist\//] } }, include: ['frontend/tests/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['frontend/tests/setup.ts'],
    environmentOptions: { jsdom: { url: 'http://localhost/' } }, testTimeout: 15_000, hookTimeout: 15_000 },
});
