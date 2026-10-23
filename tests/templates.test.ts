import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';

const workIdOf = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function fixture(t: TestContext, drivers: Record<string, Driver> = { 'claude-sdk': new FakeDriver() }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-templates-')));
  const templateDir = join(directory, 'templates');
  await mkdir(templateDir);
  const previousHome = process.env.HOME;
  process.env.HOME = join(directory, 'home');
  await mkdir(process.env.HOME);
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), templateDir, drivers });
  t.after(async () => {
    await daemon.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const writeTemplate = async (id: string, config: object = {}, prompt = '文件中的策略') => {
    const path = join(templateDir, id);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'config.json'), JSON.stringify({ role: 'executor', driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: '处理实现卡片', ...config }));
    await writeFile(join(path, 'prompt.md'), prompt);
  };
  return { ...daemon, directory, templateDir, call, writeTemplate };
}

test('模板目录是唯一来源，坏模板和 Claude fast 独立标为不可用，文件修好立即生效', async t => {
  const daemon = await fixture(t);
  assert.deepEqual((await daemon.call('list-agent-templates')).result, []);
  await daemon.writeTemplate('file-executor');
  await daemon.writeTemplate('api-executor', { home: 'template' });
  await daemon.writeTemplate('fast-executor', { fast: true });
  await daemon.writeTemplate('broken-executor');
  await writeFile(join(daemon.templateDir, 'broken-executor', 'config.json'), '{');
  await daemon.writeTemplate('unregistered-executor', { driver: 'codex' });
  await daemon.writeTemplate('invalid-settings', { env: { ANTHROPIC_API_KEY: 'unsupported' } });
  await daemon.writeTemplate('missing-prompt');
  await rm(join(daemon.templateDir, 'missing-prompt', 'prompt.md'));
  const templates = (await daemon.call('list-agent-templates')).result;
  const valid = templates.find((item: any) => item.id === 'file-executor');
  assert.equal(valid.role, 'executor');
  assert.equal(valid.driver, 'claude-sdk');
  assert.equal(valid.model, 'haiku');
  assert.equal(valid.description, '处理实现卡片');
  assert.equal(valid.billing, 'subscription');
  assert.equal(valid.available, true);
  assert.equal(templates.find((item: any) => item.id === 'api-executor').billing, 'api');
  const fast = templates.find((item: any) => item.id === 'fast-executor');
  assert.equal(fast.available, false);
  assert.match(fast.reason, /Claude fast 在订阅下要开 extra usage 并计入 extra usage/);
  const broken = templates.find((item: any) => item.id === 'broken-executor');
  assert.equal(broken.available, false);
  assert.match(broken.reason, /config.json/);
  assert.match(templates.find((item: any) => item.id === 'unregistered-executor').reason, /codex.*未登记/);
  assert.equal(templates.find((item: any) => item.id === 'invalid-settings').available, false);
  assert.match(templates.find((item: any) => item.id === 'missing-prompt').reason, /prompt.md/);
  await daemon.writeTemplate('broken-executor', { model: 'repaired' });
  assert.equal((await daemon.call('list-agent-templates')).result.find((item: any) => item.id === 'broken-executor').model, 'repaired');
  assert.equal((await daemon.call('configure-agent-template', { templateId: 'file-executor', model: 'ignored' })).error.code, 'UNKNOWN_OPERATION');
});

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, JSON.stringify(value));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function startWork(daemon: Awaited<ReturnType<typeof fixture>>) {
  const repo = join(daemon.directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
  const project = (await daemon.call('register-project', { path: repo })).result;
  const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '检查模板' })).result.work;
  const events = async (): Promise<any[]> => (await daemon.call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(value => value.action === 'round-ended'));
  return { project, work, events };
}

