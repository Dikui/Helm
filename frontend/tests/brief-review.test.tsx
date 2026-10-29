import { reviewReport } from '../../tests/fixtures/review-report.js';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';

// 收件箱行点击会打开工作页，详情要用右侧按钮展开
function expandRow(text: HTMLElement) {
  const row = text.closest('.irow') as HTMLElement;
  const toggle = within(row).getByRole('button', { name: '展开详情' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return row;
}
import type { FakeContext, FakeStep } from '../../src/driver.js';
import type { ReviewReport } from '../../src/review-report.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const decisionRequests: Promise<Response>[] = [];
const trackDecisions: typeof fetch = (input, init) => {
  const response = fetch(input, init);
  if (['decide-gate', 'merge-work', 'push-work', 'withdraw-acceptance', 'finish-work-without-merge'].some(name => String(input).endsWith(`/api/${name}`))) decisionRequests.push(response);
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

async function prepareReview(report?: ReviewReport | ((ctx: FakeContext) => ReviewReport)) {
  let releaseExecution!: () => void;
  let releaseVerification!: () => void;
  const executionEnded = new Promise<void>(resolve => { releaseExecution = resolve; });
  const verificationEnded = new Promise<void>(resolve => { releaseVerification = resolve; });
  daemon = await uiFixture([[draft(1)], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('code') as any).result.id, key: 'execute', agentId: 'claude-executor' }), saveAs: 'execute', check: ok },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'too-early', report: reviewReport('还未完成') }), check: value => expect((value as any).error.code).toBe('NON_TERMINAL_CARDS') },
    { type: 'hang', until: executionEnded },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('code') as any).result.id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: (ctx.results.get('code') as any).result.id }, downstream: { type: 'card', id: (ctx.results.get('overall') as any).result.id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('overall') as any).result.id, key: 'verify', purpose: 'verification', agentId: 'claude-executor' }), saveAs: 'verify', check: ok },
    { type: 'hang', until: verificationEnded },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: (ctx.results.get('overall') as any).result.id }), check: ok },
    { type: 'tool', name: 'get-dispatch-artifacts', arguments: ctx => ({ workId: workIdOf(ctx), dispatchId: (ctx.results.get('execute') as any).result.id }), saveAs: 'artifacts', check: ok },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: typeof report === 'function' ? report(ctx) : report ?? reviewReport('汇总报告原文\n成果：result.txt') }), check: ok },
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

test('结构化报告先显示结论、三类例外和标准；卡片与建议折叠，证据按需预览', async () => {
  const evidence = [{ label: '复现证据', kind: 'file' as const, ref: 'result.txt' }];
  const report: ReviewReport = {
    verdict: 'reservations', summary: '**邮箱验证码**已接通；密码入口仍有例外。<b>不能渲染 HTML</b>',
    exceptions: [
      { kind: 'unmet', what: '密码入口错误', why: '**老用户**无法登录，影响接受。', evidence },
      { kind: 'unverified', what: '外网收信', why: '真实投递仍有风险。', evidence },
      { kind: 'truncated', what: '旧入口检查', why: '输出达到上限，证据不完整。', evidence },
    ],
    criteria: [{ criterion: '密码入口仍可用', status: 'unmet', evidence }],
    cards: [{ cardId: 'card-record', title: '登录功能', result: '已完成', verification: 'passed', evidence,
      dispatches: [{ agentId: 'agent-record', dispatchId: 'dispatch-record' }] }],
    suggestions: ['后续可补充**投递耗时**观测。'],
  };
  const work = await prepareReview(report);
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  expect(await within(review).findByRole('heading', { name: '有保留' })).toBeTruthy();
  expect(within(review).getByText('邮箱验证码').tagName).toBe('STRONG');
  expect(review.querySelector('b')?.textContent).not.toBe('不能渲染 HTML');
  expect(within(review).getByRole('heading', { name: '例外' })).toBeTruthy();
  expect(within(review).getByText('覆盖截断')).toBeTruthy();
  expect(within(review).getByRole('cell', { name: '密码入口仍可用' })).toBeTruthy();
  const cards = within(review).getByText('卡片表 · 1 张卡片').closest('details')!;
  const suggestions = within(review).getByText('建议 · 不构成退回理由').closest('details')!;
  expect(cards.open).toBe(false);
  expect(suggestions.open).toBe(false);
  expect(within(review).getByRole('button', { name: 'dispatch-record' }).closest('details')!.open).toBe(false);
  fireEvent.click(within(review).getAllByRole('button', { name: '复现证据' })[0]!);
  const preview = await screen.findByRole('dialog', { name: 'result.txt' });
  expect(await within(preview).findByText(/末尾成果/)).toBeTruthy();
  fireEvent.click(within(preview).getByRole('button', { name: '返回' }));
  fireEvent.click(within(cards).getByText('卡片表 · 1 张卡片'));
  expect(within(cards).getByText('登录功能')).toBeTruthy();
  expect(within(cards).getByText('行详情').closest('details')!.open).toBe(false);
});

