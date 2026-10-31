import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { existingWorkCopy } from './helmd-fixture.js';
import { uiFixture, until } from './ui-fixture.js';

test('HTTP 读取工作分支上的文件和本工作的附件，拒绝范围外和不存在的路径', async t => {
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '出图', boundary: '仓库内', criteria: '有图' }) },
  ], [{ type: 'hang' }]]);
  t.after(() => daemon.close());
  const sent = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '见附件',
    attachments: [{ name: 'spec.md', content: Buffer.from('# 规格\n').toString('base64') }] })).result;
  const workId = sent.work.id;
  assert.deepEqual((await daemon.call('list-work-files', { workId })).result, []);
  existingWorkCopy(join(daemon.directory, 'data'), workId);
  assert.deepEqual((await daemon.call('list-work-files', { workId })).result, ['README.md']);
  assert.equal((await daemon.call('read-work-file', { workId, path: 'README.md' })).result.content, 'baseline\n');
  assert.equal((await daemon.call('read-work-file', { workId, path: sent.message.attachments[0].path })).result.content, '# 规格\n');

  const descriptions = await until(() => daemon.call('get-work-descriptions', { workId }), value => value.result.length === 1);
  const description = descriptions.result[0];
  assert.equal((await daemon.call('decide-gate', { workId, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  const work = (await daemon.call('get-work', { workId })).result;
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  await mkdir(join(work.workPath, 'outputs'));
  await writeFile(join(work.workPath, 'outputs', 'report.md'), '# 报告\n![图](plot.png)\n');
  await writeFile(join(work.workPath, 'outputs', 'plot.png'), image);
  const git = (...args: string[]) => execFileSync('git', ['-C', work.workPath, ...args]);
  git('add', 'outputs');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'outputs');

  const files = (await daemon.call('list-work-files', { workId })).result;
  assert.ok(files.includes('outputs/report.md') && files.includes('outputs/plot.png'), JSON.stringify(files));
  assert.deepEqual((await daemon.call('read-work-file', { workId, path: 'outputs/report.md' })).result,
    { path: 'outputs/report.md', size: Buffer.byteLength('# 报告\n![图](plot.png)\n'), content: '# 报告\n![图](plot.png)\n' });
  assert.equal((await daemon.call('read-work-file', { workId, path: 'outputs/plot.png', encoding: 'base64' })).result.content, image.toString('base64'));
  // Uncommitted files in the work copy are not on the branch.
  await writeFile(join(work.workPath, 'draft.md'), '草稿');
  for (const path of ['draft.md', 'outputs', '../outside.md', 'missing.md']) {
    assert.equal((await daemon.call('read-work-file', { workId, path })).error.code, 'FILE_NOT_FOUND', path);
  }
  assert.equal((await daemon.call('read-work-file', { workId, path: join(work.workPath, 'outputs', 'report.md') })).error.code, 'FILE_SCOPE');
  assert.equal((await daemon.call('read-work-file', { workId, path: join(daemon.directory, 'nothing') })).error.code, 'FILE_NOT_FOUND');
});
