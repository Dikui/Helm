import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { agentPrompt, defaultPromptDir, seedPrompts } from '../src/prompts.js';

const workIdOf = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function fixture(t: TestContext, drivers: Record<string, Driver> = { 'claude-sdk': new FakeDriver() }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-agents-')));
  const agentDir = join(directory, 'agents');
  await mkdir(agentDir);
  const previousHome = process.env.HOME;
  process.env.HOME = join(directory, 'home');
  await mkdir(process.env.HOME);
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir, drivers });
  t.after(async () => {
    await daemon.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const writeAgent = async (id: string, config: object = {}, prompt = '文件中的策略') => {
    const path = join(agentDir, id);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'config.json'), JSON.stringify({ role: 'executor', driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: '处理实现卡片', ...config }));
    await writeFile(join(path, 'prompt.md'), prompt);
  };
  return { ...daemon, directory, agentDir, call, writeAgent };
}

test('Agent 目录是唯一来源，坏 Agent 和 Claude fast 独立标为不可用，文件修好立即生效', async t => {
  const daemon = await fixture(t);
  assert.deepEqual((await daemon.call('list-agents')).result, []);
  await daemon.writeAgent('file-executor');
  await daemon.writeAgent('api-executor', { home: 'dedicated' });
  await daemon.writeAgent('fast-executor', { fast: true });
  await daemon.writeAgent('broken-executor');
  await writeFile(join(daemon.agentDir, 'broken-executor', 'config.json'), '{');
  await daemon.writeAgent('unregistered-executor', { driver: 'codex' });
  await daemon.writeAgent('invalid-settings', { env: { ANTHROPIC_API_KEY: 'unsupported' } });
  await daemon.writeAgent('missing-prompt');
  await rm(join(daemon.agentDir, 'missing-prompt', 'prompt.md'));
  const agents = (await daemon.call('list-agents')).result;
  const valid = agents.find((item: any) => item.id === 'file-executor');
  assert.equal(valid.role, 'executor');
  assert.equal(valid.driver, 'claude-sdk');
  assert.equal(valid.model, 'haiku');
  assert.equal(valid.description, '处理实现卡片');
  assert.equal(valid.billing, 'subscription');
  assert.equal(valid.available, true);
  assert.equal(agents.find((item: any) => item.id === 'api-executor').billing, 'api');
  const fast = agents.find((item: any) => item.id === 'fast-executor');
  assert.equal(fast.available, false);
  assert.match(fast.reason, /Claude fast 在订阅下要开 extra usage 并计入 extra usage/);
  const broken = agents.find((item: any) => item.id === 'broken-executor');
  assert.equal(broken.available, false);
  assert.deepEqual(broken.warnings, []);
  assert.match(broken.reason, /config.json/);
  assert.match(agents.find((item: any) => item.id === 'unregistered-executor').reason, /codex.*未登记/);
  assert.equal(agents.find((item: any) => item.id === 'invalid-settings').available, false);
  assert.match(agents.find((item: any) => item.id === 'missing-prompt').reason, /prompt.md/);
  await daemon.writeAgent('broken-executor', { model: 'repaired' });
  assert.equal((await daemon.call('list-agents')).result.find((item: any) => item.id === 'broken-executor').model, 'repaired');
  assert.equal((await daemon.call('configure-agent-agent', { agentId: 'file-executor', model: 'ignored' })).error.code, 'UNKNOWN_OPERATION');
});

const savedConfig = { role: 'executor', driver: 'claude-sdk', model: 'sonnet', reasoningEffort: 'high', fast: false,
  home: 'shared', description: '界面保存的执行者', skills: [], mcp: [] };

test('规则提示词首次启动从仓库复制到数据目录，之后只读数据目录，改写后 Agent 立即带上且不被再次复制覆盖', async t => {
  const daemon = await fixture(t);
  const promptDir = join(daemon.directory, 'data', 'prompts');
  for (const name of ['coordinator-role', 'coordinator-runtime', 'executor-role', 'executor-runtime']) {
    assert.equal(await readFile(join(promptDir, `${name}.md`), 'utf8'), await readFile(join(defaultPromptDir, `${name}.md`), 'utf8'));
  }
  await daemon.writeAgent('executor', {}, '附加要求');
  const read = await daemon.call('get-prompts');
  ok(read);
  assert.match(read.result['executor-role'], /^你是 Helm 执行者/);
  assert.equal((await daemon.call('set-prompt', { name: 'executor-role', text: '自定义执行者规则' })).ok, true);
  assert.equal((await daemon.call('set-prompt', { name: 'unknown', text: 'x' })).ok, false);
  seedPrompts(promptDir);
  assert.equal(await readFile(join(promptDir, 'executor-role.md'), 'utf8'), '自定义执行者规则');
  const agent = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'executor');
  assert.match(agentPrompt(agent), /^自定义执行者规则\n\n附加要求\n\n输入 JSON 的 content/);
});

test('订阅 Agent 的库 skill 与全局目录同名只返回警告，API 和未选中的 skill 不警告，目录变化立即生效', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'shared-skill');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '库 skill');
  ok(await daemon.call('install-skill', { path: source }));
  await daemon.writeAgent('subscription', { skills: ['shared-skill'] });
  await daemon.writeAgent('api', { home: 'dedicated', skills: ['shared-skill'] });
  await daemon.writeAgent('unselected');
  const list = async () => {
    const value = await daemon.call('list-agents');
    ok(value);
    return value.result;
  };
  assert.deepEqual((await list()).map((agent: any) => agent.warnings), [[], [], []]);
  const global = join(process.env.HOME!, '.claude', 'skills', 'shared-skill');
  await mkdir(global, { recursive: true }); // No SKILL.md: compare directory names, not contents.
  const agents = await list();
  const subscription = agents.find((agent: any) => agent.id === 'subscription');
  assert.equal(subscription.available, true);
  assert.equal(subscription.reason, null);
  assert.equal(subscription.warnings.length, 1);
  assert.match(subscription.warnings[0], /shared-skill.*全局.*同名.*冲突/);
  assert.ok(subscription.warnings[0].includes(global));
  assert.deepEqual(agents.find((agent: any) => agent.id === 'api').warnings, []);
  assert.deepEqual(agents.find((agent: any) => agent.id === 'unselected').warnings, []);
  await rm(global, { recursive: true });
  await writeFile(global, '同名普通文件不是 skill 目录');
  assert.deepEqual((await list()).find((agent: any) => agent.id === 'subscription').warnings, []);
});

test('全局重名按驱动检查默认目录，目录符号链接也警告，普通文件和断链不警告', async t => {
  for (const [driver, model, roots, foreign] of [
    ['claude-sdk', 'haiku', ['.claude'], '.codex'],
    ['codex', 'gpt-6-luna', ['.codex', '.agents'], '.claude'],
    ['grok', 'grok-4.7', ['.grok', '.claude', '.agents'], '.dsh'],
    ['deepseek', 'deepseek-flash', ['.dsh', '.agents'], '.grok'],
  ] as const) await t.test(driver, async t => {
    const daemon = await fixture(t, { [driver]: new FakeDriver() });
    const source = join(daemon.directory, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '库 skill');
    for (const name of ['shared', 'alias', 'file', 'dangling']) ok(await daemon.call('install-skill', { path: source, name }));
    await daemon.writeAgent('executor', { driver, model, skills: ['shared', 'alias', 'file', 'dangling'] });
    const listed = async () => {
      const value = await daemon.call('list-agents');
      ok(value);
      assert.equal(value.result[0].available, true, value.result[0].reason);
      return value.result[0];
    };
    await mkdir(join(process.env.HOME!, foreign, 'skills', 'shared'), { recursive: true });
    assert.deepEqual((await listed()).warnings, [], '其他驱动的全局目录不触发警告');
    const target = join(daemon.directory, 'global-skill');
    await mkdir(target);
    const paths: string[] = [];
    for (const root of roots) {
      const directory = join(process.env.HOME!, root, 'skills');
      await mkdir(join(directory, 'shared'), { recursive: true });
      await writeFile(join(directory, 'shared', 'SKILL.md'), '无效内容也不解析');
      await symlink(target, join(directory, 'alias'));
      await writeFile(join(directory, 'file'), '普通文件');
      await symlink(join(daemon.directory, 'absent'), join(directory, 'dangling'));
      paths.push(join(directory, 'shared'), join(directory, 'alias'));
    }
    const agent = await listed();
    assert.equal(agent.warnings.length, paths.length);
    for (const path of paths) assert.ok(agent.warnings.some((warning: string) => warning.includes(path)), path);
    assert.equal(agent.reason, null);
    if (driver !== 'grok') {
      await daemon.writeAgent('api', { driver, home: 'dedicated', model: driver === 'deepseek' ? 'deepseek-v4-flash' : model,
        skills: ['shared', 'alias'] });
      const api = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'api');
      assert.equal(api.available, true, api.reason);
      assert.deepEqual(api.warnings, []);
    }
  });
});

test('用户经 CLI 安装库 skill，HTTP 每次读取目录，删除记事件', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'source-skill');
  await mkdir(join(source, 'references'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '库 skill 正文');
  await writeFile(join(source, 'references', 'guide.md'), '附加资料');
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'install-skill', '--url', daemon.url, '--path', source]);
  ok(JSON.parse(stdout));
  const library = join(daemon.directory, 'data', 'library', 'skills');
  assert.equal(await readFile(join(library, 'source-skill', 'references', 'guide.md'), 'utf8'), '附加资料');
  assert.deepEqual((await daemon.call('list-library')).result, [{ type: 'skill', name: 'source-skill', agents: [] }]);
  await mkdir(join(library, 'manual'));
  await writeFile(join(library, 'manual', 'SKILL.md'), '手动放入');
  assert.deepEqual((await daemon.call('list-library')).result.map((entry: any) => entry.name), ['manual', 'source-skill']);
  ok(await daemon.call('delete-library-entry', { type: 'skill', name: 'source-skill' }));
  assert.deepEqual(await readdir(library), ['manual']);
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action.startsWith('library-'));
  assert.deepEqual(events.map((event: any) => [event.action, event.actor.type, event.details.name]),
    [['library-skill-installed', 'user', 'source-skill'], ['library-entry-deleted', 'user', 'source-skill']]);
});

