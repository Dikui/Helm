import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { AgentCatalog } from '../src/agents.js';
import type { FakeContext, FakeScript, FakeStep } from '../src/driver.js';
import { runtimeEnvironmentNames } from '../src/environment.js';
import { migrations } from '../src/migrations.js';
import { environmentRedactor } from '../src/project-environment.js';
import { TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { uiFixture, until } from './ui-fixture.js';

const name = 'PROJECT_RUNTIME_KEY';
const original = 'helm-project-env-original-5218d95b';
const replacement = 'helm-project-env-replacement-2cb60257';
const ok = (result: any) => assert.equal(result.ok, true, JSON.stringify(result));

test('项目变量设置/覆盖/删除只返回名字，校验名字、受管变量、NUL 和项目范围', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const projectId = daemon.project.id;
  for (const value of [original, replacement, '']) {
    const result = await daemon.call('set-project-environment', { projectId, name, value });
    ok(result);
    assert.deepEqual(result.result, { projectId, environmentNames: [name] });
    const settings = await daemon.call('list-projects');
    assert.deepEqual(settings.result[0].environmentNames, [name]);
    assert.ok(!JSON.stringify(settings).includes(original));
    assert.ok(!JSON.stringify(settings).includes(replacement));
    const registered = await daemon.call('register-project', { path: daemon.repo });
    assert.ok(!JSON.stringify(registered).includes(value || original));
  }
  const rejectedNames = ['', '1ABC', 'A-B', 'A=B', '名', 'A\nB', ...runtimeEnvironmentNames,
    'CODEX_HOME', 'CODEX_SQLITE_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'DSH_HOME', 'DSH_PERMISSION_MODE', 'GROK_HOME', 'GROK_SANDBOX', 'GROK_SUBAGENTS', 'GROK_WORKFLOWS', 'GROK_CONFIG', 'GROK_CONFIG_PATH',
    'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'HELM_PORT_START', 'HELM_PORT_END', 'GH_TOKEN', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_KEY_0', 'home'];
  for (const invalid of rejectedNames) {
    const result = await daemon.call('set-project-environment', { projectId, name: invalid, value: original });
    assert.equal(result.status, 400, invalid);
    assert.equal(result.error.code, 'INVALID_PARAMS');
    assert.ok(result.error.reason.length > 0);
    assert.ok(!JSON.stringify(result).includes(original));
  }
  assert.equal((await daemon.call('set-project-environment', { projectId, name, value: 'contains\0nul' })).status, 400);
  for (const operation of ['set-project-environment', 'delete-project-environment']) {
    const result = await daemon.call(operation, { projectId: 'missing', name, ...(operation.startsWith('set-') ? { value: original } : {}) });
    assert.equal(result.status, 404);
  }
  for (const valid of ['_PRIVATE', 'JAVA_HOME', 'GOPATH', 'ANDROID_HOME']) ok(await daemon.call('set-project-environment', { projectId, name: valid, value: original }));
  await mkdir(join(daemon.directory, 'another'));
  const another = (await daemon.call('register-project', { path: join(daemon.directory, 'another') })).result;
  const projects = (await daemon.call('list-projects')).result;
  assert.deepEqual(projects.find((project: any) => project.id === another.id).environmentNames, []);
  const deleted = await daemon.call('delete-project-environment', { projectId, name });
  ok(deleted);
  assert.ok(!deleted.result.environmentNames.includes(name));
  ok(await daemon.call('delete-project-environment', { projectId, name }));
  const events = (await daemon.call('get-events')).result;
  for (const event of events.filter((event: any) => event.action.startsWith('project-environment-'))) {
    assert.deepEqual(Object.keys(event.details), ['name']);
  }
  assert.ok(!JSON.stringify(events).includes(original));
  assert.ok(!JSON.stringify(events).includes(replacement));
});

