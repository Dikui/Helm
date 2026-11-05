import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPromptDir, readPrompt, roleRules } from '../src/prompts.js';

test('默认调度者规则缩减固定输入并保留跨轮与派单约定', () => {
  const rules = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.ok(Buffer.byteLength(rules.role) <= 6_650, '角色规则预算 6650 字节（含四部分工作说明）');
  assert.ok(Buffer.byteLength(executing) <= 11_550, '执行阶段规则预算 11550 字节（含先诊断、按证据停卡、交付核对）');
  for (const convention of ['helm MCP', 'resumed', 'phaseRules', 'write-coordinator-notes', 'send-message', 'projectPath', 'projectInstructionPaths', '新会话先读'])
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
  assert.match(executing, /\| 普通卡验收 failed \| 原因不明先诊断；按根因[^\n]*无可行下一步时停卡交付 \|/);
});

test('调度者对用户目标负责，按四部分对齐，失败先诊断、按证据停卡，执行者给直接证据', () => {
  const { role } = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  const executor = readPrompt(defaultPromptDir, 'executor-role');
  assert.match(role, /对用户目标的整体达成负责/);
  assert.match(role, /需求、边界、验收、交付/);
  assert.match(role, /默认每部分 1–3 条短句/);
  assert.match(role, /具体命令和执行步骤放进卡片/);
  assert.match(role, /授权内补齐实现、纠正检查命令或细化判据[^\n]*不重新起草工作说明/);
  assert.match(role, /④ 无可用 Agent 可派。\n返工失败、验收无效、受阻或证据不足按执行阶段规则自主处理/);
  assert.doesNotMatch(role + executing, /⑤/);
  assert.match(executing, /失败先找原因：[^\n]*派诊断用的调研卡[^\n]*不把可自行补齐的证据缺口交回用户/);
  assert.match(executing, /停卡交付：[^\n]*needsVerification=false 后 complete-card[^\n]*verdict=reservations/);
  assert.match(executing, /不按固定次数停卡/);
  assert.match(executing, /先保留用户目标、交付形式和使用入口/);
  assert.match(executor, /验收判不通过必须指出卡片说明中哪条标准没满足/);
  assert.match(executor, /不能仅以“没查完”提交受阻或不通过/);
});


test('规则按是否需要项目代码选择运行位置，临时目录交付文件以相对路径引用', () => {
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.match(executing, /workspace=copy/);
  assert.match(executing, /workspace=scratch/);
  assert.match(executing, /读或改.*项目代码/);
  assert.doesNotMatch(executing, /readOnly|只读卡片/);
  const runtime = readPrompt(defaultPromptDir, 'executor-runtime');
  assert.match(runtime, /workspace.*scratch/);
  assert.match(runtime, /当前目录下的文件/);
  assert.match(runtime, /相对路径/);
  assert.doesNotMatch(runtime, /readOnly/);
});

test('调度者运行约定在调度者目录工作，改代码交给卡片', () => {
  assert.match(roleRules('coordinator').runtime, /在调度者目录工作/);
  assert.match(roleRules('coordinator').runtime, /项目代码改动交给卡片执行/);
});
