import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';

// 收件箱行点击会打开工作页，详情要用右侧按钮展开
function expandRow(text: HTMLElement) {
  const row = text.closest('.irow') as HTMLElement;
  const toggle = within(row).getByRole('button', { name: '展开详情' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return row;
}
import type { FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const decisionRequests: Promise<Response>[] = [];
const trackDecisions: typeof fetch = (input, init) => {
  const response = fetch(input, init);
  if (String(input).endsWith('/api/decide-gate')) decisionRequests.push(response);
  return response;
};
afterEach(async () => {
  cleanup();
  // The completion event precedes the HTTP response, which also waits for output compression.
  await Promise.allSettled(decisionRequests.splice(0));
  await daemon?.close();
  daemon = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

const draft = (version: number): FakeStep => ({
  type: 'tool', name: 'draft-work-description', arguments: ctx => ({
    workId: JSON.parse(ctx.input).work.id, key: `v${version}`, requirements: `需求原文 ${version}`, boundary: '仅本机', criteria: '原有功能可用',
  }), check: value => expect((value as any).ok).toBe(true),
});
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const workIdOf = (ctx: { input: string }) => JSON.parse(ctx.input).work.id;

async function prepareReview() {
  let releaseExecution!: () => void;
  let releaseVerification!: () => void;
  const executionEnded = new Promise<void>(resolve => { releaseExecution = resolve; });
  const verificationEnded = new Promise<void>(resolve => { releaseVerification = resolve; });
  daemon = await uiFixture([[draft(1)], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('code') as any).result.id, key: 'execute', agentId: 'claude-executor' }), check: ok },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'too-early', body: '还未完成' }), check: value => expect((value as any).error.code).toBe('NON_TERMINAL_CARDS') },
    { type: 'hang', until: executionEnded },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('code') as any).result.id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: (ctx.results.get('code') as any).result.id }, downstream: { type: 'card', id: (ctx.results.get('overall') as any).result.id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('overall') as any).result.id, key: 'verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: verificationEnded },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('overall') as any).result.id }), check: ok },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', body: '汇总报告原文\n成果：result.txt' }), check: ok },
  ]], undefined, { executorScripts: [
    [{ type: 'write', path: 'result.txt', content: '审核成果\n' + '内容'.repeat(25_000) + '\n末尾成果\n' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '全部标准通过，原文保留' }, check: ok }],
  ] });
  const work = await createWork();
  try {
    await confirmVersion(work.id, 1);
    const ended = (count: number) => until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === count);
    await ended(1);
    releaseExecution();
    await ended(2);
    releaseVerification();
    await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'awaiting-review');
  } finally { releaseExecution(); releaseVerification(); }
  return work;
}
async function createWork() {
  return (await daemon!.call('send-message', { projectId: daemon!.project.id, body: '工作说明与审核', key: 'start' })).result.work;
}
async function confirmVersion(workId: string, version: number) {
  const descriptions = await until(() => daemon!.call('get-work-descriptions', { workId }), value => value.result.length === version);
  const description = descriptions.result.at(-1);
  expect((await daemon!.call('decide-gate', { workId, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok).toBe(true);
}

test('工作说明默认显示生效版本，历史和未确认新版只读，语言切换保留原文', async () => {
  daemon = await uiFixture([[draft(1)], [draft(2)], [draft(3)]]);
  const work = await createWork();
  await confirmVersion(work.id, 1);
  await confirmVersion(work.id, 2);
  await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 3);
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} />);
  const brief = await screen.findByRole('region', { name: '工作说明' });
  expect(await within(brief).findByText('需求原文 2')).toBeTruthy();
  expect(within(brief).getByText('生效中')).toBeTruthy();
  expect(within(brief).getByText(`helm/${work.id}`)).toBeTruthy();
  const versions = within(brief).getByLabelText('版本');
  fireEvent.change(versions, { target: { value: '1' } });
  expect(within(brief).getByText('需求原文 1')).toBeTruthy();
  expect(within(brief).getByText('历史版本 · 只读')).toBeTruthy();
  expect(within(brief).queryByRole('textbox')).toBeNull();
  fireEvent.change(versions, { target: { value: '3' } });
  expect(within(brief).getByText('需求原文 3')).toBeTruthy();
  expect(within(brief).getByText('未确认')).toBeTruthy();
  expect(within(brief).queryByRole('button', { name: /确认/ })).toBeNull();
  expect(within(brief).getByRole('link', { name: '在对话中提出修改' }).getAttribute('href')).toBe(`/works/${work.id}`);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(brief).getByRole('heading', { name: 'Requirements' })).toBeTruthy();
  expect(within(brief).getByText('需求原文 3')).toBeTruthy();
  expect((await daemon.call('get-work-descriptions', { workId: work.id })).result.map((item: any) => item.status)).toEqual(['superseded', 'active', 'draft']);
});

