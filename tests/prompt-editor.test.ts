import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { rm, symlink } from 'node:fs/promises';
import { uiFixture } from './ui-fixture.js';

for (const platform of ['darwin', 'linux', 'win32']) test(`打开 Agent 提示词：${platform} 的命令、目录、校验和错误`, async t => {
  const calls: { command: string; args: string[] }[] = [];
  let failure: string | undefined;
  const daemon = await uiFixture([], undefined, { promptEditor: { platform, async launch(command, args) {
    calls.push({ command, args });
    if (failure) throw new Error(failure);
  } } });
  t.after(() => daemon.close());
  const open = (agentId: string, extra = {}) => daemon.call('open-agent-prompt', { agentId, ...extra });
  for (const id of ['../other', 'a/b', 'a\\b', '', '.', '..', 'x\0y', '-flag']) assert.equal((await open(id)).error.code, 'INVALID_PARAMS');
  assert.equal((await open('claude-coordinator', { path: '/arbitrary' })).error.code, 'INVALID_PARAMS');
  assert.equal(calls.length, 0);
  const result = await open('claude-coordinator');
  if (platform === 'win32') {
    assert.equal(result.error.code, 'EDITOR_UNSUPPORTED_PLATFORM');
    assert.equal(calls.length, 0);
    return;
  }
  const path = join(daemon.directory, 'agents', 'claude-coordinator', 'prompt.md');
  assert.deepEqual(result.result, { agentId: 'claude-coordinator', path, opened: true });
  assert.deepEqual(calls, [{ command: platform === 'darwin' ? 'open' : 'xdg-open', args: platform === 'darwin' ? ['-t', path] : [path] }]);
  failure = 'spawn editor ENOENT: original diagnostic';
  const failed = await open('claude-coordinator');
  assert.equal(failed.error.code, 'EDITOR_OPEN_FAILED');
  assert.ok(failed.error.reason.includes(failure));
  assert.ok(failed.error.allowedOperations.includes('open-agent-prompt'));
  assert.equal((await open('missing')).error.code, 'AGENT_PROMPT_NOT_FOUND');
  await rm(path);
  assert.equal((await open('claude-coordinator')).error.code, 'AGENT_PROMPT_NOT_FOUND');
  await symlink(join(daemon.repo, 'README.md'), path);
  assert.equal((await open('claude-coordinator')).error.code, 'INVALID_AGENT_PATH');
  await symlink(join(daemon.directory, 'agents', 'claude-coordinator'), join(daemon.directory, 'agents', 'linked'));
  assert.equal((await open('linked')).error.code, 'INVALID_AGENT_PATH');
  assert.equal(calls.length, 2);
});
