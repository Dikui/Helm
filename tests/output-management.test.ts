import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { FakeDriver, type FakeContext, type FakeScript } from '../src/driver.js';
import { startHelmd } from '../src/server.js';

const workIdOf = (ctx: FakeContext) => JSON.parse(ctx.input).work.id as string;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待输出管理超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, executor: FakeScript, after: FakeScript = []) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-output-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
  const dataDir = join(directory, 'data');
  const scripts = (): FakeScript[] => [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '保存输出', boundary: '本机', criteria: '内容不丢' }), check: ok },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '生成输出' }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', templateId: 'claude-executor' }), check: ok },
  ], after];
  let daemon = await startHelmd({ port: 0, dataDir, executorDriver: new FakeDriver([executor]), driver: new FakeDriver(scripts()) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(body));
    ok(body);
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const { work } = await call('send-message', { projectId: project.id, key: 'start', body: '开始' });
  const params = { workId: work.id };
  const events = async (): Promise<any[]> => call('get-events');
  await until(events, events => events.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending'))[0];
  await call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  const dispatch = await until(async () => (await call('list-dispatches', params))[0], value => value?.status === 'running' || value?.status === 'ended');
  const output = () => call('get-dispatch-output', { ...params, dispatchId: dispatch.id });
  const restart = async (nextExecutor?: FakeScript) => {
    await daemon.close();
    daemon = await startHelmd({ port: 0, dataDir, driver: new FakeDriver(nextExecutor ? scripts() : []), executorDriver: new FakeDriver(nextExecutor ? [nextExecutor] : []) });
  };
  return { call, params, project, events, dispatch, output, restart, dataDir, url: daemon.url };
}

test('工作取消后压缩所有派单与轮次输出，透明读取和步骤筛选保留原内容，重启后仍可读', async t => {
  const daemon = await fixture(t, [
    { type: 'output', text: '取消前的输出 中文\n第二行' }, { type: 'compaction' }, { type: 'output', text: '第三步' }, { type: 'hang' },
  ], [{ type: 'output', text: '调度者仍在运行' }, { type: 'hang' }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step' && event.details.step === 3));
  await until(daemon.events, events => events.filter(event => event.action === 'round-started').length >= 3);
  const before = await daemon.output();
  assert.equal(before[0].text, '取消前的输出 中文\n第二行');
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json')), true);
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json.gz')), false);
  const roundPaths = (await daemon.events()).filter(event => event.action === 'round-started').map(event => event.details.outputPath as string);
  for (const path of roundPaths) assert.equal(existsSync(`${path}.gz`), false);
  await daemon.call('cancel-work', daemon.params);
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json')), false);
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(daemon.dispatch.outputPath, '1.json.gz'))).toString()), before[0]);
  assert.deepEqual(await daemon.output(), before);
  assert.deepEqual(await daemon.call('get-dispatch-output', { ...daemon.params, dispatchId: daemon.dispatch.id, fromStep: 2, toStep: 3 }), before.slice(1));
  for (const path of roundPaths) {
    assert.equal(existsSync(path), false);
    assert.ok(gunzipSync(await readFile(`${path}.gz`)).length > 0);
  }
  await daemon.call('cancel-work', daemon.params);
  await daemon.restart();
  assert.deepEqual(await daemon.output(), before);
});

