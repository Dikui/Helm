import assert from 'node:assert/strict';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import { acpFixture, collect } from './acp-fixture.js';
import { until } from './browser-fixture.js';

test('Grok Agent skills 通过进程插件加载，两个并行 Agent 及续跑互不注入，默认主目录不被改写', async t => {
  const ctx = await acpFixture(t);
  const agents = await Promise.all(['alpha', 'beta'].map(async id => {
    const directory = join(ctx.directory, `agent ${id}`);
    const skillsPath = join(directory, 'skills');
    await mkdir(join(skillsPath, id), { recursive: true });
    await writeFile(join(skillsPath, id, 'SKILL.md'), `---\nname: ${id}\ndescription: test\n---\n${id}`);
    return { ...ctx.agent, id, directory, skillsPath };
  }));
  for (const agent of agents) assert.deepEqual(await ctx.driver.checkAvailability(agent), { available: true });
  const sessions = await Promise.all(agents.map(agent => ctx.driver.start({ ...ctx.options, agent })));
  await Promise.all(sessions.map(async session => { await session.send('派单'); await collect(session.events); }));
  const resumed = await ctx.driver.start({ ...ctx.options, agent: agents[0]!, resumeSessionId: sessions[0]!.id });
  await resumed.send('续跑');
  await collect(resumed.events);
  const plain = await ctx.driver.start(ctx.options);
  await plain.send('无 Agent skills');
  await collect(plain.events);
  const spawns = (await ctx.requests()).filter(r => r.method === 'fixture/spawn');
  assert.equal(spawns.length, 6);
  for (const agent of agents) assert.equal(spawns.slice(0, 4).filter(spawn => spawn.args.includes(agent.directory)).length, 2);
  for (const spawn of spawns.slice(0, -1)) {
    const index = spawn.args.indexOf('--plugin-dir');
    assert.ok(index > 0);
    assert.ok(spawn.args.includes('--no-leader'), '插件不能被共享 leader 忽略');
    assert.ok(agents.some(agent => agent.directory === spawn.args[index + 1]));
    assert.equal(spawn.args.filter((arg: string) => arg === '--plugin-dir').length, 1);
    assert.equal(spawn.env.HOME, ctx.home);
    assert.equal(spawn.env.GROK_HOME, undefined);
  }
  assert.deepEqual(spawns[4].args, ['agent', '--effort', 'low', '--no-leader', '--plugin-dir', agents[0]!.directory, 'stdio']);
  assert.equal(spawns[5].args.includes('--plugin-dir'), false);
  assert.deepEqual(await readdir(ctx.home), [], '不写 .grok、.claude 或 .helm 全局位置');
});

