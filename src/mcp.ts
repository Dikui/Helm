import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { invoke, operations, rejectOperation } from './operations.js';
import { RuleError, type Actor, type TaskStore } from './store.js';
import type { BrowserProcess } from './browser.js';

// Stateless transport; the HTTP layer resolves and validates round and dispatch tokens.
export async function handleMcp(request: IncomingMessage, response: ServerResponse, input: unknown, store: TaskStore, actor: Actor,
  browserFor: () => BrowserProcess | undefined = () => undefined) {
  const server = new Server({ name: 'helm', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: operations.filter(operation => operation.callers.includes(actor.type)).map<Tool>(operation => ({
      name: operation.name, description: operation.description,
      inputSchema: z.toJSONSchema(operation.schema) as Tool['inputSchema'],
    })).concat(browserFor()?.listTools() ?? []),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name.startsWith('browser_')) {
      try {
        const browser = browserFor();
        if (!browser?.listTools().some(tool => tool.name === request.params.name)) {
          throw new RuleError('FORBIDDEN', '这次派单不能使用该浏览器工具。', 403);
        }
        return await browser.callTool(request.params.name, request.params.arguments ?? {});
      } catch (error) {
        const failure = error instanceof RuleError ? error : new RuleError('BROWSER_UNAVAILABLE', '浏览器工具调用失败，请检查这次派单的浏览器进程。');
        const result = rejectOperation(store, actor, request.params.name, failure);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(result.body) }], structuredContent: result.body };
      }
    }
    const result = invoke(store, actor, request.params.name, request.params.arguments ?? {});
    return {
      isError: !result.body.ok,
      content: [{ type: 'text' as const, text: JSON.stringify(result.body) }],
      structuredContent: result.body,
    };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.once('close', () => { server.close().catch(console.error); });
  await server.connect(transport);
  await transport.handleRequest(request, response, input);
}
