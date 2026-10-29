import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver } from '../src/claude-driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { fixture, until } from './claude-coordinator-fixture.js';

test('Claude 调度者接入运行层：带令牌 MCP 改卡片图，打断后新会话重投且 key 去重', async t => {
  const briefs: StartupBrief[] = [];
  const sessions: string[] = [];
  const tokens: string[] = [];
  let closed = 0;
  const driver = new ClaudeCoordinatorDriver({ pathToClaudeCodeExecutable: '/fake/claude', query: args => ({
    close() { closed++; },
    async *[Symbol.asyncIterator]() {
      const sdk = args.options!;
      const brief = JSON.parse(args.prompt as string) as StartupBrief;
      const attempt = briefs.push(brief);
      sessions.push(sdk.sessionId!);
      assert.equal(sdk.cwd, brief.work.workPath);
      assert.ok(sdk.cwd!.endsWith('/_work'));
      const endpoint = sdk.mcpServers!.helm!;
      assert.ok('url' in endpoint && endpoint.type === 'http');
      tokens.push(endpoint.headers!.Authorization!);
      const client = new Client({ name: 'coordinator-sdk-substitute', version: '1' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
        const tool = async (name: string, params: object) => {
          const response = await client.callTool({ name, arguments: { workId: brief.work.id, ...params } });
          const body = response.structuredContent as any;
          assert.equal(body.ok, true, JSON.stringify(body));
          return body.result;
        };
        const upstream = await tool('create-card', { key: 'upstream', content: '上游卡片' });
        const downstream = await tool('create-card', { key: 'downstream', content: '下游卡片' });
        const dependency = { upstream: { type: 'card', id: upstream.id }, downstream: { type: 'card', id: downstream.id } };
        await tool('add-dependency', dependency);
        if (attempt === 1) {
          await tool('remove-dependency', dependency);
          await tool('add-dependency', dependency);
        }
        await tool('create-dispatch', { key: 'dispatch', cardId: upstream.id, agentId: 'claude-executor', needsBrowser: false });
        if (attempt === 1) {
          yield { type: 'system', subtype: 'compact_boundary' } as SDKMessage;
          await new Promise<void>(resolve => {
            const signal = sdk.abortController!.signal;
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
        } else yield {
          type: 'result', subtype: 'success', is_error: false, result: '重投完成',
          modelUsage: { main: { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 5, cacheCreationInputTokens: 7 } },
        } as unknown as SDKMessage;
      } finally { await client.close(); }
    },
  }) });
  const daemon = await fixture(t, driver, 2);
  await until(daemon.events, values => values.some(event => event.action === 'context-compacted'));
  await daemon.call('send-message', { ...daemon.params, key: 'interrupt-message', body: '同一批事件重投' });
  await daemon.call('interrupt-round', daemon.params);
  const events = await until(daemon.events, values => values.some(event => event.action === 'round-ended' && event.details.finalAnswer === '重投完成'));
  const starts = events.filter(event => event.action === 'round-started').slice(1, 3);
  const ends = starts.map(start => events.find(event => event.action === 'round-ended' && event.object.id === start.object.id)!);
  assert.equal(ends[0]!.details.reason, 'aborted');
  assert.equal(ends[0]!.details.processed, false);
  assert.equal(ends[1]!.details.reason, 'completed');
  assert.deepEqual(ends[1]!.details.usage, { inputTokens: 14, outputTokens: 3, cacheReadTokens: 5 });
  assert.notEqual(sessions[0], sessions[1]);
  assert.notEqual(tokens[0], tokens[1]);
  for (const event of briefs[0]!.wakeEvents) assert.ok(briefs[1]!.wakeEvents.some(replayed => replayed.id === event.id));
  assert.ok(briefs[1]!.wakeEvents.some(event => (event.details as any).body === '同一批事件重投'));
  const cards = (await daemon.call('get-card-graph', daemon.params)).filter((node: any) => node.type === 'card');
  assert.equal(cards.length, 2);
  const upstream = cards.find((card: any) => card.key === 'upstream');
  const downstream = cards.find((card: any) => card.key === 'downstream');
  assert.equal(downstream.status, 'waiting');
  assert.deepEqual(downstream.dependencies, [{ type: 'card', id: upstream.id }]);
  assert.equal((await daemon.call('list-dispatches', daemon.params)).length, 1);
  assert.equal(events.filter(event => event.action === 'card-created').length, 2);
  assert.equal(events.filter(event => event.action === 'dispatch-created').length, 1);
  assert.ok(closed >= 2);
  for (const token of tokens) {
    const response = await fetch(`${daemon.url}/api/get-work`, { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: token }, body: JSON.stringify(daemon.params) });
    assert.equal(response.status, 401);
  }
  assert.equal(daemon.git('status', '--porcelain'), '');
});
