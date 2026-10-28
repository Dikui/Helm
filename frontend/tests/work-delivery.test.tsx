import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataProvider } from '../src/shared/data.js';
import { I18nProvider } from '../src/shared/i18n.js';
import { Router } from '../src/shared/router.js';
import type { Work } from '../src/shared/types.js';
import { WorkDelivery } from '../src/pages/work/WorkDelivery.js';

afterEach(() => { cleanup(); localStorage.clear(); });
const conflict: Pick<Work, 'id' | 'status' | 'delivery'> = { id: 'work', status: 'accepted', delivery: {
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