test('报告成果和验收回答链接打开实际记录，关闭预览后焦点回到证据入口', async () => {
  let branchRef = '';
  const work = await prepareReview(ctx => {
    const branch = (ctx.results.get('artifacts') as any).result.find((item: any) => item.kind === 'branch');
    branchRef = branch.ref;
    return { ...reviewReport(), criteria: [{ criterion: '成果已验收', status: 'passed', evidence: [
      { label: '分支成果', kind: 'artifact', ref: branch.id },
      { label: '验收回答', kind: 'dispatch', ref: (ctx.results.get('verify') as any).result.id },
    ] }] };
  });
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  fireEvent.click(await within(review).findByText('1 条标准均有验收证据'));
  const branch = within(review).getByRole('button', { name: '分支成果' });
  fireEvent.click(branch);
  const artifact = await screen.findByRole('dialog', { name: '分支成果' });
  expect(await within(artifact).findByText(branchRef)).toBeTruthy();
  fireEvent.click(within(artifact).getByRole('button', { name: '返回' }));
  expect(document.activeElement).toBe(branch);
  fireEvent.click(within(review).getByRole('button', { name: '验收回答' }));
  const dispatch = await screen.findByRole('dialog', { name: '验收回答' });
  expect(await within(dispatch).findByText('全部标准通过，原文保留')).toBeTruthy();
  expect(within(dispatch).getByRole('region', { name: '最终回答' })).toBeTruthy();
});

test.each(['accept', 'return'] as const)('%s 结论按固定布局显示，全通过时标准收为一行，空建议不显示，语言可切换', async verdict => {
  const report: ReviewReport = { ...reviewReport('报告内容保持原文'), verdict };
  if (verdict === 'return') {
    report.criteria[0]!.status = 'unmet';
    report.exceptions = [{ kind: 'unmet', what: '验证码未拒绝', why: '不符合安全标准。', evidence: report.criteria[0]!.evidence }];
  }
  const work = await prepareReview(report);
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  expect(await within(review).findByRole('heading', { name: verdict === 'accept' ? '建议接受' : '建议退回' })).toBeTruthy();
  expect(within(review).queryByText('建议 · 不构成退回理由')).toBeNull();
  expect(within(review).getByText('全部标准 · 无截断')).toBeTruthy();
  if (verdict === 'accept') {
    expect(within(review).getByText('1 条标准均有验收证据').closest('details')!.open).toBe(false);
  } else expect(within(review).getByRole('heading', { name: '标准' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(review).getByRole('heading', { name: verdict === 'accept' ? 'Recommend accepting' : 'Recommend returning' })).toBeTruthy();
  expect(within(review).getByText('报告内容保持原文')).toBeTruthy();
});

test('旧版纯文本审核在工作页和收件箱继续显示 Markdown，接受与退回仍可用', async () => {
  const work = await prepareReview();
  // Simulate the read contract of a historical gate, which has no structured report.
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!String(input).endsWith('/api/get-conversation')) return response;
    const body = await response.json();
    for (const item of body.result) if (item.kind === 'review') { item.report = null; item.body = '## 历史报告\n\n**原始结论**'; }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} transport={transport} />);
  const review = await screen.findByRole('region', { name: '审核' });
  expect(await within(review).findByText('历史汇总报告 · 旧版文本')).toBeTruthy();
  expect(within(review).getByRole('heading', { name: '历史报告' })).toBeTruthy();
  expect(within(review).getByText('原始结论').tagName).toBe('STRONG');
  const row = expandRow(within(screen.getByRole('region', { name: '等你处理' })).getByText('工作说明与审核'));
  expect(await within(row).findByText('原始结论')).toBeTruthy();
  expect(within(review).getByRole('button', { name: '接受' })).toBeTruthy();
});