test('执行和验收的 shell 读取项目变量，调度者只见名字；值不进任务记录、输出及解压导出', async t => {
  const rounds: FakeContext[] = [];
  const executors: FakeContext[] = [];
  let dispatched = false;
  let verified = false;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const coordinator: FakeScript = ctx => {
    rounds.push(ctx);
    const brief = JSON.parse(ctx.input);
    assert.equal(ctx.options.env[name], undefined);
    assert.equal(ctx.options.env.PROJECT_TOOL_HOME, undefined);
    assert.deepEqual(brief.projectEnvironmentNames, ['PROJECT_RUNTIME_KEY', 'PROJECT_TOOL_HOME']);
    for (const value of [original, replacement]) assert.ok(!JSON.stringify({ input: ctx.input, agent: ctx.options.agent }).includes(value));
    const workId = brief.work.id;
    if (brief.work.status === 'aligning') return [{ type: 'tool', name: 'draft-work-description', arguments: {
      workId, key: 'draft', requirements: '项目环境变量', boundary: '测试项目', criteria: '执行和验收读取环境变量',
    }, check: ok }];
    if (!dispatched) {
      dispatched = true;
      return [
        { type: 'tool', name: 'create-card', arguments: { workId, key: 'card', content: '检查环境', needsVerification: true }, saveAs: 'card', check: ok },
        { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId, cardId: (ctx.results.get('card') as any).result.id,
          key: 'execution', agentId: 'claude-executor' }), check: ok },
      ];
    }
    const ended = brief.wakeEvents.find((event: any) => event.action === 'dispatch-ended');
    if (!verified && ended) {
      verified = true;
      return [{ type: 'tool', name: 'create-dispatch', arguments: { workId, cardId: ended.cardId,
        key: 'verification', purpose: 'verification', agentId: 'claude-executor' }, check: ok }];
    }
    return [];
  };
  const executor: FakeScript = ctx => {
    executors.push(ctx);
    const verification = JSON.parse(ctx.input).purpose === 'verification';
    const expected = verification ? replacement : original;
    assert.equal(ctx.options.env[name], expected);
    assert.equal(ctx.options.env.PROJECT_TOOL_HOME, '/opt/project-tools');
    assert.deepEqual(ctx.options.projectEnvironmentNames, ['PROJECT_RUNTIME_KEY', 'PROJECT_TOOL_HOME']);
    assert.equal(execFileSync('/bin/sh', ['-c', 'printf %s "$PROJECT_RUNTIME_KEY"'], { env: ctx.options.env, encoding: 'utf8' }), expected);
    assert.equal(ctx.options.env.GH_TOKEN, 'helm-push-disabled');
    assert.ok(ctx.options.env.PATH);
    assert.ok(!JSON.stringify({ input: ctx.input, agent: ctx.options.agent }).includes(expected));
    return [
      ...(!verification ? [{ type: 'hang', until: ready } as FakeStep] : []),
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: verification ? 'passed' : 'completed', reason: `accidental echo ${expected}` }, check: ok },
      { type: 'output', text: JSON.stringify({ accidentalEcho: expected }) },
      { type: 'write', path: 'accidental-echo.txt', content: expected },
      { type: 'artifact', kind: 'test-output', path: 'accidental-echo.txt' },
      { type: 'plan', entries: [{ content: expected, status: 'completed' }] },
      { type: 'end', reason: 'completed', finalAnswer: `accidental echo ${expected}` },
    ];
  };
  const daemon = await uiFixture(Array(20).fill(coordinator), undefined, { executorScripts: [executor, executor] });
  t.after(() => daemon.close());
  const projectId = daemon.project.id;
  ok(await daemon.call('set-project-environment', { projectId, name, value: original }));
  ok(await daemon.call('set-project-environment', { projectId, name: 'PROJECT_TOOL_HOME', value: '/opt/project-tools' }));
  const workId = (await daemon.call('send-message', { projectId, body: '运行项目测试', key: 'start' })).result.work.id;
  const events = async () => (await daemon.call('get-events', { workId })).result as any[];
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await daemon.call('list-pending')).result.find((gate: any) => gate.workId === workId);
  ok(await daemon.call('decide-gate', { workId, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await until(async () => executors.length, count => count === 1);
  // The running dispatch keeps its startup env and redacts the old value.
  ok(await daemon.call('set-project-environment', { projectId, name, value: replacement }));
  release();
  const dispatches = await until(async () => (await daemon.call('list-dispatches', { workId })).result as any[],
    values => values.length === 2 && values.every(dispatch => dispatch.status === 'ended'));
  assert.deepEqual(dispatches.map(dispatch => dispatch.purpose), ['execution', 'verification']);
  assert.deepEqual(dispatches.map(dispatch => dispatch.conclusion), ['completed', 'passed']);
  assert.ok(dispatches.every(dispatch => dispatch.finalAnswer.includes('[REDACTED]') && dispatch.conclusionReason.includes('[REDACTED]')));
  assert.equal(executors.length, 2);
  assert.ok(rounds.length >= 3);
  for (const dispatch of dispatches) {
    const output = await daemon.call('get-dispatch-output', { workId, dispatchId: dispatch.id });
    for (const value of [original, replacement]) assert.ok(!JSON.stringify(output).includes(value));
  }
  ok(await daemon.call('cancel-work', { workId }));
  await until(events, values => !values.some(event => event.action === 'round-started'
    && !values.some(end => end.action === 'round-ended' && end.object.id === event.object.id)));
  const database = new DatabaseSync(join(daemon.directory, 'data', 'helm.db'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT value FROM project_environment WHERE project_id = ? AND name = ?').get(projectId, name)!.value, replacement);
    for (const row of database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'project_environment'").all()) {
      const records = database.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`).all();
      for (const value of [original, replacement]) assert.ok(!JSON.stringify(records).includes(value), `值不应进入 ${row.name}`);
    }
  } finally { database.close(); }
  const targetPath = join(daemon.directory, 'project-environment.tar.gz');
  ok(await daemon.call('export-outputs', { workId, targetPath }));
  const extracted = join(daemon.directory, 'exported');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', targetPath, '-C', extracted]);
  for (const entry of await readdir(extracted, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const bytes = await readFile(path);
    const contents = path.endsWith('.gz') ? gunzipSync(bytes) : bytes;
    for (const value of [original, replacement]) assert.ok(!contents.includes(Buffer.from(value)), `导出文件 ${entry.name}`);
  }
});

test('迁移从现有任务库升级，重启保留变量，删除项目级联删除变量', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-project-env-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = migrations.findIndex(sql => sql.includes('CREATE TABLE project_environment'));
  assert.ok(before > 0);
  const legacy = new DatabaseSync(join(directory, 'helm.db'));
  for (const [index, sql] of migrations.slice(0, before).entries()) legacy.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
  legacy.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('old', '旧项目', '/old', '2026-01-01')").run();
  legacy.close();
  const catalog = new AgentCatalog(fixtureAgentDir);
  const store = new TaskStore(directory, catalog);
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, migrations.length);
  assert.equal(store.db.prepare('SELECT name FROM projects WHERE id = ?').get('old')!.name, '旧项目');
  store.db.prepare('INSERT INTO project_environment VALUES (?, ?, ?)').run('old', name, original);
  store.close();
  const reopened = new TaskStore(directory, catalog);
  try {
    assert.equal(reopened.db.prepare('SELECT value FROM project_environment').get()!.value, original);
    reopened.db.prepare('DELETE FROM projects WHERE id = ?').run('old');
    assert.deepEqual(reopened.db.prepare('SELECT * FROM project_environment').all(), []);
    assert.throws(() => reopened.db.prepare('INSERT INTO project_environment VALUES (?, ?, ?)').run('missing', name, original), /FOREIGN KEY/);
  } finally { reopened.close(); }
});

test('日志脱敏覆盖多行、JSON 转义、正则字符和重叠值，不改变事件结构字段', () => {
  const value = 'line-one\nline-two"\\.*';
  const redact = environmentRedactor({ FIRST: value, SECOND: 'prefix-value', THIRD: 'prefix' });
  assert.equal(redact(value), '[REDACTED]');
  assert.equal(redact(JSON.stringify({ value })), '{"value":"[REDACTED]"}');
  assert.equal(redact('prefix-value prefix'), '[REDACTED] [REDACTED]');
  assert.equal(environmentRedactor({ EMPTY: '' })('unchanged'), 'unchanged');
});