test('库 skill 安装拒绝重名、缺 SKILL.md、非法名字和符号链接，拒绝不改文件', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '原文');
  ok(await daemon.call('install-skill', { path: source, name: 'valid' }));
  await writeFile(join(source, 'SKILL.md'), '新文');
  assert.equal((await daemon.call('install-skill', { path: source, name: 'valid' })).error.code, 'LIBRARY_ENTRY_EXISTS');
  const library = join(daemon.directory, 'data', 'library', 'skills');
  assert.equal(await readFile(join(library, 'valid', 'SKILL.md'), 'utf8'), '原文');
  for (const name of ['../escape', 'Upper', '', '-bad', 'a'.repeat(65)]) {
    assert.equal((await daemon.call('install-skill', { path: source, name })).error.code, 'INVALID_PARAMS');
  }
  const missing = join(daemon.directory, 'missing');
  await mkdir(missing);
  assert.equal((await daemon.call('install-skill', { path: missing })).error.code, 'INVALID_SKILL_PATH');
  const linked = join(daemon.directory, 'linked');
  await symlink(source, linked);
  assert.equal((await daemon.call('install-skill', { path: linked })).error.code, 'INVALID_SKILL_PATH');
  await symlink(join(source, 'SKILL.md'), join(source, 'link'));
  assert.equal((await daemon.call('install-skill', { path: source, name: 'nested-link' })).error.code, 'INVALID_SKILL_PATH');
  await rm(join(source, 'link'));
  await rm(join(source, 'SKILL.md'));
  await symlink(join(library, 'valid', 'SKILL.md'), join(source, 'SKILL.md'));
  assert.equal((await daemon.call('install-skill', { path: source, name: 'linked-skill' })).error.code, 'INVALID_SKILL_PATH');
  assert.deepEqual(await readdir(library), ['valid']);
  assert.equal((await daemon.call('get-events')).result.filter((event: any) => event.action === 'library-skill-installed').length, 1);
});

test('覆盖被引用的库 skill 保留引用，HTTP 和生成的 CLI 参数生效，事件区分安装和覆盖', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'shared');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '版本一');
  await writeFile(join(source, 'obsolete.txt'), '旧文件');
  ok(await daemon.call('install-skill', { path: source }));
  const saved = await daemon.call('save-agent', { id: 'uses-shared', mode: 'create', config: { ...savedConfig, skills: ['shared'] }, prompt: '策略' });
  ok(saved);
  await writeFile(join(source, 'SKILL.md'), '版本二');
  await rm(join(source, 'obsolete.txt'));
  await mkdir(join(source, 'references'));
  await writeFile(join(source, 'references', 'guide.md'), '新资料');
  for (const params of [{}, { replace: false }]) {
    assert.equal((await daemon.call('install-skill', { path: source, ...params })).error.code, 'LIBRARY_ENTRY_EXISTS');
  }
  ok(await daemon.call('install-skill', { path: source, replace: true }));
  const library = join(daemon.directory, 'data', 'library', 'skills');
  assert.equal(await readFile(join(library, 'shared', 'SKILL.md'), 'utf8'), '版本二');
  assert.equal(await readFile(join(library, 'shared', 'references', 'guide.md'), 'utf8'), '新资料');
  await assert.rejects(lstat(join(library, 'shared', 'obsolete.txt')), { code: 'ENOENT' });
  assert.deepEqual((await daemon.call('list-library')).result, [{ type: 'skill', name: 'shared', agents: ['uses-shared'] }]);
  const current = (await daemon.call('list-agents')).result.find((agent: any) => agent.id === 'uses-shared');
  assert.deepEqual(current.config.skills, ['shared']);
  assert.equal(current.revision, saved.result.revision);
  await writeFile(join(source, 'SKILL.md'), '版本三');
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'install-skill', '--url', daemon.url, '--path', source, '--replace', 'true']);
  ok(JSON.parse(stdout));
  assert.equal(await readFile(join(library, 'shared', 'SKILL.md'), 'utf8'), '版本三');
  ok(await daemon.call('install-skill', { path: source, name: 'new', replace: true }));
  assert.deepEqual(await readdir(library), ['new', 'shared']);
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'library-skill-installed');
  assert.deepEqual(events.map((event: any) => event.details.replaced), [false, true, true, false]);
});

test('覆盖 skill 的来源不存在、缺少 SKILL.md 或包含符号链接时，旧版本和引用完好', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'source');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '旧版本');
  ok(await daemon.call('install-skill', { path: source, name: 'shared' }));
  await daemon.writeAgent('uses-shared', { skills: ['shared'] });
  await rm(join(source, 'SKILL.md'));
  for (const path of [join(daemon.directory, 'missing'), source]) {
    assert.equal((await daemon.call('install-skill', { path, name: 'shared', replace: true })).error.code, 'INVALID_SKILL_PATH');
  }
  await writeFile(join(source, 'SKILL.md'), '新版本');
  await symlink(join(source, 'SKILL.md'), join(source, 'link'));
  assert.equal((await daemon.call('install-skill', { path: source, name: 'shared', replace: true })).error.code, 'INVALID_SKILL_PATH');
  const library = join(daemon.directory, 'data', 'library', 'skills');
  assert.deepEqual(await readdir(library), ['shared']);
  assert.equal(await readFile(join(library, 'shared', 'SKILL.md'), 'utf8'), '旧版本');
  assert.deepEqual((await daemon.call('list-library')).result, [{ type: 'skill', name: 'shared', agents: ['uses-shared'] }]);
  assert.equal((await daemon.call('get-events')).result.filter((event: any) => event.action === 'library-skill-installed').length, 1);
});

test('覆盖 skill 复制或重命名失败时回滚，旧目录清理失败时保留完整的新版本', async t => {
  for (const failure of ['copy', 'backup', 'swap', 'cleanup']) await t.test(failure, async t => {
    const daemon = await fixture(t);
    const source = join(daemon.directory, 'source');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'), '旧版本');
    ok(await daemon.call('install-skill', { path: source, name: 'shared' }));
    await writeFile(join(source, 'SKILL.md'), '新版本');
    const library = join(daemon.directory, 'data', 'library', 'skills');
    const destination = join(library, 'shared');
    const { cpSync, renameSync, rmSync } = fs;
    let injected = false;
    t.mock.method(fs, 'cpSync', (...args: Parameters<typeof fs.cpSync>) => {
      cpSync(...args);
      if (failure === 'copy' && !injected) { injected = true; throw new Error('injected copy failure'); }
    });
    t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
      if (!injected && ((failure === 'backup' && args[0] === destination) || (failure === 'swap' && args[1] === destination))) {
        injected = true; throw new Error('injected rename failure');
      }
      renameSync(...args);
    });
    t.mock.method(fs, 'rmSync', (...args: Parameters<typeof fs.rmSync>) => {
      if (failure === 'cleanup' && !injected && String(args[0]).endsWith('.old')) {
        injected = true;
        rmSync(join(String(args[0]), 'SKILL.md'));
        throw new Error('injected cleanup failure');
      }
      rmSync(...args);
    });
    syncBuiltinESMExports();
    let result;
    try { result = await daemon.call('install-skill', { path: source, name: 'shared', replace: true }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    assert.equal(result.status, failure === 'cleanup' ? 200 : 500);
    if (failure !== 'cleanup') assert.equal(result.error.code, 'INTERNAL_ERROR');
    assert.equal(await readFile(join(destination, 'SKILL.md'), 'utf8'), failure === 'cleanup' ? '新版本' : '旧版本');
    assert.deepEqual((await daemon.call('list-library')).result, [{ type: 'skill', name: 'shared', agents: [] }]);
    if (failure !== 'cleanup') assert.deepEqual(await readdir(library), ['shared']);
    const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'library-skill-installed');
    assert.deepEqual(events.map((event: any) => event.details.replaced), failure === 'cleanup' ? [false, true] : [false]);
  });
});

