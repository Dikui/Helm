import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => {
  cleanup(); await daemon?.close(); daemon = undefined;
  localStorage.clear(); window.history.replaceState(null, '', '/');
});

async function ready() {
  const base = await screen.findByRole('combobox', { name: '基准分支' });
  await waitFor(() => expect((base as HTMLSelectElement).value).toBe('main'));
  await waitFor(() => expect((screen.getByRole('combobox', { name: '调度者 Agent' }) as HTMLSelectElement).value).toBe('claude-coordinator'));
}

test('左栏与快捷键在当前工作上打开弹窗：锁定焦点、Esc 恢复原页面、检查器与输入', async () => {
  daemon = await uiFixture([[{ type: 'hang' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'background', body: '弹窗背景工作' })).result.work;
  const original = `/works/${work.id}?inspect=events`;
  window.history.replaceState(null, '', original);
  render(<App baseUrl={daemon.url} />);
  const message = await screen.findByRole('textbox', { name: '消息' });
  fireEvent.change(message, { target: { value: '背景对话草稿' } });
  const trigger = within(screen.getByRole('complementary', { name: 'Helm' })).getByRole('link', { name: '新建工作' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: '新建工作' });
  await ready();
  const request = within(dialog).getByRole('textbox', { name: '需求' });
  expect(document.activeElement).toBe(request);
  expect(message.isConnected).toBe(true);
  expect(screen.queryByRole('region', { name: '对话' })).toBeNull();
  const close = within(dialog).getByRole('button', { name: '关闭新建工作' });
  close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  const context = within(dialog).getByText('附件与项目上下文');
  expect(document.activeElement).toBe(context);
  fireEvent.keyDown(context, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  fireEvent.change(request, { target: { value: '保留的新建草稿' } });
  fireEvent.keyDown(request, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(window.location.pathname + window.location.search).toBe(original);
  expect(screen.getByRole('textbox', { name: '消息' })).toBe(message);
  expect((message as HTMLTextAreaElement).value).toBe('背景对话草稿');
  fireEvent.keyDown(message, { key: 'n', metaKey: true });
  expect(await screen.findByRole('dialog', { name: '新建工作' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement).value).toBe('保留的新建草稿');
  fireEvent.keyDown(screen.getByRole('textbox', { name: '需求' }), { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
});

test('项目菜单能取消并恢复焦点，项目、基准与调度者跨重挂载记住选择', async () => {
  daemon = await uiFixture();
  const second = join(daemon.directory, 'second');
  execFileSync('git', ['clone', daemon.repo, second], { stdio: 'ignore' });
  execFileSync('git', ['-C', second, 'branch', 'release/1.0']);
  const project = (await daemon.call('register-project', { path: second })).result;
  window.history.replaceState(null, '', '/new');
  const view = render(<App baseUrl={daemon.url} />);
  await ready();
  const trigger = screen.getByRole('button', { name: /^项目:/ });
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu', { name: '选择项目' });
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitemradio', { name: /^second/ }));
  await ready();
  fireEvent.change(screen.getByRole('combobox', { name: '基准分支' }), { target: { value: 'release/1.0' } });
  fireEvent.change(screen.getByRole('combobox', { name: '调度者 Agent' }), { target: { value: 'codex-coordinator' } });
  view.unmount();
  render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('button', { name: `项目: ${project.name}` })).toBeTruthy();
  await waitFor(() => expect((screen.getByRole('combobox', { name: '基准分支' }) as HTMLSelectElement).value).toBe('release/1.0'));
  expect((screen.getByRole('combobox', { name: '调度者 Agent' }) as HTMLSelectElement).value).toBe('codex-coordinator');
});

test('空分支状态可直接发送并进入对齐，不提交空基准值', async () => {
  daemon = await uiFixture();
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon!.repo, ...args], { stdio: 'pipe' });
  let empty = false;
  const requests: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/list-project-branches') && !empty) {
      // Let list-projects observe ready git, then remove the last local branch before its branch read.
      empty = true; git('checkout', '--detach'); git('branch', '-D', 'main');
    }
    if (String(input).endsWith('/api/send-message')) requests.push(JSON.parse(String(init?.body)));
    return fetch(input, init);
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  expect(await screen.findByText(/此项目尚无可用分支/)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: '需求' }), { target: { value: '空分支先对齐' } });
  await waitFor(() => expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByRole('heading', { name: '空分支先对齐' });
  expect(requests).toHaveLength(1); expect('baseRef' in requests[0]).toBe(false);
  expect((await daemon.call('list-works')).result[0].baseRef).toBeNull();
});

test('明确失败保留正文和附件、可编辑重试；提交中锁定输入和胶囊', async () => {
  daemon = await uiFixture();
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const requests: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/send-message')) {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) return new Response(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', reason: '明确未创建', allowedOperations: [] } }), { status: 409 });
      await held;
    }
    return fetch(input, init);
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  await ready();
  fireEvent.click(screen.getByText('附件与项目上下文'));
  const file = new File(['evidence'], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('新建工作附件'), { target: { files: [file] } });
  const request = screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement;
  fireEvent.change(request, { target: { value: '保留附件' } });
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('运行层已明确未创建工作。保留正文与附件；可重试。')).toBeTruthy();
  expect(request.disabled).toBe(false); expect(request.value).toBe('保留附件');
  expect(screen.getByText('notes.txt')).toBeTruthy();
  fireEvent.change(request, { target: { value: '保留附件后修订' } });
  fireEvent.click(screen.getByRole('button', { name: '重试发送' }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(request.disabled).toBe(true);
  expect((screen.getByRole('button', { name: /^项目:/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '基准分支' }) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('combobox', { name: '调度者 Agent' }) as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '创建中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(requests[1].attachments).toEqual(requests[0].attachments);
  expect(requests[1].key).not.toBe(requests[0].key);
  finish();
  await screen.findByRole('heading', { name: '保留附件后修订' });
  expect((await daemon.call('list-works')).result).toHaveLength(1);
});

test('响应不确定时关闭再打开，仍锁定原请求并用同一个 key 重试', async () => {
  daemon = await uiFixture();
  const requests: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (String(input).endsWith('/api/send-message')) {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) { await response.text(); throw new Error('Lost response'); }
    }
    return response;
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '需求' }), { target: { value: '只创建一次' } });
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByText('Lost response');
  fireEvent.click(screen.getByRole('button', { name: '关闭新建工作' }));
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  expect((screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重试原请求' }));
  await screen.findByRole('heading', { name: '只创建一次' });
  expect(requests[1]).toEqual(requests[0]);
  expect((await daemon.call('list-works')).result).toHaveLength(1);
});

