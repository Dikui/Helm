// Outside the sandbox only; opt in with HELM_GROK_EXECUTOR_REAL=1.
// This file is compiled by npm test but is never executed by that command.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import { acpExecutorFixture as grokFixture, ok } from './acp-executor-fixture.js';
import { until } from './browser-fixture.js';

const enabled = process.env.HELM_GROK_EXECUTOR_REAL === '1';
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test('Grok 真实执行者：一轮、同端点结论/浏览器、卡片沙箱、token、模型/推理强度、两派单同时会合、续跑与取消',
  { skip: !enabled, timeout: 720_000 }, async t => {
    const realHome = homedir();
    const stagedAuth = join(realHome, '.grok', 'auth.json');
    assert.ok((await stat(stagedAuth)).isFile(), '先在本机 grok login');
    const previousBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(realHome, process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
    t.after(() => {
      if (previousBrowsers === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
      else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsers;
    });
    if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '需要有界面的 Chromium');
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-grok-smoke-evidence-')));
    console.log(`Grok 冒烟证据目录：${evidence}`);
    // The protected destination must be outside the sandbox's writable temp roots.
    const outsideDirectory = await realpath(await mkdtemp(join(homedir(), '.helm-grok-smoke-')));
    t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
    const outside = join(outsideDirectory, 'outside.txt');
    const marker = randomUUID();
    const memory = randomUUID();
    let cancelResponse: ServerResponse | undefined;
    const waiting = new Map<string, { response: ServerResponse; timer: NodeJS.Timeout }>();
    const arrivals: Record<string, number> = {};
    let paired = false;
    let rendezvousFailure: string | undefined;
    const site = createServer((request, response) => {
      if (request.url === '/cancel-in-flight') { cancelResponse = response; return; }
      const slot = request.url?.match(/^\/rendezvous\/(one|two)$/)?.[1];
      if (!slot) { response.end('<h1>Helm Grok executor smoke</h1>'); return; }
      if (waiting.has(slot) || paired) { response.writeHead(409).end('Do not retry'); return; }
      arrivals[slot] = Date.now();
      const timer = setTimeout(() => {
        rendezvousFailure = `另一派单未到达 ${slot} 的会合等待点（可能排队或提前失败）`;
        response.writeHead(504).end('Other dispatch did not arrive: possible queuing or early failure');
        waiting.delete(slot);
      }, 90_000);
      waiting.set(slot, { response, timer });
      if (waiting.size === 2) {
        // Neither request has returned, proving both model turns reached their
        // shell tool concurrently, rather than merely overlapping CLI lifetimes.
        paired = true;
        for (const entry of waiting.values()) {
          clearTimeout(entry.timer);
          entry.response.writeHead(200).end('parallel-ok');
        }
        waiting.clear();
      }
    });
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
      cancelResponse?.destroy();
      for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.response.destroy(); }
      site.closeAllConnections();
      await new Promise<void>(resolve => site.close(() => resolve()));
    });
    const address = site.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const rendezvous = (slot: string) => `curl -fsS --max-time 100 ${shellQuote(`${base}/rendezvous/${slot}`)}`;
    const boundaryCommand = `printf outside > ${shellQuote(outside)}`;
    // Standard older model, low effort; never select the 2x-price build-fast variant.
    const model = 'grok-4.5';
    const daemon = await grokFixture(t, new AcpDriver('grok'), { stagedAuth, model, needsBrowser: true, realBrowser: true,
      content: `这是低消耗隔离冒烟，不安装、不派生子代理、不提交、不推送；不得切模型或推理强度。
第一步只执行一次原样命令 ${rendezvous('one')}，等待另一派单到达；不得提前结束、重试或绕过。成功应输出 parallel-ok。
随后实际执行一次原样命令 ${boundaryCommand}，预期由真实沙箱拒绝副本外写入；不得提权、重试或绕过，拒绝后继续。
在卡片副本写 inside.txt，内容 ${marker}。
只在会话里记住暗号 ${memory}，不得写入文件、日志或本轮最终回答；下一轮会追问。
只用 helm MCP 的 browser_navigate 打开 ${base}，browser_snapshot 读取标题，browser_take_screenshot 保存 grok.png。
最后在同一个 helm MCP 调用 submit-conclusion，符合预期用 completed，否则 blocked；给出含检查证据的最终回答。`,
      secondContent: `这是低消耗并行冒烟，不安装、不派生子代理、不提交、不推送；不得切模型或推理强度。
第一步只执行一次原样命令 ${rendezvous('two')}，等待另一派单到达；不得提前结束、重试或绕过。成功应输出 parallel-ok。
然后最后调用 helm MCP 的 submit-conclusion completed，否则 blocked，并给出最终回答。`,
    });
    try {
      await daemon.confirm();
      const dispatches = await daemon.ended(2, 300_000);
      await writeFile(join(evidence, 'parallel.json'), JSON.stringify({ paired, arrivals, rendezvousFailure, dispatches }, null, 2));
      assert.ok(paired, `${rendezvousFailure ?? '派单未到达会合点'}；必须两个派单同时等待，若排队则回到 spec 修订设计。到达记录：${JSON.stringify(arrivals)}`);
      const outputs = new Map<string, any[]>();
      for (const dispatch of dispatches) {
        const output = await daemon.output(dispatch.id);
        await writeFile(join(evidence, `${dispatch.key}.json`), JSON.stringify({ dispatch, output }, null, 2));
        assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? JSON.stringify(dispatch));
        assert.equal(dispatch.conclusion, 'completed');
        assert.ok(dispatch.finalAnswer.trim());
        assert.ok(dispatch.usage.inputTokens > 0 && dispatch.usage.outputTokens > 0);
        const messages = output.filter(e => e.type === 'output').map(e => { try { return JSON.parse(e.text); } catch { return {}; } });
        outputs.set(dispatch.key, messages);
        const session = messages.findLast(m => m.method === 'session/set_config_option').result;
        assert.equal(session.configOptions.find((o: any) => o.id === 'model').currentValue, model, 'session/set_config_option 必须设为模板模型');
        assert.equal(session.configOptions.find((o: any) => o.id === 'reasoning_effort').currentValue, 'low', '--effort 必须生效');
      }
      assert.notEqual(dispatches[0].sessionId, dispatches[1].sessionId);
      const first = dispatches.find(d => d.key === 'dispatch-0');
      assert.ok(first);
      const tools = new Map<string, any[]>();
      for (const message of outputs.get(first.key)!) {
        const update = message.params?.update;
        if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) continue;
        const entries = tools.get(update.toolCallId) ?? [];
        entries.push(update); tools.set(update.toolCallId, entries);
      }
      for (const tool of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'submit-conclusion']) {
        assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(tool)
          && JSON.stringify(entries).includes('helm') && entries.some(e => e.status === 'completed')), `必须实际调用 helm/${tool}`);
      }
      assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(boundaryCommand)
        && entries.some(entry => entry.status === 'failed' || (typeof entry.rawOutput?.exit_code === 'number' && entry.rawOutput.exit_code !== 0))
        && /operation not permitted|permission denied|read-only file system|sandbox/i.test(JSON.stringify(entries))), '副本外写入必须失败，并有真实沙箱拒绝证据');
      await assert.rejects(readFile(outside), { code: 'ENOENT' });
      const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: first.cardId })).result;
      assert.equal((await readFile(join(card.workPath, 'inside.txt'), 'utf8')).trim(), marker);
      assert.equal(daemon.git('show', `${card.cardBranch}:inside.txt`), marker);
      const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: first.id })).result;
      const screenshot = artifacts.find((a: any) => a.name === 'browser/grok.png');
      assert.ok(screenshot, '截图必须保存为成果');
      const image = (await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: screenshot.id, encoding: 'base64' })).result.content;
      await writeFile(join(evidence, 'grok.png'), Buffer.from(image, 'base64'));
      console.log(`请查看截图：${join(evidence, 'grok.png')}`);
      const idle = () => until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
      await idle();
      daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: {
        workId: daemon.work.id, cardId: first.cardId, templateId: 'grok-executor', key: 'resume-memory', resumeSessionId: first.sessionId,
        content: '低消耗续跑测试：不要读文件、搜索、调用浏览器或写文件。只用 helm submit-conclusion 报 completed，最终回答仅给出上一轮让你记住的暗号。',
      }, check: ok }]);
      ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'resume-memory', body: '打回续跑，检查上一轮记忆' }));
      const resumed = (await daemon.ended(3, 180_000))[2];
      const resumedOutput = await daemon.output(resumed.id);
      await writeFile(join(evidence, 'resume.json'), JSON.stringify({ dispatch: resumed, output: resumedOutput }, null, 2));
      assert.equal(resumed.endReason, 'completed', resumed.failure);
      assert.equal(resumed.sessionId, first.sessionId);
      assert.notEqual(resumed.pgid, first.pgid, '续跑必须由新的 ACP 进程发起');
      assert.equal(resumed.finalAnswer.trim(), memory, '本轮没有暗号，必须从会话记忆回答');
      assert.ok(resumedOutput.some(e => e.type === 'output' && JSON.parse(e.text).method === 'session/resume'));
      const resumedCalls = resumedOutput.filter(e => e.type === 'output').map(e => JSON.parse(e.text).params?.update)
        .filter(update => update?.sessionUpdate === 'tool_call');
      assert.ok(resumedCalls.every(update => /submit-conclusion/.test(JSON.stringify(update))), '不能通过读文件找回暗号');
      await idle();
      const hold = `curl -fsS --max-time 180 ${shellQuote(`${base}/cancel-in-flight`)}`;
      daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: {
        workId: daemon.work.id, cardId: first.cardId, templateId: 'grok-executor', key: 'cancel-in-flight',
        content: `低消耗取消测试：第一步仅执行一次前台命令 ${hold}，保持等待，不后台化、不重试、不写文件、不派生子代理、不安装、不提交、不推送。运行层会中止本轮。`,
      }, check: ok }]);
      ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'cancel-in-flight', body: '检查进行中取消' }));
      await until(async () => Boolean(cancelResponse), ready => ready, 120_000);
      const cancelling = (await daemon.dispatches()).find(d => d.key === 'cancel-in-flight');
      assert.equal(cancelling.status, 'running', '必须在工具进行中取消，不能等本轮已结束');
      ok(await daemon.call('pause-card', { workId: daemon.work.id, cardId: first.cardId }));
      const cancelled = (await daemon.ended(4, 30_000))[3];
      await writeFile(join(evidence, 'cancel.json'), JSON.stringify({ dispatch: cancelled, output: await daemon.output(cancelled.id) }, null, 2));
      assert.equal(cancelled.endReason, 'aborted', cancelled.failure);
      assert.equal(cancelled.abortReason, '卡片暂停');
      assert.equal(cancelled.finalAnswer, null);
      await until(async () => cancelResponse!.destroyed, closed => closed, 10_000);
    } finally { await daemon.close(); }
  });
