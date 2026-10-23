import assert from 'node:assert/strict';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function helmToolNames(endpoint: { url: string; headers?: Record<string, string> }) {
  const client = new Client({ name: 'helm-smoke-inspector', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
    return (await client.listTools()).tools.map(tool => tool.name);
  } finally { await client.close(); }
}

// Expectations are independent of the driver's Options: fail on CLI/tool drift.
export function assertIsolatedInitialization(messages: SDKMessage[], role: 'coordinator' | 'executor', helmTools: string[]) {
  const initializations = messages.filter(message => message.type === 'system' && message.subtype === 'init');
  assert.ok(initializations.length > 0, '必须有真实初始化记录，不能空集合通过');
  const builtins = ['Bash', 'Read', 'Grep', 'Glob',
    ...(role === 'executor' ? ['Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite'] : [])];
  const allowed = new Set([...builtins, ...helmTools.map(name => `mcp__helm__${name}`)]);
  for (const init of initializations) {
    assert.doesNotMatch(JSON.stringify(init), /"messaging_socket_path"\s*:/, '不应携带桌面通信套接字，即使值为空');
    assert.ok(init.tools.length > 0, '初始化必须报告可用工具');
    for (const tool of init.tools) assert.ok(allowed.has(tool), `${role} 不应加载工具 ${tool}`);
    assert.ok(init.tools.some(tool => tool.startsWith('mcp__helm__')), '必须实际加载 Helm 工具');
    assert.deepEqual(init.mcp_servers.map(server => server.name), ['helm'], '只允许注入的 Helm MCP');
  }
}