test('用户经 HTTP 和 CLI 登记 stdio MCP，文件保留命令参数及环境变量，列表和事件只返回环境变量键名', async t => {
  const daemon = await fixture(t);
  const config = { type: 'stdio', command: 'node', args: ['local-mcp.js', '--mode', 'tools'],
    env: { TOKEN: 'stdio-secret', ACCOUNT: 'private-account' } };
  const registered = await daemon.call('register-mcp', { name: 'local', config });
  ok(registered);
  const path = join(daemon.directory, 'data', 'library', 'mcp', 'local.json');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'register-mcp', '--url', daemon.url, '--name', 'minimal', '--config', JSON.stringify({ type: 'stdio', command: 'local-mcp' })]);
  ok(JSON.parse(stdout));
  assert.deepEqual((await daemon.call('list-library')).result, [
    { type: 'mcp', name: 'local', transport: 'stdio', command: 'node', envKeys: ['ACCOUNT', 'TOKEN'], agents: [] },
    { type: 'mcp', name: 'minimal', transport: 'stdio', command: 'local-mcp', envKeys: [], agents: [] },
  ]);
  const events = (await daemon.call('get-events')).result;
  assert.deepEqual(events.filter((event: any) => event.action === 'library-mcp-registered').map((event: any) => event.details), [
    { type: 'mcp', name: 'local', transport: 'stdio', command: 'node', envKeys: ['ACCOUNT', 'TOKEN'] },
    { type: 'mcp', name: 'minimal', transport: 'stdio', command: 'local-mcp', envKeys: [] },
  ]);
  for (const value of [registered, JSON.parse(stdout), await daemon.call('list-library'), events]) {
    assert.ok(!JSON.stringify(value).includes('stdio-secret'));
    assert.ok(!JSON.stringify(value).includes('private-account'));
    assert.ok(!JSON.stringify(value).includes('local-mcp.js'), '列表和事件不返回参数');
  }
  for (const invalid of [
    { type: 'stdio' }, { type: 'stdio', command: '' }, { type: 'stdio', command: '   ' },
    { type: 'stdio', command: 42 }, { type: 'stdio', command: 'node', args: 'server.js' },
    { type: 'stdio', command: 'node', args: [42] }, { type: 'stdio', command: 'node', env: { TOKEN: 42 } },
    { ...config, url: 'https://mixed.example.invalid' }, { ...config, headers: { Authorization: 'secret' } },
  ]) {
    const rejected = await daemon.call('register-mcp', { name: 'invalid', config: invalid });
    assert.equal(rejected.error.code, 'INVALID_PARAMS');
    assert.equal(rejected.status, 400);
  }
  await assert.rejects(lstat(join(daemon.directory, 'data', 'library', 'mcp', 'invalid.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
});

test('用户经 HTTP 和 CLI 登记 HTTP MCP，库文件私密且列表和事件不回显请求头值，删除记事件', async t => {
  const daemon = await fixture(t);
  const config = { type: 'http', url: 'https://tools.example.invalid/mcp', headers: { Authorization: 'Bearer library-secret', 'X-Account': 'private-account' } };
  const registered = await daemon.call('register-mcp', { name: 'remote', config });
  ok(registered);
  const library = join(daemon.directory, 'data', 'library', 'mcp');
  const path = join(library, 'remote.json');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'register-mcp', '--url', daemon.url, '--name', 'public', '--config', JSON.stringify({ type: 'http', url: 'http://localhost:9000/mcp' })]);
  ok(JSON.parse(stdout));
  assert.deepEqual((await daemon.call('list-library')).result, [
    { type: 'mcp', name: 'public', transport: 'http', url: 'http://localhost:9000/mcp', headerKeys: [], agents: [] },
    { type: 'mcp', name: 'remote', transport: 'http', url: config.url, headerKeys: ['Authorization', 'X-Account'], agents: [] },
  ]);
  await writeFile(join(library, 'manual.json'), JSON.stringify({ type: 'http', url: 'https://manual.example.invalid/mcp' }), { mode: 0o600 });
  assert.deepEqual((await daemon.call('list-library')).result.map((entry: any) => entry.name), ['manual', 'public', 'remote']);
  assert.equal((await daemon.call('register-mcp', { name: 'remote', config: { type: 'http', url: 'https://changed.example.invalid' } })).error.code, 'LIBRARY_ENTRY_EXISTS');
  for (const name of ['../escape', 'Upper', '', '-bad', 'a'.repeat(65)]) {
    assert.equal((await daemon.call('register-mcp', { name, config })).error.code, 'INVALID_PARAMS');
  }
  for (const invalid of [{ type: 'http', url: 'file:///secret' }, { type: 'http', url: 'invalid' },
    { type: 'http', url: config.url, headers: { Authorization: 42 } }]) {
    assert.equal((await daemon.call('register-mcp', { name: 'invalid', config: invalid })).error.code, 'INVALID_PARAMS');
  }
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
  assert.deepEqual(await readdir(library), ['manual.json', 'public.json', 'remote.json']);
  ok(await daemon.call('delete-library-entry', { type: 'mcp', name: 'remote' }));
  await assert.rejects(lstat(path), { code: 'ENOENT' });
  assert.equal((await daemon.call('delete-library-entry', { type: 'mcp', name: 'remote' })).error.code, 'LIBRARY_ENTRY_NOT_FOUND');
  const events = (await daemon.call('get-events')).result;
  assert.deepEqual(events.filter((event: any) => event.action.startsWith('library-')).map((event: any) => [event.action, event.actor.type, event.details.name]),
    [['library-mcp-registered', 'user', 'remote'], ['library-mcp-registered', 'user', 'public'], ['library-entry-deleted', 'user', 'remote']]);
  for (const value of [registered, JSON.parse(stdout), await daemon.call('list-library'), events]) {
    assert.ok(!JSON.stringify(value).includes('library-secret'));
    assert.ok(!JSON.stringify(value).includes('private-account'));
  }
});

test('Agent 保存和复制保留库 skill 引用，列表显示引用，拒绝删除被引用条目', async t => {
  const daemon = await fixture(t);
  const source = join(daemon.directory, 'shared-skill');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '共享 skill');
  ok(await daemon.call('install-skill', { path: source }));
  const created = await daemon.call('save-agent', { id: 'first', mode: 'create',
    config: { ...savedConfig, skills: ['shared-skill'] }, prompt: '附加要求' });
  ok(created);
  assert.deepEqual(created.result.config.skills, ['shared-skill']);
  const copy = await daemon.call('save-agent', { id: 'copy', mode: 'create', config: { ...created.result.config, fast: true }, prompt: created.result.prompt });
  ok(copy);
  assert.equal(copy.result.available, false);
  assert.deepEqual(JSON.parse(await readFile(join(daemon.agentDir, 'copy', 'config.json'), 'utf8')).skills, ['shared-skill']);
  assert.deepEqual((await daemon.call('list-library')).result[0].agents, ['copy', 'first']);
  const denied = await daemon.call('delete-library-entry', { type: 'skill', name: 'shared-skill' });
  assert.equal(denied.error.code, 'LIBRARY_ENTRY_IN_USE');
  assert.deepEqual(denied.error.details.agents, ['copy', 'first']);
  assert.equal(await readFile(join(daemon.directory, 'data', 'library', 'skills', 'shared-skill', 'SKILL.md'), 'utf8'), '共享 skill');
  for (const id of ['first', 'copy']) {
    const current = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === id);
    ok(await daemon.call('save-agent', { id, mode: 'update', baseRevision: current.revision,
      config: { ...current.config, skills: [] }, prompt: current.prompt }));
  }
  ok(await daemon.call('delete-library-entry', { type: 'skill', name: 'shared-skill' }));
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'agent-saved');
  assert.deepEqual(events.map((event: any) => event.details.skills), [['shared-skill'], ['shared-skill'], [], []]);
});

test('Agent 的 MCP 引用默认空，保存和复制保留选择，缺失或保留名字不可用且被引用 MCP 不可删除', async t => {
  const daemon = await fixture(t);
  const config = { type: 'http', url: 'https://remote.example.invalid/mcp', headers: { Authorization: 'Bearer private-value' } };
  for (const name of ['shared', 'helm', 'browser', 'playwright']) ok(await daemon.call('register-mcp', { name, config }));
  await daemon.writeAgent('default');
  assert.deepEqual((await daemon.call('list-agents')).result[0].config.mcp, []);
  const created = await daemon.call('save-agent', { id: 'first', mode: 'create',
    config: { ...savedConfig, mcp: ['shared'] }, prompt: '附加要求' });
  ok(created);
  assert.equal(created.result.available, true, created.result.reason);
  assert.deepEqual(created.result.config.mcp, ['shared']);
  const copy = await daemon.call('save-agent', { id: 'copy', mode: 'create', config: { ...created.result.config, fast: true }, prompt: created.result.prompt });
  ok(copy);
  assert.equal(copy.result.available, false);
  assert.deepEqual(JSON.parse(await readFile(join(daemon.agentDir, 'copy', 'config.json'), 'utf8')).mcp, ['shared']);
  const listed = (await daemon.call('list-library')).result.find((entry: any) => entry.name === 'shared');
  assert.deepEqual(listed.agents, ['copy', 'first']);
  const denied = await daemon.call('delete-library-entry', { type: 'mcp', name: 'shared' });
  assert.equal(denied.error.code, 'LIBRARY_ENTRY_IN_USE');
  assert.deepEqual(denied.error.details.agents, ['copy', 'first']);
  assert.deepEqual(JSON.parse(await readFile(join(daemon.directory, 'data', 'library', 'mcp', 'shared.json'), 'utf8')), config);
  for (const name of ['absent', 'helm', 'browser', 'playwright']) {
    const value = await daemon.call('save-agent', { id: `uses-${name}`, mode: 'create', config: { ...savedConfig, mcp: [name] }, prompt: '' });
    ok(value);
    assert.equal(value.result.available, false, name);
    assert.ok(value.result.reason.includes(name), value.result.reason);
    assert.match(value.result.reason, name === 'absent' ? /不存在/ : /冲突/);
  }
  // Invalid MCP files must neither make a healthy Agent unavailable nor disclose credentials.
  const path = join(daemon.directory, 'data', 'library', 'mcp', 'absent.json');
  await writeFile(path, '{ "headers": { "Authorization": "private-value" }');
  const broken = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'uses-absent');
  assert.equal(broken.available, false);
  assert.ok(!JSON.stringify(broken).includes('private-value'));
  await writeFile(path, JSON.stringify({ type: 'http', url: 'https://repaired.example.invalid/mcp' }));
  assert.equal((await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'uses-absent').available, true);
  for (const id of ['first', 'copy']) {
    const current = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === id);
    ok(await daemon.call('save-agent', { id, mode: 'update', baseRevision: current.revision,
      config: { ...current.config, mcp: [] }, prompt: current.prompt }));
  }
  ok(await daemon.call('delete-library-entry', { type: 'mcp', name: 'shared' }));
  const saved = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'agent-saved' && ['first', 'copy'].includes(event.object.id));
  assert.deepEqual(saved.map((event: any) => event.details.mcp), [['shared'], ['shared'], [], []]);
});

