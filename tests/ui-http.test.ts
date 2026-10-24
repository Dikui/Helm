import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';

// Use raw request targets: fetch / URL normalize literal dot segments away.
function rawGet(url: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { path }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end();
  });
}

test('GET 托管构建产物、深链接回落，拒绝路径穿越，POST 接口保持不变', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const response = await fetch(daemon.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/html/);
  const html = await response.text();
  assert.match(html, /id="root"/);
  const asset = html.match(/src="([^"]+\.js)"/)![1]!;
  const js = await fetch(`${daemon.url}${asset}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type')!, /javascript/);
  assert.equal(await (await fetch(`${daemon.url}/works/example/brief`)).text(), html);
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/..%5cpackage.json', '/%00', '/%zz']) {
    assert.equal(await rawGet(daemon.url, path), 400, path);
  }
  for (const path of ['/api/get-settings', '/events', '/mcp']) assert.equal((await fetch(`${daemon.url}${path}`)).status, 405);
  assert.equal((await daemon.call('get-settings')).result.concurrencyLimit, 10);
});

test('静态文件的符号链接不能逃出静态目录', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-static-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<main>Helm</main>');
  await symlink(join(process.cwd(), 'package.json'), join(directory, 'secret.json'));
  const daemon = await uiFixture([], directory);
  t.after(() => daemon.close());
  assert.equal((await fetch(`${daemon.url}/secret.json`)).status, 400);
});

test('工作读取补标题、事件摘要、状态起点、卡片计数及未决关卡摘要', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const body = '界'.repeat(90) + '\n这是第二行';
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body, key: 'first' })).result.work;
  const details = (await daemon.call('get-work', { workId: work.id })).result;
  assert.equal(details.title, '界'.repeat(79) + '…');
  const list = () => daemon.call('list-works');
  await until(() => daemon.call('get-events', { workId: work.id }), value => value.result.some((e: any) => e.action === 'round-ended'));
  const row = (await list()).result[0];
  assert.equal(row.title, details.title);
  assert.equal(row.statusSince, work.createdAt);
  assert.equal(row.summary, '调度轮次结束');
  assert.equal(row.completedCards, 0);
  assert.equal(row.totalCards, 0);
  assert.equal(row.hasPendingGate, true);
  assert.equal(row.pendingGates[0].question, '确认工作说明');
  assert.equal(row.pendingGates[0].kind, 'work-confirmation');
  await daemon.call('pause-work', { workId: work.id });
  const paused = (await list()).result[0];
  const events = (await daemon.call('get-events', { workId: work.id })).result;
  assert.equal(paused.statusSince, events.findLast((e: any) => e.action === 'work-paused').time);
  await daemon.call('send-message', { workId: work.id, body: '跟进\n不重置计时', key: 'followup' });
  assert.equal((await list()).result[0].statusSince, paused.statusSince);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.title, details.title);
  await daemon.call('cancel-work', { workId: work.id });
  const ended = (await list()).result[0];
  assert.equal(ended.hasPendingGate, false);
  assert.deepEqual(ended.pendingGates, []);
  assert.equal((await daemon.call('list-works', { projectId: 'other' })).result.length, 0);
});