test('调小输出提示阈值会列出全局待处理事项并推送一次 SSE，重启不重复，阈值回落后再超限才重推', async t => {
  const daemon = await fixture(t, [{ type: 'output', text: '保留内容' }, { type: 'hang' }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  assert.equal((await daemon.call('get-settings')).outputThresholdBytes, 10_000_000_000);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${daemon.url}/events`, { method: 'POST', body: JSON.stringify({ after: (await daemon.events()).at(-1).id }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
  const notification = (async () => {
    let data = '';
    for await (const chunk of stream.body!) {
      data += new TextDecoder().decode(chunk);
      if (data.includes('event: needs-user-attention') && data.includes('"kind":"output-threshold"')) return data;
    }
    assert.fail('未收到输出超限 SSE 通知');
  })();
  await daemon.call('set-output-threshold', { thresholdBytes: 1 });
  assert.match(await notification, /"totalBytes":\d+/);
  controller.abort();
  const warning = (await daemon.call('list-pending')).find((item: any) => item.kind === 'output-threshold');
  assert.equal(warning.thresholdBytes, 1);
  assert.ok(warning.totalBytes > 1);
  const warnings = async () => (await daemon.events()).filter(event => event.action === 'needs-user-attention' && event.details.kind === 'output-threshold');
  await daemon.call('set-output-threshold', { thresholdBytes: 1 });
  await daemon.call('set-output-threshold', { thresholdBytes: 0 });
  assert.equal((await warnings()).length, 1);
  await daemon.restart();
  assert.equal((await daemon.call('get-settings')).outputThresholdBytes, 0);
  assert.equal((await warnings()).length, 1);
  assert.ok((await daemon.call('list-pending')).some((item: any) => item.kind === 'output-threshold'));
  await daemon.call('cancel-work', daemon.params);
  const output = await daemon.output();
  const { totalBytes } = (await daemon.call('list-pending')).find((item: any) => item.kind === 'output-threshold');
  // Equality is below the warning boundary; raising the setting re-arms it.
  await daemon.call('set-output-threshold', { thresholdBytes: totalBytes });
  assert.ok(!(await daemon.call('list-pending')).some((item: any) => item.kind === 'output-threshold'));
  await daemon.call('set-output-threshold', { thresholdBytes: 1 });
  await daemon.call('set-output-threshold', { thresholdBytes: 1 });
  assert.equal((await warnings()).length, 2);
  assert.deepEqual(await daemon.output(), output);
});

test('派单结束统计输出，终态压缩使实际用量回落后重新超限会再提示', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await fixture(t, [{ type: 'hang', until: hold }, { type: 'output', text: '原始输出'.repeat(50_000) }]);
  await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length >= 2);
  await daemon.call('set-output-threshold', { thresholdBytes: 100_000 });
  release();
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  const warnings = async () => (await daemon.events()).filter(event => event.action === 'needs-user-attention' && event.details.kind === 'output-threshold');
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json')), true, '派单结束但工作未结束时保留原文件');
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json.gz')), false);
  assert.equal((await warnings()).length, 1);
  assert.ok((await daemon.call('list-pending')).some((item: any) => item.kind === 'output-threshold'));
  const before = await daemon.output();
  await daemon.call('cancel-work', daemon.params);
  assert.ok(!(await daemon.call('list-pending')).some((item: any) => item.kind === 'output-threshold'));
  assert.deepEqual(await daemon.output(), before);
  // Simulate interrupted compression: both copies can remain after a crash.
  // Startup must finish compression and count the stored gzip bytes, not raw size.
  await writeFile(join(daemon.dispatch.outputPath, '1.json'), JSON.stringify(before[0]));
  assert.deepEqual(await daemon.output(), before, '原文件和 gzip 共存时同一步只返回一次');
  await daemon.restart();
  assert.equal(existsSync(join(daemon.dispatch.outputPath, '1.json')), false);
  assert.equal((await warnings()).length, 1);
  await daemon.restart([{ type: 'output', text: '新工作的原始输出'.repeat(50_000) }]);
  const { work } = await daemon.call('send-message', { projectId: daemon.project.id, key: 'second-work', body: '另一个工作' });
  await until(daemon.events, events => events.some(event => event.workId === work.id && event.action === 'round-ended'));
  const confirmation = (await daemon.call('list-pending')).find((item: any) => item.workId === work.id);
  await daemon.call('decide-gate', { workId: work.id, gateId: confirmation.id, descriptionId: confirmation.description.id, decision: 'confirm' });
  await until(daemon.events, events => events.some(event => event.workId === work.id && event.action === 'dispatch-ended'));
  assert.equal((await daemon.call('get-settings')).outputThresholdBytes, 100_000);
  assert.equal((await warnings()).length, 2);
  assert.deepEqual(await daemon.output(), before);
});
