import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { uiFixture } from './ui-fixture.js';

test('HTTP 项目读取包含分支、HEAD 和改动数，git 不可读时保留项目并给出原因', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const path = daemon.project.path;
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  const read = async () => (await daemon.call('list-projects')).result[0];
  assert.deepEqual(await read(), { ...daemon.project, currentBranch: 'main', headCommit: head, uncommittedChanges: 0, gitStatusReason: null });
  await rename(join(path, 'README.md'), join(path, 'renamed\nfile.md'));
  git('add', 'README.md', 'renamed\nfile.md');
  await writeFile(join(path, 'new\nfile.md'), 'untracked');
  assert.equal((await read()).uncommittedChanges, 2);
  git('checkout', '--detach', head);
  assert.equal((await read()).currentBranch, null);
  assert.equal((await read()).headCommit, head);
  await rm(path, { recursive: true, force: true });
  const unavailable = await read();
  assert.equal(unavailable.id, daemon.project.id);
  assert.equal(unavailable.headCommit, null);
  assert.equal(unavailable.uncommittedChanges, null);
  assert.match(unavailable.gitStatusReason, /git/);
});
