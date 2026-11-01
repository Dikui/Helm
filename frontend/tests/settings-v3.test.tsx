import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });

test.each([['environment', 'agents', 'Agent'], ['prompts', 'advanced', '高级'], ['runtime', 'advanced', '高级']])('旧设置分区 %s 重定向到 %s，导航只有四页', async (old, section, title) => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', `/settings/${old}`);
  render(<App baseUrl={daemon.url} />);
  await waitFor(() => expect(window.location.pathname).toBe(`/settings/${section}`));
  const nav = screen.getByRole('navigation', { name: '设置' });
  expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/settings/agents', '/settings/library', '/settings/projects', '/settings/advanced']);
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
  if (section === 'advanced') {
    expect(await screen.findByRole('form', { name: '执行者并发上限' })).toBeTruthy();
    expect(await screen.findByText('调度者规则 · 编辑')).toBeTruthy();
    const settings = (await daemon.call('get-settings')).result;
    expect(screen.getByText(`当前执行者用量: ${settings.runningDispatches} / ${settings.concurrencyLimit} · 排队 ${settings.queuedDispatches}`)).toBeTruthy();
  }
});

test('Agent 深链接按四驱动分组，组头重检保留详情草稿，英文切换覆盖四页', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/agents/codex-executor');
  let rechecks = 0;
  const transport: typeof fetch = (url, options) => {
    if (String(url).endsWith('/api/recheck-agent')) rechecks++;
    return fetch(url, options);
  };
  render(<App baseUrl={daemon.url} transport={transport} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  expect(within(editor).getByRole('heading', { name: 'codex-executor' })).toBeTruthy();
  expect(window.location.pathname).toBe('/settings/agents/codex-executor');
  for (const name of ['Claude CLI', 'Codex CLI', 'Grok CLI', 'DeepSeek CLI']) expect(screen.getByRole('group', { name })).toBeTruthy();
  const description = within(editor).getByRole('textbox', { name: '职责说明' }) as HTMLTextAreaElement;
  fireEvent.change(description, { target: { value: 'draft responsibilities' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Codex CLI' })).getByRole('button', { name: '重新检测' }));
  await waitFor(() => expect(rechecks).toBe(2));
  expect(description.value).toBe('draft responsibilities');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('form', { name: 'Agent details' })).toBeTruthy();
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/settings/agents', '/settings/library', '/settings/projects', '/settings/advanced']);
  fireEvent.click(within(nav).getByRole('link', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
  expect(await screen.findByText('Coordinator rules · Edit')).toBeTruthy();
  expect(await screen.findByText(/Current executor usage:/)).toBeTruthy();
  fireEvent.click(within(nav).getByRole('link', { name: 'Library' }));
  expect(await screen.findByRole('region', { name: 'Skills' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Install skill' })).toBeTruthy();
  fireEvent.click(within(nav).getByRole('link', { name: 'Projects' }));
  expect(await screen.findByRole('button', { name: '＋ Register project' })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/高级|库里|重新检测|未安装|提示词|项目设置/);
});

test('保存中锁定 Agent 表单和重复保存，失败保留输入，重试显示成功', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  let attempts = 0;
  let release!: () => void;
  const transport: typeof fetch = async (url, options) => {
    if (String(url).endsWith('/api/save-agent') && ++attempts === 1) {
      await new Promise<void>(resolve => { release = resolve; });
      return new Response(JSON.stringify({ ok: false, error: { code: 'SAVE_FAILED', reason: 'Disk unavailable' } }), { status: 500 });
    }
    return fetch(url, options);
  };
  render(<App baseUrl={daemon.url} transport={transport} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  const description = within(editor).getByRole('textbox', { name: '职责说明' }) as HTMLTextAreaElement;
  fireEvent.change(description, { target: { value: 'draft after failure' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  const saving = await within(editor).findByRole('button', { name: '保存中…' }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  fireEvent.click(saving);
  expect(attempts).toBe(1);
  release();
  await within(editor).findByText('Disk unavailable');
  expect(description.value).toBe('draft after failure');
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await within(editor).findByText('已保存');
  expect((await daemon.call('list-agents')).result.find((entry: any) => entry.id === 'claude-executor').description).toBe('draft after failure');
});