test('用户经 HTTP、CLI 和 MCP 保存 Agent，写入文件、检查可用性并记录事件', async t => {
  const checked: string[] = [];
  const daemon = await fixture(t, { 'claude-sdk': { checkAvailability: async agent => {
    checked.push(agent.id);
    return agent.home === 'dedicated' ? { available: false, reason: '请配置 API 主目录' } : { available: true };
  }, start: options => new FakeDriver().start(options) } });
  const created = await daemon.call('save-agent', { id: 'saved-executor', config: savedConfig, prompt: '完整策略\n', mode: 'create' });
  ok(created);
  assert.equal(created.result.model, 'sonnet');
  assert.equal(created.result.available, true);
  assert.match(created.result.revision, /^[a-f0-9]{64}$/);
  assert.ok(checked.includes('saved-executor'));
  assert.equal(await readFile(join(daemon.agentDir, 'saved-executor', 'config.json'), 'utf8'), JSON.stringify(savedConfig, null, 2) + '\n');
  assert.equal(await readFile(join(daemon.agentDir, 'saved-executor', 'prompt.md'), 'utf8'), '完整策略\n');
  assert.deepEqual(await readdir(join(daemon.agentDir, 'saved-executor')), ['config.json', 'prompt.md']);
  const listed = (await daemon.call('list-agents')).result[0];
  assert.equal(listed.revision, created.result.revision);
  assert.equal(listed.prompt, '完整策略\n');
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
    'save-agent', '--url', daemon.url, '--id', 'api-copy', '--mode', 'create',
    '--config', JSON.stringify({ ...savedConfig, home: 'dedicated' }), '--prompt', 'API 策略']);
  const api = JSON.parse(stdout);
  ok(api);
  assert.equal(api.result.billing, 'api');
  assert.equal(api.result.available, false);
  assert.match(api.result.notice, /agent-homes.*api-copy/);
  assert.deepEqual(await readdir(process.env.HOME!), []);
  const client = new Client({ name: 'helm-agent-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`)));
  const tool = (await client.listTools()).tools.find(tool => tool.name === 'save-agent');
  assert.equal((tool!.inputSchema.properties!.config as any).type, 'object');
  const mcp = await client.callTool({ name: 'save-agent', arguments: { id: 'api-copy', mode: 'update',
    config: { ...savedConfig, home: 'dedicated' }, prompt: '通过 MCP 更新策略', baseRevision: api.result.revision } });
  ok(mcp.structuredContent);
  assert.equal((await daemon.call('list-agents')).result.find((item: any) => item.id === 'api-copy').prompt, '通过 MCP 更新策略');
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'agent-saved');
  assert.deepEqual(events.map((event: any) => [event.actor.type, event.object.id, event.details.mode]),
    [['user', 'saved-executor', 'create'], ['user', 'api-copy', 'create'], ['user', 'api-copy', 'update']]);
});

test('更新 Agent 保留 skills 和 API 主目录，旧 revision 拒绝覆盖配置或提示词的外部改动', async t => {
  const daemon = await fixture(t);
  await daemon.writeAgent('editable', { home: 'dedicated' });
  const path = join(daemon.agentDir, 'editable');
  await mkdir(join(path, 'skills'));
  await writeFile(join(path, 'skills', 'strategy.md'), '技能原文');
  const home = join(process.env.HOME!, '.helm', 'agent-homes', 'editable');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'config.json'), 'CLI 管理的凭据');
  const current = () => daemon.call('list-agents').then(value => value.result.find((item: any) => item.id === 'editable'));
  const initial = await current();
  const params = { id: 'editable', config: { ...savedConfig, home: 'dedicated' }, prompt: '更新的策略\n', mode: 'update', baseRevision: initial.revision };
  const updated = await daemon.call('save-agent', params);
  ok(updated);
  assert.notEqual(updated.result.revision, initial.revision);
  assert.equal((await current()).model, 'sonnet');
  assert.equal((await current()).prompt, '更新的策略\n');
  assert.equal(await readFile(join(path, 'skills', 'strategy.md'), 'utf8'), '技能原文');
  assert.equal(await readFile(join(home, 'config.json'), 'utf8'), 'CLI 管理的凭据');
  assert.deepEqual(await readdir(path), ['config.json', 'prompt.md', 'skills']);
  assert.equal((await daemon.call('save-agent', params)).error.code, 'AGENT_CONFLICT');
  for (const filename of ['config.json', 'prompt.md']) {
    const before = await current();
    // Even a formatting-only external edit invalidates the revision.
    await writeFile(join(path, filename), (await readFile(join(path, filename), 'utf8')) + '\n');
    const expected = await Promise.all(['config.json', 'prompt.md'].map(file => readFile(join(path, file), 'utf8')));
    const conflicted = await daemon.call('save-agent', { ...params, baseRevision: before.revision });
    assert.equal(conflicted.status, 409);
    assert.equal(conflicted.error.code, 'AGENT_CONFLICT');
    assert.match(conflicted.error.reason, /重新载入/);
    assert.deepEqual(await Promise.all(['config.json', 'prompt.md'].map(file => readFile(join(path, file), 'utf8'))), expected);
    assert.notEqual((await current()).revision, before.revision);
  }
  const refreshed = await current();
  ok(await daemon.call('save-agent', { ...params, baseRevision: refreshed.revision }));
  const events = (await daemon.call('get-events')).result.filter((event: any) => event.action === 'agent-saved');
  assert.equal(events.length, 2);
  assert.equal(events[1].details.mode, 'update');
});

test('保存拒绝非法字段、id、目录状态、角色修改和符号链接，拒绝时文件不变', async t => {
  const daemon = await fixture(t);
  await daemon.writeAgent('editable');
  await mkdir(join(daemon.agentDir, 'empty'));
  const before = (await daemon.call('list-agents')).result.find((item: any) => item.id === 'editable');
  const params = { id: 'editable', config: savedConfig, prompt: '不能意外落盘', mode: 'update', baseRevision: before.revision };
  const files = () => Promise.all(['config.json', 'prompt.md'].map(file => readFile(join(daemon.agentDir, 'editable', file), 'utf8')));
  const original = await files();
  const cases: [object, string, RegExp][] = [
    [{ config: { ...savedConfig, model: '' } }, 'INVALID_PARAMS', /config.model/],
    [{ config: { ...savedConfig, driver: 'unknown' } }, 'INVALID_PARAMS', /config.driver/],
    [{ config: { ...savedConfig, reasoningEffort: ' ' } }, 'INVALID_PARAMS', /config.reasoningEffort/],
    [{ config: { ...savedConfig, home: 'arbitrary-path' } }, 'INVALID_PARAMS', /config.home/],
    [{ config: { ...savedConfig, fast: 'true' } }, 'INVALID_PARAMS', /config.fast/],
    [{ config: { ...savedConfig, description: ' ' } }, 'INVALID_PARAMS', /config.description/],
    [{ config: { ...savedConfig, secret: 'unsupported' } }, 'INVALID_PARAMS', /config.*secret/],
    [{ baseRevision: undefined }, 'INVALID_PARAMS', /baseRevision/],
    [{ mode: 'create' }, 'AGENT_EXISTS', /已存在/],
    [{ id: 'empty', mode: 'create' }, 'AGENT_EXISTS', /已存在/],
    [{ id: 'missing' }, 'AGENT_NOT_FOUND', /不存在/],
    [{ config: { ...savedConfig, role: 'coordinator' } }, 'AGENT_ROLE_IMMUTABLE', /role.*新建/],
    ...['..', '.', '../outside', 'a/b', 'a\\b', 'UPPER', 'x'.repeat(65), '-leading', 'a\0b'].map(id =>
      [{ id, mode: 'create' }, 'INVALID_PARAMS', /id/] as [object, string, RegExp]),
  ];
  const outside = join(daemon.directory, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'config.json'), original[0]!);
  await writeFile(join(outside, 'prompt.md'), original[1]!);
  await symlink(outside, join(daemon.agentDir, 'linked'));
  cases.push([{ id: 'linked' }, 'INVALID_AGENT_PATH', /目录/]);
  for (const [change, code, reason] of cases) {
    const rejected = await daemon.call('save-agent', { ...params, ...change });
    assert.equal(rejected.error?.code, code, JSON.stringify({ change, rejected }));
    assert.match(rejected.error.reason, reason);
    assert.deepEqual(await files(), original);
    assert.deepEqual(await readdir(join(daemon.agentDir, 'editable')), ['config.json', 'prompt.md']);
  }
  assert.deepEqual(await readdir(join(daemon.agentDir, 'empty')), []);
  assert.deepEqual(await Promise.all(['config.json', 'prompt.md'].map(file => readFile(join(outside, file), 'utf8'))), original);
  await rm(join(daemon.agentDir, 'linked'));
  await rm(join(daemon.agentDir, 'editable', 'config.json'));
  await symlink(join(outside, 'config.json'), join(daemon.agentDir, 'editable', 'config.json'));
  assert.equal((await daemon.call('save-agent', params)).error.code, 'INVALID_AGENT_PATH');
  assert.equal(await readFile(join(outside, 'config.json'), 'utf8'), original[0]);
  assert.equal((await daemon.call('get-events')).result.filter((event: any) => event.action === 'agent-saved').length, 0);
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
  const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '检查 Agent' })).result.work;
  const events = async (): Promise<any[]> => (await daemon.call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(value => value.action === 'round-ended'));
  return { project, work, events };
}

const forbiddenSave: FakeStep = { type: 'tool', name: 'save-agent',
  arguments: { id: 'agent-must-not-create', config: savedConfig, prompt: '越权写 Agent', mode: 'create' },
  check: (value: any) => assert.equal(value.error.code, 'FORBIDDEN') };

