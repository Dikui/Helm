import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// The real Claude smoke must pass both the registered argument and environment.
const secret = process.env.HELM_LIBRARY_MCP_SECRET;
if (process.argv[2] !== 'library-smoke' || !secret) throw new Error('库 stdio MCP 缺少启动参数或环境变量。');
const server = new Server({ name: 'library-stdio-probe', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'read_secret', description: '返回本次库 stdio MCP 冒烟暗号', inputSchema: { type: 'object', properties: {} } },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'read_secret') throw new Error('未知工具。');
  return { content: [{ type: 'text', text: secret }] };
});
await server.connect(new StdioServerTransport());
