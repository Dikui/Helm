import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
const { FakeDriver }: typeof import('../../src/driver.js') = await import('../../dist/src/' + 'driver.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });

test('收件箱显示 Agent 不可用的原因和命令，进入设置重新检测后移除提醒', async () => {
  const reason = 'deepseek-official 缺少 API key，请在 dsh web 的 Models 页配置。';
  let available = false;
  const codex = Object.assign(new FakeDriver([], agent => available || agent.id !== 'codex-executor'
    ? { available: true } : { available: false, reason, command: 'dsh web' }), {
    listModels: async () => [{ id: 'gpt-6-luna', label: 'Luna', efforts: ['low'], defaultEffort: 'low' }],
  });
  daemon = await uiFixture([], undefined, { codexDriver: codex });
  window.history.replaceState(null, '', '/');
  render(<App baseUrl={daemon.url} />);
  const inbox = screen.getByRole('complementary', { name: 'Helm' });
  const alert = await within(inbox).findByRole('link', { name: 'CLI 异常，打开环境设置' });
  expect(alert.getAttribute('title')).toContain(reason);
  expect(alert.getAttribute('title')).toContain('dsh web');
  fireEvent.click(within(inbox).getByRole('button', { name: '收起收件箱' }));
  const compact = await within(inbox).findByRole('link', { name: 'CLI 异常，打开环境设置' });
  expect(compact.getAttribute('href')).toBe('/settings/environment');
  expect(compact.getAttribute('title')).toContain(reason);
  fireEvent.click(compact);
  expect(window.location.pathname).toBe('/settings/environment');
  await screen.findByRole('heading', { name: '环境' });
  fireEvent.click(screen.getByRole('link', { name: /^Agent/ }));
  fireEvent.click(await screen.findByRole('link', { name: /codex-executor/ }));
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  expect(within(editor).getByText(reason)).toBeTruthy();
  available = true;
  fireEvent.click(within(editor).getByRole('button', { name: '重新检测' }));
  await within(editor).findByText('可用');
  await waitFor(() => expect(within(inbox).queryByRole('link', { name: 'CLI 异常，打开环境设置' })).toBeNull());
});
