import { expect, test } from 'vitest';
import { isHousekeeping } from '../src/shared/step-summary.js';

test('CLI 的 hook、系统、限额和会话状态事件算流水，工具调用和普通输出不算', () => {
  for (const raw of [{ type: 'system', subtype: 'init' }, { type: 'system', subtype: 'hook_started' }, { type: 'hook_response' },
    { type: 'rate_limit_event' }, { type: 'stream_event' }, { method: 'thread/tokenUsage/updated' }, { method: 'turn/started' }])
    expect(isHousekeeping(JSON.stringify(raw))).toBe(true);
  for (const raw of [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({ method: 'turn/completed' }), '普通文字输出'])
    expect(isHousekeeping(raw)).toBe(false);
});

const { readFileSync, readdirSync } = await import('node:fs');
const { operationLabels, systemValueLabel } = await import('../src/shared/system-labels.js');
const { stepSummary } = await import('../src/shared/step-summary.js');
const { messages } = await import('../src/shared/i18n.js');
const { default: ts } = await import('typescript');
const { eventSummary, eventActionLabels } = await import('../src/pages/work/card-graph/event-summary.js');

test('所有已登记操作都有中英步骤名称，协议枚举翻译而正文不改写', () => {
  const names = [...readFileSync('src/operations.ts', 'utf8').matchAll(/name: '([^']+)'/g)].map(match => match[1]!);
  for (const name of names) for (const language of ['zh', 'en'] as const) {
    const key = operationLabels[name];
    expect(key, name).toBeTruthy();
    expect(messages[language][key!]).toBeTruthy();
    if (language === 'zh') expect(messages.zh[key!]).toMatch(/[\u3400-\u9fff]/);
  }
  const zh = (key: keyof typeof messages.zh) => messages.zh[key];
  const en = (key: keyof typeof messages.en) => messages.en[key];
  expect(systemValueLabel('completed', zh)).toBe('正常完成');
  expect(systemValueLabel('submit-conclusion', zh)).toBe('提交结论');
  expect(systemValueLabel('mcp__helm__submit-conclusion', zh)).toBe('提交结论');
  expect(systemValueLabel('submit-conclusion', en)).toBe('Submit conclusion');
  expect(systemValueLabel('create-card · submit-conclusion', zh)).toBe('创建卡片 · 提交结论');
  expect(stepSummary(JSON.stringify({ tool: 'submit-conclusion' }), zh)).toBe('提交结论');
  expect(stepSummary(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'completed · 用户原文' }, { type: 'tool_use', name: 'create-card', input: {} }] } }), zh)).toBe('completed · 用户原文 · 创建卡片');
  expect(stepSummary(JSON.stringify({ method: 'item/started', params: { item: { type: 'mcpToolCall', tool: 'submit-conclusion' } } }), zh)).toBe('提交结论');
  expect(stepSummary(JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', title: 'submit-conclusion' } } }), zh)).toBe('提交结论');
  const event = { id: 1, action: 'round-ended', time: '', workId: 'work', cardId: null, dispatchId: null, object: { type: 'coordinator-round', id: 'round' }, details: { reason: 'completed' } };
  expect(eventSummary(event, zh)).toBe('调度轮次结束 · 正常完成');
  expect(eventSummary({ ...event, action: 'dispatch-step', details: { step: 1, summary: 'submit-conclusion' } }, zh)).toBe('派单执行步骤 · 步骤 1 · 提交结论');
});


test('运行层登记的事件动作均有中文摘要名，未知事件保留可读后备', () => {
  const actions = new Set<string>();
  function labels(node: import('typescript').Node | undefined) {
    if (!node) return;
    if (ts.isStringLiteral(node)) actions.add(node.text);
    else if (ts.isConditionalExpression(node)) { labels(node.whenTrue); labels(node.whenFalse); }
  }
  for (const file of readdirSync('src').filter(name => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(file, readFileSync(`src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node: import('typescript').Node) {
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'appendEvent') labels(node.arguments[2]);
        else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'wake') labels(node.arguments[3]);
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'record') labels(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(actions.size).toBeGreaterThan(60);
  const zh = (key: keyof typeof messages.zh) => messages.zh[key];
  for (const action of actions) {
    expect(eventActionLabels[action], action).toBeTruthy();
    expect(zh(eventActionLabels[action]!)).toMatch(/[\u3400-\u9fff]/);
  }
  expect(systemValueLabel('Bash · npm run check', zh)).toBe('运行命令 · npm run check');
  expect(eventSummary({ id: 1, action: 'auto-flow-stopped', time: '', workId: 'w', cardId: null, dispatchId: null, object: { type: 'card', id: 'c' }, details: { step: 'verification', reason: '等待处理' } }, zh)).toBe('自动派单已停止 · 验收 · 等待处理');
});

test('历史只读违规事件使用通用摘要，保留可读后备', () => {
  const event = { id: 1, action: 'dispatch-read-only-violated', time: '', workId: 'work', cardId: null,
    dispatchId: 'dispatch', object: { type: 'dispatch', id: 'dispatch' }, details: { status: 'violated', paths: ['report.md'] } };
  expect(eventSummary(event, key => messages.zh[key])).toBe('记录工作事件');
  expect(eventSummary(event, key => messages.en[key])).toBe('Work event recorded');
});