for (const registered of [true, false]) test(`英文弹窗全部界面文案没有中文（${registered ? '已登记' : '未登记'}项目）`, async () => {
  localStorage.setItem('helm.language', 'en');
  daemon = await uiFixture([], undefined, { registerProject: registered });
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} />);
  const dialog = await screen.findByRole('dialog', { name: 'New work' });
  if (registered) {
    fireEvent.click(await within(dialog).findByText('Attachments and project context'));
    expect(within(dialog).getByLabelText('New work attachments')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Project:/ }));
    expect(within(dialog).getByRole('menuitem', { name: 'Register project' })).toBeTruthy();
  } else {
    expect(await within(dialog).findByRole('heading', { name: 'Register a project first' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Project path' })).toBeTruthy();
  }
  expect(dialog.textContent).not.toMatch(/[\u3400-\u9fff]/);
  if (registered) expect((within(dialog).getByRole('textbox', { name: 'Requirements' }) as HTMLTextAreaElement).placeholder).not.toMatch(/[\u3400-\u9fff]/);
});

test('背景工作经 SSE 改变阶段时，新建弹窗和草稿仍保持打开', async () => {
  daemon = await uiFixture([[{ type: 'hang' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'background', body: '背景状态变化' })).result.work;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('textbox', { name: '消息' });
  fireEvent.keyDown(window, { key: 'n', metaKey: true });
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '需求' }), { target: { value: '独立的新工作草稿' } });
  await daemon.call('cancel-work', { workId: work.id });
  await screen.findAllByText('已取消', { exact: true });
  expect(window.location.pathname).toBe('/new');
  expect(screen.getByRole('dialog', { name: '新建工作' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement).value).toBe('独立的新工作草稿');
  fireEvent.click(screen.getByRole('button', { name: '关闭新建工作' }));
  expect(window.location.pathname + window.location.search).toBe(`/works/${work.id}?inspect=list`);
});

test('仅在明确确认未创建后可恢复编辑不确定的请求', async () => {
  daemon = await uiFixture();
  let lose = true;
  const transport: typeof fetch = (input, init) => {
    if (lose && String(input).endsWith('/api/send-message')) { lose = false; return Promise.reject(new Error('Lost before send')); }
    return fetch(input, init);
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '需求' }), { target: { value: '尚未创建' } });
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByText('Lost before send');
  expect((screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement).disabled).toBe(true);
  expect((await daemon.call('list-works')).result).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '已确认未创建后恢复编辑' }));
  expect((screen.getByRole('textbox', { name: '需求' }) as HTMLTextAreaElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: '需求' }), { target: { value: '恢复编辑后创建' } });
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByRole('heading', { name: '恢复编辑后创建' });
  expect((await daemon.call('list-works')).result).toHaveLength(1);
});
