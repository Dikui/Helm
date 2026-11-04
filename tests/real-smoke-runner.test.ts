import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { firstFailure, groups, pruneOld, runRealSmoke, type HistoryEntry } from './real-smoke-runner.js';

const parent = { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42',
  CLAUDE_CODE_DESKTOP_SESSION: 'desktop', ARBITRARY: 'secret', NODE_OPTIONS: '--inspect',
  HELM_FAKE_COORDINATOR: '1', HELM_GROK_COORDINATOR_REAL: 'unexpected', HELM_BROWSER_REAL: 'unexpected', HELM_AUTO_FLOW_REAL: 'unexpected', HELM_ATTACHMENTS_REAL: 'unexpected', HELM_UI_REAL: 'unexpected', npm_config_cache: '/caller/cache' };

function harness(history: HistoryEntry[] = []) {
  const written: Record<string, string>[] = [];
  const state = { detected: '1.0' };
  const versions = { read: () => ({ ...written.at(-1) }), detect: async (executable: string) => `${executable} ${state.detected}`, write: (value: Record<string, string>) => { written.push(value); } };
  const tmp = mkdtempSync(join(tmpdir(), 'hs-'));
  const context = { tmpdir: () => tmp, commit: () => 'abc1234', prune: () => {}, history: { read: () => [...history], append: (entry: HistoryEntry) => { history.push(entry); } } };
  return { written, state, versions, tmp, context, history };
}
const file = (args: string[]) => args.at(-1)!.replace(/^dist\/tests\/|\.real\.js$/g, '');
const report = (args: string[]) => args.find(arg => arg.startsWith('--test-reporter-destination=/'))!.split('=')[1]!;

test('真实冒烟入口按顺序在干净环境和短临时目录运行十四套测试，全部首跑通过时只跑一次并记录各驱动版本（只用进程替身）', async () => {
  const { written, versions, tmp, context, history } = harness();
  const calls: { args: string[]; env: Record<string, string>; cwd: string }[] = [];
  assert.equal(await runRealSmoke((args, options) => {
    calls.push({ args, ...options });
    return { status: 0, signal: null };
  }, parent, versions, context), 0);
  assert.deepEqual(calls.map(call => call.args.at(-1)), groups.map(([name]) => `dist/tests/${name}.real.js`));
  for (const [index, call] of calls.entries()) {
    assert.equal(call.args[0], '--test');
    assert.ok(call.args.includes('--test-reporter=tap'), '必须另写一份 TAP 报告供提取首个失败');
    assert.deepEqual(call.env, { PATH: '/bin', HOME: '/home/test', USER: 'test', LANG: 'C.UTF-8', DISPLAY: ':42', TMPDIR: tmp, [groups[index]![1]]: '1' });
    assert.equal(call.cwd, resolve(fileURLToPath(new URL('../..', import.meta.url))));
  }
  assert.deepEqual(written[0], { 'claude-sdk': 'claude 1.0', codex: 'codex 1.0', grok: 'grok 1.0', deepseek: 'dsh 1.0' });
  assert.equal(history.length, 14);
  assert.ok(history.every(entry => entry.passed && entry.attempt === 1 && entry.commit === 'abc1234' && entry.failure === null));
});

test('真实冒烟某组失败后重跑一次：重跑通过算通过并记入历史，两次都失败才返回失败码，其余组照常跑完', async () => {
  const flaky = harness();
  let attempts = 0;
  assert.equal(await runRealSmoke(args => {
    attempts++;
    return { status: file(args) === 'claude-executor' && attempts === 2 ? 7 : 0, signal: null };
  }, parent, flaky.versions, flaky.context), 0, '重跑通过不算失败');
  assert.equal(attempts, 15);
  assert.deepEqual(flaky.history.filter(entry => entry.group === 'claude-executor').map(entry => [entry.attempt, entry.passed]), [[1, false], [2, true]]);
  assert.equal(flaky.written[0]!['claude-sdk'], 'claude 1.0', '重跑通过的驱动照常记录版本');

  const broken = harness();
  broken.written.push({ 'claude-sdk': 'claude 0.9' });
  attempts = 0;
  assert.equal(await runRealSmoke(args => {
    attempts++;
    return { status: file(args) === 'claude-executor' ? 7 : 0, signal: null };
  }, parent, broken.versions, broken.context), 7);
  assert.equal(attempts, 15);
  assert.equal(broken.written.at(-1)!['claude-sdk'], 'claude 0.9', '失败的驱动保留上次通过的版本');
  assert.equal(broken.written.at(-1)!.codex, 'codex 1.0');

  for (const [kind, name] of [['grok', 'grok-executor'], ['grok', 'grok-coordinator'], ['deepseek', 'deepseek-coordinator']] as const) {
    const run = harness();
    run.written.push({ [kind]: 'old' });
    assert.equal(await runRealSmoke(args => ({ status: file(args) === name ? 9 : 0, signal: null }), parent, run.versions, run.context), 9);
    assert.equal(run.written.at(-1)![kind], 'old', '驱动组失败时不得将该驱动版本记为通过');
  }
  const signalled = harness();
  assert.equal(await runRealSmoke(args => file(args) === 'browser' ? { status: null, signal: 'SIGTERM' } : { status: 0, signal: null }, parent, signalled.versions, signalled.context), 1);
  const spawnFailed = harness();
  assert.equal(await runRealSmoke(() => ({ status: null, signal: null, error: new Error('spawn failed') }), parent, spawnFailed.versions, spawnFailed.context), 1);
});

