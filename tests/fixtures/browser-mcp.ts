// Browser boundary substitute: serves MCP over HTTP and never imports Playwright.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const config = JSON.parse(readFileSync(option('--config')!, 'utf8'));
if (args.includes('--headless') || !args.includes('--isolated') || option('--browser') !== 'chromium'
  || option('--host') !== '127.0.0.1' || config.browser.launchOptions.headless !== false) {
  throw new Error('Expected isolated, headed, bundled Chromium on loopback');
}
if (args.includes('--crash')) process.exit(2);
if (args.includes('--hang-start')) setInterval(() => {}, 1000);
else {
  // A group member ignores TERM, proving cleanup reaches descendants after MCP exits.
  const descendant = spawn(process.execPath, ['-e', `${args.includes('--stubborn') ? 'process.on("SIGTERM", () => {});' : ''} console.log('ready'); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise<void>(resolve => descendant.stdout!.once('data', () => resolve()));
  writeFileSync(join(config.outputDir, 'descendant.pid'), String(descendant.pid));
  let page = '';
  let navigatedUrl = '';
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const mcp = new Server({ name: 'fake-browser', version: '1' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_take_screenshot',
      'browser_evaluate', 'browser_run_code_unsafe', 'browser_future_unsafe',
    ].map(name => ({ name, description: name, inputSchema: { type: 'object' as const, additionalProperties: true } })) }));
    mcp.setRequestHandler(CallToolRequestSchema, async request => {
      if (request.params.arguments?.fail) return { isError: true, content: [{ type: 'text', text: 'Element unavailable' }] };
      if (request.params.name === 'browser_navigate') {
        navigatedUrl = String(request.params.arguments?.url);
        page = await (await fetch(navigatedUrl)).text();
      }
      if (request.params.name === 'browser_take_screenshot') {
        const text = page.replace(/<[^>]*>/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80"><text x="10" y="40">${text}</text></svg>`;
        return { content: [{ type: 'image', mimeType: 'image/svg+xml', data: Buffer.from(svg).toString('base64') }], structuredContent: { url: navigatedUrl, page } };
      }
      return { content: [{ type: 'text', text: page }], structuredContent: { url: navigatedUrl, page } };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once('close', () => { void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(request, response, input);
  });
  server.listen(Number(option('--port')), option('--host'), () => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP port');
    // Mirrors the real Playwright MCP, which reports localhost for a 127.0.0.1 bind.
    console.error(`Listening on http://localhost:${address.port}`);
  });
}
