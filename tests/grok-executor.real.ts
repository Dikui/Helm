// Outside the sandbox only; opt in with HELM_GROK_EXECUTOR_REAL=1.
// This file is compiled by npm test but is never executed by that command.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { AcpDriver } from '../src/acp-driver.js';
import { runtimeEnvironment } from '../src/environment.js';
import { grokFixture } from './grok-executor-fixture.js';

const enabled = process.env.HELM_GROK_EXECUTOR_REAL === '1';
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test('Grok 真实执行者：一轮、同端点结论/浏览器、卡片沙箱、token、模型/推理强度和共用 leader 真并行',
  { skip: !enabled, timeout: 480_000 }, async t => {
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
    const outside = join(evidence, 'outside.txt');
    const marker = randomUUID();
    const waiting = new Map<string, { response: ServerResponse; timer: NodeJS.Timeout }>();
    const arrivals: Record<string, number> = {};
    let paired = false;
    let cliHome = '';
    const site = createServer((request, response) => {
      const slot = request.url?.match(/^\/rendezvous\/(one|two)$/)?.[1];
      if (!slot) { response.end('<h1>Helm Grok executor smoke</h1>'); return; }
      if (waiting.has(slot) || paired) { response.writeHead(409).end('Do not retry'); return; }
      arrivals[slot] = Date.now();
      const timer = setTimeout(() => {
        response.writeHead(504).end('Other dispatch did not arrive: possible leader serialization');
        waiting.delete(slot);
      }, 90_000);
      waiting.set(slot, { response, timer });
      if (waiting.size === 2) {
        // Neither request has returned, proving both model turns reached their
        // shell tool concurrently, rather than merely overlapping CLI lifetimes.
        void stat(join(cliHome, '.grok', 'leader.sock')).then(socket => {
          paired = socket.isSocket();
          for (const entry of waiting.values()) {
            clearTimeout(entry.timer);
            entry.response.writeHead(paired ? 200 : 500).end(paired ? 'parallel-ok' : 'Missing shared leader socket');
          }
          waiting.clear();
        }, error => {
          for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.response.writeHead(500).end(String(error)); }
          waiting.clear();
        });
      }
    });
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
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
只用 helm MCP 的 browser_navigate 打开 ${base}，browser_snapshot 读取标题，browser_take_screenshot 保存 grok.png。
最后在同一个 helm MCP 调用 submit-conclusion，符合预期用 completed，否则 blocked；给出含检查证据的最终回答。`,
      secondContent: `这是低消耗并行冒烟，不安装、不派生子代理、不提交、不推送；不得切模型或推理强度。
第一步只执行一次原样命令 ${rendezvous('two')}，等待另一派单到达；不得提前结束、重试或绕过。成功应输出 parallel-ok。
然后最后调用 helm MCP 的 submit-conclusion completed，否则 blocked，并给出最终回答。`,
    });
    cliHome = daemon.home;
    // The helper registered its cleanup first. Stop the temporary shared leader
    // before its HOME is removed; never target the user's real default socket.
    const stopLeader = async () => {
      await daemon.close();
      await promisify(execFile)('grok', ['leader', 'kill', '--leader-socket', join(cliHome, '.grok', 'leader.sock')], {
        env: { ...runtimeEnvironment(), HOME: cliHome }, timeout: 10_000,
      });
    };
    try {
      await daemon.confirm();
      const dispatches = await daemon.ended(2, 300_000);
      await writeFile(join(evidence, 'parallel.json'), JSON.stringify({ paired, arrivals, dispatches }, null, 2));
      assert.ok(paired, '两个派单必须同时到达 rendezvous；若排队，回到 spec 修订设计，不能放宽断言');
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
        const session = messages.find(m => m.method === 'session/new').result;
        assert.equal(session.configOptions.find((o: any) => o.id === 'model').currentValue, model, '-m 必须在会话元数据生效');
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
      assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(outside)
        && /operation not permitted|permission denied|read-only file system|sandbox/i.test(JSON.stringify(entries))), '必须有真实沙箱拒绝证据');
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
    } finally { await stopLeader(); }
  });