test('项目默认调度者模板可修改，新工作继承默认且现有工作保持原选择，重启后保留', async t => {
  const drivers = { 'claude-sdk': new FakeDriver(), codex: new FakeDriver() };
  const daemon = await fixture(t, drivers);
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator' });
  await daemon.writeTemplate('codex-coordinator', { role: 'coordinator', driver: 'codex' });
  const { project, work } = await startWork(daemon);
  assert.equal(project.defaultCoordinatorTemplateId, 'claude-coordinator');
  assert.equal(work.coordinatorTemplateId, 'claude-coordinator');
  const changed = await daemon.call('set-project-coordinator-template', { projectId: project.id, templateId: 'codex-coordinator' });
  ok(changed);
  assert.equal(changed.result.defaultCoordinatorTemplateId, 'codex-coordinator');
  const inherited = await daemon.call('send-message', { projectId: project.id, key: 'inherited', body: '用项目默认' });
  ok(inherited);
  assert.equal(inherited.result.work.coordinatorTemplateId, 'codex-coordinator');
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.coordinatorTemplateId, 'claude-coordinator');
  const inheritedEvents = await until(async () => (await daemon.call('get-events', { workId: inherited.result.work.id })).result as any[],
    events => events.some(event => event.action === 'round-ended'));
  assert.equal(inheritedEvents.find(event => event.action === 'round-template-loaded').details.template.id, 'codex-coordinator');
  await daemon.close();
  const restarted = await startHelmd({ port: 0, dataDir: join(daemon.directory, 'data'), templateDir: daemon.templateDir, drivers });
  t.after(() => restarted.close());
  const read = async (name: string, params: object = {}) => (await (await fetch(`${restarted.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) })).json() as any).result;
  assert.equal((await read('list-projects'))[0].defaultCoordinatorTemplateId, 'codex-coordinator');
  assert.equal((await read('get-work', { workId: inherited.result.work.id })).coordinatorTemplateId, 'codex-coordinator');
  assert.equal((await read('list-works')).find((item: any) => item.id === work.id).coordinatorTemplateId, 'claude-coordinator');
});

test('创建工作可指定调度者模板，key 重投保留选择且拒绝执行者、缺失和坏模板', async t => {
  const seen: string[] = [];
  const daemon = await fixture(t, { 'claude-sdk': new FakeDriver(), codex: new FakeDriver([ctx => {
    seen.push(ctx.options.template!.id);
    return [];
  }]) });
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator' });
  await daemon.writeTemplate('codex-coordinator', { role: 'coordinator', driver: 'codex' });
  await daemon.writeTemplate('executor');
  await daemon.writeTemplate('broken', { role: 'coordinator', fast: true });
  const { project, work } = await startWork(daemon);
  const params = { projectId: project.id, key: 'explicit', body: '用另一家调度', coordinatorTemplateId: 'codex-coordinator' };
  const created = await daemon.call('send-message', params);
  ok(created);
  assert.equal(created.result.work.coordinatorTemplateId, 'codex-coordinator');
  await until(async () => (await daemon.call('get-events', { workId: created.result.work.id })).result as any[],
    events => events.some(event => event.action === 'round-ended'));
  assert.deepEqual(seen, ['codex-coordinator']);
  const retried = await daemon.call('send-message', { ...params, coordinatorTemplateId: 'claude-coordinator' });
  ok(retried);
  assert.deepEqual(retried.result, created.result);
  assert.equal((await daemon.call('list-projects')).result[0].defaultCoordinatorTemplateId, 'claude-coordinator');
  for (const templateId of ['executor', 'missing', 'broken']) {
    const rejected = await daemon.call('send-message', { ...params, key: templateId, coordinatorTemplateId: templateId });
    assert.equal(rejected.error.code, 'TEMPLATE_UNAVAILABLE');
    assert.equal(rejected.error.details.templateId, templateId);
    assert.equal((await daemon.call('set-project-coordinator-template', { projectId: project.id, templateId })).error.code, 'TEMPLATE_UNAVAILABLE');
  }
  assert.equal((await daemon.call('list-works')).result.length, 2);
  const onExistingWork = await daemon.call('send-message', { workId: work.id, key: 'invalid', body: '创建后不能这样改模板', coordinatorTemplateId: 'codex-coordinator' });
  assert.equal(onExistingWork.error.code, 'INVALID_PARAMS');
});

test('换调度者模板只影响下一轮，当前运行或启动中的轮次不受影响，暂停时也可通过 CLI 更换', async t => {
  for (const phase of ['running', 'starting'] as const) await t.test(phase, async t => {
    let releaseStart!: () => void;
    let releaseRound!: () => void;
    const starting = new Promise<void>(resolve => { releaseStart = resolve; });
    const running = new Promise<void>(resolve => { releaseRound = resolve; });
    t.after(() => { releaseStart(); releaseRound(); });
    const seen: { template: any; input: any }[] = [];
    let firstOptions: FakeContext['options'] | undefined;
    const original = new FakeDriver([ctx => {
      seen.push({ template: structuredClone(ctx.options.template), input: JSON.parse(ctx.input) });
      return [{ type: 'hang', until: running }];
    }]);
    const record: FakeScript = ctx => {
      seen.push({ template: structuredClone(ctx.options.template), input: JSON.parse(ctx.input) });
      return [];
    };
    const replacements = new FakeDriver([record, record]);
    const daemon = await fixture(t, { 'claude-sdk': { async start(options) {
      firstOptions = options;
      if (phase === 'starting') await starting;
      return original.start(options);
    } }, codex: replacements });
    await daemon.writeTemplate('claude-coordinator', { role: 'coordinator', model: 'original' }, '原来的调度策略');
    await daemon.writeTemplate('codex-coordinator', { role: 'coordinator', driver: 'codex', model: 'replacement' }, '替换后的调度策略');
    await daemon.writeTemplate('executor');
    // startWork waits for round completion; register without waiting for this held round.
    const repo = join(daemon.directory, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    const project = (await daemon.call('register-project', { path: repo })).result;
    const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '开始调度' })).result.work;
    const params = { workId: work.id };
    const events = async (): Promise<any[]> => (await daemon.call('get-events', params)).result;
    await until(async () => phase === 'starting' ? Boolean(firstOptions) : seen.length === 1, Boolean);
    const firstRound = (await events()).find(event => event.action === 'round-started').object.id;
    for (const templateId of ['executor', 'missing']) {
      assert.equal((await daemon.call('change-coordinator-template', { ...params, templateId })).error.code, 'TEMPLATE_UNAVAILABLE');
    }
    const forbidden = await fetch(`${daemon.url}/api/change-coordinator-template`, { method: 'POST',
      headers: { Authorization: firstOptions!.mcpServers.helm!.headers.Authorization! },
      body: JSON.stringify({ ...params, templateId: 'codex-coordinator' }) });
    assert.equal(forbidden.status, 403);
    const changed = await daemon.call('change-coordinator-template', { ...params, templateId: 'codex-coordinator' });
    ok(changed);
    assert.equal(changed.result.coordinatorTemplateId, 'codex-coordinator');
    assert.equal(changed.result.status, 'aligning');
    ok(await daemon.call('change-coordinator-template', { ...params, templateId: 'codex-coordinator' }));
    assert.equal(firstOptions!.signal!.aborted, false);
    const during = await events();
    assert.equal(during.filter(event => event.action === 'round-started').length, 1);
    assert.equal(during.filter(event => event.action === 'round-ended').length, 0);
    const changes = during.filter(event => event.action === 'coordinator-template-changed');
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].details, { previousTemplateId: 'claude-coordinator', templateId: 'codex-coordinator' });
    assert.equal(changes[0].actor.type, 'user');
    releaseStart();
    await until(async () => seen.length, count => count === 1);
    assert.equal(seen[0]!.template.id, 'claude-coordinator');
    assert.equal(seen[0]!.input.work.coordinatorTemplateId, 'claude-coordinator');
    releaseRound();
    const ended = await until(events, values => values.filter(event => event.action === 'round-ended').length === 2);
    assert.equal(ended.find(event => event.action === 'round-ended' && event.object.id === firstRound).details.reason, 'completed');
    assert.deepEqual(seen.map(value => value.template.id), ['claude-coordinator', 'codex-coordinator']);
    assert.equal(seen[1]!.input.work.coordinatorTemplateId, 'codex-coordinator');
    assert.ok(seen[1]!.input.wakeEvents.some((event: any) => event.action === 'coordinator-template-changed'));
    assert.deepEqual(ended.filter(event => event.action === 'round-template-loaded').map(event => event.details.template.prompt), ['原来的调度策略', '替换后的调度策略']);

    ok(await daemon.call('pause-work', params));
    await daemon.writeTemplate('other-coordinator', { role: 'coordinator', driver: 'codex' });
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
      'change-coordinator-template', '--url', daemon.url, '--workId', work.id, '--templateId', 'other-coordinator']);
    const cliResult = JSON.parse(stdout);
    ok(cliResult);
    assert.equal(cliResult.result.status, 'paused');
    assert.equal(cliResult.result.coordinatorTemplateId, 'other-coordinator');
    assert.equal((await events()).filter(event => event.action === 'round-started').length, 2);
    ok(await daemon.call('resume-work', params));
    await until(events, values => values.filter(event => event.action === 'round-ended').length === 3);
    assert.equal(seen[2]!.template.id, 'other-coordinator');
    ok(await daemon.call('change-coordinator-template', { ...params, templateId: 'codex-coordinator' }));
    const afterIdleChange = await until(events, values => values.filter(event => event.action === 'round-ended').length === 4);
    assert.equal(afterIdleChange.filter(event => event.action === 'round-template-loaded').at(-1).details.template.id, 'codex-coordinator');
  });
});

const alignment = (ctx: FakeContext): FakeStep[] => [
  { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), key: 'draft', requirements: '模板文件生效', boundary: '本机', criteria: '快照和驱动一致' }, check: ok },
];

test('每次派单和调度轮次读取文件并留快照，下一轮按文件中的驱动路由，无须重启', async t => {
  const seen: { driver: string; template: any }[] = [];
  const jobs = ['first'];
  const script = (driver: string): FakeScript => ctx => {
    seen.push({ driver, template: structuredClone(ctx.options.template) });
    if (ctx.options.template?.role === 'executor') return [];
    if (JSON.parse(ctx.input).work.status === 'aligning') return alignment(ctx);
    const key = jobs.shift();
    if (!key) return [];
    return [
      { type: 'tool', name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: `卡片 ${key}` }, saveAs: 'card', check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key, templateId: 'file-executor' }), check: ok },
    ];
  };
  const daemon = await fixture(t, {
    'claude-sdk': new FakeDriver(Array(30).fill(script('claude-sdk'))),
    codex: new FakeDriver(Array(30).fill(script('codex'))),
  });
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator', model: 'coordinator-v1' }, '调度策略一');
  await daemon.writeTemplate('file-executor', { model: 'executor-v1' }, '执行策略一');
  await mkdir(join(daemon.templateDir, 'file-executor', 'skills'));
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
  await until(dispatches, values => values.length === 1 && values[0].status === 'ended');
  const idle = () => until(events, values => values.filter(value => value.action === 'round-started').length === values.filter(value => value.action === 'round-ended').length);
  await idle();
  const first = (await dispatches())[0];
  assert.equal(first.template.model, 'executor-v1');
  assert.equal(first.template.prompt, '执行策略一');
  assert.equal(first.template.fast, false);
  assert.equal(first.template.skillsPath, join(daemon.templateDir, 'file-executor', 'skills'));
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator', driver: 'codex', model: 'coordinator-v2' }, '调度策略二');
  await daemon.writeTemplate('file-executor', { driver: 'codex', model: 'executor-v2' }, '执行策略二');
  jobs.push('second');
  ok(await daemon.call('send-message', { workId: work.id, key: 'next', body: '使用更新后的模板' }));
  const values = await until(dispatches, values => values.length === 2 && values[1].status === 'ended');
  await idle();
  assert.deepEqual(values[0], first);
  assert.equal(values[1].template.model, 'executor-v2');
  assert.equal(values[1].template.prompt, '执行策略二');
  assert.equal(values[1].template.driver, 'codex');
  const rounds = (await events()).filter(value => value.action === 'round-template-loaded');
  assert.equal(rounds[0].details.template.prompt, '调度策略一');
  assert.equal(rounds.at(-1).details.template.prompt, '调度策略二');
  assert.equal(rounds.at(-1).details.template.model, 'coordinator-v2');
  assert.deepEqual(seen.filter(value => value.template.role === 'executor').map(value => value.driver), ['claude-sdk', 'codex']);
  assert.ok(seen.some(value => value.template.role === 'coordinator' && value.driver === 'codex'));
});

test('排队派单在实际启动时重读模板，已经运行的派单保留原快照', async t => {
  for (const change of ['valid', 'broken'] as const) await t.test(change, async t => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const executors = new FakeDriver([[{ type: 'hang', until: hold }], []]);
    const rounds = new FakeDriver([alignment, ctx => [
      ...['first', 'queued'].flatMap(key => [
        { type: 'tool' as const, name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: key }, saveAs: key, check: ok },
        { type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: (ctx.results.get(key) as any).result.id, key, templateId: 'file-executor' }), check: ok },
      ]),
    ]]);
    const routed: string[] = [];
    const daemon = await fixture(t, { 'claude-sdk': { start: options => options.template?.role === 'coordinator' ? rounds.start(options) : executors.start(options) },
      codex: { start: options => { routed.push(options.template!.model!); return new FakeDriver().start(options); } },
    });
    await daemon.writeTemplate('claude-coordinator', { role: 'coordinator' });
    await daemon.writeTemplate('file-executor', { model: 'before-queue' });
    ok(await daemon.call('set-concurrency', { limit: 1 }));
    const { work, events } = await startWork(daemon);
    const gate = (await daemon.call('list-pending')).result[0];
    ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
    const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
    const queued = await until(dispatches, values => values.length === 2 && values[0].status === 'running' && values[1].status === 'queued');
    const card = (await daemon.call('get-card', { workId: work.id, cardId: queued[1].cardId })).result;
    if (change === 'broken') {
      await writeFile(join(card.workPath, 'unstarted.txt'), '派单尚未开始');
      await writeFile(join(daemon.templateDir, 'file-executor', 'config.json'), '{');
    } else await daemon.writeTemplate('file-executor', { driver: 'codex', model: 'after-queue' }, '排队后更新的策略');
    release();
    const values = await until(dispatches, values => values.length === 2 && values.every(value => value.status === 'ended'));
    assert.equal(values[0].template.model, 'before-queue');
    if (change === 'broken') {
      assert.equal(values[1].endReason, 'error');
      assert.equal(values[1].startCommit, null);
      assert.equal(values[1].endCommit, null);
      assert.deepEqual(routed, []);
      assert.match(execFileSync('git', ['-C', card.workPath, 'status', '--porcelain'], { encoding: 'utf8' }), /unstarted.txt/);
      const ended = (await events()).find(value => value.action === 'dispatch-ended' && value.dispatchId === values[1].id);
      assert.equal(ended.details.error.code, 'TEMPLATE_UNAVAILABLE');
      return;
    }
    assert.equal(values[1].template.model, 'after-queue');
    assert.equal(values[1].template.prompt, '排队后更新的策略');
    assert.deepEqual(routed, ['after-queue']);
  });
});

test('坏的调度者模板用结构化错误结束轮次，不拉起驱动', async t => {
  const daemon = await fixture(t, { 'claude-sdk': { start() { throw new Error('不应启动驱动'); } } });
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator', fast: true });
  const { events } = await startWork(daemon);
  const ended = (await events()).find(value => value.action === 'round-ended');
  assert.equal(ended.details.error.code, 'TEMPLATE_UNAVAILABLE');
  assert.equal(ended.details.error.details.templateId, 'claude-coordinator');
  assert.match(ended.details.error.reason, /extra usage/);
});

test('派给坏模板、缺失模板和 Claude fast 模板返回结构化错误，健康模板仍能派单', async t => {
  const rounds = new FakeDriver([alignment, ctx => [
    { type: 'tool', name: 'create-card', arguments: { workId: workIdOf(ctx), key: 'card', content: '检查不可用模板' }, saveAs: 'card', check: ok },
    ...['broken', 'missing', 'fast', '../outside'].map(templateId => ({
      type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: templateId, templateId }),
      check: (value: any) => {
        assert.equal(value.ok, false, JSON.stringify(value));
        assert.equal(value.error.code, 'TEMPLATE_UNAVAILABLE');
        assert.equal(value.error.details.templateId, templateId);
      },
    })),
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: 'healthy', templateId: 'healthy' }), check: ok },
  ]]);
  const daemon = await fixture(t, { 'claude-sdk': { start: options => (options.template?.role === 'coordinator' ? rounds : new FakeDriver()).start(options) } });
  await daemon.writeTemplate('claude-coordinator', { role: 'coordinator' });
  await daemon.writeTemplate('healthy');
  await daemon.writeTemplate('fast', { fast: true });
  await daemon.writeTemplate('broken');
  await writeFile(join(daemon.templateDir, 'broken', 'config.json'), '{');
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const values = await until(events, values => values.some(value => value.action === 'dispatch-ended'));
  assert.equal(values.filter(value => value.action === 'operation-rejected' && value.object.id === 'create-dispatch').length, 4);
  const dispatches = (await daemon.call('list-dispatches', { workId: work.id })).result;
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].templateId, 'healthy');
});
