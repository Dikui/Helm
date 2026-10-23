import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { assertInitialization } from './claude-init.js';

test('初始化断言允许用户 MCP 和 Skill，拒绝额外内置工具、伪装的 Helm 工具、fast 和缺失记录', () => {
  const init = { type: 'system', subtype: 'init', tools: ['Read', 'Skill', 'mcp__helm__get-work', 'mcp__user__read'],
    mcp_servers: [{ name: 'helm', status: 'connected' }, { name: 'user', status: 'connected' }], fast_mode_state: 'off', permissionMode: 'default' };
  const check = (value: object, role: 'coordinator' | 'executor' = 'executor') =>
    assertInitialization([value as SDKMessage], role, ['get-work']);
  check(init);
  check(init, 'coordinator');
  assert.throws(() => assertInitialization([], 'executor', ['get-work']), /初始化记录/);
  for (const tool of ['Artifact', 'DesignSync', 'PushNotification', 'SendMessage', 'mcp__helm__desktop-tool']) {
    assert.throws(() => check({ ...init, tools: [...init.tools, tool] }), /不应加载工具/);
  }
  assert.throws(() => check({ ...init, tools: [...init.tools, 'Write'] }, 'coordinator'), /不应加载工具 Write/);
  assert.throws(() => check({ ...init, tools: [] }), /必须报告可用工具/);
  assert.throws(() => check({ ...init, mcp_servers: [{ name: 'user', status: 'connected' }] }), /必须保留注入/);
  assert.throws(() => check({ ...init, fast_mode_state: 'on' }), /fast/);
  assert.throws(() => check({ ...init, permissionMode: 'acceptEdits' }));
});