test('报告加载、读取失败重试、空报告及字段缺失均有反馈；补齐字段后出现审核入口', async () => {
  let submitInvalid!: () => void;
  let submitValid!: () => void;
  const invalidReady = new Promise<void>(resolve => { submitInvalid = resolve; });
  const validReady = new Promise<void>(resolve => { submitValid = resolve; });
  daemon = await uiFixture([[draft(1)], [
    { type: 'hang', until: invalidReady },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: { ...reviewReport(), summary: '' } }) },
    { type: 'hang', until: validReady },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: reviewReport('补齐后的结论') }) },
  ]]);
  const work = await createWork();
  await confirmVersion(work.id, 1);
  let releaseRead!: () => void;
  const readReady = new Promise<void>(resolve => { releaseRead = resolve; });
  let fail = true;
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/get-conversation') && fail) { await readReady; throw new Error('审核读取连接中断'); }
    return fetch(input, init);
  };
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  try {
    expect(await screen.findByText('正在读取汇总报告…')).toBeTruthy();
    releaseRead();
    expect(await screen.findByText('汇总报告读取失败')).toBeTruthy();
    fail = false;
    fireEvent.click(within(screen.getByText('审核读取连接中断').closest('[role="alert"]')!).getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('尚无汇总报告')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '接受' })).toBeNull();
    submitInvalid();
    expect(await screen.findByText('汇总报告尚不能发起审核')).toBeTruthy();
    const invalid = screen.getByText('汇总报告尚不能发起审核').closest('section')!;
    expect(within(invalid).getByText(/report.summary: 缺少结论说明/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '接受' })).toBeNull();
    submitValid();
    expect(await screen.findByRole('button', { name: '接受' })).toBeTruthy();
    expect(screen.queryByText('汇总报告尚不能发起审核')).toBeNull();
  } finally { releaseRead(); submitInvalid(); submitValid(); }
});

test('已有有效待审核报告时，失败的重复提交不会显示未生成关卡或挡住审核', async () => {
  daemon = await uiFixture([[draft(1)], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: reviewReport('已有有效报告') }) },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: { ...reviewReport(), summary: '' } }) },
  ]]);
  const work = await createWork();
  await confirmVersion(work.id, 1);
  await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.some((item: any) => item.action === 'operation-rejected'));
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} />);
  const review = await screen.findByRole('region', { name: '审核' });
  expect(await within(review).findByText('已有有效报告')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('正在读取汇总报告…')).toBeNull());
  expect(screen.queryByText('汇总报告尚不能发起审核')).toBeNull();
  expect(within(review).getByRole('button', { name: '接受' })).toBeTruthy();
});
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
  fireEvent.click(within(review).getByText('审核记录与全部改动'));
  expect(within(review).getByText('全部标准通过，原文保留')).toBeTruthy();
  expect(within(within(review).getByRole('heading', { name: '整体验收' }).parentElement!).getByText('通过')).toBeTruthy();
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