const forbiddenLibrary: FakeStep[] = [
  { type: 'tool', name: 'install-skill', arguments: { path: '/must-not-install', name: 'shared' },
    check: (value: any) => assert.equal(value.error.code, 'FORBIDDEN') },
  { type: 'tool', name: 'delete-library-entry', arguments: { type: 'skill', name: 'shared' },
    check: (value: any) => assert.equal(value.error.code, 'FORBIDDEN') },
  { type: 'tool', name: 'register-mcp', arguments: { name: 'must-not-register', config: { type: 'http', url: 'https://forbidden.example.invalid' } },
    check: (value: any) => assert.equal(value.error.code, 'FORBIDDEN') },
];

test('保存调度者 Agent 只在下一轮生效，调度者不能经 MCP 保存 Agent', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const seen: any[] = [];
  const rounds = new FakeDriver([[], ctx => {
    seen.push(ctx.options.agent);
    return [forbiddenSave, { type: 'hang', until: hold }];
  }, ctx => { seen.push(ctx.options.agent); return []; }]);
  const daemon = await fixture(t, { 'claude-sdk': rounds });
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator', model: 'before-save' }, '旧调度策略');
  const { work, events } = await startWork(daemon);
  ok(await daemon.call('send-message', { workId: work.id, key: 'hold', body: '保持当前轮次运行' }));
  await until(events, values => values.some(event => event.action === 'operation-rejected' && event.details.code === 'FORBIDDEN'));
  const before = (await daemon.call('list-agents')).result[0];
  const saved = await daemon.call('save-agent', { id: before.id, mode: 'update', baseRevision: before.revision,
    config: { ...savedConfig, role: 'coordinator', model: 'after-save' }, prompt: '新调度策略' });
  ok(saved);
  assert.equal(seen[0].model, 'before-save');
  assert.equal(seen[0].prompt, '旧调度策略');
  const during = await events();
  assert.equal(during.filter(event => event.action === 'round-started').length, 2);
  assert.equal(during.filter(event => event.action === 'round-ended').length, 1);
  assert.equal(during.filter(event => event.action === 'round-agent-loaded').at(-1).details.agent.model, 'before-save');
  release();
  await until(events, values => values.filter(event => event.action === 'round-ended').length === 2);
  ok(await daemon.call('send-message', { workId: work.id, key: 'next', body: '开始下一轮' }));
  const ended = await until(events, values => values.filter(event => event.action === 'round-ended').length === 3);
  assert.equal(seen[1].model, 'after-save');
  assert.equal(seen[1].prompt, '新调度策略');
  assert.equal(ended.filter(event => event.action === 'round-agent-loaded').at(-1).details.agent.model, 'after-save');
  assert.deepEqual(await readdir(daemon.agentDir), ['claude-coordinator']);
});

