// Browser boundary substitute: serves MCP over HTTP and never imports Playwright.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { testProcessWatchdog, watchTestProcess } from './test-process.js';

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const testPid = Number(option('--test-process-pid'));
const watchdog = watchTestProcess(testPid).unref();
const config = JSON.parse(readFileSync(option('--config')!, 'utf8'));
// Locked Playwright MCP resolves explicit filenames against its workspace (cwd
// when the client advertises no roots), and generated names against outputDir.
function outputFile(filename: unknown, generated: string) {
  const path = filename ? resolve(process.cwd(), String(filename)) : resolve(config.outputDir, generated);
  let ancestor = path;
  for (;;) {
    try { ancestor = realpathSync(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
  const inside = (root: string, target: string) => {
    const suffix = relative(realpathSync(root), target);
    return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  };
  if (![process.cwd(), config.outputDir].some(root => inside(root, path) && inside(root, ancestor))) {
    throw new Error(`File access denied: ${path} is outside allowed roots`);
  }
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
if (args.includes('--headless') || !args.includes('--isolated') || option('--browser') !== 'chromium'
  || option('--host') !== '127.0.0.1' || config.browser.launchOptions.headless !== false) {
  throw new Error('Expected isolated, headed, bundled Chromium on loopback');
}
if (args.includes('--crash')) process.exit(2);
if (args.includes('--hang-start')) watchdog.ref();
else {
  // A group member ignores TERM, proving cleanup reaches descendants after MCP exits.
  const descendant = spawn(process.execPath, ['-e', `${testProcessWatchdog(testPid)} ${args.includes('--stubborn') ? 'process.on("SIGTERM", () => {});' : ''} console.log('ready');`], { stdio: ['ignore', 'pipe', 'ignore'] });
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
        const png = request.params.arguments?.type === 'png';
        const bytes = png ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64') : Buffer.from(svg);
        writeFileSync(outputFile(request.params.arguments?.filename, png ? 'page.png' : 'page.svg'), bytes);
        return { content: [{ type: 'image', mimeType: png ? 'image/png' : 'image/svg+xml', data: bytes.toString('base64') }], structuredContent: { url: navigatedUrl, page } };
      }
      if (request.params.name === 'browser_snapshot' && request.params.arguments?.filename) {
        writeFileSync(outputFile(request.params.arguments.filename, 'page.yml'), page);
      } else if (request.params.name === 'browser_snapshot') {
        // Like Playwright MCP, link the saved snapshot relative to the server's cwd.
        writeFileSync(outputFile(undefined, 'page.yml'), page);
        return { content: [{ type: 'text', text: `${page}\n- [Snapshot](./page.yml)` }], structuredContent: { url: navigatedUrl, page } };
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
