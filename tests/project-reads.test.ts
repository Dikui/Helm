import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(await read(), { ...daemon.project, isGit: true, currentBranch: 'main', headCommit: head, uncommittedChanges: 0, gitStatusReason: null });
  await rename(join(path, 'README.md'), join(path, 'renamed\nfile.md'));
  git('add', 'README.md', 'renamed\nfile.md');
  await writeFile(join(path, 'new\nfile.md'), 'untracked');
  assert.equal((await read()).uncommittedChanges, 2);
  git('checkout', '--detach', head);
  assert.equal((await read()).isGit, false);
  assert.equal((await read()).currentBranch, null);
  assert.equal((await read()).headCommit, null);
  await rm(path, { recursive: true, force: true });
  const unavailable = await read();
  assert.equal(unavailable.id, daemon.project.id);
  assert.equal(unavailable.headCommit, null);
  assert.equal(unavailable.uncommittedChanges, null);
  assert.match(unavailable.gitStatusReason, /git/);
});

test('HTTP 可用基准只列本地分支并标识当前检出分支，空项目和读取失败可区分', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('branch', 'release/1.0');
  git('tag', 'release-tag');
  git('update-ref', 'refs/remotes/origin/remote-only', 'HEAD');
  const read = () => daemon.call('list-project-branches', { projectId: daemon.project.id });
  assert.deepEqual((await read()).result, { currentBranch: 'main', branches: ['main', 'release/1.0'] });
  git('checkout', '--detach');
  assert.equal((await read()).result.currentBranch, null);
  git('branch', '-D', 'main', 'release/1.0');
  assert.deepEqual((await read()).result.branches, []);
  await rm(daemon.repo, { recursive: true, force: true });
  assert.equal((await read()).error.code, 'PROJECT_BRANCHES_UNAVAILABLE');
  assert.equal((await daemon.call('list-project-branches', { projectId: 'missing' })).error.code, 'NOT_FOUND');
});

test('HTTP 删除空项目只移除登记和记录事件，仓库文件保留；不存在时返回 NOT_FOUND', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const result = await daemon.call('delete-project', { projectId: daemon.project.id });
  assert.equal(result.status, 200);
  assert.deepEqual(result.result, { id: daemon.project.id, deleted: true });
  assert.deepEqual((await daemon.call('list-projects')).result, []);
  assert.ok((await lstat(daemon.repo)).isDirectory());
  assert.ok((await lstat(join(daemon.repo, '.git'))).isDirectory());
  assert.equal(await readFile(join(daemon.repo, 'README.md'), 'utf8'), 'baseline\n');
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'project-deleted');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].object, { type: 'project', id: daemon.project.id });
  assert.equal(events[0].actor.type, 'user');
  const missing = await daemon.call('delete-project', { projectId: daemon.project.id });
  assert.equal(missing.status, 404);
  assert.equal(missing.error.code, 'NOT_FOUND');
});

test('HTTP 删除有工作的项目被拒绝，工作数包含已取消的工作', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  for (const key of ['cancelled', 'aligning']) {
    const result = await daemon.call('send-message', { projectId: daemon.project.id, body: key, key });
    assert.equal(result.ok, true);
    if (key === 'cancelled') assert.equal((await daemon.call('cancel-work', { workId: result.result.work.id })).ok, true);
  }
  const result = await daemon.call('delete-project', { projectId: daemon.project.id });
  assert.equal(result.status, 409);
  assert.equal(result.error.code, 'PROJECT_IN_USE');
  assert.match(result.error.reason, /2 项工作.*先删除/);
  assert.deepEqual(result.error.details, { projectId: daemon.project.id, workCount: 2 });
  assert.equal((await daemon.call('list-projects')).result[0].id, daemon.project.id);
  assert.equal((await daemon.call('list-works')).result.length, 2);
  assert.equal((await daemon.call('get-events')).result.filter((event: any) => event.action === 'project-deleted').length, 0);
});

