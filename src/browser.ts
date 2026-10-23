import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { processStartTime, processTargetExists, signalProcess } from './processes.js';

export interface BrowserCommand { file: string; args: string[] }
const require = createRequire(import.meta.url);
export const playwrightCommand: BrowserCommand = {
  file: process.execPath, args: [join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js')],
};

// An allowlist also excludes newly added upstream tools until explicitly reviewed.
const inspectionTools = new Set([
  'browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_type',
  'browser_take_screenshot', 'browser_press_key', 'browser_hover', 'browser_drag', 'browser_select_option',
  'browser_fill_form', 'browser_wait_for', 'browser_tabs', 'browser_resize', 'browser_handle_dialog',
  'browser_console_messages', 'browser_network_requests', 'browser_close',
]);

export class BrowserProcess {
  private child: ChildProcess;
  private controller = new AbortController();
  private client = new Client({ name: 'helm-browser-forwarder', version: '0.1.0' });
  private endpoint: Promise<string>;
  private closing?: Promise<void>;
  private tools: Tool[] = [];
  readonly pgid: number;
  readonly startedAt: string;

  constructor(command: BrowserCommand, readonly outputDir: string, onExit: () => void) {
    mkdirSync(outputDir, { recursive: true });
    const configPath = join(outputDir, 'config.json');
    writeFileSync(configPath, JSON.stringify({
      browser: { browserName: 'chromium', launchOptions: { channel: 'chrome-for-testing', headless: false } },
      outputDir,
    }));
    // Environment overrides must not select system Chrome, a remote browser, or headless mode.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PLAYWRIGHT_MCP_')));
    env.NO_PROXY = [env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
    env.no_proxy = env.NO_PROXY;
    this.child = spawn(command.file, [...command.args, '--port', '0', '--host', '127.0.0.1',
      // With no client roots, Playwright resolves explicit filenames against cwd.
      // Use the same root for both named and automatically generated output files.
      '--isolated', '--browser', 'chromium', '--config', configPath], { cwd: outputDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.endpoint = new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Browser MCP startup timed out: ${output}`)), 15_000);
      const abort = () => reject(new Error('Browser MCP cancelled'));
      this.controller.signal.addEventListener('abort', abort, { once: true });
      const finish = () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', abort); };
      const data = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-8192);
        // Playwright MCP prints localhost for a 127.0.0.1 bind and by default only accepts that exact host:port.
        const match = /Listening on (http:\/\/(?:127\.0\.0\.1|localhost):\d+)/.exec(output);
        if (match) { finish(); resolve(`${match[1]}/mcp`); }
      };
      this.child.stdout!.on('data', data);
      this.child.stderr!.on('data', data);
      this.child.once('error', error => { finish(); reject(error); });
      this.child.once('exit', (code, signal) => {
        finish();
        reject(new Error(`Browser MCP exited (${code ?? signal}): ${output}`));
        if (!this.controller.signal.aborted) onExit();
      });
    });
    // Rejections can arrive while the owner is still recording the process identity.
    void this.endpoint.catch(() => {});
    this.pgid = this.child.pid ?? 0;
    this.startedAt = this.pgid ? processStartTime(this.pgid) ?? new Date().toISOString() : '';
  }

  async connect() {
    const url = await this.endpoint;
    this.controller.signal.throwIfAborted();
    await this.client.connect(new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { signal: this.controller.signal },
    }));
    this.tools = (await this.client.listTools()).tools.filter(tool => inspectionTools.has(tool.name));
    this.controller.signal.throwIfAborted();
  }

  listTools() { return this.tools; }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.controller.signal.throwIfAborted();
    const result = await this.client.callTool({ name, arguments: args }, undefined, { signal: this.controller.signal }) as CallToolResult;
    // Playwright links saved files relative to its cwd (outputDir), which the executor never sees.
    for (const block of result.content ?? []) if (block.type === 'text') block.text = block.text.replaceAll('](./', `](${this.outputDir}/`);
    return result;
  }

  close() {
    this.closing ??= this.stop();
    return this.closing;
  }

  private async stop() {
    this.controller.abort();
    const closeClient = this.client.close();
    try {
      if (this.pgid && await processTargetExists(-this.pgid)) {
        await signalProcess(-this.pgid, 'SIGTERM');
        const deadline = Date.now() + 5_000;
        while (await processTargetExists(-this.pgid) && Date.now() < deadline) await delay(25);
        if (await processTargetExists(-this.pgid)) {
          await signalProcess(-this.pgid, 'SIGKILL');
          const killedDeadline = Date.now() + 2_000;
          while (await processTargetExists(-this.pgid)) {
            if (Date.now() >= killedDeadline) throw new Error(`Browser process group ${this.pgid} survived SIGKILL`);
            await delay(25);
          }
        }
      }
      if (this.child.pid && this.child.exitCode === null && this.child.signalCode === null) {
        await new Promise<void>(resolve => this.child.once('exit', () => resolve()));
      }
    } finally { await closeClient; }
  }
}
