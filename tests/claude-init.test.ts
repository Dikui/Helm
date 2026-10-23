import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { assertIsolatedInitialization } from './claude-init.js';

test('初始化断言拒绝额外工具、伪装的 Helm 工具和缺失记录', () => {
  const init = { type: 'system', subtype: 'init', tools: ['Read', 'mcp__helm__get-work'], mcp_servers: [{ name: 'helm', status: 'connected' }] };
  const check = (value: object, role: 'coordinator' | 'executor' = 'executor') =>
    assertIsolatedInitialization([value as SDKMessage], role, ['get-work']);
  check(init);
  check(init, 'coordinator');
  assert.throws(() => assertIsolatedInitialization([], 'executor', ['get-work']), /初始化记录/);
  for (const tool of ['Artifact', 'DesignSync', 'PushNotification', 'SendMessage', 'mcp__other__read', 'mcp__helm__desktop-tool']) {
    assert.throws(() => check({ ...init, tools: [...init.tools, tool] }), /不应加载工具/);
  }
  assert.throws(() => check({ ...init, tools: [...init.tools, 'Write'] }, 'coordinator'), /不应加载工具 Write/);
  assert.throws(() => check({ ...init, tools: [] }), /必须报告可用工具/);
  assert.throws(() => check({ ...init, mcp_servers: [...init.mcp_servers, { name: 'desktop', status: 'connected' }] }), /只允许注入/);
});