test('HTTP 列出子目录并标出 git 仓库；登记已有目录不初始化 git', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  await mkdir(join(daemon.directory, '.hidden'));
  const listing = (await daemon.call('list-directories', { path: `${daemon.directory}/` })).result;
  assert.equal(listing.path, daemon.directory);
  assert.deepEqual(listing.directories.find((entry: any) => entry.name === 'project'), { name: 'project', git: true });
  assert.ok(!listing.directories.some((entry: any) => entry.name === '.hidden'));
  assert.equal((await daemon.call('list-directories', { path: join(daemon.directory, 'missing') })).error.code, 'DIRECTORY_UNAVAILABLE');
  const created = join(daemon.repo, 'new', 'app');
  const refused = await daemon.call('register-project', { path: created });
  assert.equal(refused.error.code, 'INVALID_PROJECT');
  assert.match(refused.error.reason, /不存在/);
  assert.equal(refused.error.details.missing, true);
  assert.equal(existsSync(created), false);
  assert.equal((await daemon.call('register-project', { path: created, initGit: true })).error.code, 'INVALID_PARAMS');
  for (const createDirectory of [false, true]) {
    const file = await daemon.call('register-project', { path: join(daemon.repo, 'README.md'), createDirectory });
    assert.equal(file.error.code, 'INVALID_PROJECT');
    assert.equal(file.error.details?.missing, undefined);
  }
  const directory = join(daemon.directory, 'plain');
  await mkdir(directory);
  await writeFile(join(directory, 'existing.txt'), '保留原文件');
  const project = (await daemon.call('register-project', { path: directory })).result;
  assert.equal(project.path, directory);
  assert.equal((await daemon.call('register-project', { path: directory })).result.id, project.id);
  const read = (await daemon.call('list-projects')).result.find((item: any) => item.id === project.id);
  assert.equal(read.isGit, false);
  assert.equal(read.currentBranch, null);
  assert.equal(read.headCommit, null);
  assert.equal(existsSync(join(directory, '.git')), false);
  assert.equal(await readFile(join(directory, 'existing.txt'), 'utf8'), '保留原文件');
  // Empty git directories are accepted without Helm adding an initial commit.
  execFileSync('git', ['init', directory], { stdio: 'ignore' });
  assert.equal((await daemon.call('register-project', { path: directory })).result.id, project.id);
  const empty = (await daemon.call('list-projects')).result.find((item: any) => item.id === project.id);
  assert.equal(empty.isGit, false);
  assert.equal(empty.currentBranch, null);
  assert.equal(empty.headCommit, null);
  const work = await daemon.call('send-message', { projectId: project.id, key: 'unborn', body: '先只读' });
  assert.equal(work.ok, true);
  assert.equal(work.result.work.baseRef, null);
  assert.throws(() => execFileSync('git', ['-C', directory, 'rev-parse', '--verify', 'HEAD'], { stdio: 'pipe' }));
});

for (const segments of [['created'], ['new', 'app']]) test(`HTTP 缺失目录 ${segments.join('/')} 确认后递归创建并登记，不初始化 git`, async t => {
  const daemon = await uiFixture([], undefined, { registerProject: false });
  t.after(() => daemon.close());
  const path = join(daemon.directory, ...segments);
  for (const params of [{ path }, { path, createDirectory: false }]) {
    const refused = await daemon.call('register-project', params);
    assert.equal(refused.status, 400);
    assert.equal(refused.error.code, 'INVALID_PROJECT');
    assert.equal(refused.error.details.missing, true);
    assert.equal(existsSync(join(daemon.directory, segments[0]!)), false);
    assert.deepEqual((await daemon.call('list-projects')).result, []);
  }
  const response = await daemon.call('register-project', { path, createDirectory: true });
  assert.equal(response.status, 200);
  assert.equal(response.result.path, path);
  assert.equal(response.result.name, segments.at(-1));
  assert.ok((await lstat(path)).isDirectory());
  const projects = (await daemon.call('list-projects')).result;
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, response.result.id);
  assert.equal(projects[0].isGit, false);
  assert.equal(projects[0].currentBranch, null);
  assert.equal(projects[0].headCommit, null);
  for (let index = 1; index <= segments.length; index++) assert.equal(existsSync(join(daemon.directory, ...segments.slice(0, index), '.git')), false);
  assert.equal((await daemon.call('register-project', { path, createDirectory: true })).result.id, response.result.id);
});
