import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../src/App.js';
import type { FakeScript, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: 'Inspect changes', boundary: 'Local', criteria: 'Readable patch' }, check: ok };
async function setup(executor: FakeScript) {
  daemon = await uiFixture([[draft], [
    { type: 'tool', name: 'create-card', arguments: { key: 'card', content: 'Card changes' }, saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'execute', agentId: 'claude-executor' }), check: ok },
  ]], undefined, { executorScripts: [executor] });
  const start = async () => {
    const work = (await daemon!.call('send-message', { projectId: daemon!.project.id, key: 'start', body: 'Inspect a card' })).result.work;
    const description = (await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result[0];
    await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
    ok(await daemon!.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
    const dispatch = (await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'ended')).result[0];
    expect(dispatch.endReason).toBe('completed');
    window.history.replaceState(null, '', `/works/${work.id}?inspect=card:${dispatch.cardId}`);
    return work;
  };
  return { start };
}

test('真实卡片成果列出增删、重命名和二进制；点击文件按需读取对应 patch，原文读取与双语保留', async () => {
  const fixture = await setup(ctx => {
    rmSync(join(ctx.options.cwd, 'before.txt'));
    renameSync(join(ctx.options.cwd, 'old name.txt'), join(ctx.options.cwd, 'new name.txt'));
    writeFileSync(join(ctx.options.cwd, 'image.bin'), Buffer.from([0, 1, 2]));
    return [{ type: 'write', path: 'README.md', content: 'updated\nsecond\n' }, { type: 'write', path: 'feature.txt', content: 'feature\n' }];
  });
  writeFileSync(join(daemon!.repo, 'before.txt'), 'delete me\n');
  writeFileSync(join(daemon!.repo, 'old name.txt'), 'unchanged\n'.repeat(8));
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon!.repo, ...args], { stdio: 'ignore' });
  git('add', 'before.txt', 'old name.txt'); git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'baseline files');
  const work = await fixture.start();
  const requests: { path?: string; artifactId: string }[] = [];
  const transport: typeof fetch = (input, init) => {
    if (String(input).endsWith('/api/read-artifact')) requests.push(JSON.parse(String(init?.body)));
    return fetch(input, init);
  };
  const view = render(<App baseUrl={daemon!.url} transport={transport} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  expect(await within(inspector).findByRole('heading', { name: '成果 · 5 个文件' })).toBeTruthy();
  const files = within(inspector).getByRole('list', { name: '文件变更' });
  const rows = within(files).getAllByRole('listitem');
  expect(rows.map(row => row.textContent)).toContain('README.md+2−1');
  expect(rows.map(row => row.textContent)).toContain('before.txt+0−1');
  expect(rows.map(row => row.textContent)).toContain('old name.txt → new name.txt+0−0');
  expect(rows.map(row => row.textContent)).toContain('image.bin二进制');
  expect(requests).toHaveLength(0);
  fireEvent.click(within(files).getByRole('button', { name: '查看文件 diff：README.md' }));
  const patch = await within(inspector).findByLabelText('文件 patch：README.md');
  expect(patch.textContent).toContain('-baseline\n+updated\n+second');
  expect(patch.textContent).not.toContain('+feature');
  expect([...new Set(requests.map(request => request.path))]).toEqual(['README.md']);
  fireEvent.click(within(files).getByRole('button', { name: '查看文件 diff：before.txt' }));
  expect((await within(inspector).findByLabelText('文件 patch：before.txt')).textContent).toContain('-delete me');
  fireEvent.click(within(files).getByRole('button', { name: '查看文件 diff：new name.txt' }));
  expect((await within(inspector).findByLabelText('文件 patch：new name.txt')).textContent).toContain('rename from old name.txt');
  fireEvent.click(within(inspector).getByText('已保存的文件与测试输出', { selector: 'summary' }));
  fireEvent.click(within(inspector).getByRole('button', { name: '读取成果：feature.txt' }));
  expect((await within(inspector).findByLabelText('feature.txt')).textContent).toBe('feature\n');
  const dispatch = (await daemon!.call('list-dispatches', { workId: work.id })).result[0];
  const branch = (await daemon!.call('get-dispatch-artifacts', { workId: work.id, dispatchId: dispatch.id })).result.find((artifact: any) => artifact.kind === 'branch');
  expect((await daemon!.call('read-artifact', { workId: work.id, artifactId: branch.id, path: '../README.md' })).status).toBe(400);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(inspector).getByRole('list', { name: 'Changed files' })).toBeTruthy();
  expect(within(inspector).getByText('Binary')).toBeTruthy();
  expect(inspector.textContent).not.toMatch(/[\u3400-\u9fff]/);
  view.unmount();
  ok(await daemon!.call('cancel-card', { workId: work.id, cardId: dispatch.cardId, reason: 'Fixture cleanup' }));
  const cleaned = render(<App baseUrl={daemon!.url} />);
  expect(await screen.findByText('The copy or card branch is unavailable; showing the saved commits.')).toBeTruthy();
  expect(await screen.findByRole('list', { name: 'Changed files' })).toBeTruthy();
  cleaned.unmount();
  const moved = `${daemon!.repo}-moved`;
  renameSync(daemon!.repo, moved);
  try {
    render(<App baseUrl={daemon!.url} />);
    expect(await screen.findByText('The project repository was removed or is unavailable. Cannot read the diff.')).toBeTruthy();
    renameSync(moved, daemon!.repo);
    fireEvent.click(screen.getByRole('button', { name: /^(Reload|重新读取)$/ }));
    expect(await screen.findByRole('list', { name: /Changed files|文件变更/ })).toBeTruthy();
  } finally { try { renameSync(moved, daemon!.repo); } catch {} }
});

