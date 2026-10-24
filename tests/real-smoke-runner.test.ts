import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRealSmoke } from './real-smoke-runner.js';

test('真实冒烟入口按顺序在干净环境运行九套测试，失败时停止（只用进程替身）', () => {
  const parent = { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42',
    CLAUDE_CODE_DESKTOP_SESSION: 'desktop', ARBITRARY: 'secret', NODE_OPTIONS: '--inspect',
    HELM_FAKE_COORDINATOR: '1', HELM_BROWSER_REAL: 'unexpected', HELM_UI_REAL: 'unexpected',
    HELM_UI_REAL_HOME: '/tmp/helm-ui-login', npm_config_cache: '/caller/cache' };
  const calls: { args: string[]; env: Record<string, string>; cwd: string }[] = [];
  assert.equal(runRealSmoke((args, options) => {
    calls.push({ args, ...options });
    return { status: 0, signal: null };
  }, parent), 0);
  assert.deepEqual(calls.map(call => call.args.slice(0, 2)), [
    ['--test', 'dist/tests/browser.real.js'], ['--test', 'dist/tests/claude-executor.real.js'], ['--test', 'dist/tests/claude-coordinator.real.js'],
    ['--test', 'dist/tests/claude-skills.real.js'], ['--test', 'dist/tests/codex-executor.real.js'], ['--test', 'dist/tests/codex-coordinator.real.js'],
    ['--test', 'dist/tests/grok-executor.real.js'],
    ['--test', 'dist/tests/deepseek-executor.real.js'],
    ['--test', 'dist/tests/ui.real.js'],
  ]);
  for (const [index, call] of calls.entries()) {
    const flag = ['HELM_BROWSER_REAL', 'HELM_CLAUDE_EXECUTOR_REAL', 'HELM_CLAUDE_COORDINATOR_REAL', 'HELM_CLAUDE_SKILLS_REAL', 'HELM_CODEX_EXECUTOR_REAL', 'HELM_CODEX_COORDINATOR_REAL', 'HELM_GROK_EXECUTOR_REAL', 'HELM_DEEPSEEK_EXECUTOR_REAL', 'HELM_UI_REAL'][index]!;
    assert.deepEqual(call.env, { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42', [flag]: '1',
      ...(flag === 'HELM_UI_REAL' ? { HELM_UI_REAL_HOME: '/tmp/helm-ui-login' } : {}) });
    assert.equal(call.cwd, resolve(fileURLToPath(new URL('../..', import.meta.url))));
  }
  let attempted = 0;
  assert.equal(runRealSmoke(() => ({ status: ++attempted === 2 ? 7 : 0, signal: null }), parent), 7);
  assert.equal(attempted, 2);
  let uiAttempted = 0;
  assert.equal(runRealSmoke((_args, options) => {
    uiAttempted++;
    return { status: options.env.HELM_UI_REAL === '1' ? 5 : 0, signal: null };
  }, parent), 5);
  assert.equal(uiAttempted, 9);
  assert.equal(runRealSmoke(() => ({ status: null, signal: 'SIGTERM' }), parent), 1);
  assert.equal(runRealSmoke(() => ({ status: null, signal: null, error: new Error('spawn failed') }), parent), 1);
});
