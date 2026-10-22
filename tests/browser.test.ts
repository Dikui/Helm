import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, until } from './browser-fixture.js';

const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

test('派单持久记录是否需要浏览器，未标记时不启动浏览器', async t => {
  const daemon = await fixture(t, [ctx => {
    const endpoint = ctx.options.mcpServers.helm!;
    let failure: unknown;
    const checked = (async () => {
      const client = new Client({ name: 'executor-no-browser', version: '1' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['submit-conclusion']);
        const denied = await client.callTool({ name: 'browser_navigate', arguments: { url: 'http://127.0.0.1:1' } });
        assert.equal((denied.structuredContent as any).error.code, 'FORBIDDEN');
      } finally { await client.close(); }
    })().catch(error => { failure = error; });
    return [{ type: 'hang', until: checked }, { type: 'tool', name: 'submit-conclusion',
      arguments: () => { if (failure) throw failure; return { conclusion: 'completed', reason: '无浏览器权限' }; }, check: ok }];
  }]);
  const result = await daemon.ended();
  assert.equal(result.needsBrowser, false);
  assert.equal(result.browserPgid, null);
  assert.equal(result.endReason, 'completed');
  assert.ok(!(await daemon.events()).some(event => event.action === 'browser-started'));
});

test('需要浏览器的派单只获得检查工具，截图的图像与结构化结果原样转发', async t => {
  let tools: string[] = [];
  const daemon = await fixture(t, [ctx => {
    const endpoint = ctx.options.mcpServers.helm!;
    const checked = (async () => {
      // The fake executor is assigned a free local port, then serves its card copy there.
      const site = createServer(async (_request, response) => { response.end(await readFile(join(ctx.options.cwd, 'index.html'))); });
      await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
      const address = site.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      const client = new Client({ name: 'executor-browser-check', version: '1' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
        tools = (await client.listTools()).tools.map(tool => tool.name);
        assert.ok(tools.includes('browser_navigate'));
        assert.ok(tools.includes('browser_take_screenshot'));
        assert.ok(tools.includes('submit-conclusion'));
        assert.ok(!tools.includes('browser_evaluate'));
        assert.ok(!tools.includes('browser_run_code_unsafe'));
        assert.ok(!tools.includes('browser_future_unsafe'));
        const nav = await client.callTool({ name: 'browser_navigate', arguments: { url } });
        assert.deepEqual(nav.structuredContent, { url, page: '<h1>Helm browser dispatch</h1>' });
        const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
        assert.deepEqual(snapshot.content, [{ type: 'text', text: '<h1>Helm browser dispatch</h1>' }]);
        const screenshot = await client.callTool({ name: 'browser_take_screenshot', arguments: {} });
        const blocks = screenshot.content as { type: string; data: string; mimeType: string }[];
        assert.equal(blocks[0]!.type, 'image');
        assert.equal(blocks[0]!.mimeType, 'image/svg+xml');
        assert.equal(Buffer.from(blocks[0]!.data, 'base64').toString(), '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"><text x="10" y="40">Helm browser dispatch</text></svg>');
        assert.deepEqual(screenshot.structuredContent, { url, page: '<h1>Helm browser dispatch</h1>' });
        const failedClick = await client.callTool({ name: 'browser_click', arguments: { fail: true } });
        assert.equal(failedClick.isError, true);
        assert.deepEqual(failedClick.content, [{ type: 'text', text: 'Element unavailable' }]);
        for (const name of ['browser_evaluate', 'browser_run_code_unsafe', 'browser_future_unsafe']) {
          const denied = await client.callTool({ name, arguments: {} });
          assert.equal((denied.structuredContent as any).error.code, 'FORBIDDEN');
        }
      } finally { await client.close(); await new Promise<void>(resolve => site.close(() => resolve())); }
    })();
    // Surface async assertions as driver failures instead of unhandled rejections.
    let error: unknown;
    return [{ type: 'hang', until: checked.catch(value => { error = value; }) },
      { type: 'tool', name: 'submit-conclusion', arguments: () => { if (error) throw error; return { conclusion: 'completed', reason: '工具可用' }; }, check: ok }];
  }], { needsBrowser: true });
  const result = await daemon.ended();
  assert.equal(result.needsBrowser, true);
  assert.equal(result.endReason, 'completed', result.failure);
  assert.ok(Number.isInteger(result.browserPgid));
  assert.ok(result.browserStartedAt);
  assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
  const events = await daemon.events();
  const stoppedIndex = events.findIndex(event => event.action === 'browser-stopped');
  assert.ok(stoppedIndex >= 0);
  assert.ok(stoppedIndex < events.findIndex(event => event.action === 'dispatch-ended'));
  const user = new Client({ name: 'user-no-browser', version: '1' });
  try {
    await user.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`)));
    assert.ok(!(await user.listTools()).tools.some(tool => tool.name.startsWith('browser_')));
    assert.equal(((await user.callTool({ name: 'browser_snapshot', arguments: {} })).structuredContent as any).error.code, 'FORBIDDEN');
  } finally { await user.close(); }
});

test('验收派单可在同一端点检查页面并提交通过，关闭浏览器后丢弃临时改动', async t => {
  let workPath = '';
  const daemon = await fixture(t, [ctx => {
    workPath = ctx.options.cwd;
    assert.ok(JSON.parse(ctx.input).content.startsWith('卡片说明快照：\n检查页面'));
    return [
      { type: 'write', path: 'index.html', content: 'temporary review edit' },
      { type: 'tool', name: 'browser_snapshot', arguments: {}, check: value => assert.ok(value) },
      { type: 'tool', name: 'browser_take_screenshot', arguments: {}, check: value => assert.ok(value) },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '用途不匹配' }, check: value => assert.equal((value as any).error.code, 'INVALID_PARAMS') },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '页面验收通过' }, check: ok },
    ];
  }], { purpose: 'verification', needsBrowser: true });
  const result = await daemon.ended();
  assert.equal(result.purpose, 'verification');
  assert.equal(result.needsBrowser, true);
  assert.equal(result.endReason, 'completed', result.failure);
  assert.equal(result.conclusion, 'passed');
  assert.equal(result.endCommit, result.startCommit);
  assert.equal(await readFile(join(workPath, 'index.html'), 'utf8'), '<h1>Helm browser dispatch</h1>');
  assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
  const events = await daemon.events();
  assert.ok(events.findIndex(event => event.action === 'browser-stopped') < events.findIndex(event => event.action === 'dispatch-ended'));
});

for (const reason of ['error', 'quota-exhausted', 'timed-out', 'aborted', 'context-overflow'] as const) {
  test(`浏览器派单以 ${reason} 结束时关闭进程组并使令牌失效`, async t => {
    let token = '';
    const daemon = await fixture(t, [ctx => {
      token = ctx.options.mcpServers.helm!.headers.Authorization!;
      return [{ type: 'end', reason }];
    }], { needsBrowser: true });
    const result = await daemon.ended();
    assert.equal(result.endReason, reason === 'context-overflow' ? 'error' : reason, result.failure);
    assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
    assert.equal((await daemon.call('submit-conclusion', { conclusion: 'completed', reason: '已结束' }, token)).status, 401);
  });
}

test('执行者崩溃仍关闭浏览器，TERM 后强制清理同组顽固子进程', async t => {
  const daemon = await fixture(t, [[{ type: 'crash' }]], { needsBrowser: true, browserArgs: ['--stubborn'] });
  const result = await daemon.ended();
  assert.equal(result.endReason, 'error');
  assert.match(result.failure, /Fake agent crashed/);
  const descendant = Number(await readFile(join(result.outputPath, '..', 'browser', 'descendant.pid'), 'utf8'));
  await until(async () => {
    try { process.kill(descendant, 0); return false; } catch { return true; }
  }, Boolean);
  assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
});

test('调度者撤销派单会关闭浏览器；运行层停止同样关闭浏览器', async t => {
  for (const stopDaemon of [false, true]) {
    let dispatchId = '';
    let revoke!: () => void;
    const ready = new Promise<void>(resolve => { revoke = resolve; });
    const daemon = await fixture(t, [[{ type: 'hang' }]], { needsBrowser: true, after: ctx => [
      { type: 'hang', until: ready },
      { type: 'tool', name: 'revoke-dispatch', arguments: () => ({ workId: JSON.parse(ctx.input).work.id, dispatchId, reason: '不再需要' }), check: ok },
    ] });
    dispatchId = daemon.dispatch.id;
    const dispatch = await until(async () => (await daemon.call('get-dispatch', { workId: daemon.work.id, dispatchId: daemon.dispatch.id })).result,
      value => Boolean(value.sessionId));
    if (stopDaemon) await daemon.close();
    else {
      const result = await daemon.call('send-message', { workId: daemon.work.id, key: 'revoke', body: '撤销这次派单' });
      ok(result);
      revoke();
      assert.equal((await daemon.ended()).endReason, 'aborted');
    }
    assert.throws(() => process.kill(dispatch.browserPgid, 0), { code: 'ESRCH' });
  }
});

test('浏览器启动失败不拉起执行者，记录错误并清理进程', async t => {
  let executorStarted = false;
  const daemon = await fixture(t, [() => { executorStarted = true; return []; }], { needsBrowser: true, browserArgs: ['--crash'] });
  const result = await daemon.ended();
  assert.equal(result.endReason, 'error');
  assert.match(result.failure, /Browser MCP exited/);
  assert.equal(executorStarted, false);
  assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
});

test('浏览器尚未就绪时停止运行层会取消启动并清理进程', async t => {
  const daemon = await fixture(t, [], { needsBrowser: true, browserArgs: ['--hang-start'] });
  const dispatch = await until(async () => (await daemon.call('get-dispatch', { workId: daemon.work.id, dispatchId: daemon.dispatch.id })).result,
    value => Boolean(value.browserPgid));
  await daemon.close();
  assert.throws(() => process.kill(dispatch.browserPgid, 0), { code: 'ESRCH' });
});

test('验收浏览器尚未就绪时看门狗仍能中止启动、清理进程并重置副本', async t => {
  const daemon = await fixture(t, [], { purpose: 'verification', needsBrowser: true, browserArgs: ['--hang-start'],
    watchdog: { wallTimeoutMs: 1000, idleTimeoutMs: 10000 } });
  const result = await daemon.ended();
  assert.equal(result.endReason, 'timed-out', result.failure);
  assert.equal(result.sessionId, null);
  assert.equal(result.conclusion, 'undeclared');
  assert.equal(result.endCommit, result.startCommit);
  assert.throws(() => process.kill(result.browserPgid, 0), { code: 'ESRCH' });
});

test('运行中的浏览器 MCP 意外退出会结束挂住的执行者并记录错误', async t => {
  const daemon = await fixture(t, [[{ type: 'hang' }]], { needsBrowser: true });
  const dispatch = await until(async () => (await daemon.call('get-dispatch', { workId: daemon.work.id, dispatchId: daemon.dispatch.id })).result,
    value => Boolean(value.sessionId));
  process.kill(dispatch.browserPgid, 'SIGTERM');
  const result = await daemon.ended();
  assert.equal(result.endReason, 'error');
  assert.match(result.failure, /Browser MCP exited unexpectedly/);
  assert.throws(() => process.kill(dispatch.browserPgid, 0), { code: 'ESRCH' });
});
