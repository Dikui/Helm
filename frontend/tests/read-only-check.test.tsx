import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App.js';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });

test('只读派单详情显示违规路径和项目目录说明，切换英文后提示完整翻译', async () => {
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: 'Research', boundary: 'Read only', criteria: 'Report findings' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'research', content: 'Research', workspace: 'scratch' }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'execute', agentId: 'claude-executor' }) },
  ]], undefined, { executorScripts: [ctx => { writeFileSync(join(ctx.options.cwd, 'unexpected file.txt'), 'changed\n'); return []; }] });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: 'Research' })).result.work;
  const description = (await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result[0];
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  expect((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok).toBe(true);
  const dispatch = (await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'ended')).result[0];
  expect(dispatch.endReason, dispatch.failure ?? '').toBe('completed');
  const db = new DatabaseSync(join(daemon.directory, 'data', 'helm.db'));
  try { db.prepare('UPDATE dispatches SET read_only_check = ? WHERE id = ?').run(JSON.stringify({ status: 'violated', paths: ['unexpected file.txt'], projectDirectory: true }), dispatch.id); }
  finally { db.close(); }
  window.history.replaceState(null, '', `/works/${work.id}?inspect=card:${dispatch.cardId}`);
  render(<App baseUrl={daemon.url} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  fireEvent.click(await within(inspector).findByText('派单详情', { selector: 'summary' }));
  const check = await within(inspector).findByRole('region', { name: '只读检查' });
  expect(within(check).getByText('只读违规')).toBeTruthy();
  expect(within(check).getByText('在项目目录运行，可能包含用户自己的改动')).toBeTruthy();
  expect(within(check).getByRole('list', { name: '违规路径' }).textContent).toBe('unexpected file.txt');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(check).getByText('Read-only violation')).toBeTruthy();
  expect(within(check).getByText('Ran in the project directory; changes may include your own edits.')).toBeTruthy();
  expect(within(check).getByRole('list', { name: 'Violation paths' }).textContent).toBe('unexpected file.txt');
  expect(check.textContent).not.toMatch(/[\u3400-\u9fff]/);
});