test('审核显示真实汇总、计数和整体验收；长 diff 按需分段，退回须附意见并恢复进行中', async () => {
  const work = await prepareReview();
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  expect(await within(review).findByText(/汇总报告原文/)).toBeTruthy();
  expect(within(review).getByText('全部标准通过，原文保留')).toBeTruthy();
  expect(within(review).getByText('通过')).toBeTruthy();
  expect(within(review).getByLabelText('被拒绝的操作').textContent).toBe('1');
  expect(within(review).getByLabelText('未声明结论的派单').textContent).toBe('1');
  expect(within(review).queryByLabelText('Diff 内容')).toBeNull();
  fireEvent.click(within(review).getByRole('button', { name: '查看 diff' }));
  expect(within(review).getByLabelText('Diff 内容').textContent).toContain('+审核成果');
  expect(within(review).getByLabelText('Diff 内容').textContent!.length).toBeLessThanOrEqual(20_000);
  let fullDiff = within(review).getByLabelText('Diff 内容').textContent!;
  for (let segment = 0; segment < 2; segment++) {
    fireEvent.click(within(review).getByRole('button', { name: '下一段' }));
    fullDiff += within(review).getByLabelText('Diff 内容').textContent!;
  }
  expect((within(review).getByRole('button', { name: '下一段' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(review).getByLabelText('Diff 内容').textContent).toContain('+末尾成果');
  const original = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(fullDiff).toBe(original.review.diff);
  const sendBack = within(review).getByRole('button', { name: '退回' }) as HTMLButtonElement;
  expect(sendBack.disabled).toBe(true);
  fireEvent.change(within(review).getByLabelText('意见'), { target: { value: '   ' } });
  expect(sendBack.disabled).toBe(true);
  fireEvent.change(within(review).getByLabelText('意见'), { target: { value: '请补齐边界说明' } });
  fireEvent.click(sendBack);
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('工作说明与审核')).toBeTruthy());
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(gate.decision).toBe('return');
  expect(gate.comment).toBe('请补齐边界说明');
  expect(within(review).queryByRole('button', { name: '接受' })).toBeNull();
  await checkGraphDecision(gate.question, '已退回', 'Sent back');
});

test.each(['工作页', '收件箱'])('%s接受审核与另一处同步，工作移到已结束，成果只推送到临时本地仓库', async source => {
  const work = await prepareReview();
  const remote = join(daemon!.directory, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['-C', daemon!.repo, 'remote', 'add', 'origin', remote], { stdio: 'ignore' });
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} transport={trackDecisions} />);
  const review = await screen.findByRole('region', { name: '审核' });
  const top = (await screen.findByRole('heading', { level: 1, name: '工作说明与审核' })).closest('header')!;
  const row = expandRow(within(screen.getByRole('region', { name: '等你处理' })).getByText('工作说明与审核'));
  const inboxAccept = await within(row).findByRole('button', { name: '接受' });
  expect(within(row).queryByRole('button', { name: '查看 diff' })).toBeNull();
  expect(within(row).getByRole('link', { name: '查看审核详情' }).getAttribute('href')).toBe(`/works/${work.id}/brief`);
  fireEvent.click(source === '工作页' ? within(review).getByRole('button', { name: '接受' }) : inboxAccept);
  await waitFor(() => expect(within(top).getByText('已完成')).toBeTruthy());
  await waitFor(() => expect(within(screen.getByRole('region', { name: '已结束' })).getByText('工作说明与审核')).toBeTruthy());
  expect(within(screen.getByRole('region', { name: '等你处理' })).queryByText('工作说明与审核')).toBeNull();
  await waitFor(() => expect(within(review).getByText('已决定 · 接受')).toBeTruthy());
  expect(within(review).queryByRole('button', { name: '接受' })).toBeNull();
  expect(within(review).queryByRole('button', { name: '退回' })).toBeNull();
  expect(within(review).queryByLabelText('意见')).toBeNull();
  expect(within(review).getByText('已完成')).toBeTruthy();
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(gate.decision).toBe('accept');
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('completed');
  expect(execFileSync('git', ['-C', remote, 'show', 'main:result.txt'], { encoding: 'utf8' })).toContain('末尾成果');
  await checkGraphDecision(gate.question, '已接受', 'Accepted');
});

