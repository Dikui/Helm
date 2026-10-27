import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DataProvider } from '../src/shared/data.js';
import { I18nProvider } from '../src/shared/i18n.js';
import { OutputSteps } from '../src/pages/work/card-graph/DispatchDetails.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); localStorage.clear(); });

test('轮次与派单共用的输出分页组件能显示计划快照及原始 JSON', async () => {
  const entries = [{ content: '核对', status: 'completed' as const }, { content: '执行', status: 'in_progress' as const }, { content: '记录', status: 'pending' as const }];
  daemon = await uiFixture([[{ type: 'plan', entries }, { type: 'hang' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '分页计划', key: 'plan-output' })).result.work;
  const rounds = (await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.currentSteps.length > 0)).result;
  render(<I18nProvider><DataProvider baseUrl={daemon.url}><OutputSteps workId={work.id} roundId={rounds.rounds[0].id} affects={() => false} /></DataProvider></I18nProvider>);
  const list = await screen.findByRole('list', { name: '本轮计划' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(within(list).getByText('已完成')).toBeTruthy();
  expect(within(list).getByText('进行中')).toBeTruthy();
  expect(within(list).getByText('待做')).toBeTruthy();
  const raw = screen.getByText('原始步骤', { selector: 'summary' });
  fireEvent.click(raw);
  expect(raw.closest('details')?.open).toBe(true);
  expect(within(raw.closest('details')!).getByText(/"type": "plan"/, { selector: 'pre' }).textContent).toContain('"entries"');
});
