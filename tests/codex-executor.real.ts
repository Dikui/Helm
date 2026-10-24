// Outside the sandbox only: npm run test:codex-executor
// Uses the real Codex login through a symlink (never opened) and the installed Playwright browsers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodexExecutorDriver } from '../src/codex-driver.js';
import { codexFixture, ok, sandboxDenied } from './codex-executor-fixture.js';
import { configureTestAgent } from './helmd-fixture.js';
import { until } from './browser-fixture.js';

const enabled = process.env.HELM_CODEX_EXECUTOR_REAL === '1';
const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

test('Codex 真实执行者：同端点结论/浏览器、沙箱、默认主目录、token、续跑和两 Agent skills 隔离',
  { skip: !enabled, timeout: 720_000 }, async t => {
    // Only this smoke links the real login into a temporary default CLI home; never write to the real home.
    const realHome = homedir();
    const stagedAuth = join(realHome, '.codex', 'auth.json');
    assert.ok((await stat(stagedAuth)).isFile(), '先在本机 codex login（文件存储）');
    // The fixture swaps HOME, so pin Playwright to the browsers already installed for the real HOME.
    const previousBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(realHome, process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
    t.after(() => {
      if (previousBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsers;
    });
    if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '需要有界面的 Chromium');
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-codex-smoke-evidence-')));
    console.log(`Codex 冒烟证据目录：${evidence}`);
    const outside = join(evidence, 'outside.txt');
    const marker = randomUUID();
    const alpha = `alpha-${randomUUID()}`;
    const beta = `beta-${randomUUID()}`;
    const command = `printf outside > ${shellQuote(outside)}`;
    const site = createServer((_request, response) => response.end('<h1>Helm Codex executor smoke</h1>'));
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
    const address = site.address();
    assert.ok(address && typeof address !== 'string');
    const daemon = await codexFixture(t, new CodexExecutorDriver(), { stagedAuth, needsBrowser: true,
      skills: { 'helm-smoke-alpha': `把 ${alpha} 写入 skill-proof.txt。` },
      content: `这是低消耗隔离冒烟，不安装、不派生子代理、不提交、不推送。
记住会话记号 ${marker}，不得把记号写入文件。
使用你可用的 helm-smoke- 开头的 skill，照技能要求写 skill-proof.txt，并列出可用的这些技能名。
实际执行一次原样命令 ${command}，预期副本外写入被沙箱拒绝；不得重试、提权或寻找绕过方式，拒绝后继续。
在副本中写 inside.txt（内容 inside）。
只用 helm MCP 的 browser_navigate 打开 http://127.0.0.1:${address.port}，browser_snapshot 读取标题，browser_take_screenshot 保存 codex.png。
最后在同一 helm MCP 调用 submit-conclusion，符合预期用 completed，否则 blocked，并给出最终回答。`,
    });
    await daemon.confirm();
    const first = (await daemon.ended(1, 240_000))[0];
    const saveOutput = async (dispatch: any) => {
      const output = (await daemon.call('get-dispatch-output', { workId: daemon.work.id, dispatchId: dispatch.id })).result;
      await writeFile(join(evidence, `${dispatch.key}.json`), JSON.stringify({ dispatch, output }, null, 2));
      const messages = output.filter((e: any) => e.type === 'output').map((e: any) => {
        try { return JSON.parse(e.text); } catch { return {}; }
      });
      const timings = messages.filter((m: any) => m.initializeDurationMs !== undefined).map((m: any) => m.initializeDurationMs);
      assert.equal(timings.length, 1, '必须记录 initialize 耗时');
      console.log(`Codex ${dispatch.key} initialize: ${timings[0]} ms`);
      assert.ok(timings[0] <= 15_000, `initialize ${timings[0]} ms > 15 秒：触发 spec 推翻条件，需评估共用进程或 sqlite 目录`);
      return messages;
    };
    const messages = await saveOutput(first);
    assert.equal(first.endReason, 'completed', first.failure ?? JSON.stringify(first));
    assert.equal(first.conclusion, 'completed');
    assert.ok(first.usage.inputTokens > 0 && first.usage.outputTokens > 0);
    assert.ok(first.sqlitePath.startsWith(join(daemon.dataDir, 'dispatches', first.id)));
    assert.ok((await readdir(first.sqlitePath)).some(name => name.endsWith('.sqlite')));
    const items = messages.filter((m: any) => m.method === 'item/completed').map((m: any) => m.params.item);
    for (const tool of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'submit-conclusion']) {
      assert.ok(items.some((item: any) => item.type === 'mcpToolCall' && item.server === 'helm' && item.tool === tool && item.status === 'completed'), `必须实际调用 helm/${tool}`);
    }
    assert.ok(await sandboxDenied(items, join(daemon.home, '.codex'), outside), '必须由真实沙箱拒绝副本外 shell 写入');
    await assert.rejects(readFile(outside), { code: 'ENOENT' });
    const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: first.cardId })).result;
    assert.equal((await readFile(join(card.workPath, 'inside.txt'), 'utf8')).trim(), 'inside');
    assert.equal((await readFile(join(card.workPath, 'skill-proof.txt'), 'utf8')).trim(), alpha);
    assert.match(first.finalAnswer, /helm-smoke-alpha/);
    const screenshot = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: first.id })).result.find((a: any) => a.name === 'browser/codex.png');
    assert.ok(screenshot, '截图必须保存为成果');
    const image = (await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: screenshot.id, encoding: 'base64' })).result.content;
    await writeFile(join(evidence, 'codex.png'), Buffer.from(image, 'base64'));
    console.log(`请查看截图：${join(evidence, 'codex.png')}`);
    const dispatch = async (key: string, agentId: string, content: string, resumeSessionId?: string) => {
      await until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
      daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: { workId: daemon.work.id, cardId: first.cardId,
        agentId, key, content, ...(resumeSessionId ? { resumeSessionId } : {}) }, check: ok }]);
      ok(await daemon.call('send-message', { workId: daemon.work.id, key, body: content }));
    };
    await dispatch('resume', 'codex-executor', '只凭先前对话回答会话记号，不读文件。最后调用 submit-conclusion completed 并在最终回答中写出记号。', first.sessionId);
    const resumed = (await daemon.ended(2, 180_000))[1];
    await saveOutput(resumed);
    assert.equal(resumed.endReason, 'completed', resumed.failure);
    assert.equal(resumed.sessionId, first.sessionId);
    assert.notEqual(resumed.sqlitePath, first.sqlitePath);
    assert.ok(resumed.finalAnswer.includes(marker), '真实 thread/resume 必须恢复对话');
    await cp(join(daemon.agentDir, 'codex-executor'), join(daemon.agentDir, 'codex-other'), { recursive: true });
    const otherSkills = join(daemon.agentDir, 'codex-other', 'skills');
    await rm(otherSkills, { recursive: true });
    await mkdir(join(otherSkills, 'helm-smoke-beta'), { recursive: true });
    await writeFile(join(otherSkills, 'helm-smoke-beta', 'SKILL.md'), `---\nname: helm-smoke-beta\ndescription: Helm smoke skill\n---\n用 ${beta} 覆盖 skill-proof.txt 的全部内容。`);
    await configureTestAgent(daemon.agentDir, 'codex-other', { home: 'shared' });
    await dispatch('other-agent', 'codex-other', '列出可用的 helm-smoke- 开头的 skill，并照技能要求写 skill-proof.txt；最后调用 submit-conclusion completed 并报告技能名。');
    const other = (await daemon.ended(3, 180_000))[2];
    await saveOutput(other);
    assert.equal(other.endReason, 'completed', other.failure);
    assert.equal(other.conclusion, 'completed');
    assert.notEqual(other.sessionId, first.sessionId);
    assert.match(other.finalAnswer, /helm-smoke-beta/);
    assert.doesNotMatch(other.finalAnswer, /helm-smoke-alpha/);
    assert.equal((await readFile(join(card.workPath, 'skill-proof.txt'), 'utf8')).trim(), beta);
  });
