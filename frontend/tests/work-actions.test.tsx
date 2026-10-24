import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
// jsdom has no native dialog implementation. Substitute only the platform API.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function startWork() {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '管理输出的工作', key: 'start' })).result.work;
  await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.some((event: any) => event.action === 'round-ended'));
  window.history.replaceState(null, '', `/works/${work.id}`);
  return work;
}

function actions() {
  fireEvent.click(screen.getByRole('button', { name: '操作' }));
  return screen.getByRole('group', { name: '工作操作' });
}

test('工作菜单暂停、恢复经 HTTP 生效；取消必须二次确认，结束后禁用修改', async () => {
  const work = await startWork();
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  fireEvent.click(within(actions()).getByRole('button', { name: '暂停工作' }));
  await waitFor(async () => expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('paused'));
  await within(screen.getByRole('heading', { level: 1 }).closest('header')!).findByText('已暂停');
  await waitFor(() => expect(screen.queryByRole('group', { name: '工作操作' })).toBeNull());
  fireEvent.click(within(actions()).getByRole('button', { name: '恢复工作' }));
  await waitFor(async () => expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('aligning'));
  await within(screen.getByRole('heading', { level: 1 }).closest('header')!).findByText('对齐中');
  await waitFor(() => expect(screen.queryByRole('group', { name: '工作操作' })).toBeNull());
  fireEvent.click(within(actions()).getByRole('button', { name: '取消工作' }));
  let dialog = await screen.findByRole('dialog', { name: '取消工作' });
  expect(dialog.textContent).toContain('管理输出的工作');
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('aligning');
  fireEvent.click(within(dialog).getByRole('button', { name: '返回' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '操作' }));
  fireEvent.click(within(actions()).getByRole('button', { name: '取消工作' }));
  dialog = await screen.findByRole('dialog', { name: '取消工作' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认取消工作' }));
  await waitFor(async () => expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('cancelled'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await within(screen.getByRole('heading', { level: 1 }).closest('header')!).findByText('已取消');
  const menu = actions();
  expect((within(menu).getByRole('button', { name: '暂停工作' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(menu).getByRole('button', { name: '换调度者 Agent' }) as HTMLButtonElement).disabled).toBe(true);
});

test('换调度者列出全部调度者 Agent，不可用的显示原因且不能应用，选择后经 HTTP 更新且从下一轮生效', async () => {
  const work = await startWork();
  const saved = await daemon!.call('save-agent', {
    id: 'unavailable-coordinator', mode: 'create', prompt: '不可用的调度者',
    config: { role: 'coordinator', driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', fast: true, home: 'shared', description: '不可用 Agent' },
  });
  expect(saved.ok).toBe(true);
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  fireEvent.click(within(actions()).getByRole('button', { name: '换调度者 Agent' }));
  const dialog = await screen.findByRole('dialog', { name: '换调度者 Agent' });
  expect(await within(dialog).findByRole('radio', { name: /codex-coordinator/ })).toBeTruthy();
  fireEvent.click(await within(dialog).findByRole('radio', { name: /unavailable-coordinator.*extra usage/ }));
  expect((within(dialog).getByRole('button', { name: '更换 Agent' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).queryByText(/claude-executor/)).toBeNull();
  expect(within(dialog).getByText('从下一调度轮次起生效。')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('radio', { name: /codex-coordinator/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: '更换 Agent' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await daemon!.call('get-work', { workId: work.id })).result.coordinatorAgentId).toBe('codex-coordinator');
});

test('已结束工作导出到本机路径，错误保留输入；已导出后删除仍须确认并持久显示已删除', async () => {
  const work = await startWork();
  await daemon!.call('cancel-work', { workId: work.id });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  fireEvent.click(within(actions()).getByRole('button', { name: '导出输出' }));
  let dialog = await screen.findByRole('dialog', { name: '导出输出' });
  const path = `${daemon!.directory}/outputs.tar.gz`;
  fireEvent.change(within(dialog).getByLabelText('本机保存路径（.tar.gz）'), { target: { value: `${daemon!.directory}/bad.zip` } });
  fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
  expect((await within(dialog).findByRole('alert')).textContent).toContain('导出目标路径必须以 .tar.gz 结尾。');
  expect((within(dialog).getByLabelText('本机保存路径（.tar.gz）') as HTMLInputElement).value).toContain('bad.zip');
  fireEvent.change(within(dialog).getByLabelText('本机保存路径（.tar.gz）'), { target: { value: path } });
  fireEvent.click(within(dialog).getByRole('button', { name: '导出' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText(path)).toBeTruthy();
  expect((await daemon!.call('get-work', { workId: work.id })).result.outputsExportedAt).toBeTruthy();
  fireEvent.click(within(actions()).getByRole('button', { name: '删除输出' }));
  dialog = await screen.findByRole('dialog', { name: '删除输出' });
  expect((await daemon!.call('get-work', { workId: work.id })).result.outputsDeletedAt).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '返回' }));
  fireEvent.click(within(actions()).getByRole('button', { name: '删除输出' }));
  dialog = await screen.findByRole('dialog', { name: '删除输出' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除输出' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('已删除')).toBeTruthy();
  expect((await daemon!.call('get-work', { workId: work.id })).result.outputsDeletedAt).toBeTruthy();
  cleanup();
  render(<App baseUrl={daemon!.url} />);
  expect(await screen.findByText('已删除')).toBeTruthy();
  expect((within(actions()).getByRole('button', { name: '删除输出' }) as HTMLButtonElement).disabled).toBe(true);
});

test('未导出的删除沿用运行层 confirm 提示，可先导出或明确仍然删除', async () => {
  const work = await startWork();
  await daemon!.call('cancel-work', { workId: work.id });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  fireEvent.click(within(actions()).getByRole('button', { name: '删除输出' }));
  let dialog = await screen.findByRole('dialog', { name: '删除输出' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除输出' }));
  expect(await within(dialog).findByText(/尚未导出这项工作的输出，建议先导出/)).toBeTruthy();
  expect((await daemon!.call('get-work', { workId: work.id })).result.outputsDeletedAt).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '先导出' }));
  dialog = await screen.findByRole('dialog', { name: '导出输出' });
  fireEvent.click(within(dialog).getByRole('button', { name: '返回' }));
  fireEvent.click(within(actions()).getByRole('button', { name: '删除输出' }));
  dialog = await screen.findByRole('dialog', { name: '删除输出' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除输出' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '仍然删除' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('已删除')).toBeTruthy();
  const events = (await daemon!.call('get-events', { workId: work.id })).result;
  expect(events.find((event: any) => event.action === 'outputs-deleted').details.confirmedWithoutExport).toBe(true);
});

test('超阈值顶部提示首次读取和 SSE 更新，指向运行设置与已结束工作，删除输出后消失', async () => {
  const work = await startWork();
  await daemon!.call('cancel-work', { workId: work.id });
  await daemon!.call('set-output-threshold', { thresholdBytes: 0 });
  render(<App baseUrl={daemon!.url} />);
  let banner = await screen.findByRole('region', { name: '输出空间提示' });
  expect(within(banner).getByRole('link', { name: '调整输出阈值' }).getAttribute('href')).toBe('/settings/runtime');
  expect((await within(banner).findByRole('link', { name: '管理输出的工作' })).getAttribute('href')).toBe(`/works/${work.id}`);
  const settings = (await daemon!.call('get-settings')).result;
  expect(settings.outputTotalBytes).toBeGreaterThan(0);
  expect(settings.outputThresholdExceeded).toBe(true);
  await daemon!.call('set-output-threshold', { thresholdBytes: 1_000_000_000 });
  await waitFor(() => expect(screen.queryByRole('region', { name: '输出空间提示' })).toBeNull());
  await daemon!.call('set-output-threshold', { thresholdBytes: 0 });
  banner = await screen.findByRole('region', { name: '输出空间提示' });
  expect(within(banner).getByText('输出总量已超过阈值。')).toBeTruthy();
  fireEvent.click(within(actions()).getByRole('button', { name: '删除输出' }));
  const dialog = await screen.findByRole('dialog', { name: '删除输出' });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除输出' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: '仍然删除' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '输出空间提示' })).toBeNull());
  expect((await daemon!.call('get-settings')).result.outputTotalBytes).toBe(0);
});

test('断线后旧菜单的操作被运行层拒绝时显示原始原因，并重读终态禁用修改', async () => {
  const work = await startWork();
  const transport: typeof fetch = (input, init) => {
    if (String(input).endsWith('/events')) return Promise.reject(new Error('模拟离线'));
    return fetch(input, init);
  };
  render(<App baseUrl={daemon!.url} transport={transport} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  const menu = actions();
  await daemon!.call('cancel-work', { workId: work.id });
  fireEvent.click(within(menu).getByRole('button', { name: '暂停工作' }));
  expect((await screen.findByRole('alert')).textContent).toContain('完成或已取消的工作不能再修改。');
  await waitFor(() => expect((within(menu).getByRole('button', { name: '暂停工作' }) as HTMLButtonElement).disabled).toBe(true));
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('cancelled');
});

test('操作菜单和确认框可用 Escape 退出，焦点返回操作按钮，英文沿用全局语言', async () => {
  const work = await startWork();
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { name: '管理输出的工作' });
  const menu = actions();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: '工作操作' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '操作' }));
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel work' }));
  const dialog = await screen.findByRole('dialog', { name: 'Cancel work' });
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Back' }));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
  expect((await daemon!.call('get-work', { workId: work.id })).result.status).toBe('aligning');
});
