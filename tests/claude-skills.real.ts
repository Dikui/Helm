import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { before, test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeDriver } from '../src/claude-driver.js';
import { runtimeEnvironment } from '../src/environment.js';
import { TemplateCatalog } from '../src/templates.js';

// Only the test:real runner enables this file. npm test never starts a CLI.
before(async () => {
  if (process.env.HELM_CLAUDE_SKILLS_REAL === '1') assert.notEqual(await realpath(homedir()), await realpath(userInfo().homedir),
    '请先设置并登录临时 HOME，禁止使用用户真实主目录');
});
test('Claude 两个模板并行叠加自己的 skill，init 不含另一模板的 skill',
  { skip: process.env.HELM_CLAUDE_SKILLS_REAL !== '1', timeout: 240_000 }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'helm-claude-skills-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const catalog = new TemplateCatalog(join(root, 'templates'));
    const roles = ['coordinator', 'executor'] as const;
    const secrets = [`ALPHA-${randomUUID()}`, `BRAVO-${randomUUID()}`];
    const env = runtimeEnvironment();
    const driver = new ClaudeDriver();
    for (const [index, role] of roles.entries()) {
      const directory = join(catalog.directory, `template-${role}`);
      await mkdir(join(directory, 'skills', 'secret'), { recursive: true });
      await writeFile(join(directory, 'config.json'), JSON.stringify({
        role, driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: 'Skills isolation smoke',
      }));
      await writeFile(join(directory, 'prompt.md'), '这是技能隔离冒烟。遵循派单要求，不改文件，不使用 Bash、不启动浏览器、不派生子代理、不提交。');
      await writeFile(join(directory, 'skills', 'secret', 'SKILL.md'),
        `---\nname: secret\ndescription: 提供本模板的测试暗号。需要暗号时必须调用此技能。\n---\n本模板的暗号是 ${secrets[index]}。只回答这个暗号，不加说明。\n`);
      await mkdir(join(root, role));
    }
    const availability = await driver.checkAvailability(catalog.get('template-executor'));
    assert.equal(availability.available, true, `${availability.reason ?? ''}\n${availability.command ?? ''}`);
    // Start both sessions together and wait for both before removing their files.
    const outcomes = await Promise.allSettled(roles.map(async (role, index) => {
      const template = catalog.get(`template-${role}`);
      const cwd = join(root, role);
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 180_000);
      let session;
      try {
        session = await driver.start({ cwd, env, template, signal: controller.signal, mcpServers: {},
          sandbox: role === 'coordinator' ? { mode: 'read-only', writableRoots: [] } : { mode: 'workspace-write', writableRoots: [cwd] } });
        await session.send('请实际调用当前模板的 secret 技能，最后只回答它给出的暗号。禁止猜测、使用 Read/Bash 或读取其他目录。');
        const messages: SDKMessage[] = [];
        let completed = false;
        for await (const event of session.events) {
          if (event.type === 'output') messages.push(JSON.parse(event.text) as SDKMessage);
          if (event.type === 'end') {
            assert.equal(event.reason, 'completed');
            assert.equal(event.finalAnswer?.trim(), secrets[index]);
            completed = true;
          }
        }
        assert.equal(completed, true, '不能因超时或无 result 而通过');
        const inits = messages.filter(message => message.type === 'system' && message.subtype === 'init');
        assert.ok(inits.length > 0, '必须有真实 init 记录');
        for (const init of inits) {
          assert.ok(init.skills.includes(`template-${role}:secret`), '必须发现本模板的 skill');
          assert.ok(!init.skills.some(name => name.startsWith('template-') && name !== `template-${role}:secret`), '不得出现另一模板的 skill');
          assert.ok(init.plugins.some(plugin => plugin.name === template.id), '模板插件必须实际加载');
          assert.equal(init.fast_mode_state, 'off');
        }
        const calls = messages.flatMap(message => message.type === 'assistant' ? message.message.content
          .filter(block => block.type === 'tool_use').filter(block => block.name === 'Skill') : []);
        assert.ok(calls.length > 0, '必须实际调用 Skill，不能仅复述提示词');
        for (const call of calls) {
          assert.equal((call.input as { skill: string }).skill, `template-${role}:secret`);
          assert.ok(messages.some(message => message.type === 'user' && Array.isArray(message.message.content)
            && message.message.content.some(block => block.type === 'tool_result' && block.tool_use_id === call.id && !block.is_error)),
          'Skill 调用必须成功');
        }
        t.diagnostic(`${template.id}: init.skills=${JSON.stringify(inits[0]!.skills)}; Skill 调用及暗号通过`);
      } finally {
        clearTimeout(deadline);
        session?.cancel();
      }
    }));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  });
