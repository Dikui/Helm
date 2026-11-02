import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });

test('派单详情忽略旧只读检查字段，中英文都不显示只读标识或违规', async () => {
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: 'Research', boundary: 'Scratch directory', criteria: 'Report findings' } },
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
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!String(input).endsWith('/api/get-dispatch')) return response;
    const body = await response.json();
    body.result.readOnlyCheck = { status: 'violated', paths: ['unexpected file.txt'], projectDirectory: true };
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
  window.history.replaceState(null, '', `/works/${work.id}?inspect=card:${dispatch.cardId}`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  fireEvent.click(await within(inspector).findByText('派单详情', { selector: 'summary' }));
  await within(inspector).findByRole('region', { name: '最终回答' });
  expect(inspector.textContent).not.toMatch(/只读|违规/);
  expect(within(inspector).getAllByText('临时目录').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(inspector.textContent).not.toMatch(/read.only|violation/i);
});
