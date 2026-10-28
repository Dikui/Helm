import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeScript } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
let height: number;
let viewportHeight: number;
const positions = new WeakMap<Element, number>();
const resizes = new Set<() => void>();
const smoothScrolls = new Map<Element, number>();
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  height = 1600;
  viewportHeight = 400;
  // jsdom does not lay out or animate scrolling. Substitute only these browser APIs.
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight);
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) { return positions.get(this) ?? 0; });
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, value) {
    positions.set(this, Math.max(0, Math.min(value, height - viewportHeight)));
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function (options: ScrollToOptions) {
    if (options.behavior === 'smooth') smoothScrolls.set(this, options.top!);
    else this.scrollTop = options.top!;
  } });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { resizes.add(callback); }
    observe() {}
    disconnect() { resizes.delete(this.callback); }
  });
});

afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
  smoothScrolls.clear();
  resizes.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function openWork(phase: string, script: FakeScript = [{ type: 'hang' }]) {
  const draft: FakeScript = [{ type: 'tool', name: 'draft-work-description', arguments: ctx => ({
    workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: '登录', boundary: '登录页', criteria: '可登录',
  }) }];
  daemon = await uiFixture(phase === '执行' ? [draft, script] : [script]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '历史消息', key: 'start' })).result.work;
  if (phase === '执行') {
    const descriptions = await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
    await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.some((event: any) => event.action === 'round-ended'));
    const description = descriptions.result[0];
    await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
  }
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByText('历史消息', { selector: 'article p' });
  return { work, history: screen.getByRole('region', { name: '对话记录' }) };
}

test.each(['对齐', '执行'])('%s打开工作直接停在最新，底部的新消息继续跟随', async phase => {
  const { work, history } = await openWork(phase);
  expect(history.scrollTop).toBe(1200);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
  height = 1900;
  await daemon!.call('send-message', { workId: work.id, body: '新增消息', key: 'new' });
  await within(history).findByText('新增消息', { selector: 'article p' });
  expect(history.scrollTop).toBe(1500);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
});

test.each(['对齐', '执行'])('%s阅读历史时不被新消息拉回，点箭头平滑回到最新后恢复跟随', async phase => {
  const { work, history } = await openWork(phase);
  history.scrollTop = 300;
  fireEvent.scroll(history);
  const arrow = screen.getByRole('button', { name: '回到最新内容' });
  height = 2000;
  await daemon!.call('send-message', { workId: work.id, body: '阅读历史期间的消息', key: 'while-reading' });
  await within(history).findByText('阅读历史期间的消息', { selector: 'article p' });
  expect(history.scrollTop).toBe(300);
  fireEvent.click(arrow);
  expect(smoothScrolls.get(history)).toBe(2000);
  // An intermediate scroll event must keep the arrow until the animation reaches the bottom.
  history.scrollTop = 800;
  fireEvent.scroll(history);
  expect(screen.getByRole('button', { name: '回到最新内容' })).toBeTruthy();
  history.scrollTop = 1600;
  fireEvent.scroll(history);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
  height = 2200;
  await daemon!.call('send-message', { workId: work.id, body: '回到最新后的消息', key: 'following-again' });
  await within(history).findByText('回到最新后的消息', { selector: 'article p' });
  expect(history.scrollTop).toBe(1800);
});

test.each(['对齐', '执行'])('%s思考输出、步骤区域和窗口尺寸变化也按阅读位置决定是否跟随', async phase => {
  let advance!: () => void;
  let finish!: () => void;
  const script: FakeScript = [
    { type: 'hang', until: new Promise<void>(resolve => { advance = resolve; }) },
    { type: 'output', text: '检查邮件模板' },
    { type: 'hang', until: new Promise<void>(resolve => { finish = resolve; }) },
  ];
  const { history } = await openWork(phase, script);
  await within(history).findByText('调度者正在思考…');
  height = 1800;
  advance();
  await within(history).findByText('检查邮件模板');
  await waitFor(() => expect(history.scrollTop).toBe(1400));
  // Expanding round steps or resizing the composer shrinks the history viewport.
  viewportHeight = 250;
  act(() => { for (const resize of resizes) resize(); });
  expect(history.scrollTop).toBe(1550);
  history.scrollTop = 300;
  fireEvent.scroll(history);
  height = 2100;
  viewportHeight = 200;
  act(() => { for (const resize of resizes) resize(); });
  expect(history.scrollTop).toBe(300);
  finish();
  await waitFor(() => expect(within(history).queryByText('调度者正在思考…')).toBeNull());
  expect(await screen.findByText('本轮 1 步 · 已结束 · 最新：检查邮件模板')).toBeTruthy();
  expect(history.scrollTop).toBe(300);
  expect(screen.getByRole('button', { name: '回到最新内容' })).toBeTruthy();
  // Manually scrolling back to the bottom also hides the arrow and resumes following.
  history.scrollTop = 1900;
  fireEvent.scroll(history);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
  height = 2300;
  act(() => { for (const resize of resizes) resize(); });
  expect(history.scrollTop).toBe(2100);
});

test.each(['对齐', '执行'])('%s切换工作和重新打开时重置到最新内容', async phase => {
  const { work, history } = await openWork(phase);
  history.scrollTop = 300;
  fireEvent.scroll(history);
  const other = (await daemon!.call('send-message', { projectId: daemon!.project.id, body: '另一项工作的历史', key: 'other' })).result.work;
  const navigate = (workId: string) => act(() => {
    window.history.pushState(null, '', `/works/${workId}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  height = 2400;
  navigate(other.id);
  await screen.findByText('另一项工作的历史', { selector: 'article p' });
  const otherHistory = screen.getByRole('region', { name: '对话记录' });
  expect(otherHistory.scrollTop).toBe(2000);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
  otherHistory.scrollTop = 400;
  fireEvent.scroll(otherHistory);
  height = 1900;
  navigate(work.id);
  await screen.findByText('历史消息', { selector: 'article p' });
  expect(screen.getByRole('region', { name: '对话记录' }).scrollTop).toBe(1500);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
});

test('视口被输入区挤小时触发的滚动不算往上翻，仍贴底跟随', async () => {
  const { history } = await openWork('对齐');
  expect(history.scrollTop).toBe(1200);
  // A taller round summary shrinks the viewport: the browser fires scroll with scrollTop unchanged, before ResizeObserver.
  viewportHeight = 375;
  fireEvent.scroll(history);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
  act(() => resizes.forEach(callback => callback()));
  expect(history.scrollTop).toBe(1225);
  expect(screen.queryByRole('button', { name: '回到最新内容' })).toBeNull();
});
