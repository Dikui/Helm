import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeScript } from '../../src/driver.js';
import { reviewReport } from '../../tests/fixtures/review-report.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function startWork(scripts: FakeScript[] = [], executorScripts: FakeScript[] = []) {
  daemon = await uiFixture(scripts, undefined, { executorScripts });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '分析工作问题', key: 'start' })).result.work;
  await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.some((event: any) => event.action === 'round-ended'));
  window.history.replaceState(null, '', `/works/${work.id}?inspect=spec`);
  return work;
}

function clipboard() {
  // Substitute only the browser clipboard platform boundary; HTTP and helmd are real.
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

async function openReference() {
  fireEvent.click(screen.getByRole('button', { name: '操作' }));
  fireEvent.click(screen.getByRole('button', { name: '工作引用与路径' }));
  return screen.findByRole('dialog', { name: '工作引用与路径' });
}

// Issue #28 · medium spec: a copied reference lets an external agent locate this work and read its records.
test('无工作副本时可复制项目路径及供外部 Agent 定位的工作引用', async () => {
  const work = await startWork();
  const writeText = clipboard();
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  expect(await within(dialog).findByText('工作副本尚未创建。')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '复制工作副本路径' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '复制项目路径' }));
  expect(await within(dialog).findByText('已复制')).toBeTruthy();
  expect(writeText).toHaveBeenLastCalledWith(daemon!.repo);
  fireEvent.click(within(dialog).getByRole('button', { name: '复制工作引用' }));
  const text = (within(dialog).getByLabelText('工作引用') as HTMLTextAreaElement).value;
  expect(writeText).toHaveBeenLastCalledWith(text);
  expect(text).toContain('分析工作问题');
  expect(text).toContain(work.id);
  expect(text).toContain(`http://localhost/works/${work.id}`);
  expect(text).toContain('对齐中');
  expect(text).toContain(daemon!.repo);
  expect(text).toContain(`POST ${daemon!.url}/api/get-work`);
  expect(text).toContain(`POST ${daemon!.url}/api/get-card-graph`);
  expect(text).toContain(`POST ${daemon!.url}/api/get-conversation`);
  expect(text).toContain(JSON.stringify({ workId: work.id }));
  // The copied instructions must work against the public API, not just look like URLs.
  const responses = await Promise.all([...text.matchAll(/^POST (.+)$/gm)].map(async ([, url]) => {
    const response = await fetch(url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workId: work.id }) });
    return response.json();
  }));
  expect(responses).toHaveLength(7);
  for (const response of responses) expect(response.ok).toBe(true);
  expect((await daemon!.call('get-work', { workId: work.id })).result.workPath).toBeNull();
});

// Issue #28 · medium spec: use the real work-copy lifecycle rather than predicting a directory name.
test('已有工作副本可复制实际路径，取消后仍可引用工作但不再提供副本路径', async () => {
  const work = await startWork([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'draft', requirements: '分析问题', boundary: '本机', criteria: '能够定位', deliverables: '路径与引用' }) },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '分析代码' }), saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', agentId: 'claude-executor' }) },
  ]], [[{ type: 'hang' }]]);
  const gate = (await daemon!.call('list-pending')).result[0];
  expect((await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' })).ok).toBe(true);
  const current = (await until(() => daemon!.call('get-work', { workId: work.id }), value => Boolean(value.result.workPath))).result;
  const writeText = clipboard();
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  const button = await within(dialog).findByRole('button', { name: '复制工作副本路径' });
  fireEvent.click(button);
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(current.workPath));
  expect((within(dialog).getByLabelText('工作引用') as HTMLTextAreaElement).value).toContain(current.workBranch);
  expect((within(dialog).getByLabelText('工作引用') as HTMLTextAreaElement).value).toContain(current.baseCommit);
  await daemon!.call('cancel-work', { workId: work.id });
  expect(await within(dialog).findByText('工作已结束，不再提供工作副本路径。')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: '复制工作副本路径' })).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: '复制工作引用' }));
  expect(writeText.mock.calls.at(-1)![0]).not.toContain(current.workPath);
  expect(writeText.mock.calls.at(-1)![0]).toContain(work.id);
});

// Issue #28 · medium spec: rejected/missing Clipboard API must leave selectable text and allow retry.
test.each(['拒绝', '不可用', '兼容方式抛错'])('剪贴板%s时保留完整引用供手动复制并允许重试', async mode => {
  await startWork();
  const writeText = clipboard().mockRejectedValue(new Error('NotAllowedError'));
  if (mode === '不可用') Reflect.deleteProperty(navigator, 'clipboard');
  if (mode === '兼容方式抛错') Object.defineProperty(document, 'execCommand', { configurable: true, value: () => { throw new Error('复制被浏览器阻止'); } });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  const button = await within(dialog).findByRole('button', { name: '复制工作引用' });
  const field = within(dialog).getByLabelText('工作引用') as HTMLTextAreaElement;
  const text = field.value;
  fireEvent.click(button);
  expect((await within(dialog).findByRole('alert')).textContent).toContain('无法自动复制，请选中文本手动复制，或重试。');
  expect(field.value).toBe(text);
  expect(field.selectionEnd - field.selectionStart).toBe(text.length);
  expect(within(dialog).queryByText('已复制')).toBeNull();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
  fireEvent.click(button);
  expect(await within(dialog).findByText('已复制')).toBeTruthy();
  expect(writeText).toHaveBeenLastCalledWith(text);
});

