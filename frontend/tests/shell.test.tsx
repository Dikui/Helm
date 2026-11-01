import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';

const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const initialWidth = window.innerWidth;
function resize(width: number) {
  act(() => { Object.defineProperty(window, 'innerWidth', { value: width, configurable: true }); window.dispatchEvent(new Event('resize')); });
}
async function openWork() {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '外壳中的真实工作', key: 'shell' })).result.work;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('heading', { level: 1, name: '外壳中的真实工作' });
  return work;
}
afterEach(async () => {
  cleanup(); await daemon?.close(); daemon = undefined;
  vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState(null, '', '/'); resize(initialWidth);
});

test('两侧可独立收起、恢复；快捷键避开输入和 IME；收起后仍可搜索、新建和设置', async () => {
  const work = await openWork();
  fireEvent.click(screen.getByRole('button', { name: '收起收件箱' }));
  expect(screen.getByRole('button', { name: '展开收件箱' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /外壳中的真实工作/ }).getAttribute('href')).toBe(`/works/${work.id}`);
  fireEvent.keyDown(window, { key: '\\' });
  expect(screen.getByRole('button', { name: '展开检查器' })).toBeTruthy();
  fireEvent.keyDown(window, { key: '[' });
  const search = screen.getByRole('searchbox', { name: '搜索工作' });
  fireEvent.keyDown(search, { key: '[' }); fireEvent.keyDown(search, { key: '\\' });
  fireEvent.keyDown(window, { key: '[', isComposing: true });
  expect(screen.getByRole('button', { name: '收起收件箱' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '展开检查器' })).toBeTruthy();
  fireEvent.keyDown(window, { key: '[' });
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
  fireEvent.click(screen.getByRole('button', { name: '展开检查器' }));
  expect(screen.getByRole('button', { name: '收起检查器' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
  expect(window.location.pathname).toBe('/new');
  expect(await screen.findByRole('heading', { name: '新建工作' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭新建工作' }));
  fireEvent.click(screen.getByRole('link', { name: '设置' }));
  expect(await screen.findByRole('heading', { name: 'Agent' })).toBeTruthy();
});

test('收起与检查器宽度跨重挂载保留；宽度支持方向键、放宽和恢复默认', async () => {
  await openWork();
  const separator = screen.getByRole('separator', { name: '调整检查器宽度' });
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  const width = localStorage.getItem('helm.inspector-width');
  expect(Number(width)).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: '放宽检查器' }));
  expect(screen.getByRole('button', { name: '收窄检查器' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收窄检查器' }));
  expect(localStorage.getItem('helm.inspector-width')).toBeNull();
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  fireEvent.click(screen.getByRole('button', { name: '收起收件箱' }));
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  cleanup(); render(<App baseUrl={daemon!.url} />);
  expect(screen.getByRole('button', { name: '展开收件箱' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开检查器' }));
  expect(Number(screen.getByRole('separator', { name: '调整检查器宽度' }).getAttribute('aria-valuenow'))).toBe(Number(width));
  fireEvent.doubleClick(screen.getByRole('separator', { name: '调整检查器宽度' }));
  expect(localStorage.getItem('helm.inspector-width')).toBeNull();
});

test('390px 抽屉可搜索、圈定焦点、Esc 和点背景关闭、导航关闭；移动状态不改桌面偏好', async () => {
  await openWork();
  fireEvent.click(screen.getByRole('button', { name: '收起收件箱' }));
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  const saved = { ...localStorage };
  resize(390);
  const opener = screen.getByRole('button', { name: '展开收件箱' });
  opener.focus(); fireEvent.click(opener);
  const drawer = screen.getByRole('dialog', { name: '工作收件箱' });
  await waitFor(() => expect(document.activeElement).toBe(within(drawer).getByRole('searchbox')));
  const close = within(drawer).getByRole('button', { name: '关闭收件箱' });
  close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(drawer.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '展开收件箱' })));
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '关闭收件箱背景' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  fireEvent.click(screen.getByRole('button', { name: '展开检查器' }));
  expect(screen.queryByRole('separator', { name: '调整检查器宽度' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开收件箱' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: '设置' }));
  await screen.findByRole('heading', { name: 'Agent' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect({ ...localStorage }).toEqual(saved);
  resize(1440);
  expect(screen.getByRole('button', { name: '展开收件箱' })).toBeTruthy();
});

test('英文外壳和驱动标志复用现有设置页；本机存储不可用时仍可收起', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
  await openWork();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('button', { name: 'Collapse inbox' })).toBeTruthy();
  expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }));
  expect(screen.getByRole('button', { name: 'Expand inspector' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  const group = await screen.findByRole('group', { name: 'Claude CLI' });
  expect(within(group).getByRole('img', { name: 'Claude' })).toBeTruthy();
  expect(within(await screen.findByRole('form', { name: 'Agent details' })).getByRole('img', { name: 'Claude' })).toBeTruthy();
});

test('新建快捷键沿用设置未保存保护，textarea 与 select 中单字符不收起', async () => {
  await openWork();
  fireEvent.click(screen.getByRole('link', { name: '设置' }));
  const description = await screen.findByRole('textbox', { name: '职责说明' });
  fireEvent.change(description, { target: { value: '仍未保存' } });
  fireEvent.keyDown(description, { key: '[' });
  fireEvent.keyDown(screen.getByRole('combobox', { name: '驱动' }), { key: '[' });
  expect(screen.getByRole('button', { name: '收起收件箱' })).toBeTruthy();
  fireEvent.keyDown(description, { key: 'n', metaKey: true });
  expect(window.location.pathname).toBe('/settings');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((description as HTMLTextAreaElement).value).toBe('仍未保存');
  fireEvent.keyDown(description, { key: 'n', metaKey: true });
  fireEvent.click(screen.getByRole('button', { name: '丢弃并继续' }));
  expect(await screen.findByRole('heading', { name: '新建工作' })).toBeTruthy();
});
