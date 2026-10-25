import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });

test('提示词分区显示四段规则，单段保存写入数据目录', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/prompts');
  render(<App baseUrl={daemon.url} />);
  const form = await screen.findByRole('form', { name: '调度者规则' });
  const text = within(form).getByLabelText('调度者规则') as HTMLTextAreaElement;
  expect(text.value).toMatch(/^你是 Helm 调度者/);
  for (const name of ['调度者运行约束', '执行者规则', '执行者运行约束']) expect(screen.getByRole('form', { name })).toBeTruthy();
  fireEvent.change(text, { target: { value: '只写结论' } });
  fireEvent.click(within(form).getByRole('button', { name: '保存' }));
  await within(form).findByText('已保存');
  expect(await readFile(join(daemon.directory, 'data', 'prompts', 'coordinator-role.md'), 'utf8')).toBe('只写结论');
});
