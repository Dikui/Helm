import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPromptDir, readPrompt, roleRules } from '../src/prompts.js';

test('默认调度者规则缩减固定输入并保留跨轮与派单约定', () => {
  const rules = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.ok(Buffer.byteLength(rules.role) <= 6_000, '角色规则预算 6000 字节（精简前 8535）');
  assert.ok(Buffer.byteLength(executing) <= 9_700, '执行阶段规则预算 9700 字节（精简前 13265）');
  for (const convention of ['helm MCP', 'resumed', 'phaseRules', 'write-coordinator-notes', 'send-message'])
    assert.ok(rules.role.includes(convention), `角色规则保留 ${convention}`);
  for (const convention of ['submit-conclusion', 'complete-card', 'request-review', 'outdated', 'autoFlow'])
    assert.ok(executing.includes(convention), `执行阶段规则保留 ${convention}`);
});

test('默认执行阶段规则明确自动派票、无效验收和停止返工的边界', () => {
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.match(executing, /执行完成后由运行层自动派出预写的验收票，全部通过后自动完成卡片/);
  assert.match(executing, /已预写的票不再手动派单/);
  assert.match(executing, /\| 执行 completed \| [^\n]*autoFlow[^\n]*未预写[^\n]*派票/);
  assert.match(executing, /自动操作在 newEvents 中，actor=runtime/);
  assert.match(executing, /\| 验收 failed 缺少可复现证据[^|\n]*命令与失败输出[^|\n]*\| 无效票：新开对话重派一次验收[^|\n]*不计打回/);
  assert.match(executing, /无进展或同问题反复时不再返工，提关卡④/);
});