test.each(['工作页', '收件箱'])('%s接受审核与另一处同步，可撤回，合入即移到已结束，推送可选', async source => {
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
  let delivery = await screen.findByRole('region', { name: '合入与推送' });
  expect(await within(delivery).findByRole('heading', { name: '已接受，待合入' })).toBeTruthy();
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('accepted');
  fireEvent.click(within(delivery).getByRole('button', { name: '撤回接受' }));
  expect(await within(review).findByRole('button', { name: '接受' })).toBeTruthy();
  fireEvent.click(within(review).getByRole('button', { name: '接受' }));
  delivery = await screen.findByRole('region', { name: '合入与推送' });
  await within(delivery).findByRole('heading', { name: '已接受，待合入' });
  await waitFor(() => expect((within(delivery).getByRole('button', { name: '合入' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(delivery).getByRole('button', { name: '合入' }));
  expect(await within(delivery).findByRole('heading', { name: '已完成' })).toBeTruthy();
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('completed');
  await waitFor(() => expect((within(delivery).getByRole('button', { name: '推送' }) as HTMLButtonElement).disabled).toBe(false));
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
  expect(await within(delivery).findByRole('region', { name: '将推出的提交' })).toBeTruthy();
  expect(within(delivery).getByText(/将新建远端分支/)).toBeTruthy();
  fireEvent.click(within(delivery).getByRole('button', { name: '推送' }));
  await within(delivery).findByRole('heading', { name: '已推送 · 工作完成' });
  expect(execFileSync('git', ['-C', remote, 'show', 'main:result.txt'], { encoding: 'utf8' })).toContain('末尾成果');
  await checkGraphDecision(gate.question, '已接受', 'Accepted');
});

test('待合入时对话和执行操作只读，撤回接受后恢复输入', async () => {
  const work = await prepareReview();
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon!.url} transport={trackDecisions} />);
  const delivery = await screen.findByRole('region', { name: '合入与推送' });
  const conversation = await screen.findByRole('region', { name: '对话' });
  expect((within(conversation).getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^操作/ }));
  expect((screen.getByRole('button', { name: '暂停工作' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(delivery).getByRole('button', { name: '撤回接受' }));
  await waitFor(() => expect((within(conversation).getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).disabled).toBe(false));
});

test.each(['conflict', 'push-failed'])('界面显示 %s 原因并保留继续操作入口', async problem => {
  const work = await prepareReview();
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon!.repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const remote = join(daemon!.directory, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  if (problem === 'conflict') {
    await writeFile(join(daemon!.repo, 'result.txt'), 'another work\n');
    git('add', 'result.txt');
    git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'base updated');
  }
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} transport={trackDecisions} />);
  const delivery = await screen.findByRole('region', { name: '合入与推送' });
  fireEvent.click(within(delivery).getByRole('button', { name: '合入' }));
  if (problem === 'conflict') {
    expect(await within(delivery).findByRole('heading', { name: '合入冲突，待合入' })).toBeTruthy();
    expect(within(delivery).getByRole('cell', { name: 'result.txt' })).toBeTruthy();
    expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('accepted');
    expect(within(delivery).queryByRole('button', { name: '推送' })).toBeNull();
    expect(within(delivery).getByRole('button', { name: '撤回接受' })).toBeTruthy();
  } else {
    await within(delivery).findByRole('heading', { name: '已完成' });
    const hook = join(remote, 'hooks', 'pre-receive');
    await writeFile(hook, '#!/bin/sh\necho ui-push-rejected >&2\nexit 1\n', { mode: 0o755 });
    await waitFor(() => expect((within(delivery).getByRole('button', { name: '推送' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(delivery).getByRole('button', { name: '推送' }));
    expect(await within(delivery).findByRole('heading', { name: '推送失败' })).toBeTruthy();
    expect(within(delivery).getByRole('alert').textContent).toContain('ui-push-rejected');
    await rm(hook);
    await waitFor(() => expect((within(delivery).getByRole('button', { name: '重试推送' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(delivery).getByRole('button', { name: '重试推送' }));
    expect(await within(delivery).findByRole('heading', { name: '已推送 · 工作完成' })).toBeTruthy();
  }
});

async function checkGraphDecision(question: string, zh: string, en: string) {
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  fireEvent.click(within(header).getByRole('link', { name: '调度结构' }));
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const node = await within(graph).findByRole('button', { name: `关卡：${question}` });
  expect(node.title).toContain(zh);
  fireEvent.click(node);
  expect(within(screen.getByRole('complementary', { name: '关卡检查器' })).getByText(zh)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(node.title).toContain(en);
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
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: reviewReport('没有代码变更') }), check: ok },
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
  fireEvent.click(within(review).getByText('审核记录与全部改动'));
  expect(within(review).getByText('暂无整体验收结论。')).toBeTruthy();
  fireEvent.click(within(review).getByRole('button', { name: '查看 diff' }));
  expect(within(review).getByText('没有代码差异。')).toBeTruthy();
  expect(within(review).queryByLabelText('Diff 内容')).toBeNull();
});


test.each(['打开时已取消', '打开后取消'])('%s时审核和收件箱只读，保留报告并显示终态', async timing => {
  daemon = await uiFixture([[draft(1)], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: reviewReport('终态仍可读取的汇总报告') }), check: ok },
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

test('审核接受后确认结束（不合入）即移到已结束，完成后没有推送入口', async () => {
  const work = await prepareReview();
  const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon!.url} transport={trackDecisions} />);
  const delivery = await screen.findByRole('region', { name: '合入与推送' });
  fireEvent.click(within(delivery).getByRole('button', { name: '结束（不合入）' }));
  const dialog = await screen.findByRole('dialog', { name: '结束（不合入）' });
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('accepted');
  fireEvent.click(within(dialog).getByRole('button', { name: '确认结束（不合入）' }));
  await within(delivery).findByText(/工作已完成，未合入/);
  await waitFor(() => expect(within(screen.getByRole('region', { name: '已结束' })).getByText('工作说明与审核')).toBeTruthy());
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('completed');
  expect(within(delivery).queryByRole('button', { name: '推送' })).toBeNull();
});
