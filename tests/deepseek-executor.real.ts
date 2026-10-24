// Outside the sandbox only; opt in with HELM_DEEPSEEK_EXECUTOR_REAL=1.
// npm test compiles this file but never executes it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import { acpExecutorFixture, assertExecutorGitProbe, executorGitProbe, ok } from './acp-executor-fixture.js';
import { until } from './browser-fixture.js';

const enabled = process.env.HELM_DEEPSEEK_EXECUTOR_REAL === '1';
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const messages = (output: any[]) => output.filter(e => e.type === 'output').map(e => { try { return JSON.parse(e.text); } catch { return {}; } });

test('DeepSeek 真实账号执行者：一轮、同端点结论/浏览器、卡片沙箱、token、配置、续跑与取消',
  { skip: !enabled, timeout: 720_000 }, async t => {
    const realHome = homedir();
    const stagedAuth = join(realHome, '.dsh', '.credentials.yaml');
    assert.ok((await stat(stagedAuth)).isFile(), '先运行 dsh web 登录账号；本测试只链接 CLI 拥有的凭据，不读取内容');
    const previousBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(realHome, process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
    t.after(() => {
      if (previousBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsers;
    });
    if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '需要有界面的 Chromium');
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-deepseek-smoke-evidence-')));
    console.log(`DeepSeek 冒烟证据目录：${evidence}`);
    // Place the protected destination outside writable system temp directories.
    const outsideDirectory = await realpath(await mkdtemp(join(realHome, '.helm-deepseek-smoke-')));
    t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
    const outside = join(outsideDirectory, 'outside.txt');
    const boundaryCommand = `printf outside > ${shellQuote(outside)}`;
    const marker = randomUUID();
    const skillProof = randomUUID();
    const memory = randomUUID();
    let cancelResponse: ServerResponse | undefined;
    const site = createServer((request, response) => {
      if (request.url === '/cancel-in-flight') { cancelResponse = response; return; }
      response.end('<h1>Helm DeepSeek executor smoke</h1>');
    });
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      cancelResponse?.destroy(); site.closeAllConnections();
      await new Promise<void>(resolve => site.close(() => resolve()));
    });
    const address = site.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const daemon = await acpExecutorFixture(t, new AcpDriver('deepseek'), { agent: 'deepseek', stagedAuth,
      model: 'deepseek-flash', needsBrowser: true, realBrowser: true, gitProbe: true,
      skills: { 'helm-smoke-deepseek': `把 ${skillProof} 写入卡片副本的 skill-proof.txt。最终回答列出本技能名。` },
      content: `这是低消耗隔离冒烟，不安装、不派生子代理、不提交；只允许下面一次指定的本地远端推送探针，不得向其他目标推送；不得切换模型和推理强度。
在卡片副本原样执行一次命令 ${executorGitProbe}，git status 必须成功，git push 必须因 /dev/null/helm-push-disabled/ 失败；不得 unset 环境、覆盖 git 配置或重试，保留工具输出。本地裸远端由测试保留检查，不要清理。
实际执行一次原样命令 ${boundaryCommand}，预期由真实沙箱拒绝副本外写入；不得提权、重试或绕过，拒绝后继续。
在卡片副本写 inside.txt，内容 ${marker}。
使用已加载的 helm-smoke-deepseek 模板技能，按技能正文写 skill-proof.txt，最终回答列出该技能名。不得从其他模板查找技能。
在会话里记住暗号 ${memory}，不得主动写入文件或本轮最终回答，下一轮会追问。
只用 helm MCP 的 browser_navigate 打开 ${base}，browser_snapshot 读取标题，browser_take_screenshot 保存 deepseek.png。
最后在同一个 helm MCP 调用 submit-conclusion，符合预期用 completed，否则 blocked；给出包含检查证据的最终回答。`,
    });
    try {
      await daemon.confirm();
      const [first] = await daemon.ended(1, 300_000);
      const output = await daemon.output(first.id);
      await writeFile(join(evidence, 'first.json'), JSON.stringify({ dispatch: first, output }, null, 2));
      assert.equal(first.endReason, 'completed', first.failure);
      assert.equal(first.conclusion, 'completed');
      assert.ok(first.finalAnswer.trim());
      assert.ok(first.usage.inputTokens > 0 && first.usage.outputTokens > 0, '必须从真实 v4 zstd 文件读到用量');
      const firstMessages = messages(output);
      assert.ok(!firstMessages.some(m => m.method === 'helm/usage'), '用量读取不能静默失败');
      const configured = firstMessages.findLast(m => m.method === 'session/set_config_option').result.configOptions;
      assert.deepEqual(JSON.parse(configured.find((o: any) => o.id === 'model').currentValue), ['deepseek-account', 'deepseek-flash']);
      assert.equal(configured.find((o: any) => o.id === 'reasoning_effort').currentValue, 'low');
      const tools = new Map<string, any[]>();
      for (const message of firstMessages) {
        const update = message.params?.update;
        if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) continue;
        const entries = tools.get(update.toolCallId) ?? [];
        entries.push(update); tools.set(update.toolCallId, entries);
      }
      for (const tool of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'submit-conclusion']) {
        assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(tool)
          && JSON.stringify(entries).includes('helm') && entries.some(e => e.status === 'completed')), `必须实际调用 helm/${tool}`);
      }
      // The model may append commands (e.g. `echo "exit:$?"`), so the tool's exit code is not reliable evidence.
      assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(boundaryCommand)
        && /operation not permitted|permission denied|read-only file system|file access denied under workspace-write|outside.*workspace/i.test(JSON.stringify(entries))),
      '副本外写入必须有真实沙箱拒绝证据，不能只凭最终回答');
      await assert.rejects(readFile(outside), { code: 'ENOENT' });
      const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: first.cardId })).result;
      assertExecutorGitProbe(tools, card.workPath);
      assert.match(first.finalAnswer, /helm-smoke-deepseek/);
      assert.equal((await readFile(join(card.workPath, 'skill-proof.txt'), 'utf8')).trim(), skillProof, '暗号仅在模板技能正文里，必须实际加载并使用');
      assert.equal(daemon.git('show', `${card.cardBranch}:skill-proof.txt`), skillProof);
      assert.equal((await readFile(join(card.workPath, 'inside.txt'), 'utf8')).trim(), marker);
      assert.equal(daemon.git('show', `${card.cardBranch}:inside.txt`), marker);
      const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: first.id })).result;
      const screenshot = artifacts.find((a: any) => a.name === 'browser/deepseek.png');
      assert.ok(screenshot, '截图必须保存为成果');
      const image = (await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: screenshot.id, encoding: 'base64' })).result.content;
      await writeFile(join(evidence, 'deepseek.png'), Buffer.from(image, 'base64'));
      console.log(`请查看截图：${join(evidence, 'deepseek.png')}`);
      const idle = () => until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
      await idle();
      daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: {
        workId: daemon.work.id, cardId: first.cardId, templateId: 'deepseek-executor', key: 'resume-memory', resumeSessionId: first.sessionId,
        content: '低消耗续跑：不要读文件、搜索、调用浏览器或写文件。只用 helm submit-conclusion 报 completed，最终回答仅给出上一轮让你记住的暗号。',
      }, check: ok }]);
      ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'resume-memory', body: '打回续跑，检查上一轮记忆' }));
      const resumed = (await daemon.ended(2, 180_000))[1];
      const resumedOutput = await daemon.output(resumed.id);
      await writeFile(join(evidence, 'resume.json'), JSON.stringify({ dispatch: resumed, output: resumedOutput }, null, 2));
      assert.equal(resumed.endReason, 'completed', resumed.failure);
      assert.equal(resumed.conclusion, 'completed');
      assert.equal(resumed.sessionId, first.sessionId);
      assert.notEqual(resumed.pgid, first.pgid, '续跑必须由新的 ACP 进程发起');
      assert.equal(resumed.finalAnswer.trim(), memory, '必须从会话记忆回答');
      assert.ok(resumed.usage.inputTokens > 0 && resumed.usage.outputTokens > 0);
      assert.ok(messages(resumedOutput).some(m => m.method === 'session/resume'));
      const resumedCalls = messages(resumedOutput).map(m => m.params?.update).filter(u => u?.sessionUpdate === 'tool_call');
      assert.ok(resumedCalls.every(u => /submit-conclusion/.test(JSON.stringify(u))), '不能通过读文件找回暗号');
      await idle();
      const hold = `curl -fsS --max-time 180 ${shellQuote(`${base}/cancel-in-flight`)}`;
      daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: {
        workId: daemon.work.id, cardId: first.cardId, templateId: 'deepseek-executor', key: 'cancel-in-flight',
        content: `低消耗取消测试：第一步仅执行一次前台命令 ${hold}，保持等待，不后台化、不重试、不写文件、不派生子代理、不安装、不提交、不推送。运行层会中止本轮。`,
      }, check: ok }]);
      ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'cancel-in-flight', body: '检查进行中取消' }));
      await until(async () => Boolean(cancelResponse), ready => ready, 120_000);
      const running = (await daemon.dispatches()).find(d => d.key === 'cancel-in-flight');
      assert.equal(running.status, 'running', '必须在工具进行中取消');
      ok(await daemon.call('pause-card', { workId: daemon.work.id, cardId: first.cardId }));
      const cancelled = (await daemon.ended(3, 30_000))[2];
      await writeFile(join(evidence, 'cancel.json'), JSON.stringify({ dispatch: cancelled, output: await daemon.output(cancelled.id) }, null, 2));
      assert.equal(cancelled.endReason, 'aborted', cancelled.failure);
      assert.equal(cancelled.abortReason, '卡片暂停');
      assert.equal(cancelled.finalAnswer, null);
      await until(async () => cancelResponse!.destroyed, closed => closed, 10_000);
      console.log('请在 dsh web 账户页核对本次 deepseek-account 路线的实际计费方式，并追加到任务单 03 Comments；模型路由断言不能证明免费或订阅计费。');
    } finally { await daemon.close(); }
  });
