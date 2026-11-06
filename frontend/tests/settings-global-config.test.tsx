import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });

test.each(['coordinator', 'executor'])('Claude %s 的全局配置开关可保存、重开和复制，支持中英文', async role => {
  daemon = await uiFixture();
  const id = `claude-${role}`;
  window.history.replaceState(null, '', `/settings/agents/${id}`);
  render(<App baseUrl={daemon.url} />);
  const toggle = await screen.findByRole('checkbox', { name: '加载全局配置' }) as HTMLInputElement;
  expect(toggle.checked).toBe(role === 'executor');
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  const saved = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === id);
  expect(saved.config.loadGlobalConfig).toBe(role === 'coordinator');
  cleanup(); render(<App baseUrl={daemon.url} />);
  expect((await screen.findByRole('checkbox', { name: '加载全局配置' }) as HTMLInputElement).checked).toBe(role === 'coordinator');
  fireEvent.click(screen.getByRole('button', { name: '复制为新 Agent' }));
  await waitFor(() => expect(window.location.pathname).toBe('/settings/new-agent'));
  expect((screen.getByRole('checkbox', { name: '加载全局配置' }) as HTMLInputElement).checked).toBe(role === 'coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect((screen.getByRole('checkbox', { name: 'Load global config' }) as HTMLInputElement).checked).toBe(role === 'coordinator');
});

test('新建 Agent 切换角色时全局配置按角色默认，API 提示专用主目录始终加载', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/new-agent');
  render(<App baseUrl={daemon.url} />);
  const form = await screen.findByRole('form', { name: 'Agent 详情' });
  const toggle = within(form).getByRole('checkbox', { name: '加载全局配置' }) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  fireEvent.change(within(form).getByLabelText('角色'), { target: { value: 'coordinator' } });
  expect(toggle.checked).toBe(false);
  fireEvent.change(within(form).getByLabelText('角色'), { target: { value: 'executor' } });
  expect(toggle.checked).toBe(true);
  fireEvent.click(within(form).getByRole('radio', { name: /API/ }));
  expect(within(form).getByText('API Agent 始终加载专用主目录的用户配置。')).toBeTruthy();
});

test.each(['codex', 'grok', 'deepseek'])('%s 不能干净启动时禁用开关并显示原因，切换驱动保留草稿', async driver => {
  daemon = await uiFixture();
  const agent = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === `${driver}-executor`);
  await daemon.call('save-agent', { id: agent.id, mode: 'update', baseRevision: agent.revision,
    config: { ...agent.config, loadGlobalConfig: false }, prompt: agent.prompt });
  const reason = `${driver} 无法跳过用户与项目的规则、MCP 和 skills。`;
  const transport: typeof fetch = (url, options) => {
    if (String(url).endsWith('/api/check-agent') && JSON.parse(String(options?.body)).driver === driver) {
      return Promise.resolve(Response.json({ ok: true, result: { installed: true, install: null,
        capabilities: { cleanStart: { supported: false, reason } } } }));
    }
    return fetch(url, options);
  };
  window.history.replaceState(null, '', `/settings/agents/${agent.id}`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  const toggle = await screen.findByRole('checkbox', { name: '加载全局配置' }) as HTMLInputElement;
  // The toggle is also disabled while the check loads; the reason appears only with its result.
  await screen.findByText(reason);
  expect(toggle.disabled).toBe(true);
  expect(toggle.checked).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
  expect(toggle.getAttribute('aria-describedby')?.split(' ').some(id => document.getElementById(id)?.textContent === reason)).toBe(true);
  const description = screen.getByRole('textbox', { name: '职责说明' }) as HTMLTextAreaElement;
  fireEvent.change(description, { target: { value: '保留的职责草稿' } });
  fireEvent.change(screen.getByRole('combobox', { name: '驱动' }), { target: { value: 'claude-sdk' } });
  await waitFor(() => expect(toggle.disabled).toBe(false));
  expect(toggle.checked).toBe(false);
  expect(screen.queryByText(reason)).toBeNull();
  expect(description.value).toBe('保留的职责草稿');
  fireEvent.change(screen.getByRole('combobox', { name: '驱动' }), { target: { value: driver } });
  await screen.findByText(reason);
  expect(toggle.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect((screen.getByRole('checkbox', { name: 'Load global config' }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
});
