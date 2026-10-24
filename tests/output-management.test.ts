import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FakeDriver, type FakeContext, type FakeScript } from '../src/driver.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';

const workIdOf = (ctx: FakeContext) => JSON.parse(ctx.input).work.id as string;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

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
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', agentId: 'claude-executor' }), check: ok },
  ], after];
  let daemon = await startHelmd({ port: 0, dataDir, executorDriver: new FakeDriver([executor]), driver: new FakeDriver(scripts()) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const call = async (name: string, params: object = {}) => {
    const body = await request(name, params);
    assert.equal(body.status, 200, JSON.stringify(body));
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
  return { call, request, params, project, events, dispatch, output, restart, dataDir, repo, directory, url: daemon.url };
}

test('已结束工作导出全部输出、成果和完整任务库记录，归档可独立解包', async t => {
  const daemon = await fixture(t, [
    { type: 'write', path: '结果.txt', content: '成果内容 中文\n' },
    { type: 'artifact', kind: 'file', path: '结果.txt' },
    { type: 'write', path: 'tests.txt', content: 'tests passed\n' },
    { type: 'artifact', kind: 'test-output', path: 'tests.txt' },
    { type: 'output', text: '执行者输出' },
  ], [
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '第一版调度笔记' }), check: ok },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '导出时保留调度笔记' }), check: ok },
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'revision', requirements: '修订后的说明', boundary: '本机', criteria: '仍保留旧版本' }), check: ok },
    { type: 'output', text: '调度者输出' },
  ]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended')
    && events.some(event => event.action === 'work-description-drafted' && event.details.version === 2));
  const browserDir = join(daemon.dispatch.outputPath, '..', 'browser');
  await mkdir(browserDir);
  await writeFile(join(browserDir, 'screenshot.png'), Buffer.from([137, 80, 78, 71]));
  await daemon.call('cancel-work', daemon.params);
  const other = await daemon.call('send-message', { projectId: daemon.project.id, key: 'other-work', body: 'OTHER-WORK-NOT-EXPORTED' });
  const before = await daemon.output();
  const artifacts = await daemon.call('get-dispatch-artifacts', { ...daemon.params, dispatchId: daemon.dispatch.id });
  const events = (await daemon.events()).filter(event => event.workId === daemon.params.workId);
  const targetPath = join(daemon.directory, '工作 输出.tar.gz');
  const result = await daemon.call('export-outputs', { ...daemon.params, targetPath });
  assert.equal(result.targetPath, targetPath);
  const extracted = join(daemon.directory, 'extracted');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', targetPath, '-C', extracted]);
  const records = JSON.parse(await readFile(join(extracted, 'records.json'), 'utf8'));
  assert.equal(records.work.id, daemon.params.workId);
  assert.equal(records.work.status, 'cancelled');
  assert.equal(records.workDescriptions.length, (await daemon.call('get-work-descriptions', daemon.params)).length);
  assert.equal(records.workDescriptions[0].requirements, '保存输出');
  assert.equal(records.workDescriptions[1].requirements, '修订后的说明');
  assert.equal(records.cards[0].content, '生成输出');
  assert.equal(records.dispatches[0].id, daemon.dispatch.id);
  assert.equal(records.coordinatorRounds.length, events.filter(event => event.action === 'round-started').length);
  assert.equal(records.coordinatorNotes[0].body, '导出时保留调度笔记');
  assert.equal(records.events.filter((event: any) => event.action === 'coordinator-notes-written').length, 2);
  assert.equal(records.messages[0].body, '开始');
  assert.equal(records.gates[0].decision, 'confirm');
  assert.deepEqual(records.events, events);
  assert.equal(records.artifacts.length, artifacts.length);
  assert.ok(!JSON.stringify(records).includes(other.work.id), '不导出其他工作的记录或输出');
  for (const file of records.files) {
    assert.deepEqual(await readFile(join(extracted, file.archivePath)), await readFile(file.sourcePath));
  }
  const stepFile = records.files.find((file: any) => file.archivePath.endsWith('/steps/1.json.gz'));
  assert.deepEqual(JSON.parse(gunzipSync(await readFile(join(extracted, stepFile.archivePath))).toString()), before[0]);
  assert.ok(records.files.some((file: any) => file.archivePath.endsWith('/browser/screenshot.png')));
  assert.equal(records.files.filter((file: any) => file.archivePath.startsWith('rounds/')).length, records.coordinatorRounds.length);
  for (const artifact of artifacts.filter((item: any) => item.path)) {
    assert.ok(records.files.some((file: any) => file.sourcePath === artifact.path));
  }
  assert.deepEqual(await daemon.output(), before);
  assert.ok((await daemon.call('get-work', daemon.params)).outputsExportedAt);
  await daemon.restart();
  assert.ok((await daemon.call('get-work', daemon.params)).outputsExportedAt);
  assert.deepEqual(await daemon.call('delete-outputs', daemon.params), { status: 'deleted', message: '已删除' });
  assert.ok(existsSync(targetPath), '导出归档保留');
});

