import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { uiFixture } from './ui-fixture.js';

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