for (const home of ['shared', 'dedicated'] as const) test(`DeepSeek ${home} Agent 独立进程补丁叠加 skills，并行及续跑隔离且退出清理补丁`, async t => {
  const model = home === 'shared' ? 'deepseek-flash' : 'deepseek-v4-flash';
  const route = home === 'shared' ? 'deepseek-account' : 'deepseek-official';
  const configOptions = [
    { id: 'model', name: 'Model', type: 'select', currentValue: JSON.stringify([route, model]),
      options: [{ value: JSON.stringify([route, model]), name: model }] },
    { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }] },
  ];
  const ctx = await acpFixture(t, { configOptions }, true, 'deepseek');
  const agents = await Promise.all(['alpha', 'beta'].map(async id => {
    const directory = join(ctx.directory, `agent '${id}`);
    const skillsPath = join(directory, 'skills');
    await mkdir(join(skillsPath, id), { recursive: true });
    await writeFile(join(skillsPath, id, 'SKILL.md'), `---\nname: ${id}\ndescription: test\n---\n${id}`);
    if (home === 'dedicated') {
      const apiHome = join(ctx.home, '.helm', 'agent-homes', id);
      await mkdir(apiHome, { recursive: true });
      await writeFile(join(apiHome, '.env'), 'DEEPSEEK_API_KEY=fixture-key\n');
    }
    return { ...ctx.agent, id, directory, skillsPath, home, model };
  }));
  for (const agent of agents) assert.deepEqual(await ctx.driver.checkAvailability(agent), { available: true });
  const sessions = await Promise.all(agents.map(agent => ctx.driver.start({ ...ctx.options, agent })));
  const liveSpawns = (await ctx.requests()).filter(r => r.method === 'fixture/spawn').slice(2);
  for (const spawn of liveSpawns) assert.ok((await stat(spawn.patches[0].path)).isFile(), '补丁在进程存活时仍可读');
  await Promise.all(sessions.map(async session => { await session.send('派单'); await collect(session.events); }));
  const resumed = await ctx.driver.start({ ...ctx.options, agent: agents[0]!, resumeSessionId: sessions[0]!.id });
  await resumed.send('续跑');
  await collect(resumed.events);
  const plain = await ctx.driver.start({ ...ctx.options, agent: { ...agents[0]!, skillsPath: null } });
  await plain.send('无 Agent skills');
  await collect(plain.events);
  const spawns = (await ctx.requests()).filter(r => r.method === 'fixture/spawn');
  assert.equal(spawns.length, 6);
  const patched = spawns.slice(0, -1);
  for (const agent of agents) assert.equal(patched.slice(0, 4).filter(spawn =>
    spawn.patches[0].content[0].insert[0].config.customSkillDirs.includes(agent.skillsPath)).length, 2);
  assert.equal(new Set(patched.map(s => s.patches[0].path)).size, 5, '每次检查、派单、续跑都有自己的临时文件');
  for (const spawn of patched) {
    assert.deepEqual(spawn.args, ['--profile', 'acp', '--patch', spawn.patches[0].path]);
    const expected = agents.find(agent => home === 'dedicated'
      ? spawn.env.DSH_HOME === join(ctx.home, '.helm', 'agent-homes', agent.id)
      : spawn.patches[0].content[0].insert[0].config.customSkillDirs[0] === agent.skillsPath)!;
    assert.ok(expected);
    assert.deepEqual(spawn.patches[0].content, [{ insert: [{ id: 'helm-agent-skills',
      name: '@deepseek-ai/dsh-skill-filesystem', config: {
        providerName: 'helm-agent', includeDefaultRoots: false, customSkillDirs: [expected.skillsPath],
      } }] }], '增加独立提供者，不覆盖用户原有 skill-filesystem 配置和默认来源');
    assert.equal(spawn.env.HOME, ctx.home);
    if (home === 'shared') assert.equal(spawn.env.DSH_HOME, undefined);
    assert.equal(spawn.env.DSH_PERMISSION_MODE, 'workspace-write');
    assert.equal(spawn.env.DEEPSEEK_API_KEY, undefined);
    await assert.rejects(stat(spawn.patches[0].path), { code: 'ENOENT' });
  }
  assert.deepEqual(patched[4].patches[0].content[0].insert[0].config.customSkillDirs, [agents[0]!.skillsPath]);
  assert.deepEqual(spawns[5].args, ['--profile', 'acp']);
  assert.deepEqual(await readdir(ctx.home), home === 'shared' ? [] : ['.helm']);
  if (home === 'dedicated') for (const agent of agents) {
    const apiHome = join(ctx.home, '.helm', 'agent-homes', agent.id);
    assert.deepEqual(await readdir(apiHome), ['.env'], '不把补丁或 skills 写入 API 主目录');
  }
});

for (const failure of ['availability', 'startup', 'configuration', 'abort-startup', 'cancel'] as const) {
  test(`DeepSeek skills 临时补丁在 ${failure} 后清理`, async t => {
    const script = failure === 'availability' ? { rejectOn: 'initialize' }
      : failure === 'startup' ? { rejectOn: 'session/new' }
      : failure === 'abort-startup' ? { hangOn: 'initialize' }
      : failure === 'cancel' ? { holdPrompt: true, configOptions: [
        { id: 'model', name: 'Model', type: 'select', currentValue: '["deepseek-account","deepseek-flash"]',
          options: [{ value: '["deepseek-account","deepseek-flash"]', name: 'Flash' }] },
        { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'low', options: [{ value: 'low', name: 'Low' }] },
      ] } : { configOptions: [] };
    const ctx = await acpFixture(t, script, true, 'deepseek');
    const agent = { ...ctx.agent, skillsPath: join(ctx.directory, 'skills') };
    await mkdir(agent.skillsPath);
    const driver = new AcpDriver('deepseek', { command: ctx.command, timeoutMs: 2000 });
    if (failure === 'availability') assert.equal((await driver.checkAvailability(agent)).available, false);
    else if (failure === 'abort-startup') {
      const controller = new AbortController();
      const rejected = assert.rejects(driver.start({ ...ctx.options, agent, signal: controller.signal }));
      await until(ctx.requests, requests => requests.some(r => r.method === 'initialize'));
      controller.abort();
      await rejected;
    } else if (failure === 'cancel') {
      const session = await driver.start({ ...ctx.options, agent });
      await session.send('等待');
      const collecting = collect(session.events);
      await until(ctx.requests, requests => requests.some(r => r.method === 'session/prompt'));
      session.cancel();
      const end = (await collecting).at(-1)!;
      assert.equal(end.type === 'end' && end.reason, 'aborted');
    } else await assert.rejects(driver.start({ ...ctx.options, agent }));
    const spawn = (await ctx.requests()).find(r => r.method === 'fixture/spawn');
    assert.ok(spawn);
    await assert.rejects(stat(spawn.patches[0].path), { code: 'ENOENT' });
    assert.deepEqual(await readdir(ctx.home), []);
  });
}
