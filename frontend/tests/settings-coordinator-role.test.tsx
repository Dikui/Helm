import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });

test.each(['grok', 'deepseek'])('%s 可创建调度者 Agent，能力关闭时禁用角色并显示原因', async driver => {
  daemon = await uiFixture();
  let supported = false;
  const reason = `${driver} 调度者真实冒烟未通过。`;
  const transport: typeof fetch = (url, options) => {
    if (String(url).endsWith('/api/check-agent')) return Promise.resolve(Response.json({ ok: true, result: {
      installed: true, install: null, capabilities: { coordinator: JSON.parse(String(options?.body)).driver === driver ? supported : true,
        coordinatorUnavailableReason: reason,
        cleanStart: { supported: true } },
    } }));
    return fetch(url, options);
  };
  window.history.replaceState(null, '', '/settings/new-agent');
  render(<App baseUrl={daemon.url} transport={transport} />);
  const form = await screen.findByRole('form', { name: 'Agent 详情' });
  const drivers = within(form).getByLabelText('驱动');
  fireEvent.change(drivers, { target: { value: driver } });
  const coordinator = within(form).getByRole('option', { name: '调度者' }) as HTMLOptionElement;
  await waitFor(() => expect(coordinator.disabled).toBe(true));
  expect(within(form).getByText(reason)).toBeTruthy();
  supported = true;
  fireEvent.change(drivers, { target: { value: 'claude-sdk' } });
  await waitFor(() => expect(coordinator.disabled).toBe(false));
  fireEvent.change(drivers, { target: { value: driver } });
  await waitFor(() => expect(coordinator.disabled).toBe(false));
  expect(within(form).queryByText(reason)).toBeNull();
  fireEvent.change(within(form).getByLabelText('角色'), { target: { value: 'coordinator' } });
  fireEvent.change(within(form).getByLabelText('名字'), { target: { value: `${driver}-coordinator` } });
  fireEvent.change(within(form).getByLabelText('模型'), { target: { value: driver === 'grok' ? 'grok-4.7' : 'deepseek-flash' } });
  fireEvent.change(within(form).getByLabelText('推理强度'), { target: { value: 'low' } });
  fireEvent.change(within(form).getByLabelText('职责说明'), { target: { value: '推进工作' } });
  fireEvent.click(within(form).getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  const saved = (await daemon.call('list-agents')).result.find((entry: any) => entry.id === `${driver}-coordinator`);
  expect(saved.available).toBe(true);
  expect(saved.config.role).toBe('coordinator');
  expect(saved.config.loadGlobalConfig).toBe(false);
});
