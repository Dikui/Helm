import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type DriverEvent, type EndReason, type SessionOptions } from '../src/driver.js';

async function fixture(t: TestContext): Promise<SessionOptions> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'helm-driver-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { agent: { id: 'test', role: 'executor', driver: 'claude-sdk', model: null, reasoningEffort: null, fast: false, home: 'shared',
    description: '测试', prompt: '', rules: { role: '', runtime: '' }, directory: cwd, skillsPath: null }, cwd, env: { HELM_TEST: 'scripted' }, sandbox: { mode: 'workspace-write', writableRoots: [cwd] }, mcpServers: {} };
}

test('假驱动接受新开或续跑及任意输入，按 cwd 写文件，逐条报告输出、压缩和结束', async t => {
  const options = await fixture(t);
  const driver = new FakeDriver([ctx => {
    assert.equal(ctx.input, '继续这个派单');
    assert.equal(ctx.options.env.HELM_TEST, 'scripted');
    return [
      { type: 'write', path: 'nested/evidence.txt', content: '结果文件' },
      { type: 'output', text: '写文件完成' },
      { type: 'compaction' },
      { type: 'end', reason: 'completed', finalAnswer: '已完成', usage: { inputTokens: 3, outputTokens: 2 } },
    ];
  }, []]);
  const session = await driver.start({ ...options, resumeSessionId: 'previous-session' });
  assert.equal(session.id, 'previous-session');
  await session.send('继续这个派单');
  const events: DriverEvent[] = [];
  for await (const event of session.events) events.push(event);
  assert.equal(await readFile(join(options.cwd, 'nested/evidence.txt'), 'utf8'), '结果文件');
  assert.deepEqual(events.map(event => event.step), [1, 2, 3, 4]);
  assert.deepEqual(events.at(-1), { type: 'end', step: 4, reason: 'completed', finalAnswer: '已完成', usage: { inputTokens: 3, outputTokens: 2 } });
  const fresh = await driver.start(options);
  assert.notEqual(fresh.id, session.id);
  fresh.cancel();
});

test('假驱动按指定方式结束，挂住时可取消，崩溃通过驱动输出流报错', async t => {
  const options = await fixture(t);
  const reasons: EndReason[] = ['completed', 'error', 'quota-exhausted', 'timed-out', 'aborted', 'context-overflow'];
  const driver = new FakeDriver([
    ...reasons.map(reason => [{ type: 'end' as const, reason, finalAnswer: '只有正常完成有效' }]),
    [{ type: 'hang' }], [{ type: 'crash', message: '模拟崩溃退出' }],
  ]);
  for (const reason of reasons) {
    const session = await driver.start(options);
    await session.send('派单内容');
    const events: DriverEvent[] = [];
    for await (const event of session.events) events.push(event);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: 'end', step: 1, reason,
      ...(reason === 'completed' ? { finalAnswer: '只有正常完成有效' } : {}), usage: { inputTokens: 0, outputTokens: 0 } });
  }
  const hung = await driver.start(options);
  await hung.send('挂住');
  const pending = hung.events[Symbol.asyncIterator]().next();
  assert.equal(await Promise.race([pending.then(() => 'unexpected-output'), new Promise(resolve => setTimeout(() => resolve('waiting'), 10))]), 'waiting');
  hung.cancel();
  assert.equal((await pending).done, true);
  const crashed = await driver.start(options);
  await crashed.send('崩溃');
  await assert.rejects(crashed.events[Symbol.asyncIterator]().next(), /模拟崩溃退出/);
});

test('假驱动遵守只读和可写目录边界，拒绝路径穿越与符号链接越界', async t => {
  const options = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside.cwd, join(options.cwd, 'escape'));
  await symlink(join(outside.cwd, 'forbidden.txt'), join(options.cwd, 'dangling'));
  const driver = new FakeDriver([
    [{ type: 'write', path: 'forbidden.txt', content: '不能写' }],
    [{ type: 'write', path: '../forbidden.txt', content: '不能写' }],
    [{ type: 'write', path: 'escape/forbidden.txt', content: '不能写' }],
    [{ type: 'write', path: 'dangling', content: '不能写' }],
  ]);
  for (let index = 0; index < 4; index++) {
    const session = await driver.start(index === 0 ? { ...options, sandbox: { mode: 'read-only', writableRoots: [] } } : options);
    await session.send('写文件');
    await assert.rejects(session.events[Symbol.asyncIterator]().next(), /Sandbox rejects/);
  }
  await assert.rejects(readFile(join(outside.cwd, 'forbidden.txt')), { code: 'ENOENT' });
});
