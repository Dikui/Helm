import { afterEach, beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeContext, FakeScript, FakeStep } from '../../src/driver.js';
import { reviewReport } from '../../tests/fixtures/review-report.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const responses: Promise<Response>[] = [];
const requests: string[] = [];
const transport: typeof fetch = (input, init) => {
  const name = String(input).split('/').at(-1)!;
  requests.push(name);
  const result = fetch(input, init);
  if (['merge-work', 'push-work', 'finish-work-without-merge', 'recheck-work-merge'].includes(name)) responses.push(result);
  return result;
};
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => {
  cleanup(); await Promise.allSettled(responses.splice(0)); await daemon?.close(); daemon = undefined;
  requests.splice(0); localStorage.clear(); window.history.replaceState(null, '', '/');
});
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const workId = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const saved = (ctx: FakeContext, key: string) => (ctx.results.get(key) as any).result.id;
const tool = (name: string, args: Record<string, unknown> | ((ctx: FakeContext) => Record<string, unknown>), saveAs?: string): FakeStep => ({ type: 'tool', name, arguments: args, saveAs, check: ok });
const git = (...args: string[]) => execFileSync('git', ['-C', daemon!.repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function prepare(options: { readonly?: boolean; resolution?: FakeScript } = {}) {
  const executors: FakeScript[] = [];
  const scripts: FakeScript[] = [];
  const stages = new Map<string, FakeScript>();
  const seen = new Set<string>();
  let resolving = false;
  const route: FakeScript = ctx => {
    scripts.push(route);
    const id = workId(ctx);
    if (!seen.has(id)) {
      seen.add(id);
      return [tool('draft-work-description', { workId: id, key: 'draft', requirements: 'Deliver', boundary: 'Local', criteria: 'Works' })];
    }
    const stage = stages.get(id);
    if (stage) { stages.delete(id); return typeof stage === 'function' ? stage(ctx) : stage; }
    if (!resolving && options.resolution && JSON.parse(ctx.input).delivery?.resolution?.status === 'solving') {
      resolving = true;
      return typeof options.resolution === 'function' ? options.resolution(ctx) : options.resolution;
    }
    return [];
  };
  scripts.push(route);
  daemon = await uiFixture(scripts, undefined, { executorScripts: executors });
  let sequence = 0;
  async function createAccepted() {
    const number = ++sequence;
    let release!: () => void;
    const executed = new Promise<void>(resolve => { release = resolve; });
    executors.push(options.readonly ? [{ type: 'artifact', kind: 'file', path: 'README.md' }]
      : [{ type: 'write', path: number === 1 ? 'result.txt' : 'other-work.txt', content: 'work change\n' }]);
    const work = (await daemon!.call('send-message', { projectId: daemon!.project.id, key: `start-${number}`, body: number === 1 ? 'Delivery work' : 'Another delivery' })).result.work;
    const descriptions = (await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result;
    await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
    stages.set(work.id, [
      tool('create-card', { workId: work.id, key: 'card', content: 'Delivery card', readOnly: Boolean(options.readonly) }, 'card'),
      tool('create-dispatch', ctx => ({ workId: work.id, key: 'execute', cardId: saved(ctx, 'card'), agentId: 'claude-executor' })),
      { type: 'hang', until: executed },
      tool('complete-card', ctx => ({ workId: work.id, cardId: saved(ctx, 'card') })),
      tool('request-review', { workId: work.id, key: 'review', report: reviewReport('Delivery report') }),
    ]);
    ok(await daemon!.call('decide-gate', { workId: work.id, gateId: descriptions[0].gateId, descriptionId: descriptions[0].id, decision: 'confirm' }));
    try {
      await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'ended');
      release();
      await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'awaiting-review');
      await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
    } finally { release(); }
    const gate = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
    ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
    return (await daemon!.call('get-work', { workId: work.id })).result;
  }
  const work = await createAccepted();
  window.history.replaceState(null, '', `/works/${work.id}?inspect=delivery`);
  return { work, executors, createAccepted };
}
async function createConflict() {
  await writeFile(join(daemon!.repo, 'result.txt'), 'base change\n');
  git('add', 'result.txt'); git('-c', 'user.name=UI Test', '-c', 'user.email=ui@example.invalid', 'commit', '-m', 'base changed');
}
async function addRemote(pushBaseline = true) {
  const remote = join(daemon!.directory, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  git('remote', 'add', 'origin', remote);
  if (pushBaseline) git('push', 'origin', 'main');
  return remote;
}
const delivery = () => screen.getByRole('region', { name: '合入与推送' });
const pin = () => within(screen.getByRole('region', { name: '对话' })).getByRole('group', { name: '合入与推送' });
function pressPin(name: string, key: string) {
  const button = within(pin()).getByRole('button', { name });
  button.focus(); fireEvent.keyDown(button, { key });
}
const show = (custom: typeof fetch = transport) => render(<App baseUrl={daemon!.url} transport={custom} />);
async function openPush(name = '推送…') {
  fireEvent.click(within(delivery()).getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name: '推送 main 到 origin/main' });
  await within(dialog).findByRole('table', { name: '将推出的提交' });
  return dialog;
}

test('接受后钉栏在对话记录之外，数字键撤回后恢复审核，分支显示真实名称', async () => {
  const { work } = await prepare(); show();
  await screen.findByRole('region', { name: '合入与推送' });
  expect(within(delivery()).getByRole('heading', { name: '待合入' })).toBeTruthy();
  expect(within(delivery()).getByLabelText('分支流向').textContent).toBe(`${work.workBranch}→main`);
  expect(within(screen.getByRole('region', { name: '对话记录' })).queryByRole('group', { name: '合入与推送' })).toBeNull();
  expect(within(pin()).getByRole('button', { name: '合入' })).toBeTruthy();
  pressPin('撤回接受', '2');
  await screen.findByRole('region', { name: '审核' });
  await waitFor(() => expect(within(screen.getByRole('region', { name: '对话' })).queryByRole('group', { name: '合入与推送' })).toBeNull());
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('awaiting-review');
});

test.each(['merge-queued', 'merging'] as const)('%s 显示真实串行交付进展，禁用重复操作，中英文完整', async status => {
  const { work, createAccepted } = await prepare();
  const second = status === 'merge-queued' ? await createAccepted() : undefined;
  const marker = join(daemon!.repo, '.git', 'hold-ui-merge');
  await writeFile(marker, 'hold');
  await writeFile(join(daemon!.repo, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\nwhile test -f .git/hold-ui-merge; do sleep 0.05; done\n', { mode: 0o755 });
  const merging = daemon!.call('merge-work', { workId: work.id });
  let queued: ReturnType<NonNullable<typeof daemon>['call']> | undefined;
  try {
    await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'merging');
    if (second) queued = daemon!.call('merge-work', { workId: second.id });
    const target = second ?? work;
    await until(() => daemon!.call('get-work', { workId: target.id }), value => value.result.status === status);
    window.history.replaceState(null, '', `/works/${target.id}?inspect=delivery`);
    show(); await screen.findByRole('region', { name: '合入与推送' });
    const button = within(delivery()).getByRole('button', { name: status === 'merge-queued' ? '合入已排队' : '合入中…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(delivery().getAttribute('aria-busy')).toBe('true');
    expect(within(delivery()).queryByRole('button', { name: '撤回接受' })).toBeNull();
    fireEvent.keyDown(window, { key: '1' }); expect(requests).not.toContain('merge-work');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('region', { name: 'Merge and push' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
  } finally {
    await rm(marker, { force: true });
    await Promise.allSettled([merging, ...(queued ? [queued] : [])]);
  }
});

test('合入失败用钉栏重试，原始错误只在详情，检查器与钉栏共享重复操作保护', async () => {
  const { work } = await prepare();
  await writeFile(join(daemon!.repo, 'result.txt'), 'untracked file');
  ok(await daemon!.call('merge-work', { workId: work.id }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const custom: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/merge-work')) await held;
    return transport(input, init);
  };
  show(custom); await screen.findByRole('region', { name: '合入与推送' });
  expect(within(pin()).getByText('合入失败')).toBeTruthy();
  expect(within(delivery()).queryByRole('alert')).toBeNull();
  expect(within(delivery()).getByText('原始原因与详情')).toBeTruthy();
  await rm(join(daemon!.repo, 'result.txt'));
  pressPin('重试合入', '1');
  try {
    expect((within(delivery()).getByRole('button', { name: '重试合入' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.click(within(delivery()).getByRole('button', { name: '重试合入' }));
  } finally { release(); }
  await within(delivery()).findByRole('heading', { name: '已完成 · 已合入' });
  expect(requests.filter(name => name === 'merge-work')).toHaveLength(1);
});

test('冲突文件与两个处理入口，自己处理仅检测祖先关系，保留改交调度者与结束出口', async () => {
  const { work } = await prepare(); await createConflict(); ok(await daemon!.call('merge-work', { workId: work.id }));
  show(); await screen.findByRole('region', { name: '合入与推送' });
  expect(within(delivery()).getByRole('cell', { name: 'result.txt' })).toBeTruthy();
  expect(within(pin()).getByRole('button', { name: '交给调度者' })).toBeTruthy();
  pressPin('我自己处理', '2');
  await within(delivery()).findByRole('heading', { name: '等待你处理冲突' });
  await within(pin()).findByText('本地合入后重新检测');
  pressPin('重新检测', '1');
  await within(delivery()).findByRole('status', { name: '' });
  expect(requests.filter(name => name === 'recheck-work-merge')).toHaveLength(1);
  expect(requests).not.toContain('merge-work');
  expect(within(delivery()).queryByRole('button', { name: '合入' })).toBeNull();
  expect(within(delivery()).getByRole('button', { name: '结束（不合入）' })).toBeTruthy();
  fireEvent.click(within(delivery()).getByRole('button', { name: '改交给调度者' }));
  await within(delivery()).findByRole('heading', { name: '调度者正在解决冲突' });
  expect((within(delivery()).getByRole('button', { name: '解决与验收中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(delivery()).getByRole('link', { name: '查看调度者进展' }).getAttribute('href')).toBe(`/works/${work.id}?inspect=coord`);
  expect(within(delivery()).queryByRole('button', { name: '撤回接受' })).toBeNull();
  expect(new URLSearchParams(window.location.search).get('inspect')).toBe('delivery');
  expect(within(delivery()).getByRole('button', { name: '结束（不合入）' })).toBeTruthy();
});

test.each(['accepted', 'conflict', 'manual', 'solving'] as const)('%s 结束不合入先确认，取消恢复焦点，完成保留分支且无推送', async phase => {
  const { work } = await prepare();
  if (phase !== 'accepted') {
    await createConflict(); ok(await daemon!.call('merge-work', { workId: work.id }));
    if (phase === 'manual' || phase === 'solving') ok(await daemon!.call('resolve-merge-conflict', { workId: work.id, resolution: phase === 'manual' ? 'manual' : 'coordinator' }));
  }
  show(); await screen.findByRole('region', { name: '合入与推送' });
  const trigger = within(delivery()).getByRole('button', { name: '结束（不合入）' });
  fireEvent.click(trigger);
  let dialog = screen.getByRole('dialog', { name: '结束（不合入）' });
  expect(within(dialog).getByText(/删除工作副本，保留工作分支/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(requests).not.toContain('finish-work-without-merge'); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); dialog = screen.getByRole('dialog', { name: '结束（不合入）' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认结束（不合入）' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await within(delivery()).findByRole('heading', { name: '已完成 · 未合入' });
  expect(await within(screen.getByRole('banner', { name: '工作概况' })).findByText('已完成 · 未合入')).toBeTruthy();
  expect(within(delivery()).queryByRole('button', { name: /推送/ })).toBeNull();
  expect(requests).not.toContain('get-work-push-preview');
  expect(git('show-ref', '--verify', `refs/heads/${work.workBranch}`)).toContain(work.workBranch);
  expect((await daemon!.call('get-work', { workId: work.id })).result.delivery.completedWithoutMerge).toBe(true);
});

test('完成摘要默认不展示提交，推送弹窗含其他本地提交，推送期间切换检查器仍禁用重复操作', async () => {
  const { work } = await prepare(); await addRemote(false);
  await writeFile(join(daemon!.repo, 'other.txt'), 'unrelated'); git('add', 'other.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'unrelated local commit');
  ok(await daemon!.call('merge-work', { workId: work.id }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const custom: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/push-work')) await held;
    return transport(input, init);
  };
  show(custom); await screen.findByRole('region', { name: '合入与推送' });
  expect(within(delivery()).queryByRole('table', { name: '将推出的提交' })).toBeNull();
  expect(within(delivery()).queryByText('unrelated local commit')).toBeNull();
  const dialog = await openPush();
  const preview = (await daemon!.call('get-work-push-preview', { workId: work.id })).result;
  for (const commit of preview.commits) {
    expect(within(dialog).getByRole('cell', { name: commit.hash })).toBeTruthy();
    expect(within(dialog).getByRole('cell', { name: commit.subject })).toBeTruthy();
  }
  expect(within(dialog).getByRole('cell', { name: 'unrelated local commit' })).toBeTruthy();
  expect(within(dialog).getByRole('columnheader', { name: '来源' })).toBeTruthy();
  const unknown = within(dialog).getByRole('row', { name: /unrelated local commit/ });
  expect(within(unknown).getByRole('cell', { name: '来源无法判定（本地提交）' })).toBeTruthy();
  await within(dialog).findByRole('cell', { name: 'Delivery work' });
  expect(within(dialog).getByText('将新建远端分支：')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: /^推送这 \d+ 个提交$/ }));
  try {
    await within(delivery()).findByRole('heading', { name: '已完成 · 正在推送' });
    expect(within(screen.getByRole('banner', { name: '工作概况' })).getByText('已完成 · 正在推送')).toBeTruthy();
    // Change the route while the request remains pending; the state belongs to the work page.
    act(() => { window.history.pushState(null, '', `/works/${work.id}?inspect=report`); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByRole('region', { name: '审核' });
    act(() => { window.history.pushState(null, '', `/works/${work.id}?inspect=delivery`); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByRole('region', { name: '合入与推送' });
    expect((within(delivery()).getByRole('button', { name: '推送中…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: '1' });
  } finally { release(); }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await within(delivery()).findByRole('heading', { name: '已完成 · 已推送' });
  expect(requests.filter(name => name === 'push-work')).toHaveLength(1);
  expect(within(delivery()).queryByRole('button', { name: /推送/ })).toBeNull();
  fireEvent.click(within(delivery()).getByRole('button', { name: '查看最终改动' }));
  const final = await screen.findByRole('dialog', { name: '查看最终改动' });
  fireEvent.click(within(final).getByRole('button', { name: '查看 diff' }));
  expect(within(final).getByLabelText('Diff 内容').textContent).toContain('work change');
});

test('推送失败用钉栏先预览再重试，原始 fatal 和路径在详情，英文无遗留中文', async () => {
  const { work } = await prepare(); const remote = await addRemote();
  ok(await daemon!.call('merge-work', { workId: work.id }));
  const hook = join(remote, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\necho fatal-ui-push-rejected >&2\nexit 1\n', { mode: 0o755 });
  ok(await daemon!.call('push-work', { workId: work.id }));
  show(); await screen.findByRole('region', { name: '合入与推送' });
  expect(within(pin()).getByText('推送失败')).toBeTruthy();
  expect(within(delivery()).getByRole('heading', { name: '已完成 · 推送失败' })).toBeTruthy();
  expect(within(delivery()).queryByRole('alert')).toBeNull();
  const details = within(delivery()).getByText('原始原因与详情');
  fireEvent.click(details);
  expect(within(delivery()).getByText(/fatal-ui-push-rejected/)).toBeTruthy();
  expect(requests).not.toContain('push-work');
  pressPin('预览并重试推送', '1');
  const dialog = await screen.findByRole('dialog', { name: '推送 main 到 origin/main' });
  await within(dialog).findByRole('table', { name: '将推出的提交' });
  expect(requests).not.toContain('push-work');
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('region', { name: 'Merge and push' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
  expect(within(screen.getByRole('region', { name: 'Chat' })).getByRole('group', { name: 'Merge and push' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
  fireEvent.click(screen.getByRole('button', { name: 'Chinese' }));
  await rm(hook); const retry = await openPush('重试推送…');
  fireEvent.click(within(retry).getByRole('button', { name: /^推送这 \d+ 个提交$/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await within(delivery()).findByRole('heading', { name: '已完成 · 已推送' });
});

test.each(['no-remote', 'no-commits', 'preview-failed'] as const)('%s 预览不能误推，保留刷新和退出', async phase => {
  const { work } = await prepare(); if (phase === 'no-commits') await addRemote();
  ok(await daemon!.call('merge-work', { workId: work.id }));
  if (phase === 'no-commits') git('push', 'origin', 'main');
  let fail = phase === 'preview-failed';
  const custom: typeof fetch = (input, init) => fail && String(input).endsWith('/api/get-work-push-preview') ? Promise.reject(new Error('preview offline')) : transport(input, init);
  show(custom); await screen.findByRole('region', { name: '合入与推送' });
  fireEvent.click(within(delivery()).getByRole('button', { name: '推送…' }));
  const dialog = screen.getByRole('dialog');
  if (phase === 'no-commits') await within(dialog).findByText('没有待推送的提交。');
  else if (fail) {
    await within(dialog).findByRole('alert'); fail = false;
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新推送预览' }));
    await within(dialog).findByText('暂时无法推送，请查看详情并配置远端。');
  } else await within(dialog).findByText('暂时无法推送，请查看详情并配置远端。');
  expect((within(dialog).getByRole('button', { name: '推送这 0 个提交' }) as HTMLButtonElement).disabled).toBe(true);
  expect(requests).not.toContain('push-work');
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('只读完成显示真实成果和导出删除入口，不读取推送预览', async () => {
  await prepare({ readonly: true }); show();
  await screen.findByRole('region', { name: '合入与推送' });
  expect(within(delivery()).getByRole('heading', { name: '已完成 · 只读工作' })).toBeTruthy();
  fireEvent.click(await within(delivery()).findByRole('button', { name: 'README.md' }));
  const artifact = await screen.findByRole('dialog', { name: 'README.md' });
  expect(await within(artifact).findByText('baseline')).toBeTruthy();
  fireEvent.click(within(artifact).getByRole('button', { name: '关闭' }));
  fireEvent.click(within(delivery()).getByRole('button', { name: '导出' }));
  expect(await screen.findByRole('dialog', { name: '导出输出' })).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
  expect(within(delivery()).getByRole('button', { name: '删除输出' })).toBeTruthy();
  expect(requests).not.toContain('get-work-push-preview');
  expect(within(delivery()).queryByRole('button', { name: /合入|推送/ })).toBeNull();
});

test.each(['merge', 'manual-recheck'] as const)('%s 检测基准已包含即完成，推送仍需单独预览，完成结果重开保留', async mode => {
  const { work } = await prepare();
  if (mode === 'manual-recheck') {
    await createConflict(); ok(await daemon!.call('merge-work', { workId: work.id }));
    ok(await daemon!.call('resolve-merge-conflict', { workId: work.id, resolution: 'manual' }));
  }
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'merge', '--no-ff', '-s', 'ours', work.workBranch, '-m', 'local merge');
  if (mode === 'merge') ok(await daemon!.call('merge-work', { workId: work.id }));
  const view = show(); await screen.findByRole('region', { name: '合入与推送' });
  if (mode === 'manual-recheck') fireEvent.click(within(pin()).getByRole('button', { name: '重新检测' }));
  await within(delivery()).findByRole('heading', { name: '已完成 · 基准已包含' });
  expect(within(delivery()).getByRole('button', { name: '推送…' })).toBeTruthy();
  expect(requests).not.toContain('push-work');
  await Promise.allSettled(responses.splice(0));
  view.unmount(); show();
  await screen.findByRole('region', { name: '合入与推送' });
  expect(within(delivery()).getByRole('heading', { name: '已完成 · 基准已包含' })).toBeTruthy();
});

test('冲突卡片验收后不重新审核，钉栏查看固定提交新增改动并再次合入，diff 不执行 HTML', async () => {
  let executionDone!: () => void;
  let verificationDone!: () => void;
  const executed = new Promise<void>(resolve => { executionDone = resolve; });
  const verified = new Promise<void>(resolve => { verificationDone = resolve; });
  const resolution: FakeScript = [
    tool('create-card', ctx => ({ workId: workId(ctx), key: 'resolve', content: 'Resolve conflict', needsVerification: true }), 'resolve'),
    tool('create-dispatch', ctx => ({ workId: workId(ctx), cardId: saved(ctx, 'resolve'), key: 'resolve', agentId: 'claude-executor' })),
    { type: 'hang', until: executed },
    tool('create-dispatch', ctx => ({ workId: workId(ctx), cardId: saved(ctx, 'resolve'), key: 'verify', purpose: 'verification', agentId: 'claude-executor' })),
    { type: 'hang', until: verified },
    tool('complete-card', ctx => ({ workId: workId(ctx), cardId: saved(ctx, 'resolve') })),
    tool('finish-conflict-resolution', ctx => ({ workId: workId(ctx) })),
  ];
  try {
    const { work, executors } = await prepare({ resolution });
    executors.push([{ type: 'write', path: 'result.txt', content: 'work and base resolved\n<img src=x onerror=alert(1)>\n' }],
      [tool('submit-conclusion', { conclusion: 'passed', reason: 'Both sides verified' })]);
    await createConflict(); ok(await daemon!.call('merge-work', { workId: work.id }));
    show(); await screen.findByRole('region', { name: '合入与推送' });
    fireEvent.click(within(pin()).getByRole('button', { name: '交给调度者' }));
    await within(delivery()).findByRole('heading', { name: '调度者正在解决冲突' });
    await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 2);
    executionDone();
    await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 3);
    verificationDone();
    const resolvedPin = await within(screen.getByRole('region', { name: '对话' })).findByRole('group', { name: '合入与推送' });
    await within(resolvedPin).findByText('冲突已解决并验收');
    expect(within(delivery()).getByRole('cell', { name: 'result.txt' })).toBeTruthy();
    expect(within(delivery()).queryByRole('button', { name: '接受' })).toBeNull();
    pressPin('查看新增改动', '1');
    const dialog = await screen.findByRole('dialog', { name: '查看冲突解决改动' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '查看 diff' }));
    expect(within(dialog).getByLabelText('Diff 内容').textContent).toContain('+work and base resolved');
    expect(within(dialog).queryByRole('img')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(within(delivery()).getByRole('button', { name: '验收回答与解决冲突的提交' }));
    const verification = await screen.findByRole('dialog', { name: '验收回答与解决冲突的提交' });
    expect(await within(verification).findByText('Both sides verified')).toBeTruthy();
    fireEvent.click(within(verification).getByRole('button', { name: '关闭' }));
    pressPin('再次合入', '2');
    await within(delivery()).findByRole('heading', { name: '已完成 · 已合入' });
    const gates = (await daemon!.call('get-conversation', { workId: work.id })).result.filter((item: any) => item.kind === 'review');
    expect(gates).toHaveLength(1); expect(gates[0].decision).toBe('accept');
  } finally { executionDone(); verificationDone(); }
});

test('清理失败保留完成结果，原始路径收进详情，不声称副本已删除', async () => {
  const { work } = await prepare(); ok(await daemon!.call('merge-work', { workId: work.id }));
  const custom: typeof fetch = async (input, init) => {
    const response = await transport(input, init);
    if (!String(input).endsWith('/api/get-work')) return response;
    const body = await response.json(); body.result.delivery.cleanup = { reason: 'fatal: cannot remove /private/tmp/work-copy' }; return Response.json(body);
  };
  show(custom); await screen.findByRole('region', { name: '合入与推送' });
  fireEvent.click(within(delivery()).getByText('清理结果'));
  const cleanup = within(delivery()).getByRole('region', { name: '清理结果' });
  expect(within(cleanup).getByRole('status').textContent).toBe('清理未完成，详情中可查看原因。');
  expect(within(cleanup).queryByText('工作副本与工作分支已删除，输出已压缩。')).toBeNull();
  fireEvent.click(within(cleanup).getByText('原始原因与详情'));
  expect(within(cleanup).getByText('fatal: cannot remove /private/tmp/work-copy')).toBeTruthy();
  expect(within(delivery()).getByRole('heading', { name: '已完成 · 已合入' })).toBeTruthy();
});