test('真实冒烟只跑指定的组；驱动的组没跑全时不记录它的版本；未知组名直接报错', async () => {
  const { written, versions, context } = harness();
  const ran: string[] = [];
  assert.equal(await runRealSmoke(args => { ran.push(file(args)); return { status: 0, signal: null }; }, parent, versions, { ...context, groups: ['ui', 'codex-executor'] }), 0);
  assert.deepEqual(ran, ['codex-executor', 'ui'], '按固定顺序运行，不按参数顺序');
  assert.deepEqual(written[0], {}, 'codex-coordinator 没跑，Codex 版本不能记为通过');
  await assert.rejects(runRealSmoke(() => ({ status: 0, signal: null }), parent, versions, { ...context, groups: ['codex'] }), /未知的冒烟组：codex/);
});

test('真实冒烟同一测试在最近十次首跑中第二次失败时，提示按缺陷排查', async () => {
  const tap = 'TAP version 13\n# Subtest: 调度者建卡\nnot ok 1 - 调度者建卡\n  ---\n  error: |-\n    必须实际调用 create-card 至少 2 次\n  ...\n';
  const earlier = { at: '', commit: 'old', group: 'codex-coordinator', attempt: 1, passed: false, failure: { test: '调度者建卡', error: '' } };
  const { versions, context, history } = harness([earlier]);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { errors.push(values.join(' ')); };
  try {
    assert.equal(await runRealSmoke(args => {
      if (file(args) !== 'codex-coordinator') return { status: 0, signal: null };
      writeFileSync(report(args), tap);
      return { status: 1, signal: null };
    }, parent, versions, context), 1);
  } finally { console.error = original; }
  assert.deepEqual(history.find(entry => entry.group === 'codex-coordinator' && entry.attempt === 1 && entry.commit === 'abc1234')!.failure, { test: '调度者建卡', error: '必须实际调用 create-card 至少 2 次' });
  assert.ok(errors.some(line => line.includes('反复失败') && line.includes('首跑失败 2 次')), errors.join('\n'));
});

test('从 node:test 的 TAP 报告取首个失败的测试名和错误首行，测试名里的冒号不影响识别', () => {
  const tap = [
    'TAP version 13',
    '# Subtest: ok one', 'ok 1 - ok one', '  ---', '  duration_ms: 1', '  ...',
    '# Subtest: 界面真实冒烟：新建 → 对齐',
    '    # Subtest: 子步骤', '    not ok 1 - 子步骤', '      ---', '      error: |-', '        必须实际调用 create-card 2 次', '      ...',
    'not ok 2 - 界面真实冒烟：新建 → 对齐', '  ---', "  error: '1 subtest failed'", '  ...',
  ].join('\n');
  assert.deepEqual(firstFailure(tap), { test: '子步骤', error: '必须实际调用 create-card 2 次' });
  assert.deepEqual(firstFailure("not ok 3 - timeout one\n  ---\n  error: 'test timed out after 50ms'\n"), { test: 'timeout one', error: 'test timed out after 50ms' });
  assert.deepEqual(firstFailure("not ok 1 - 验收\n  ---\n  error: |-\n    Expected values to be strictly equal:\n  expected: 'passed'\n  actual: 'undeclared'\n  ...\n"),
    { test: '验收', error: "Expected values to be strictly equal:（actual 'undeclared'，expected 'passed'）" });
  assert.equal(firstFailure('ok 1 - fine\n'), null);
});

test('真实冒烟启动时只删除超过保留期的同前缀临时目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-'));
  for (const name of ['hs-old', 'hs-new', 'other-old']) mkdirSync(join(root, name));
  const old = new Date(Date.now() - 8 * 24 * 3600_000);
  for (const name of ['hs-old', 'other-old']) utimesSync(join(root, name), old, old);
  pruneOld(root, 'hs-', 7 * 24 * 3600_000);
  assert.deepEqual(['hs-old', 'hs-new', 'other-old'].map(name => existsSync(join(root, name))), [false, true, true]);
});
