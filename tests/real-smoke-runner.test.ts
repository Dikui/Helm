import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRealSmoke } from './real-smoke-runner.js';

test('真实冒烟入口按顺序在干净环境运行十二套测试，失败后继续跑完并返回首个失败码（只用进程替身）', async () => {
  const written: Record<string, string>[] = [];
  let detected = '1.0';
  const versions = { read: () => ({ ...written.at(-1) }), detect: async (executable: string) => `${executable} ${detected}`, write: (value: Record<string, string>) => { written.push(value); } };
  const parent = { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42',
    CLAUDE_CODE_DESKTOP_SESSION: 'desktop', ARBITRARY: 'secret', NODE_OPTIONS: '--inspect',
    HELM_FAKE_COORDINATOR: '1', HELM_BROWSER_REAL: 'unexpected', HELM_AUTO_FLOW_REAL: 'unexpected', HELM_ATTACHMENTS_REAL: 'unexpected', HELM_UI_REAL: 'unexpected', npm_config_cache: '/caller/cache' };
  const calls: { args: string[]; env: Record<string, string>; cwd: string }[] = [];
  assert.equal(await runRealSmoke((args, options) => {
    calls.push({ args, ...options });
    return { status: 0, signal: null };
  }, parent, versions), 0);
  assert.deepEqual(calls.map(call => call.args.slice(0, 2)), [
    ['--test', 'dist/tests/browser.real.js'], ['--test', 'dist/tests/claude-executor.real.js'], ['--test', 'dist/tests/claude-coordinator.real.js'],
    ['--test', 'dist/tests/claude-skills.real.js'], ['--test', 'dist/tests/codex-executor.real.js'], ['--test', 'dist/tests/codex-coordinator.real.js'],
    ['--test', 'dist/tests/coordinator-resume.real.js'],
    ['--test', 'dist/tests/auto-flow.real.js'],
    ['--test', 'dist/tests/grok-executor.real.js'],
    ['--test', 'dist/tests/deepseek-executor.real.js'],
    ['--test', 'dist/tests/attachments.real.js'],
    ['--test', 'dist/tests/ui.real.js'],
  ]);
  for (const [index, call] of calls.entries()) {
    const flag = ['HELM_BROWSER_REAL', 'HELM_CLAUDE_EXECUTOR_REAL', 'HELM_CLAUDE_COORDINATOR_REAL', 'HELM_CLAUDE_SKILLS_REAL', 'HELM_CODEX_EXECUTOR_REAL', 'HELM_CODEX_COORDINATOR_REAL', 'HELM_COORDINATOR_RESUME_REAL', 'HELM_AUTO_FLOW_REAL', 'HELM_GROK_EXECUTOR_REAL', 'HELM_DEEPSEEK_EXECUTOR_REAL', 'HELM_ATTACHMENTS_REAL', 'HELM_UI_REAL'][index]!;
    assert.deepEqual(call.env, { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42', [flag]: '1' });
    assert.equal(call.cwd, resolve(fileURLToPath(new URL('../..', import.meta.url))));
  }
  detected = '2.0';
  let attempted = 0;
  assert.equal(await runRealSmoke(() => ({ status: ++attempted === 2 ? 7 : 0, signal: null }), parent, versions), 7);
  assert.equal(attempted, 12);
  let uiAttempted = 0;
  assert.equal(await runRealSmoke((_args, options) => {
    uiAttempted++;
    return { status: options.env.HELM_UI_REAL === '1' ? 5 : 0, signal: null };
  }, parent, versions), 5);
  assert.equal(uiAttempted, 12);
  let signalled = 0;
  assert.equal(await runRealSmoke(() => ++signalled === 1 ? { status: null, signal: 'SIGTERM' } : { status: 0, signal: null }, parent, versions), 1);
  assert.equal(signalled, 12);
  assert.equal(await runRealSmoke(() => ({ status: null, signal: null, error: new Error('spawn failed') }), parent, versions), 1);
  // A driver's version is recorded only when all its groups pass; the second run failed claude-executor.
  assert.deepEqual(written[0], { 'claude-sdk': 'claude 1.0', codex: 'codex 1.0', grok: 'grok 1.0', deepseek: 'dsh 1.0' });
  assert.deepEqual(written[1], { 'claude-sdk': 'claude 1.0', codex: 'codex 2.0', grok: 'grok 2.0', deepseek: 'dsh 2.0' }, '失败的驱动保留上次通过的版本');
});
