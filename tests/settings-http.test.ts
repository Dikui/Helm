import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';

test('模板使用数只统计运行中派单和未结束的调度者工作，结束后归零', async t => {
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '需求', boundary: '边界', criteria: '标准' }) },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '卡片' }), saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', templateId: 'claude-executor' }) },
  ]], undefined, { executorScripts: [[{ type: 'hang' }]] });
  t.after(() => daemon.close());
  const templates = async () => (await daemon.call('list-agent-templates')).result;
  const initial = await templates();
  assert.equal(initial.find((item: any) => item.id === 'claude-executor').runningDispatches, 0);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '使用数', key: 'start' })).result.work;
  const pending = await until(() => daemon.call('list-pending'), value => value.result.some((gate: any) => gate.descriptionId));
  const gate = pending.result.find((item: any) => item.kind === 'work-confirmation');
  await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'confirm', descriptionId: gate.descriptionId });
  await until(templates, value => value.find((item: any) => item.id === 'claude-executor').runningDispatches === 1);
  assert.equal((await templates()).find((item: any) => item.id === 'claude-coordinator').activeWorks, 1);
  await daemon.call('pause-work', { workId: work.id });
  assert.equal((await templates()).find((item: any) => item.id === 'claude-coordinator').activeWorks, 1);
  await daemon.call('cancel-work', { workId: work.id });
  const final = await templates();
  assert.equal(final.find((item: any) => item.id === 'claude-coordinator').activeWorks, 0);
  assert.equal(final.find((item: any) => item.id === 'claude-executor').runningDispatches, 0);
});

test('模板读取返回 skills 只读目录条目，不读取文件内容', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const skills = join(daemon.directory, 'templates', 'claude-executor', 'skills');
  await mkdir(join(skills, 'testing'), { recursive: true });
  await writeFile(join(skills, 'testing', 'SKILL.md'), 'read-only skill');
  await writeFile(join(skills, 'README.md'), 'read-only index');
  const templates = (await daemon.call('list-agent-templates')).result;
  assert.deepEqual(templates.find((item: any) => item.id === 'claude-executor').skills, ['README.md', 'testing/']);
});