test('文件列表和大 patch 超限时明确截断，切换语言后保持文件 patch 和提示', async () => {
  const fixture = await setup(ctx => {
    for (let index = 0; index < 205; index++) writeFileSync(join(ctx.options.cwd, `${String(index).padStart(3, '0')}.txt`), 'file\n');
    writeFileSync(join(ctx.options.cwd, '000-large.txt'), 'large patch '.repeat(50_000));
    return [];
  });
  await fixture.start(); render(<App baseUrl={daemon!.url} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  expect(await within(inspector).findByRole('heading', { name: '成果 · 前 200 个文件' })).toBeTruthy();
  expect(within(inspector).getByText('文件列表已截断：最多 200 个文件、摘要 128 KiB、单路径 4096 字节。')).toBeTruthy();
  expect(within(within(inspector).getByRole('list', { name: '文件变更' })).getAllByRole('listitem')).toHaveLength(200);
  fireEvent.click(within(inspector).getByRole('button', { name: '查看文件 diff：000-large.txt' }));
  expect(await within(inspector).findByText('patch 已截断，只显示前 256 KiB。')).toBeTruthy();
  const patch = within(inspector).getByLabelText('文件 patch：000-large.txt');
  expect(new TextEncoder().encode(patch.textContent!).length).toBeLessThanOrEqual(256 * 1024);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(inspector).getByText('Patch truncated to the first 256 KiB.')).toBeTruthy();
  expect(within(inspector).getByLabelText('File patch：000-large.txt')).toBe(patch);
});

test('没有代码改动时显示空态，不提供不可用的 diff 入口', async () => {
  const fixture = await setup([]); await fixture.start(); render(<App baseUrl={daemon!.url} />);
  const inspector = await screen.findByRole('complementary', { name: '卡片检查器' });
  expect(await within(inspector).findByText('此卡片没有代码改动。')).toBeTruthy();
  expect(within(inspector).queryByRole('button', { name: '查看 diff' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(inspector).getByText('This card has no code changes.')).toBeTruthy();
});
