import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { uiFixture, until } from './ui-fixture.js';

const base64 = (text: string | Buffer) => Buffer.from(text).toString('base64');

test('HTTP 消息附件存到数据目录并返回绝对路径，对话和事件只带元数据，导出包含、删除工作时一起删除', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  const params = { projectId: daemon.project.id, key: 'start', body: '需求见附件',
    attachments: [{ name: '需求 说明.md', content: base64('# 需求\n') }, { name: 'mock.png', content: base64(image) }] };
  const sent = await daemon.call('send-message', params);
  assert.equal(sent.ok, true);
  const workId = sent.result.work.id;
  const directory = join(daemon.directory, 'data', 'attachments', workId, sent.result.message.id);
  assert.deepEqual(sent.result.message.attachments, [
    { name: '需求 说明.md', path: join(directory, '需求 说明.md'), size: 9 },
    { name: 'mock.png', path: join(directory, 'mock.png'), size: image.length },
  ]);
  assert.equal(await readFile(join(directory, '需求 说明.md'), 'utf8'), '# 需求\n');
  assert.deepEqual(await readFile(join(directory, 'mock.png')), image);
  // Retrying the same key returns the stored message without writing again.
  assert.deepEqual((await daemon.call('send-message', params)).result.message, sent.result.message);

  const conversation = (await daemon.call('get-conversation', { workId })).result;
  assert.deepEqual(conversation.find((item: any) => item.type === 'message').attachments, sent.result.message.attachments);
  const event = (await daemon.call('get-events', { workId })).result.find((item: any) => item.action === 'message-sent');
  assert.deepEqual(event.details.attachments, sent.result.message.attachments);
  assert.doesNotMatch(JSON.stringify(event), new RegExp(base64(image)));
  const plain = await daemon.call('send-message', { workId, key: 'plain', body: '没有附件' });
  assert.deepEqual(plain.result.message.attachments, []);

  assert.equal((await daemon.call('cancel-work', { workId })).ok, true);
  const targetPath = join(daemon.directory, 'export.tar.gz');
  assert.equal((await daemon.call('export-outputs', { workId, targetPath })).ok, true);
  const extracted = join(daemon.directory, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', targetPath, '-C', extracted]);
  assert.deepEqual(await readFile(join(extracted, 'attachments', workId, sent.result.message.id, 'mock.png')), image);
  assert.equal((await daemon.call('delete-work', { workId, confirm: true })).ok, true);
  assert.equal(existsSync(join(daemon.directory, 'data', 'attachments', workId)), false);
});

test('HTTP 拒绝带路径或重名的附件名、非 base64 内容和超过 20 MiB 的附件，不新建工作', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const send = (key: string, attachments: object[]) => daemon.call('send-message', { projectId: daemon.project.id, key, body: '附件', attachments });
  for (const name of ['../escape.md', 'dir/file.md', '..', 'a\\b']) {
    const result = await send(name, [{ name, content: base64('x') }]);
    assert.equal(result.error.code, 'INVALID_PARAMS', name);
  }
  assert.equal((await send('dup', [{ name: 'a.md', content: base64('1') }, { name: 'a.md', content: base64('2') }])).error.code, 'INVALID_PARAMS');
  assert.equal((await send('bad', [{ name: 'a.md', content: '不是 base64' }])).error.code, 'INVALID_PARAMS');
  const large = await send('large', [{ name: 'a.bin', content: Buffer.alloc(11 * 1024 * 1024).toString('base64') },
    { name: 'b.bin', content: Buffer.alloc(10 * 1024 * 1024).toString('base64') }]);
  assert.equal(large.status, 413);
  assert.equal(large.error.code, 'ATTACHMENTS_TOO_LARGE');
  assert.deepEqual((await daemon.call('list-works')).result, []);
  assert.equal(existsSync(join(daemon.directory, 'data', 'attachments')), false);
});

test('CLI --attach 读取本地文件作为附件发送', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const first = join(daemon.directory, 'spec.md');
  const second = join(daemon.directory, 'notes.txt');
  await writeFile(first, '规格');
  await writeFile(second, '备注');
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'send-message', '--url', daemon.url, '--projectId', daemon.project.id, '--key', 'cli', '--body', '看附件', '--attach', first, '--attach', second]);
  const attachments = JSON.parse(stdout).result.message.attachments;
  assert.deepEqual(attachments.map((item: any) => item.name), ['spec.md', 'notes.txt']);
  assert.equal(await readFile(attachments[0].path, 'utf8'), '规格');
});

test('references 把其他工作的说明和成果提交写成快照附件，拒绝引用自身和不存在的工作', async t => {
  const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '调研', boundary: '本机', criteria: '有结论' }), check: ok },
  ], [], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '写结论' }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'dispatch', cardId: (ctx.results.get('card') as any).result.id, agentId: 'claude-executor' }), check: ok },
  ]], undefined, { executorScripts: [[{ type: 'hang' }]] });
  t.after(() => daemon.close());
  const source = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'research', body: '调研缓存方案' })).result.work;
  const params = { workId: source.id };
  // Before any code-writing dispatch the referenced work has no work branch (ADR 0018).
  await until(() => daemon.call('get-work-descriptions', params), value => value.result.length > 0);
  const earlySent = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'early', body: '先看调研', references: [source.id] })).result;
  const early = earlySent.message.attachments[0];
  // The referencing work's own round takes the empty script before the source work is confirmed.
  await until(() => daemon.call('list-rounds', { workId: earlySent.work.id }), value => value.result.rounds[0]?.status === 'ended');
  assert.match(await readFile(early.path, 'utf8'), /成果提交：无（这项工作没有代码改动）/);
  const description = (await daemon.call('get-work-descriptions', params)).result[0];
  ok(await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  const sourcePath = (await until(() => daemon.call('get-work', params), value => Boolean(value.result.workPath))).result.workPath;
  await writeFile(join(sourcePath, 'research.md'), '# 结论\n');
  execFileSync('git', ['-C', sourcePath, 'add', 'research.md']);
  execFileSync('git', ['-C', sourcePath, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'research']);
  const commit = execFileSync('git', ['-C', sourcePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  const sent = await daemon.call('send-message', { projectId: daemon.project.id, key: 'use', body: '按调研实现', references: [source.id] });
  assert.equal(sent.ok, true);
  const [snapshot] = sent.result.message.attachments;
  assert.equal(snapshot.name, `引用工作-${source.id.slice(0, 8)}.md`);
  const text = await readFile(snapshot.path, 'utf8');
  assert.match(text, /^# 引用的工作：调研缓存方案/);
  assert.match(text, new RegExp(`成果提交：${commit}`));
  assert.match(text, /- A research\.md/);
  assert.ok(text.includes(`git -C ${daemon.repo} show ${commit}:<路径>`));

  const workId = sent.result.work.id;
  assert.equal((await daemon.call('send-message', { workId, key: 'self', body: 'x', references: [workId] })).error.code, 'INVALID_REFERENCE');
  assert.equal((await daemon.call('send-message', { workId, key: 'missing', body: 'x', references: ['nope'] })).error.code, 'NOT_FOUND');
});
