// Run explicitly outside the agent sandbox: npm run test:browser.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture } from './browser-fixture.js';

test('有界面 Chromium 经派单 MCP 打开副本里的页面并截图', { skip: process.env.HELM_BROWSER_REAL !== '1' }, async t => {
  if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '请在有显示服务的沙箱外运行，禁止无头模式');
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
