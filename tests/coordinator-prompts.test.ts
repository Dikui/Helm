import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPromptDir, readPrompt, roleRules } from '../src/prompts.js';

test('默认调度者规则缩减固定输入并保留跨轮与派单约定', () => {
  const rules = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.ok(Buffer.byteLength(rules.role) <= 6_150, '角色规则预算 6150 字节（含项目路径与新会话读取规则）');
  assert.ok(Buffer.byteLength(executing) <= 10_800, '执行阶段规则预算 10800 字节（含补证规则；精简前 13265）');
  for (const convention of ['helm MCP', 'resumed', 'phaseRules', 'write-coordinator-notes', 'send-message', 'projectPath', 'projectInstructionPaths', '新会话先读'])
    assert.ok(rules.role.includes(convention), `角色规则保留 ${convention}`);
  for (const convention of ['submit-conclusion', 'complete-card', 'request-review', 'outdated', 'autoFlow'])
    assert.ok(executing.includes(convention), `执行阶段规则保留 ${convention}`);
});

// small / spec — #16：缺少诊断能力时，执行派单应主动补证，验收仍只检查。
test('默认执行者规则要求执行派单补全诊断手段后重新取证', () => {
  const { role, runtime } = roleRules('executor');
  assert.match(role, /执行派单[^\n]*证据不足[^\n]*待验证[^\n]*最小诊断手段/);
  assert.match(role, /日志、诊断脚本或可视化/);
  assert.match(role, /重跑[^\n]*新证据/);
  assert.match(role, /工具不全[^\n]*blocked/);
  assert.match(role, /边界[^\n]*权限[^\n]*凭据/);
  assert.match(runtime, /验收[^\n]*改产品代码让检查通过等于没有验收/);
});

// small / spec — #16：调度者把可补的观测缺口交给执行派单，真正受阻仍走关卡。
test('默认调度者规则在可补证据缺口时先派执行补证', () => {
  const { role } = roleRules('coordinator');
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.match(executing, /证据不足[^\n]*边界内[^\n]*先派执行补全并重跑[^\n]*重新分析[^\n]*验收[^\n]*不直接提关卡/);
  assert.match(executing, /调度笔记[^\n]*已试方法、新证据、下一步/);
  assert.match(executing, /验收缺诊断能力[^\n]*另派执行补全[^\n]*不能让验收改产品代码/);
  assert.match(executing, /整体验收[^\n]*另建卡[^\n]*依赖/);
  assert.match(executing, /反复补证无新证据提关卡④/);
  assert.match(executing, /缺权限.*凭据[^\n]*超边界或改标准[^\n]*取舍[^\n]*关卡/);
  assert.match(role, /④[^\n]*不可自行消除的阻碍/);
  assert.match(role, /④[^\n]*无进展[^\n]*无效验收/);
});

test('默认执行阶段规则明确自动派票、无效验收和停止返工的边界', () => {
  const executing = readPrompt(defaultPromptDir, 'coordinator-executing');
  assert.match(executing, /执行完成后由运行层自动派出预写的验收票，全部通过后自动完成卡片/);
  assert.match(executing, /已预写的票不再手动派单/);
  assert.match(executing, /\| 执行 completed \| [^\n]*autoFlow[^\n]*未预写[^\n]*派票/);
  assert.match(executing, /自动操作在 newEvents 中，actor=runtime/);
  assert.match(executing, /\| 验收 failed 缺少可复现证据[^|\n]*命令与失败输出[^|\n]*\| 无效票：缺诊断能力先补证；其余新开对话重派一次验收[^|\n]*不计打回/);
  assert.match(executing, /无进展或同问题反复时不再返工，提关卡④/);
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
