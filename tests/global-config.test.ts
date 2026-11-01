import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FakeDriver, type FakeContext, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';

test('加载全局配置按角色默认，保存和读取保留显式开关，拒绝非布尔值', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-global-config-'));
  const daemon = await startHelmd({ port: 0, dataDir: directory, drivers: { 'claude-sdk': new FakeDriver() } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => await (await fetch(`${daemon.url}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  })).json() as any;
  for (const role of ['coordinator', 'executor'] as const) {
    const config = { role, driver: 'claude-sdk', model: null, reasoningEffort: null, home: 'shared', description: '测试 Agent' };
    const saved = await call('save-agent', { id: role, config, prompt: '', mode: 'create' });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.result.loadGlobalConfig, role === 'executor');
    const updated = await call('save-agent', { id: role, config: { ...config, loadGlobalConfig: role === 'coordinator' },
      prompt: '', mode: 'update', baseRevision: saved.result.revision });
    assert.equal(updated.ok, true, JSON.stringify(updated));
    const listed = (await call('list-agents')).result.find((entry: any) => entry.id === role);
    assert.equal(listed.config.loadGlobalConfig, role === 'coordinator');
    assert.equal(JSON.parse(await readFile(join(directory, 'agents', role, 'config.json'), 'utf8')).loadGlobalConfig, role === 'coordinator');
    const invalid = await call('save-agent', { id: role, config: { ...config, loadGlobalConfig: 'false' },
      prompt: '', mode: 'update', baseRevision: updated.result.revision });
    assert.equal(invalid.error.code, 'INVALID_PARAMS');
    assert.match(invalid.error.reason, /loadGlobalConfig/);
    await writeFile(join(directory, 'agents', role, 'config.json'), JSON.stringify({ ...config, loadGlobalConfig: 0 }));
    assert.equal((await call('list-agents')).result.find((entry: any) => entry.id === role).available, false);
  }
});

test('启动迁移已有 Agent 的全局配置默认值，保留显式值和坏文件，重启不覆盖用户选择', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-global-config-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configs = [
    { id: 'coordinator', role: 'coordinator' },
    { id: 'executor', role: 'executor' },
    { id: 'api', role: 'coordinator', home: 'dedicated' },
    { id: 'explicit', role: 'executor', loadGlobalConfig: false },
  ];
  for (const { id, ...config } of configs) {
    await mkdir(join(directory, 'agents', id), { recursive: true });
    await writeFile(join(directory, 'agents', id, 'config.json'), JSON.stringify({ driver: 'claude-sdk', model: null,
      reasoningEffort: null, home: 'shared', description: '旧 Agent', ...config }));
    await writeFile(join(directory, 'agents', id, 'prompt.md'), '保留附加提示词');
  }
  await mkdir(join(directory, 'agents', 'broken'));
  await writeFile(join(directory, 'agents', 'broken', 'config.json'), '{');
  for (let startup = 0; startup < 2; startup++) {
    const daemon = await startHelmd({ port: 0, dataDir: directory, drivers: { 'claude-sdk': new FakeDriver() } });
    try {
      for (const [id, expected] of [['coordinator', false], ['executor', true], ['api', false], ['explicit', false]] as const) {
        const path = join(directory, 'agents', id);
        assert.equal(JSON.parse(await readFile(join(path, 'config.json'), 'utf8')).loadGlobalConfig, expected);
        assert.equal(await readFile(join(path, 'prompt.md'), 'utf8'), '保留附加提示词');
      }
      assert.equal(await readFile(join(directory, 'agents', 'broken', 'config.json'), 'utf8'), '{');
    } finally { await daemon.close(); }
  }
});

test('全局配置开关进入轮次快照，保存不改变当前轮次，下一轮新开，未改动时继续续跑', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-global-config-rounds-'));
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const seen: FakeContext['options'][] = [];
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const round = (...steps: FakeStep[]) => (ctx: FakeContext) => { seen.push(ctx.options); return steps; };
  const driver = new FakeDriver([round({ type: 'hang', until: hold }, small), round(small), round(small), round(small)]);
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), drivers: { 'claude-sdk': driver } });
  t.after(async () => { release(); await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const value = await (await fetch(`${daemon.url}/api/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    })).json() as any;
    assert.equal(value.ok, true, JSON.stringify(value));
    return value.result;
  };
  const wait = async (ready: () => Promise<boolean>) => {
    const deadline = Date.now() + 5_000;
    while (!await ready()) {
      assert.ok(Date.now() < deadline, '等待调度轮次超时');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  await call('save-agent', { id: 'claude-coordinator', mode: 'create', prompt: '', config: { role: 'coordinator',
    driver: 'claude-sdk', model: null, reasoningEffort: null, home: 'shared', description: '测试调度者' } });
  const project = await call('register-project', { path: directory });
  const { work } = await call('send-message', { projectId: project.id, body: '开始', key: 'start' });
  await wait(async () => seen.length === 1);
  const toggle = async (loadGlobalConfig: boolean) => {
    const current = (await call('list-agents'))[0];
    await call('save-agent', { id: current.id, mode: 'update', baseRevision: current.revision,
      config: { ...current.config, loadGlobalConfig }, prompt: current.prompt });
  };
  await toggle(true);
  assert.equal(seen[0]!.agent.loadGlobalConfig, false);
  release();
  const events = () => call('get-events', { workId: work.id }) as Promise<any[]>;
  await wait(async () => (await events()).filter(event => event.action === 'round-ended').length === 1);
  for (let index = 1; index < 4; index++) {
    if (index === 3) await toggle(false);
    await call('send-message', { workId: work.id, body: '继续', key: `next-${index}` });
    await wait(async () => (await events()).filter(event => event.action === 'round-ended').length === index + 1);
  }
  assert.deepEqual(seen.map(options => options.agent.loadGlobalConfig), [false, true, true, false]);
  assert.deepEqual(seen.map(options => typeof options.resumeSessionId === 'string'), [false, false, true, false]);
  const snapshots = (await events()).filter(event => event.action === 'round-agent-loaded');
  assert.deepEqual(snapshots.map(event => event.details.agent.loadGlobalConfig), [false, true, true, false]);
  assert.deepEqual(snapshots.map(event => event.details.resumed), [false, false, true, false]);
});
