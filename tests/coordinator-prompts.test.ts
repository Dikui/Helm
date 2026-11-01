import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPromptDir, readPrompt, roleRules } from '../src/prompts.js';

test('默认调度者规则缩减固定输入并保留跨轮与派单约定', () => {
  const rules = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.ok(Buffer.byteLength(rules.role) <= 6_000, '角色规则预算 6000 字节（精简前 8535）');
  assert.ok(Buffer.byteLength(executing) <= 9_000, '执行阶段规则预算 9000 字节（精简前 13265）');
  for (const convention of ['helm MCP', 'resumed', 'phaseRules', 'write-coordinator-notes', 'send-message'])
    assert.ok(rules.role.includes(convention), `角色规则保留 ${convention}`);
  for (const convention of ['submit-conclusion', 'complete-card', 'request-review', 'outdated', 'autoFlow'])
    assert.ok(executing.includes(convention), `执行阶段规则保留 ${convention}`);
});
