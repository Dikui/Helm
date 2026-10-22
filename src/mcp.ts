import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { invoke, operations } from './operations.js';
import type { Actor, TaskStore } from './store.js';

// Stateless transport: the next ticket will supply the actor resolved from a round token.
export async function handleMcp(request: IncomingMessage, response: ServerResponse, input: unknown, store: TaskStore, actor: Actor) {
  const server = new Server({ name: 'helm', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: operations.filter(operation => operation.callers.includes(actor.type)).map(operation => ({
      name: operation.name, description: operation.description,
      inputSchema: z.toJSONSchema(operation.schema) as Tool['inputSchema'],
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
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
