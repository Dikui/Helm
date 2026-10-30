import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { uiFixture, until } from '../ui-fixture.js';

// Real HTTP/store/SSE, fake agents; also used by the headed screenshot case.
export async function gitInitializationFixture(existingIgnore = false, staticDir?: string) {
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: '修改项目', boundary: '项目目录', criteria: '保留现有文件' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'write', content: '修改现有文件' }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'write', agentId: 'claude-executor' }),
      check: value => assert.equal((value as any).error.code, 'GIT_INITIALIZATION_PENDING') },
  ], [
    { type: 'tool', name: 'send-message', arguments: { key: 'decided', body: '已收到初始化 git 的决定。' } },
  ]], staticDir, { registerProject: false });
  try {
    const projectPath = join(daemon.directory, 'plain-project');
    await mkdir(join(projectPath, 'node_modules'), { recursive: true });
    await writeFile(join(projectPath, 'node_modules', 'dep.js'), 'dependency\n');
    await writeFile(join(projectPath, '.env'), 'SECRET=private\n');
    await writeFile(join(projectPath, 'README.md'), 'existing project\n');
    if (existingIgnore) await writeFile(join(projectPath, '.gitignore'), '.env\nnode_modules/\n');
    const project = (await daemon.call('register-project', { path: projectPath })).result;
    const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '修改项目' })).result.work;
    const params = { workId: work.id };
    const description = (await until(() => daemon.call('get-work-descriptions', params), value => value.result.length === 1)).result[0];
    await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
    assert.equal((await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
    const pending = await until(() => daemon.call('list-pending'), value => value.result.some((gate: any) => gate.kind === 'git-initialization'));
    await until(() => daemon.call('list-rounds', params), value => value.result.rounds[1]?.status === 'ended');
    return { daemon, projectPath, work, gate: pending.result.find((gate: any) => gate.kind === 'git-initialization') };
  } catch (error) { await daemon.close(); throw error; }
}
