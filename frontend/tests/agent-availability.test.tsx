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
  await within(inbox).findAllByText(reason);
  expect(within(inbox).getAllByText('dsh web').length).toBeGreaterThan(0);
  fireEvent.click(within(inbox).getByRole('link', { name: 'codex-executor · 不可用' }));
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  expect(within(editor).getByText(reason)).toBeTruthy();
  available = true;
  fireEvent.click(within(editor).getByRole('button', { name: '重新检测' }));
  await within(editor).findByText('可用');
  await waitFor(() => expect(within(inbox).queryByText(reason)).toBeNull());
});