test('项目默认调度者 Agent 可修改，新工作继承默认且现有工作保持原选择，重启后保留', async t => {
  const drivers = { 'claude-sdk': new FakeDriver(), codex: new FakeDriver() };
  const daemon = await fixture(t, drivers);
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator' });
  await daemon.writeAgent('codex-coordinator', { role: 'coordinator', driver: 'codex' });
  const { project, work } = await startWork(daemon);
  assert.equal(project.defaultCoordinatorAgentId, 'claude-coordinator');
  assert.equal(work.coordinatorAgentId, 'claude-coordinator');
  const changed = await daemon.call('set-project-coordinator-agent', { projectId: project.id, agentId: 'codex-coordinator' });
  ok(changed);
  assert.equal(changed.result.defaultCoordinatorAgentId, 'codex-coordinator');
  const inherited = await daemon.call('send-message', { projectId: project.id, key: 'inherited', body: '用项目默认' });
  ok(inherited);
  assert.equal(inherited.result.work.coordinatorAgentId, 'codex-coordinator');
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.coordinatorAgentId, 'claude-coordinator');
  const inheritedEvents = await until(async () => (await daemon.call('get-events', { workId: inherited.result.work.id })).result as any[],
    events => events.some(event => event.action === 'round-ended'));
  assert.equal(inheritedEvents.find(event => event.action === 'round-agent-loaded').details.agent.id, 'codex-coordinator');
  await daemon.close();
  const restarted = await startHelmd({ port: 0, dataDir: join(daemon.directory, 'data'), agentDir: daemon.agentDir, drivers });
  t.after(() => restarted.close());
  const read = async (name: string, params: object = {}) => (await (await fetch(`${restarted.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) })).json() as any).result;
  assert.equal((await read('list-projects'))[0].defaultCoordinatorAgentId, 'codex-coordinator');
  assert.equal((await read('get-work', { workId: inherited.result.work.id })).coordinatorAgentId, 'codex-coordinator');
  assert.equal((await read('list-works')).find((item: any) => item.id === work.id).coordinatorAgentId, 'claude-coordinator');
});

test('创建工作可指定调度者 Agent，key 重投保留选择且拒绝执行者、缺失和坏 Agent', async t => {
  const seen: string[] = [];
  const daemon = await fixture(t, { 'claude-sdk': new FakeDriver(), codex: new FakeDriver([ctx => {
    seen.push(ctx.options.agent!.id);
    return [];
  }]) });
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator' });
  await daemon.writeAgent('codex-coordinator', { role: 'coordinator', driver: 'codex' });
  await daemon.writeAgent('executor');
  await daemon.writeAgent('broken', { role: 'coordinator', fast: true });
  const { project, work } = await startWork(daemon);
  const params = { projectId: project.id, key: 'explicit', body: '用另一家调度', coordinatorAgentId: 'codex-coordinator' };
  const created = await daemon.call('send-message', params);
  ok(created);
  assert.equal(created.result.work.coordinatorAgentId, 'codex-coordinator');
  await until(async () => (await daemon.call('get-events', { workId: created.result.work.id })).result as any[],
    events => events.some(event => event.action === 'round-ended'));
  assert.deepEqual(seen, ['codex-coordinator']);
  const retried = await daemon.call('send-message', { ...params, coordinatorAgentId: 'claude-coordinator' });
  ok(retried);
  assert.deepEqual(retried.result, created.result);
  assert.equal((await daemon.call('list-projects')).result[0].defaultCoordinatorAgentId, 'claude-coordinator');
  for (const agentId of ['executor', 'missing', 'broken']) {
    const rejected = await daemon.call('send-message', { ...params, key: agentId, coordinatorAgentId: agentId });
    assert.equal(rejected.error.code, 'AGENT_UNAVAILABLE');
    assert.equal(rejected.error.details.agentId, agentId);
    assert.equal((await daemon.call('set-project-coordinator-agent', { projectId: project.id, agentId })).error.code, 'AGENT_UNAVAILABLE');
  }
  assert.equal((await daemon.call('list-works')).result.length, 2);
  const onExistingWork = await daemon.call('send-message', { workId: work.id, key: 'invalid', body: '创建后不能这样改 Agent', coordinatorAgentId: 'codex-coordinator' });
  assert.equal(onExistingWork.error.code, 'INVALID_PARAMS');
});

test('换调度者 Agent 只影响下一轮，当前运行或启动中的轮次不受影响，暂停时也可通过 CLI 更换', async t => {
  for (const phase of ['running', 'starting'] as const) await t.test(phase, async t => {
    let releaseStart!: () => void;
    let releaseRound!: () => void;
    const starting = new Promise<void>(resolve => { releaseStart = resolve; });
    const running = new Promise<void>(resolve => { releaseRound = resolve; });
    t.after(() => { releaseStart(); releaseRound(); });
    const seen: { agent: any; input: any }[] = [];
    let firstOptions: FakeContext['options'] | undefined;
    const original = new FakeDriver([ctx => {
      seen.push({ agent: structuredClone(ctx.options.agent), input: JSON.parse(ctx.input) });
      return [{ type: 'hang', until: running }];
    }]);
    const record: FakeScript = ctx => {
      seen.push({ agent: structuredClone(ctx.options.agent), input: JSON.parse(ctx.input) });
      return [];
    };
    const replacements = new FakeDriver([record, record]);
    const daemon = await fixture(t, { 'claude-sdk': { checkAvailability: async () => ({ available: true }), async start(options) {
      firstOptions = options;
      if (phase === 'starting') await starting;
      return original.start(options);
    } }, codex: replacements });
    await daemon.writeAgent('claude-coordinator', { role: 'coordinator', model: 'original' }, '原来的调度策略');
    await daemon.writeAgent('codex-coordinator', { role: 'coordinator', driver: 'codex', model: 'replacement' }, '替换后的调度策略');
    await daemon.writeAgent('executor');
    // startWork waits for round completion; register without waiting for this held round.
    const repo = join(daemon.directory, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    const project = (await daemon.call('register-project', { path: repo })).result;
    const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '开始调度' })).result.work;
    const params = { workId: work.id };
    const events = async (): Promise<any[]> => (await daemon.call('get-events', params)).result;
    await until(async () => phase === 'starting' ? Boolean(firstOptions) : seen.length === 1, Boolean);
    const firstRound = (await events()).find(event => event.action === 'round-started').object.id;
    for (const agentId of ['executor', 'missing']) {
      assert.equal((await daemon.call('change-coordinator-agent', { ...params, agentId })).error.code, 'AGENT_UNAVAILABLE');
    }
    const forbidden = await fetch(`${daemon.url}/api/change-coordinator-agent`, { method: 'POST',
      headers: { Authorization: firstOptions!.mcpServers.helm!.headers.Authorization! },
      body: JSON.stringify({ ...params, agentId: 'codex-coordinator' }) });
    assert.equal(forbidden.status, 403);
    const changed = await daemon.call('change-coordinator-agent', { ...params, agentId: 'codex-coordinator' });
    ok(changed);
    assert.equal(changed.result.coordinatorAgentId, 'codex-coordinator');
    assert.equal(changed.result.status, 'aligning');
    ok(await daemon.call('change-coordinator-agent', { ...params, agentId: 'codex-coordinator' }));
    assert.equal(firstOptions!.signal!.aborted, false);
    const during = await events();
    assert.equal(during.filter(event => event.action === 'round-started').length, 1);
    assert.equal(during.filter(event => event.action === 'round-ended').length, 0);
    const changes = during.filter(event => event.action === 'coordinator-agent-changed');
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].details, { previousAgentId: 'claude-coordinator', agentId: 'codex-coordinator' });
    assert.equal(changes[0].actor.type, 'user');
    releaseStart();
    await until(async () => seen.length, count => count === 1);
    assert.equal(seen[0]!.agent.id, 'claude-coordinator');
    assert.equal(seen[0]!.input.work.coordinatorAgentId, 'claude-coordinator');
    releaseRound();
    const ended = await until(events, values => values.filter(event => event.action === 'round-ended').length === 2);
    assert.equal(ended.find(event => event.action === 'round-ended' && event.object.id === firstRound).details.reason, 'completed');
    assert.deepEqual(seen.map(value => value.agent.id), ['claude-coordinator', 'codex-coordinator']);
    assert.equal(seen[1]!.input.work.coordinatorAgentId, 'codex-coordinator');
    assert.ok(seen[1]!.input.wakeEvents.some((event: any) => event.action === 'coordinator-agent-changed'));
    assert.deepEqual(ended.filter(event => event.action === 'round-agent-loaded').map(event => event.details.agent.prompt), ['原来的调度策略', '替换后的调度策略']);

    ok(await daemon.call('pause-work', params));
    await daemon.writeAgent('other-coordinator', { role: 'coordinator', driver: 'codex' });
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)),
      'change-coordinator-agent', '--url', daemon.url, '--workId', work.id, '--agentId', 'other-coordinator']);
    const cliResult = JSON.parse(stdout);
    ok(cliResult);
    assert.equal(cliResult.result.status, 'paused');
    assert.equal(cliResult.result.coordinatorAgentId, 'other-coordinator');
    assert.equal((await events()).filter(event => event.action === 'round-started').length, 2);
    ok(await daemon.call('resume-work', params));
    await until(events, values => values.filter(event => event.action === 'round-ended').length === 3);
    assert.equal(seen[2]!.agent.id, 'other-coordinator');
    ok(await daemon.call('change-coordinator-agent', { ...params, agentId: 'codex-coordinator' }));
    const afterIdleChange = await until(events, values => values.filter(event => event.action === 'round-ended').length === 4);
    assert.equal(afterIdleChange.filter(event => event.action === 'round-agent-loaded').at(-1).details.agent.id, 'codex-coordinator');
  });
});

const alignment = (ctx: FakeContext): FakeStep[] => [
  { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), key: 'draft', requirements: 'Agent 文件生效', boundary: '本机', criteria: '快照和驱动一致' }, check: ok },
];

test('有全局重名警告的 Agent 仍可进入调度轮次并接受派单', async t => {
  const seen: FakeContext['options'][] = [];
  const rounds = new FakeDriver([ctx => { seen.push(ctx.options); return alignment(ctx); }, ctx => [
    { type: 'tool', name: 'create-card', arguments: { workId: workIdOf(ctx), key: 'card', content: '验证警告不阻止派单' }, saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx),
      cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', agentId: 'executor' }), check: ok },
  ]]);
  const executor = new FakeDriver([ctx => { seen.push(ctx.options); return []; }]);
  const daemon = await fixture(t, { 'claude-sdk': { checkAvailability: async () => ({ available: true }),
    start: options => (options.agent.role === 'coordinator' ? rounds : executor).start(options) } });
  const source = join(daemon.directory, 'shared');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '派单加载库 skill');
  ok(await daemon.call('install-skill', { path: source }));
  await mkdir(join(process.env.HOME!, '.claude', 'skills', 'shared'), { recursive: true });
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator', skills: ['shared'] });
  await daemon.writeAgent('executor', { skills: ['shared'] });
  for (const agent of (await daemon.call('list-agents')).result) {
    assert.equal(agent.available, true);
    assert.equal(agent.warnings.length, 1);
  }
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await until(events, values => values.some(value => value.action === 'dispatch-ended'));
  const dispatches = (await daemon.call('list-dispatches', { workId: work.id })).result;
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].agentId, 'executor');
  assert.equal(dispatches[0].endReason, 'completed');
  assert.deepEqual(seen.map(options => options.agent.role), ['coordinator', 'executor']);
  for (const options of seen) assert.equal(await readFile(join(options.agent.skillsPath!, 'shared', 'SKILL.md'), 'utf8'), '派单加载库 skill');
});

test('派单和调度轮次复制自带与库 skill，排队在启动时组装，运行中的副本不受库变动影响', async t => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  t.after(() => { releaseFirst(); releaseSecond(); });
  const seen: FakeContext['options'][] = [];
  const executors = new FakeDriver([first, second].map(hold => ctx => {
    seen.push(ctx.options);
    return [...forbiddenLibrary, { type: 'hang', until: hold }];
  }));
  const roundOptions: FakeContext['options'][] = [];
  const rounds = new FakeDriver([ctx => { roundOptions.push(ctx.options); return [...forbiddenLibrary, ...alignment(ctx)]; }, ctx => {
    roundOptions.push(ctx.options);
    return ['first', 'queued'].flatMap(key => [
      { type: 'tool' as const, name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: key }, saveAs: key, check: ok },
      { type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: (ctx.results.get(key) as any).result.id, key, agentId: 'file-executor' }), check: ok },
    ]);
  }]);
  const daemon = await fixture(t, { 'claude-sdk': { checkAvailability: async () => ({ available: true }),
    start: options => (options.agent.role === 'coordinator' ? rounds : executors).start(options) } });
  const source = join(daemon.directory, 'shared');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '库 skill 第一版');
  ok(await daemon.call('install-skill', { path: source }));
  for (const [id, role] of [['claude-coordinator', 'coordinator'], ['file-executor', 'executor']]) {
    await daemon.writeAgent(id!, { role, skills: ['shared'] });
    const own = join(daemon.agentDir, id!, 'skills', 'own');
    await mkdir(own, { recursive: true });
    await writeFile(join(own, 'SKILL.md'), `${role} 自带 skill`);
  }
  ok(await daemon.call('set-concurrency', { limit: 1 }));
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
  const queued = await until(dispatches, values => values.length === 2 && values[0].status === 'running' && values[1].status === 'queued' && seen.length === 1);
  for (const options of [...roundOptions, seen[0]!]) {
    assert.equal(options.agent.skillsPath, join(options.dataDir!, 'skills'));
    assert.deepEqual(await readdir(options.agent.skillsPath!), ['own', 'shared']);
    assert.equal((await lstat(join(options.agent.skillsPath!, 'shared'))).isSymbolicLink(), false);
    assert.equal(await readFile(join(options.agent.skillsPath!, 'shared', 'SKILL.md'), 'utf8'), '库 skill 第一版');
    assert.equal(await readFile(join(options.agent.skillsPath!, 'own', 'SKILL.md'), 'utf8'), `${options.agent.role} 自带 skill`);
  }
  await assert.rejects(lstat(join(queued[1].outputPath, '..', 'skills')), { code: 'ENOENT' });
  await writeFile(join(source, 'SKILL.md'), '库 skill 第二版');
  ok(await daemon.call('install-skill', { path: source, replace: true }));
  await writeFile(join(daemon.agentDir, 'file-executor', 'skills', 'own', 'SKILL.md'), '自带 skill 第二版');
  releaseFirst();
  await until(dispatches, values => values[1]?.status === 'running' && seen.length === 2);
  assert.equal(await readFile(join(seen[1]!.agent.skillsPath!, 'shared', 'SKILL.md'), 'utf8'), '库 skill 第二版');
  assert.equal(await readFile(join(seen[1]!.agent.skillsPath!, 'own', 'SKILL.md'), 'utf8'), '自带 skill 第二版');
  assert.equal(await readFile(join(seen[0]!.agent.skillsPath!, 'own', 'SKILL.md'), 'utf8'), 'executor 自带 skill');
  for (const id of ['claude-coordinator', 'file-executor']) {
    const entry = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === id);
    ok(await daemon.call('save-agent', { id, mode: 'update', baseRevision: entry.revision, config: { ...entry.config, skills: [] }, prompt: entry.prompt }));
  }
  ok(await daemon.call('delete-library-entry', { type: 'skill', name: 'shared' }));
  assert.equal(await readFile(join(seen[0]!.agent.skillsPath!, 'shared', 'SKILL.md'), 'utf8'), '库 skill 第一版');
  assert.equal(await readFile(join(seen[1]!.agent.skillsPath!, 'shared', 'SKILL.md'), 'utf8'), '库 skill 第二版');
  releaseSecond();
  const ended = await until(dispatches, values => values.length === 2 && values.every(value => value.status === 'ended'));
  assert.equal(ended[0].agent.skillsPath, seen[0]!.agent.skillsPath);
  assert.equal(ended[1].agent.skillsPath, seen[1]!.agent.skillsPath);
  assert.ok((await events()).filter(event => event.action === 'round-agent-loaded').every(event => event.details.agent.skillsPath === null
    || event.details.agent.skillsPath === join(daemon.directory, 'data', 'rounds', event.object.id, 'skills')));
});

test('派单及调度轮次合并所选 HTTP 或 stdio MCP，排队在启动时读取且运行中的配置保持不变', async t => {
  for (const [driver, transport] of [
    ['claude-sdk', 'http'], ['codex', 'http'], ['grok', 'http'], ['deepseek', 'http'],
    ['claude-sdk', 'stdio'], ['codex', 'stdio'],
  ] as const) await t.test(`${driver}/${transport}`, async t => {
    const remoteV1 = transport === 'http'
      ? { url: 'https://remote.example.invalid/v1', headers: { Authorization: 'Bearer remote-secret-v1' } }
      : { type: 'stdio' as const, command: 'node', args: ['remote-v1.js'], env: { TOKEN: 'remote-secret-v1' } };
    const remoteV2 = transport === 'http'
      ? { url: 'https://remote.example.invalid/v2', headers: { Authorization: 'Bearer remote-secret-v2' } }
      : { type: 'stdio' as const, command: 'node', args: ['remote-v2.js'], env: { TOKEN: 'remote-secret-v2' } };
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const second = new Promise<void>(resolve => { releaseSecond = resolve; });
    t.after(() => { releaseFirst(); releaseSecond(); });
    const seen: FakeContext['options'][] = [];
    const executor = new FakeDriver([first, second].map(hold => ctx => {
      seen.push(ctx.options);
      return [...forbiddenLibrary, { type: 'hang', until: hold }];
    }));
    const roundOptions: FakeContext['options'][] = [];
    const rounds = new FakeDriver([ctx => { roundOptions.push(ctx.options); return [...forbiddenLibrary, ...alignment(ctx)]; }, ctx => {
      roundOptions.push(ctx.options);
      return ['first', 'queued'].flatMap(key => [
        { type: 'tool' as const, name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: key }, saveAs: key, check: ok },
        { type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx),
          cardId: (ctx.results.get(key) as any).result.id, key, agentId: 'executor' }), check: ok },
      ]);
    }]);
    const router: Driver = { checkAvailability: async () => ({ available: true }),
      start: options => (options.agent.role === 'coordinator' ? rounds : executor).start(options) };
    const daemon = await fixture(t, { 'claude-sdk': router, [driver]: router });
    ok(await daemon.call('register-mcp', { name: 'remote', config: { type: transport, ...remoteV1 } }));
    for (const name of ['public', 'unused']) ok(await daemon.call('register-mcp', { name, config: { type: 'http', url: 'https://public.example.invalid/mcp' } }));
    const coordinatorDriver = driver === 'codex' ? 'codex' : 'claude-sdk';
    await daemon.writeAgent('claude-coordinator', { role: 'coordinator', driver: coordinatorDriver, mcp: ['remote', 'public'] });
    await daemon.writeAgent('executor', { driver, model: { 'claude-sdk': 'haiku', codex: 'gpt-6-luna', grok: 'grok-4.7', deepseek: 'deepseek-flash' }[driver],
      mcp: ['remote', 'public'] });
    ok(await daemon.call('set-concurrency', { limit: 1 }));
    const { work } = await startWork(daemon);
    const gate = (await daemon.call('list-pending')).result[0];
    ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
    const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
    await until(dispatches, values => values.length === 2 && values[0].status === 'running' && values[1].status === 'queued' && seen.length === 1);
    for (const options of [...roundOptions, seen[0]!]) {
      assert.deepEqual(Object.keys(options.mcpServers).sort(), ['helm', 'public', 'remote']);
      assert.deepEqual(options.mcpServers.remote, remoteV1);
      assert.deepEqual(options.mcpServers.public, { url: 'https://public.example.invalid/mcp', headers: {} });
      assert.equal(options.mcpServers.helm!.url, `${daemon.url}/mcp`);
      assert.match(options.mcpServers.helm!.headers.Authorization!, /^Bearer \S+$/);
    }
    await writeFile(join(daemon.directory, 'data', 'library', 'mcp', 'remote.json'),
      JSON.stringify({ type: transport, ...remoteV2 }));
    releaseFirst();
    await until(dispatches, values => values[1]?.status === 'running' && seen.length === 2);
    assert.deepEqual(seen[1]!.mcpServers.remote, remoteV2);
    assert.deepEqual(seen[0]!.mcpServers.remote, remoteV1);
    for (const id of ['claude-coordinator', 'executor']) {
      const agent = (await daemon.call('list-agents')).result.find((agent: any) => agent.id === id);
      ok(await daemon.call('save-agent', { id, mode: 'update', baseRevision: agent.revision, config: { ...agent.config, mcp: [] }, prompt: agent.prompt }));
    }
    ok(await daemon.call('delete-library-entry', { type: 'mcp', name: 'remote' }));
    assert.deepEqual(seen[1]!.mcpServers.remote, remoteV2);
    assert.deepEqual(roundOptions[0]!.mcpServers.remote, remoteV1);
    releaseSecond();
    await until(dispatches, values => values.length === 2 && values.every(value => value.status === 'ended'));
    for (const name of ['list-agents', 'get-events', 'list-dispatches', 'list-rounds']) {
      const value = await daemon.call(name, ['list-dispatches', 'list-rounds'].includes(name) ? { workId: work.id } : {});
      ok(value);
      assert.ok(!JSON.stringify(value).includes('remote-secret'), `${name} 不得泄露库 MCP 请求头或环境变量值`);
    }
  });
});

test('每次派单和调度轮次读取文件并留快照，下一轮按文件中的驱动路由，无须重启', async t => {
  const seen: { driver: string; agent: any }[] = [];
  const jobs = ['first'];
  const script = (driver: string): FakeScript => ctx => {
    seen.push({ driver, agent: structuredClone(ctx.options.agent) });
    if (ctx.options.agent?.role === 'executor') return [];
    if (JSON.parse(ctx.input).work.status === 'aligning') return alignment(ctx);
    const key = jobs.shift();
    if (!key) return [];
    return [
      { type: 'tool', name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: `卡片 ${key}` }, saveAs: 'card', check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key, agentId: 'file-executor' }), check: ok },
    ];
  };
  const daemon = await fixture(t, {
    'claude-sdk': new FakeDriver(Array(30).fill(script('claude-sdk'))),
    codex: new FakeDriver(Array(30).fill(script('codex'))),
  });
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator', model: 'coordinator-v1' }, '调度策略一');
  await daemon.writeAgent('file-executor', { model: 'executor-v1' }, '执行策略一');
  await mkdir(join(daemon.agentDir, 'file-executor', 'skills'));
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
  await until(dispatches, values => values.length === 1 && values[0].status === 'ended');
  const idle = () => until(events, values => values.filter(value => value.action === 'round-started').length === values.filter(value => value.action === 'round-ended').length);
  await idle();
  const first = (await dispatches())[0];
  assert.equal(first.agent.model, 'executor-v1');
  assert.equal(first.agent.prompt, '执行策略一');
  assert.equal(first.agent.fast, false);
  assert.equal(first.agent.skillsPath, null);
  await assert.rejects(lstat(join(first.outputPath, '..', 'skills')), { code: 'ENOENT' });
  assert.ok(seen.filter(value => value.agent.role === 'coordinator').every(value => value.agent.skillsPath === null));
  for (const [id, role, model, prompt] of [
    ['claude-coordinator', 'coordinator', 'coordinator-v2', '调度策略二'],
    ['file-executor', 'executor', 'executor-v2', '执行策略二'],
  ]) {
    const current = (await daemon.call('list-agents')).result.find((item: any) => item.id === id);
    ok(await daemon.call('save-agent', { id, mode: 'update', baseRevision: current.revision,
      config: { ...savedConfig, role, driver: 'codex', model }, prompt }));
  }
  jobs.push('second');
  ok(await daemon.call('send-message', { workId: work.id, key: 'next', body: '使用更新后的 Agent' }));
  const values = await until(dispatches, values => values.length === 2 && values[1].status === 'ended');
  await idle();
  assert.deepEqual(values[0], first);
  assert.equal(values[1].agent.model, 'executor-v2');
  assert.equal(values[1].agent.prompt, '执行策略二');
  assert.equal(values[1].agent.driver, 'codex');
  const rounds = (await events()).filter(value => value.action === 'round-agent-loaded');
  assert.equal(rounds[0].details.agent.prompt, '调度策略一');
  assert.equal(rounds.at(-1).details.agent.prompt, '调度策略二');
  assert.equal(rounds.at(-1).details.agent.model, 'coordinator-v2');
  assert.deepEqual(seen.filter(value => value.agent.role === 'executor').map(value => value.driver), ['claude-sdk', 'codex']);
  assert.ok(seen.some(value => value.agent.role === 'coordinator' && value.driver === 'codex'));
});

test('排队派单在实际启动时重读 Agent，已经运行的派单保留原快照', async t => {
  for (const change of ['valid', 'broken', 'missing-skill', 'missing-mcp'] as const) await t.test(change, async t => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const executors = new FakeDriver([[forbiddenSave, { type: 'hang', until: hold }], []]);
    const rounds = new FakeDriver([alignment, ctx => [
      ...['first', 'queued'].flatMap(key => [
        { type: 'tool' as const, name: 'create-card', arguments: { workId: workIdOf(ctx), key, content: key }, saveAs: key, check: ok },
        { type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: (ctx.results.get(key) as any).result.id, key, agentId: 'file-executor' }), check: ok },
      ]),
    ]]);
    const routed: string[] = [];
    const daemon = await fixture(t, { 'claude-sdk': { checkAvailability: async () => ({ available: true }), start: options => options.agent?.role === 'coordinator' ? rounds.start(options) : executors.start(options) },
      codex: { checkAvailability: async () => ({ available: true }), start: options => { routed.push(options.agent!.model!); return new FakeDriver().start(options); } },
    });
    await daemon.writeAgent('claude-coordinator', { role: 'coordinator' });
    await daemon.writeAgent('file-executor', { model: 'before-queue' });
    ok(await daemon.call('set-concurrency', { limit: 1 }));
    const { work, events } = await startWork(daemon);
    const gate = (await daemon.call('list-pending')).result[0];
    ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
    const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
    const queued = await until(dispatches, values => values.length === 2 && values[0].status === 'running' && values[1].status === 'queued');
    const card = (await daemon.call('get-card', { workId: work.id, cardId: queued[1].cardId })).result;
    if (change !== 'valid') {
      await writeFile(join(card.workPath, 'unstarted.txt'), '派单尚未开始');
      if (change === 'broken') await writeFile(join(daemon.agentDir, 'file-executor', 'config.json'), '{');
      else await daemon.writeAgent('file-executor', change === 'missing-mcp' ? { mcp: ['absent'] } : { skills: ['absent'] });
    } else {
      const current = (await daemon.call('list-agents')).result.find((item: any) => item.id === 'file-executor');
      ok(await daemon.call('save-agent', { id: 'file-executor', mode: 'update', baseRevision: current.revision,
        config: { ...savedConfig, driver: 'codex', model: 'after-queue' }, prompt: '排队后更新的策略' }));
      const running = (await daemon.call('get-dispatch', { workId: work.id, dispatchId: queued[0].id })).result;
      assert.equal(running.status, 'running');
      assert.deepEqual(running.agent, queued[0].agent);
    }
    release();
    const values = await until(dispatches, values => values.length === 2 && values.every(value => value.status === 'ended'));
    assert.equal(values[0].agent.model, 'before-queue');
    const denied = (await events()).find(event => event.action === 'operation-rejected' && event.actor.type === 'dispatch' && event.actor.id === values[0].id);
    assert.equal(denied?.details.code, 'FORBIDDEN');
    if (change !== 'valid') {
      assert.equal(values[1].endReason, 'error');
      assert.equal(values[1].startCommit, null);
      assert.equal(values[1].endCommit, null);
      assert.deepEqual(routed, []);
      assert.match(execFileSync('git', ['-C', card.workPath, 'status', '--porcelain'], { encoding: 'utf8' }), /unstarted.txt/);
      const ended = (await events()).find(value => value.action === 'dispatch-ended' && value.dispatchId === values[1].id);
      assert.equal(ended.details.error.code, 'AGENT_UNAVAILABLE');
      if (change === 'missing-skill' || change === 'missing-mcp') assert.match(ended.details.error.reason, /absent/);
      return;
    }
    assert.equal(values[1].agent.model, 'after-queue');
    assert.equal(values[1].agent.prompt, '排队后更新的策略');
    assert.deepEqual(routed, ['after-queue']);
  });
});

test('坏的调度者 Agent 用结构化错误结束轮次，不拉起驱动', async t => {
  for (const [name, config, reason] of [
    ['fast', { fast: true }, /extra usage/],
    ['missing-mcp', { mcp: ['absent'] }, /absent/],
    ['reserved-mcp', { mcp: ['helm'] }, /helm.*冲突/],
  ] as const) await t.test(name, async t => {
    const daemon = await fixture(t, { 'claude-sdk': new FakeDriver([[{ type: 'end', reason: 'completed', finalAnswer: '第一轮' }]]) });
    await daemon.writeAgent('claude-coordinator', { role: 'coordinator' });
    const { project, work, events } = await startWork(daemon);
    await daemon.writeAgent('claude-coordinator', { role: 'coordinator', ...config });
    const rejected = await daemon.call('send-message', { projectId: project.id, key: 'second', body: '新工作' });
    assert.equal(rejected.error.code, 'AGENT_UNAVAILABLE');
    await daemon.call('send-message', { workId: work.id, key: 'again', body: '再来一轮' });
    await until(events, values => values.filter(value => value.action === 'round-ended').length === 2);
    const ended = (await events()).filter(value => value.action === 'round-ended')[1];
    assert.equal(ended.details.error.code, 'AGENT_UNAVAILABLE');
    assert.equal(ended.details.error.details.agentId, 'claude-coordinator');
    assert.match(ended.details.error.reason, reason);
  });
});

test('派给坏 Agent、缺失 Agent 和 Claude fast Agent 返回结构化错误，健康 Agent 仍能派单', async t => {
  const rounds = new FakeDriver([alignment, ctx => [
    { type: 'tool', name: 'create-card', arguments: { workId: workIdOf(ctx), key: 'card', content: '检查不可用 Agent' }, saveAs: 'card', check: ok },
    ...['broken', 'missing', 'fast', '../outside', 'missing-skill', 'clashing-skill', 'missing-mcp', 'reserved-mcp', 'stdio-grok', 'stdio-deepseek'].map(agentId => ({
      type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: agentId, agentId }),
      check: (value: any) => {
        assert.equal(value.ok, false, JSON.stringify(value));
        assert.equal(value.error.code, 'AGENT_UNAVAILABLE');
        assert.equal(value.error.details.agentId, agentId);
        if (agentId.startsWith('stdio-')) assert.match(value.error.reason, /ACP.*(grok|deepseek).*不支持 stdio.*local/);
      },
    })),
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('card') as any).result.id, key: 'healthy', agentId: 'healthy' }), check: ok },
  ]]);
  const daemon = await fixture(t, {
    'claude-sdk': { checkAvailability: async () => ({ available: true }), start: options => (options.agent?.role === 'coordinator' ? rounds : new FakeDriver()).start(options) },
    grok: { checkAvailability: async () => ({ available: true }), start: async () => { assert.fail('不可用的 Grok Agent 不得启动'); } },
    deepseek: { checkAvailability: async () => ({ available: true }), start: async () => { assert.fail('不可用的 DeepSeek Agent 不得启动'); } },
  });
  await daemon.writeAgent('claude-coordinator', { role: 'coordinator' });
  await daemon.writeAgent('healthy');
  await daemon.writeAgent('fast', { fast: true });
  await daemon.writeAgent('broken');
  await writeFile(join(daemon.agentDir, 'broken', 'config.json'), '{');
  await daemon.writeAgent('missing-skill', { skills: ['absent'] });
  await daemon.writeAgent('clashing-skill', { skills: ['shared'] });
  await daemon.writeAgent('missing-mcp', { mcp: ['absent'] });
  await daemon.writeAgent('reserved-mcp', { mcp: ['helm'] });
  ok(await daemon.call('register-mcp', { name: 'local', config: { type: 'stdio', command: 'node', env: { TOKEN: 'private-stdio-token' } } }));
  await daemon.writeAgent('stdio-grok', { driver: 'grok', model: 'grok-4.7', mcp: ['local'] });
  await daemon.writeAgent('stdio-deepseek', { driver: 'deepseek', model: 'deepseek-flash', mcp: ['local'] });
  const library = join(daemon.directory, 'data', 'library', 'skills', 'shared');
  await mkdir(library, { recursive: true });
  await writeFile(join(library, 'SKILL.md'), '库 skill');
  await mkdir(join(daemon.agentDir, 'clashing-skill', 'skills', 'shared'), { recursive: true });
  const agents = (await daemon.call('list-agents')).result;
  for (const [id, reason] of [
    ['missing-skill', /absent/], ['clashing-skill', /同名.*shared/], ['missing-mcp', /absent/], ['reserved-mcp', /helm.*冲突/],
    ['stdio-grok', /ACP.*grok.*不支持 stdio.*local/], ['stdio-deepseek', /ACP.*deepseek.*不支持 stdio.*local/],
  ] as const) {
    const agent = agents.find((entry: any) => entry.id === id);
    assert.equal(agent.available, false);
    assert.match(agent.reason, reason);
  }
  const repaired = join(daemon.directory, 'data', 'library', 'skills', 'absent');
  await mkdir(repaired);
  await writeFile(join(repaired, 'SKILL.md'), '补回缺失条目');
  assert.equal((await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'missing-skill').available, true);
  await rm(repaired, { recursive: true });
  const { work, events } = await startWork(daemon);
  const gate = (await daemon.call('list-pending')).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const values = await until(events, values => values.some(value => value.action === 'dispatch-ended'));
  assert.equal(values.filter(value => value.action === 'operation-rejected' && value.object.id === 'create-dispatch').length, 10);
  assert.ok(!JSON.stringify(await daemon.call('list-agents')).includes('private-stdio-token'));
  assert.ok(!JSON.stringify(await daemon.call('get-events')).includes('private-stdio-token'));
  const dispatches = (await daemon.call('list-dispatches', { workId: work.id })).result;
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].agentId, 'healthy');
});

test('删除 Agent 移除目录；仍被项目默认调度者使用、不存在或 id 非法时拒绝', async t => {
  const daemon = await fixture(t);
  await daemon.writeAgent('file-coordinator', { role: 'coordinator' });
  await daemon.writeAgent('file-executor');
  await mkdir(join(daemon.agentDir, 'file-executor', 'skills'));
  const repo = join(daemon.directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const project = (await daemon.call('register-project', { path: repo })).result;
  ok(await daemon.call('set-project-coordinator-agent', { projectId: project.id, agentId: 'file-coordinator' }));
  ok(await daemon.call('delete-agent', { id: 'file-executor' }));
  assert.deepEqual(await readdir(daemon.agentDir), ['file-coordinator']);
  assert.deepEqual((await daemon.call('list-agents')).result.map((item: any) => item.id), ['file-coordinator']);
  const events = (await daemon.call('get-events', {})).result;
  assert.ok(events.some((event: any) => event.action === 'agent-deleted' && event.object.id === 'file-executor'), JSON.stringify(events));
  const inUse = await daemon.call('delete-agent', { id: 'file-coordinator' });
  assert.equal(inUse.error.code, 'AGENT_IN_USE');
  assert.match(inUse.error.reason, /1 个项目的默认调度者/);
  assert.deepEqual(await readdir(daemon.agentDir), ['file-coordinator']);
  assert.equal((await daemon.call('delete-agent', { id: 'file-executor' })).error.code, 'AGENT_NOT_FOUND');
  assert.equal((await daemon.call('delete-agent', { id: '..' })).error.code, 'INVALID_PARAMS');
});
