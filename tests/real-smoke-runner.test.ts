import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRealSmoke } from './real-smoke-runner.js';

test('真实冒烟入口按顺序在干净环境运行四套测试，失败时停止（只用进程替身）', () => {
  const parent = { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42',
    CLAUDE_CODE_DESKTOP_SESSION: 'desktop', ARBITRARY: 'secret', NODE_OPTIONS: '--inspect',
    HELM_FAKE_COORDINATOR: '1', HELM_BROWSER_REAL: 'unexpected', npm_config_cache: '/caller/cache' };
  const calls: { args: string[]; env: Record<string, string>; cwd: string }[] = [];
  assert.equal(runRealSmoke((args, options) => {
    calls.push({ args, ...options });
    return { status: 0, signal: null };
  }, parent), 0);
  assert.deepEqual(calls.map(call => call.args.slice(0, 2)), [
    ['--test', 'dist/tests/browser.real.js'], ['--test', 'dist/tests/claude-executor.real.js'], ['--test', 'dist/tests/claude-coordinator.real.js'],
    ['--test', 'dist/tests/claude-skills.real.js'],
  ]);
  for (const [index, call] of calls.entries()) {
    const flag = ['HELM_BROWSER_REAL', 'HELM_CLAUDE_EXECUTOR_REAL', 'HELM_CLAUDE_COORDINATOR_REAL', 'HELM_CLAUDE_SKILLS_REAL'][index]!;
    assert.deepEqual(call.env, { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42', [flag]: '1' });
    assert.equal(call.cwd, resolve(fileURLToPath(new URL('../..', import.meta.url))));
  }
  let attempted = 0;
  assert.equal(runRealSmoke(() => ({ status: ++attempted === 2 ? 7 : 0, signal: null }), parent), 7);
  assert.equal(attempted, 2);
  assert.equal(runRealSmoke(() => ({ status: null, signal: 'SIGTERM' }), parent), 1);
  assert.equal(runRealSmoke(() => ({ status: null, signal: null, error: new Error('spawn failed') }), parent), 1);
});

test('真实冒烟核对用户 Claude projects 没有新增目录（只用进程和目录替身）', () => {
  let snapshots = 0;
  let runs = 0;
  assert.equal(runRealSmoke(() => { runs++; return { status: 0, signal: null }; }, { HOME: '/home/test' }, home => {
    assert.equal(home, '/home/test');
    return snapshots++ === 0 ? ['existing-project'] : ['existing-project', 'leaked-helm-project'];
  }), 1);
  assert.equal(runs, 1, '隔离失败后停止冒烟');
});