test('未导出先提示，CLI 确认后只删原始事件流，保留成果、代码、记录和删除标记，重启可追溯', async t => {
  const daemon = await fixture(t, [
    { type: 'write', path: '成果.txt', content: '必须保留的成果\n' },
    { type: 'artifact', kind: 'file', path: '成果.txt' },
    { type: 'output', text: '可以删除的事件流' },
  ]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  await daemon.call('cancel-work', daemon.params);
  const before = await daemon.output();
  await writeFile(join(daemon.dispatch.outputPath, '1.json'), JSON.stringify(before[0]));
  const dispatch = await daemon.call('get-dispatch', { ...daemon.params, dispatchId: daemon.dispatch.id });
  const artifacts = await daemon.call('get-dispatch-artifacts', { ...daemon.params, dispatchId: daemon.dispatch.id });
  const artifact = artifacts.find((item: any) => item.kind === 'file');
  const events = await daemon.events();
  const roundPaths = events.filter(event => event.action === 'round-started').map(event => event.details.outputPath as string);
  const prompt = await daemon.call('delete-outputs', daemon.params);
  assert.equal(prompt.requiresConfirmation, true);
  assert.match(prompt.message, /导出/);
  assert.deepEqual(await daemon.output(), before);
  assert.equal((await daemon.call('get-work', daemon.params)).outputsDeletedAt, null);
  await daemon.call('set-output-threshold', { thresholdBytes: 1 });
  const { stdout } = await exec(process.execPath, [cliPath, 'delete-outputs', '--url', daemon.url,
    '--workId', daemon.params.workId, '--confirm', 'true']);
  assert.deepEqual(JSON.parse(stdout).result, { status: 'deleted', message: '已删除' });
  assert.deepEqual(await daemon.output(), { status: 'deleted', message: '已删除' });
  assert.equal((await daemon.call('get-dispatch', { ...daemon.params, dispatchId: dispatch.id })).outputStatus, 'deleted');
  assert.equal((await daemon.call('list-dispatches', daemon.params))[0].outputStatus, 'deleted');
  assert.ok((await daemon.call('get-work', daemon.params)).outputsDeletedAt);
  assert.equal(existsSync(join(dispatch.outputPath, '1.json')), false);
  assert.equal(existsSync(join(dispatch.outputPath, '1.json.gz')), false);
  for (const path of roundPaths) {
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.gz`), false);
  }
  assert.equal((await daemon.call('read-artifact', { ...daemon.params, artifactId: artifact.id })).content, '必须保留的成果\n');
  assert.equal(execFileSync('git', ['-C', daemon.repo, 'show', `${dispatch.endCommit}:成果.txt`], { encoding: 'utf8' }), '必须保留的成果\n');
  assert.deepEqual(await daemon.call('get-dispatch-artifacts', { ...daemon.params, dispatchId: dispatch.id }), artifacts);
  const afterEvents = await daemon.events();
  assert.deepEqual(afterEvents.slice(0, events.length), events);
  assert.equal(afterEvents.filter(event => event.action === 'outputs-deleted').length, 1);
  assert.ok(!(await daemon.call('list-pending')).some((item: any) => item.kind === 'output-threshold'));
  await daemon.restart();
  assert.deepEqual(await daemon.output(), { status: 'deleted', message: '已删除' });
  assert.equal((await daemon.call('read-artifact', { ...daemon.params, artifactId: artifact.id })).content, '必须保留的成果\n');
  assert.deepEqual(await daemon.call('delete-outputs', daemon.params), { status: 'deleted', message: '已删除' });
  assert.equal((await daemon.events()).filter(event => event.action === 'outputs-deleted').length, 1);
});

test('执行中、暂停和对齐中的工作均不能导出或删除，显式确认也不能越过终态限制', async t => {
  const daemon = await fixture(t, [{ type: 'output', text: '进行中的输出' }, { type: 'hang' }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  const targetPath = join(daemon.directory, 'unfinished.tar.gz');
  const reject = async (workId: string) => {
    for (const [name, params] of [
      ['export-outputs', { workId, targetPath }],
      ['delete-outputs', { workId, confirm: true }],
    ] as const) {
      const result = await daemon.request(name, params);
      assert.equal(result.status, 409);
      assert.equal(result.error.code, 'WORK_NOT_ENDED');
    }
    assert.equal(existsSync(targetPath), false);
  };
  await reject(daemon.params.workId);
  await daemon.call('pause-work', daemon.params);
  const before = await daemon.output();
  await reject(daemon.params.workId);
  assert.deepEqual(await daemon.output(), before);
  const { work } = await daemon.call('send-message', { projectId: daemon.project.id, key: 'aligning-work', body: '尚未确认的工作' });
  await reject(work.id);
});

test('导出失败不算已导出且不覆盖目标，CLI 生成导出命令后可省略删除确认', async t => {
  const daemon = await fixture(t, [{ type: 'output', text: '必须先导出' }, { type: 'hang' }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  await daemon.call('cancel-work', daemon.params);
  const existing = join(daemon.directory, 'existing.tar.gz');
  await writeFile(existing, '原有文件');
  const failed = await daemon.request('export-outputs', { ...daemon.params, targetPath: existing });
  assert.equal(failed.status, 409);
  assert.equal(failed.error.code, 'OUTPUT_EXPORT_FAILED');
  assert.equal(await readFile(existing, 'utf8'), '原有文件');
  assert.equal((await daemon.call('get-work', daemon.params)).outputsExportedAt, null);
  assert.equal((await daemon.call('delete-outputs', daemon.params)).requiresConfirmation, true);
  const { stdout: refused } = await exec(process.execPath, [cliPath, 'delete-outputs', '--url', daemon.url,
    '--workId', daemon.params.workId, '--confirm', 'false']);
  assert.equal(JSON.parse(refused).result.requiresConfirmation, true);
  const targetPath = join(daemon.directory, 'CLI 导出.tar.gz');
  const { stdout } = await exec(process.execPath, [cliPath, 'export-outputs', '--url', daemon.url,
    '--workId', daemon.params.workId, '--targetPath', targetPath]);
  assert.equal(JSON.parse(stdout).result.targetPath, targetPath);
  assert.ok(existsSync(targetPath));
  assert.deepEqual(await daemon.call('delete-outputs', daemon.params), { status: 'deleted', message: '已删除' });
});

test('同一工作的导出和删除串行完成，删除不会破坏正在生成的归档', async t => {
  const daemon = await fixture(t, [{ type: 'output', text: '归档必须保留的输出' }, { type: 'hang' }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  await daemon.call('cancel-work', daemon.params);
  const before = await daemon.output();
  const targetPath = join(daemon.directory, 'concurrent.tar.gz');
  const [exported, deleted] = await Promise.all([
    daemon.call('export-outputs', { ...daemon.params, targetPath }),
    daemon.call('delete-outputs', { ...daemon.params, confirm: true }),
  ]);
  assert.equal(exported.targetPath, targetPath);
  assert.equal(deleted.status, 'deleted');
  const output = execFileSync('tar', ['-xOzf', targetPath, `./dispatches/${daemon.dispatch.id}/steps/1.json.gz`]);
  assert.deepEqual(JSON.parse(gunzipSync(output).toString()), before[0]);
  assert.deepEqual(await daemon.output(), { status: 'deleted', message: '已删除' });
});

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
