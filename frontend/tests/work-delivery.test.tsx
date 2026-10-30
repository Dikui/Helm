import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataProvider } from '../src/shared/data.js';
import { I18nProvider } from '../src/shared/i18n.js';
import { Router } from '../src/shared/router.js';
import type { Work } from '../src/shared/types.js';
import { WorkDelivery } from '../src/pages/work/WorkDelivery.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); localStorage.clear(); });
const conflict: Pick<Work, 'id' | 'status' | 'delivery' | 'workBranch'> = { id: 'work', status: 'accepted', workBranch: 'helm/work', delivery: {
  merge: { status: 'conflict', baseBranch: 'refs/heads/main', workBranch: 'helm/work', conflictFiles: ['src/中文 file.ts'] },
} };
const resolution = { fromCommit: 'before', baseCommit: 'base', baseBranch: 'refs/heads/main' };
function show(work: typeof conflict, requests: { name: string; params: any }[], result: unknown = work) {
  const transport: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/events')) return new Response(null, { status: 503 });
    requests.push({ name: String(url).split('/').at(-1)!, params: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, result });
  };
  return render(<I18nProvider><Router><DataProvider transport={transport}><WorkDelivery work={work} /></DataProvider></Router></I18nProvider>);
}

test('冲突列出文件与两个选项，交给调度者只发送解决请求', async () => {
  const requests: { name: string; params: any }[] = [];
  show(conflict, requests);
  expect(screen.getByText('src/中文 file.ts')).toBeTruthy();
  expect(screen.getByRole('button', { name: '我自己处理' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '交给调度者解决' }));
  await waitFor(() => expect(requests).toEqual([{ name: 'resolve-merge-conflict', params: { workId: 'work', resolution: 'coordinator' } }]));
});

