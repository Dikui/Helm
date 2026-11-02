import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });

test('临时目录卡片显示运行位置，派单详情可读成果文件并切换英文', async () => {
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: '调研', boundary: '临时目录', criteria: '报告' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'research', content: '网络调研', workspace: 'scratch' }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'execute', agentId: 'claude-executor' }) },
  ]], undefined, { executorScripts: [[{ type: 'write', path: 'reports/fact.md', content: '查证的事实与来源' }]] });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '调研' })).result.work;
  const params = { workId: work.id };
  const description = (await until(() => daemon!.call('get-work-descriptions', params), value => value.result.length > 0)).result[0];
  await until(() => daemon!.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  expect((await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok).toBe(true);
  const dispatch = (await until(() => daemon!.call('list-dispatches', params), value => value.result[0]?.status === 'ended')).result[0];
  window.history.replaceState(null, '', `/works/${work.id}?inspect=card:${dispatch.cardId}`);
  render(<App baseUrl={daemon.url} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  expect(await within(inspector).findByText('运行位置')).toBeTruthy();
  expect(within(inspector).getAllByText('临时目录').length).toBeGreaterThan(0);
  fireEvent.click(await within(inspector).findByRole('button', { name: '读取成果：reports/fact.md' }));
  expect(await within(inspector).findByText('查证的事实与来源')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(inspector).getByText('Workspace')).toBeTruthy();
  expect(within(inspector).getAllByText('Scratch directory').length).toBeGreaterThan(0);
});