async function checkGraphDecision(question: string, zh: string, en: string) {
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  fireEvent.click(within(header).getByRole('link', { name: '调度结构' }));
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const node = await within(graph).findByRole('button', { name: `关卡：${question}` });
  expect(node.querySelector('.cg-node-summary')!.textContent).toBe(zh);
  fireEvent.click(node);
  expect(within(screen.getByRole('complementary', { name: '关卡检查器' })).getByText(zh)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(node.querySelector('.cg-node-summary')!.textContent).toBe(en);
  expect(within(screen.getByRole('complementary', { name: 'Gate inspector' })).getByText(en)).toBeTruthy();
}

test('收件箱退回失败保留意见和原始原因，重试后与工作页同步并移出等你处理', async () => {
  const work = await prepareReview();
  let failDecision = true;
  const realFetch = fetch;
  const transport: typeof fetch = async (input, init) => {
    if (failDecision && String(input).endsWith('/api/decide-gate')) throw new Error('意见暂未送达');
    return realFetch(input, init);
  };
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} transport={transport} />);
  const review = await screen.findByRole('region', { name: '审核' });
  const row = expandRow(within(screen.getByRole('region', { name: '等你处理' })).getByText('工作说明与审核'));
  const sendBack = await within(row).findByRole('button', { name: '退回' }) as HTMLButtonElement;
  expect(sendBack.disabled).toBe(true);
  fireEvent.change(within(row).getByLabelText('意见'), { target: { value: '请补边界情况' } });
  fireEvent.click(sendBack);
  expect((await within(row).findByRole('alert')).textContent).toContain('意见暂未送达');
  expect((within(row).getByLabelText('意见') as HTMLTextAreaElement).value).toBe('请补边界情况');
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('awaiting-review');
  failDecision = false;
  fireEvent.click(sendBack);
  await waitFor(() => expect(within(review).getByText('已决定 · 退回')).toBeTruthy());
  expect(within(review).getByText('请补边界情况')).toBeTruthy();
  await waitFor(() => expect(within(screen.getByRole('region', { name: '等你处理' })).queryByText('工作说明与审核')).toBeNull());
  expect(within(screen.getByRole('region', { name: '进行中' })).getByText('工作说明与审核')).toBeTruthy();
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(gate.decision).toBe('return');
  expect(gate.comment).toBe('请补边界情况');
});

test('审核没有 diff 或整体验收时如实显示，默认生效版本通过 SSE 跟随新确认版本', async () => {
  daemon = await uiFixture([[draft(1)], [draft(2)], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', body: '没有代码变更' }), check: ok },
  ]]);
  const work = await createWork();
  await confirmVersion(work.id, 1);
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} />);
  const brief = await screen.findByRole('region', { name: '工作说明' });
  expect(await within(brief).findByText('需求原文 1')).toBeTruthy();
  await confirmVersion(work.id, 2);
  expect(await within(brief).findByText('需求原文 2')).toBeTruthy();
  const review = await screen.findByRole('region', { name: '审核' });
  expect(within(review).getByText('暂无整体验收结论。')).toBeTruthy();
  fireEvent.click(within(review).getByRole('button', { name: '查看 diff' }));
  expect(within(review).getByText('没有代码差异。')).toBeTruthy();
  expect(within(review).queryByLabelText('Diff 内容')).toBeNull();
});


test.each(['打开时已取消', '打开后取消'])('%s时审核和收件箱只读，保留报告并显示终态', async timing => {
  daemon = await uiFixture([[draft(1)], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', body: '终态仍可读取的汇总报告' }), check: ok },
  ]]);
  const work = await createWork();
  await confirmVersion(work.id, 1);
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds.at(-1)?.status === 'ended' && value.result.rounds.length === 2);
  if (timing === '打开时已取消') ok(await daemon.call('cancel-work', { workId: work.id }));
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  const top = (await screen.findByRole('heading', { level: 1, name: '工作说明与审核' })).closest('header')!;
  if (timing === '打开后取消') {
    const gate = await within(review).findByRole('group', { name: '审核' });
    const accept = within(gate).getByRole('button', { name: '接受' }) as HTMLButtonElement;
    await waitFor(() => expect(accept.disabled).toBe(false));
    const row = expandRow(within(screen.getByRole('region', { name: '等你处理' })).getByText('工作说明与审核'));
    await within(row).findByRole('group', { name: '审核' });
    fireEvent.change(within(gate).getByLabelText('意见'), { target: { value: '取消前输入' } });
    ok(await daemon.call('cancel-work', { workId: work.id }));
  }
  await waitFor(() => expect(within(top).getByText('已取消')).toBeTruthy());
  await waitFor(() => expect(within(review).queryByRole('button', { name: '接受' })).toBeNull());
  expect(within(review).queryByRole('button', { name: '退回' })).toBeNull();
  expect(within(review).queryByLabelText('意见')).toBeNull();
  expect(within(review).queryByText('已决定 · 退回')).toBeNull();
  expect(within(review).getByText('已取消')).toBeTruthy();
  expect(within(review).getByText('终态仍可读取的汇总报告')).toBeTruthy();
  const ended = await screen.findByRole('region', { name: '已结束' });
  const row = await within(ended).findByText('工作说明与审核');
  const details = expandRow(row);
  const gate = await within(details).findByRole('group', { name: '审核' });
  expect(within(gate).getByText('终态仍可读取的汇总报告')).toBeTruthy();
  expect(within(gate).getByText('已取消')).toBeTruthy();
  expect(within(gate).queryByRole('button', { name: '接受' })).toBeNull();
  expect(within(gate).queryByRole('button', { name: '退回' })).toBeNull();
  expect(within(gate).queryByLabelText('意见')).toBeNull();
  const saved = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(saved.status).toBe('pending');
  expect(saved.decision).toBeNull();
  for (const decision of ['accept', 'return']) {
    const result = await daemon.call('decide-gate', { workId: work.id, gateId: saved.id, decision, comment: '终态决定应拒绝' });
    expect(result.error.code).toBe('TERMINAL_WORK');
  }
  expect((await daemon.call('get-work', { workId: work.id })).result.status).toBe('cancelled');
});