// Issue #28 · medium spec: a slow platform response must not cause duplicate writes.
test('等待剪贴板响应期间禁用重复复制', async () => {
  await startWork();
  let resolve!: () => void;
  const writeText = clipboard().mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  const button = await within(dialog).findByRole('button', { name: '复制工作引用' }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  resolve();
  expect(await within(dialog).findByText('已复制')).toBeTruthy();
  expect(button.disabled).toBe(false);
});

// Issue #28 · medium spec: substitute the legacy clipboard platform API used in insecure contexts.
test('不支持 Clipboard API 时可通过选中文本的兼容方式复制', async () => {
  await startWork();
  Reflect.deleteProperty(navigator, 'clipboard');
  const copy = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  fireEvent.click(await within(dialog).findByRole('button', { name: '复制项目路径' }));
  expect(await within(dialog).findByText('已复制')).toBeTruthy();
  expect(copy).toHaveBeenCalledWith('copy');
  const field = within(dialog).getByLabelText('项目路径') as HTMLTextAreaElement;
  expect(field.value).toBe(daemon!.repo);
  expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(daemon!.repo);
});

// A click can land between the commit that shows the button and React's later effect flush.
test('按钮刚出现就复制时仍显示已复制', async () => {
  await startWork();
  Reflect.deleteProperty(navigator, 'clipboard');
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const clicked = new Promise<void>(resolve => {
    const observer = new MutationObserver(() => {
      const button = screen.queryByRole('button', { name: '复制项目路径' });
      if (!button) return;
      observer.disconnect();
      fireEvent.click(button);
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  const dialog = await openReference();
  await clicked;
  expect(await within(dialog).findByText('已复制')).toBeTruthy();
});

// Issue #28 · medium spec: substitute only an unavailable HTTP read, never the internal resource hook.
test('项目资料加载失败不提供不完整引用，重读成功后可复制', async () => {
  const work = await startWork();
  let fail = true;
  let delay = true;
  let release!: () => void;
  const hold = new Promise<void>(done => { release = done; });
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/list-projects')) {
      if (delay) await hold;
      if (fail) throw new Error('项目读取失败');
    }
    return fetch(input, init);
  };
  render(<App baseUrl={daemon!.url} transport={transport} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  expect(within(dialog).getByRole('status').textContent).toBe('正在读取…');
  expect(within(dialog).queryByRole('button', { name: '复制工作引用' })).toBeNull();
  release(); delay = false;
  expect((await within(dialog).findByRole('alert')).textContent).toContain('项目读取失败');
  expect(within(dialog).queryByRole('button', { name: '复制工作引用' })).toBeNull();
  fail = false;
  fireEvent.click(within(dialog).getByRole('button', { name: '重新读取' }));
  expect(await within(dialog).findByRole('button', { name: '复制工作引用' })).toBeTruthy();
  expect((within(dialog).getByLabelText('工作引用') as HTMLTextAreaElement).value).toContain(work.id);
});

// Issue #28 · medium spec: the read-only entry stays usable while paused/ended, with canonical locale and focus.
test.each(['pause-work', 'cancel-work'])('%s 后英文引用弹窗可用，Escape 关闭后恢复焦点', async operation => {
  const work = await startWork();
  await daemon!.call(operation, { workId: work.id });
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Work reference and paths' }));
  const dialog = await screen.findByRole('dialog', { name: 'Work reference and paths' });
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  const field = await within(dialog).findByLabelText('Work reference') as HTMLTextAreaElement;
  expect(field.value).toContain(operation === 'pause-work' ? 'Paused' : 'Cancelled');
  expect(field.value).toContain('分析工作问题');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
});

// Issue #28 · medium spec: completed works remain referenceable even when they never needed a copy.
test('已完成且从未建立副本的工作仍可复制工作引用', async () => {
  const work = await startWork([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'draft', requirements: '分析问题', boundary: '本机', criteria: '能够定位', deliverables: '工作引用' }) },
  ], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'review', report: reviewReport('分析完成') }) },
  ]]);
  const gate = (await daemon!.call('list-pending')).result[0];
  expect((await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' })).ok).toBe(true);
  const review = (await until(() => daemon!.call('list-pending'), value => value.result.some((item: any) => item.kind === 'review'))).result.find((item: any) => item.kind === 'review');
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
  expect((await daemon!.call('decide-gate', { workId: work.id, gateId: review.id, decision: 'accept' })).ok).toBe(true);
  const writeText = clipboard();
  render(<App baseUrl={daemon!.url} />);
  await screen.findByRole('heading', { level: 1, name: '分析工作问题' });
  const dialog = await openReference();
  fireEvent.click(await within(dialog).findByRole('button', { name: '复制工作引用' }));
  expect(writeText.mock.calls.at(-1)![0]).toContain('已完成 (completed)');
  expect(writeText.mock.calls.at(-1)![0]).toContain(work.id);
  expect(within(dialog).queryByRole('button', { name: '复制工作副本路径' })).toBeNull();
});
