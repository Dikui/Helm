// Run explicitly outside the agent sandbox: npm run test:browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, until } from './browser-fixture.js';

test('Chromium 经派单 MCP 打开副本里的页面并截图', { skip: process.env.HELM_BROWSER_REAL !== '1' }, async t => {
  const screenshotPath = join(tmpdir(), `helm-browser-${Date.now()}.png`);
  const daemon = await fixture(t, [ctx => {
    let failure: unknown;
    const checked = (async () => {
      const site = createServer(async (_request, response) => { response.end(await readFile(join(ctx.options.cwd, 'index.html'))); });
      await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
      const address = site.address();
      assert.ok(address && typeof address !== 'string');
      const endpoint = ctx.options.mcpServers.helm!;
      const client = new Client({ name: 'helm-browser-smoke', version: '1' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
        const nav = await client.callTool({ name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } });
        assert.ok(!nav.isError, JSON.stringify(nav));
        const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
        assert.match(JSON.stringify(snapshot.content), /Helm browser dispatch/);
        const result = await client.callTool({ name: 'browser_take_screenshot', arguments: { type: 'png' } });
        assert.ok(!result.isError, JSON.stringify(result));
        const image = (result.content as { type: string; data: string; mimeType: string }[]).find(block => block.type === 'image');
        assert.equal(image?.mimeType, 'image/png');
        await writeFile(screenshotPath, Buffer.from(image!.data, 'base64'));
      } finally { await client.close(); await new Promise<void>(resolve => site.close(() => resolve())); }
    })().catch(error => { failure = error; });
    return [{ type: 'hang', until: checked }, { type: 'tool', name: 'submit-conclusion',
      arguments: () => { if (failure) throw failure; return { conclusion: 'completed', reason: '页面快照匹配且截图已保存' }; } }];
  }], { needsBrowser: true, realBrowser: true });
  const result = await daemon.ended();
  assert.equal(result.endReason, 'completed', result.failure);
  console.log(`请打开截图核对页面标题「Helm browser dispatch」：${screenshotPath}`);
});

// issue 30: large regression, run only outside the sandbox with bundled Chromium.
test('执行者自行启动的隔离无头 Chromium 在派单结束后被清理', { skip: process.env.HELM_BROWSER_REAL !== '1' }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'helm-executor-chromium-'));
  let pid = 0;
  t.after(async () => {
    if (pid) {
      try { process.kill(-pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    await rm(profile, { recursive: true, force: true });
  });
  const daemon = await fixture(t, [ctx => {
    const browser = spawn(chromium.executablePath(), ['--headless', '--no-sandbox', `--user-data-dir=${profile}`,
      '--remote-debugging-port=0', 'about:blank'], { cwd: ctx.options.cwd, detached: true, stdio: 'ignore' });
    pid = browser.pid ?? 0;
    let failure: unknown;
    browser.once('error', error => { failure = error; });
    const ready = until(async () => {
      if (failure) throw failure;
      if (browser.exitCode !== null) throw new Error(`Chromium exited before startup: ${browser.exitCode}`);
      try { return await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return ''; }
    }, Boolean).then(() => {}, error => { failure = error; });
    return [{ type: 'hang', until: ready }, { type: 'tool', name: 'submit-conclusion', arguments: () => {
      if (failure) throw failure;
      assert.ok(pid > 1);
      process.kill(pid, 0);
      return { conclusion: 'completed', reason: '自行启动的浏览器可用' };
    } }];
  }]);
  const result = await daemon.ended();
  assert.equal(result.endReason, 'completed', result.failure);
  assert.ok(pid > 1);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
  assert.ok((await daemon.events()).some(event => event.action === 'dispatch-processes-cleaned'));
});