test('自己处理后提供重新检测和改交给调度者，不在检测时合入', async () => {
  const requests: { name: string; params: any }[] = [];
  show({ ...conflict, delivery: { ...conflict.delivery, resolution: { ...resolution, status: 'manual' } } }, requests);
  expect(screen.getByRole('heading', { name: '等待你处理冲突' })).toBeTruthy();
  expect(screen.getByText('helm/work → main')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^合入$/ })).toBeNull();
  expect(screen.getByRole('button', { name: '改交给调度者' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  await screen.findByRole('status');
  expect(requests).toEqual([{ name: 'recheck-work-merge', params: { workId: 'work' } }]);
});

test('调度者解决中只显示进展，不能重复合入或撤回接受', () => {
  show({ ...conflict, status: 'executing', delivery: { ...conflict.delivery, resolution: { ...resolution, status: 'solving' } } }, []);
  expect(screen.getByRole('heading', { name: '调度者正在解决冲突' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '解决与验收中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: '撤回接受' })).toBeNull();
  expect(screen.getByRole('link', { name: '查看调度者进展' }).getAttribute('href')).toBe('/works/work/chat');
});

test('解决后展示改动与再次合入入口，diff 文本不执行 HTML', async () => {
  const requests: { name: string; params: any }[] = [];
  show({ ...conflict, delivery: { ...conflict.delivery, resolution: { ...resolution, status: 'resolved', toCommit: 'after' } } }, requests,
    { toCommit: 'after', diff: '+<img src=x onerror=alert(1)>\n+保留双方行为' });
  expect(screen.getByRole('heading', { name: '冲突已解决，待合入' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看冲突解决改动' }));
  expect(await screen.findByText(/保留双方行为/)).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
  expect(screen.queryByRole('button', { name: /^接受$/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '再次合入' }));
  await waitFor(() => expect(requests.map(request => request.name)).toEqual(['get-conflict-resolution', 'merge-work']));
});

const completed: typeof conflict = { id: 'work', status: 'completed', workBranch: 'helm/work', delivery: {
  merge: { status: 'merged', baseBranch: 'refs/heads/main', workBranch: 'helm/work' },
} };
const pushPreview = { baseBranch: 'refs/heads/main', remote: 'origin', remoteBranch: 'refs/heads/main', newBranch: false,
  commits: [{ hash: 'abcd123', subject: 'this work' }, { hash: 'ef01234', subject: 'unrelated local commit' }] };

test('完成后先展示全部推送预览，推送不阻碍工作完成', async () => {
  const requests: { name: string; params: any }[] = [];
  show(completed, requests, pushPreview);
  expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy();
  expect(await screen.findByText('unrelated local commit')).toBeTruthy();
  expect(screen.getByText('abcd123')).toBeTruthy();
  expect(screen.getByText('ef01234')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '推送' }));
  await waitFor(() => expect(requests.map(request => request.name)).toEqual(['get-work-push-preview', 'push-work']));
});

test('完成后推送失败保留重试，预览说明远端分支将新建', async () => {
  const requests: { name: string; params: any }[] = [];
  show({ ...completed, delivery: { ...completed.delivery, push: { status: 'failed', baseBranch: 'refs/heads/main', reason: 'timeout' } } }, requests,
    { ...pushPreview, newBranch: true });
  expect(screen.getByRole('heading', { name: '推送失败' })).toBeTruthy();
  expect(await screen.findByText('将新建远端分支：')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('timeout');
  fireEvent.click(screen.getByRole('button', { name: '重试推送' }));
  await waitFor(() => expect(requests.at(-1)?.name).toBe('push-work'));
});

test.each(['pushed', 'without-merge'] as const)('%s 的已完成工作不再预览或显示推送按钮', async kind => {
  const requests: { name: string; params: any }[] = [];
  show({ ...completed, delivery: { ...completed.delivery,
    ...(kind === 'pushed' ? { push: { status: 'pushed' as const, baseBranch: 'refs/heads/main' } } : { completedWithoutMerge: true }),
  } }, requests);
  expect(screen.queryByRole('button', { name: /推送/ })).toBeNull();
  expect(requests).toEqual([]);
  if (kind === 'without-merge') expect(screen.getByText(/工作已完成，未合入/)).toBeTruthy();
});

test('无远端时显示原因，隐藏推送入口', async () => {
  show(completed, [], { baseBranch: 'refs/heads/main', reason: '没有远端仓库', commits: [] });
  expect(await screen.findByText('没有远端仓库')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '推送' })).toBeNull();
});

test.each(['accepted', 'conflict', 'manual'] as const)('%s 时结束（不合入）先确认，取消不发送请求', async phase => {
  const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  const close = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
  try {
    const requests: { name: string; params: any }[] = [];
    const delivery = phase === 'accepted' ? {} : { ...conflict.delivery,
      ...(phase === 'manual' ? { resolution: { ...resolution, status: 'manual' as const } } : {}),
    };
    show({ ...conflict, delivery }, requests);
    const trigger = screen.getByRole('button', { name: '结束（不合入）' });
    fireEvent.click(trigger);
    let dialog = screen.getByRole('dialog', { name: '结束（不合入）' });
    expect(within(dialog).getByText(/删除工作副本，保留工作分支/)).toBeTruthy();
    expect(requests).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: '返回' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认结束（不合入）' }));
    await waitFor(() => expect(requests).toEqual([{ name: 'finish-work-without-merge', params: { workId: 'work' } }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  } finally { showModal.mockRestore(); close.mockRestore(); }
});

test('调度者正在处理合入冲突时也可结束（不合入）', () => {
  show({ ...conflict, status: 'executing', delivery: { ...conflict.delivery, resolution: { ...resolution, status: 'solving' } } }, []);
  expect(screen.getByRole('button', { name: '结束（不合入）' })).toBeTruthy();
});

test.each(['accepted', 'completed'] as const)('无工作分支的 %s 工作隐藏全部交付操作且不请求推送预览', status => {
  const requests: { name: string; params: any }[] = [];
  show({ id: 'work', status, workBranch: null, delivery: {} }, requests);
  expect(screen.queryAllByRole('button')).toEqual([]);
  expect(requests).toEqual([]);
  if (status === 'completed') {
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy();
    expect(screen.getByText('这项工作没有代码改动，已完成。')).toBeTruthy();
  } else expect(screen.queryByRole('region', { name: '合入与推送' })).toBeNull();
});
