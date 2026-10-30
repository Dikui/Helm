import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { gitInitializationFixture }: typeof import('../../tests/fixtures/git-initialization.js') = await import('../../dist/tests/fixtures/' + 'git-initialization.js');
const { until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let fixture: Awaited<ReturnType<typeof gitInitializationFixture>> | undefined;
afterEach(async () => {
  cleanup();
  await fixture?.daemon.close();
  fixture = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

test('工作对话显示文件概况和建议忽略规则，初始化失败保留编辑，重试后提交并唤醒调度者', async () => {
  fixture = await gitInitializationFixture();
  const { daemon, work, projectPath } = fixture;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const gate = await within(chat).findByRole('group', { name: '初始化 git' });
  expect(within(gate).getByText('预计提交文件数')).toBeTruthy();
  expect(within(gate).getByText('预计总大小')).toBeTruthy();
  expect(within(gate).getByText('.env', { selector: 'code' })).toBeTruthy();
  expect(within(gate).getByText('node_modules/', { selector: 'code' })).toBeTruthy();
  const rules = within(gate).getByLabelText('忽略规则') as HTMLTextAreaElement;
  expect(rules.value).toContain('/.env');
  expect(rules.value).toContain('/node_modules/');
  expect((within(gate).getByRole('button', { name: '拒绝初始化' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(rules, { target: { value: '*\n' } });
  fireEvent.click(within(gate).getByRole('button', { name: '同意并初始化' }));
  await within(gate).findByRole('alert');
  expect(rules.value).toBe('*\n');
  expect(existsSync(join(projectPath, '.git'))).toBe(false);
  fireEvent.change(rules, { target: { value: '.env\nnode_modules/\n' } });
  fireEvent.click(within(gate).getByRole('button', { name: '同意并初始化' }));
  await within(chat).findByText('git 已初始化，卡片已解除这项阻塞，可重新派单。');
  await within(chat).findByText('已收到初始化 git 的决定。');
  expect(await readFile(join(projectPath, '.gitignore'), 'utf8')).toBe('.env\nnode_modules/\n');
  const files = execFileSync('git', ['-C', projectPath, 'ls-tree', '--name-only', 'HEAD'], { encoding: 'utf8' });
  expect(files.trim().split('\n')).toEqual(['.gitignore', 'README.md']);
  expect(within(chat).queryByRole('alert')).toBeNull();
});

test('收件箱中英文同步，拒绝须有原因且卡片保持阻塞，工作对话保留拒绝记录', async () => {
  fixture = await gitInitializationFixture();
  const { daemon, work } = fixture;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const sidebar = screen.getByRole('complementary', { name: 'Helm' });
  const toggle = await within(sidebar).findByRole('button', { name: '展开详情' });
  fireEvent.click(toggle);
  await within(sidebar).findByRole('group', { name: '初始化 git' });
  fireEvent.click(within(sidebar).getByRole('button', { name: /^EN$/ }));
  const gate = await within(sidebar).findByRole('group', { name: 'Initialize git' });
  expect(within(gate).getByText('Estimated files to commit')).toBeTruthy();
  expect(within(gate).getByText(/May contain secrets/)).toBeTruthy();
  fireEvent.change(within(gate).getByLabelText('Comment (required to refuse)'), { target: { value: 'Keep this directory outside git' } });
  fireEvent.click(within(gate).getByRole('button', { name: 'Refuse initialization' }));
  const chat = screen.getByRole('region', { name: 'Chat' });
  await within(chat).findByText('Initialization was refused. The card stays blocked; the coordinator can make it read-only or cancel it.');
  await within(chat).findByText('Keep this directory outside git');
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[2]?.status === 'ended');
  const graph = (await daemon.call('get-card-graph', { workId: work.id })).result;
  expect(graph.find((node: any) => node.type === 'card').status).toBe('waiting');
  expect((await daemon.call('list-pending')).result).toEqual([]);
});

test('已有 .gitignore 时两处关卡说明沿用文件，不显示可编辑规则，同意不改原文', async () => {
  fixture = await gitInitializationFixture(true);
  const { daemon, work, projectPath } = fixture;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const gate = await within(chat).findByRole('group', { name: '初始化 git' });
  expect(within(gate).getByText('已有 .gitignore，将按它提交，Helm 不会修改这个文件。')).toBeTruthy();
  expect(within(gate).queryByLabelText('忽略规则')).toBeNull();
  fireEvent.click(within(gate).getByRole('button', { name: '同意并初始化' }));
  await waitFor(() => expect(within(chat).getByText('git 已初始化，卡片已解除这项阻塞，可重新派单。')).toBeTruthy());
  expect(await readFile(join(projectPath, '.gitignore'), 'utf8')).toBe('.env\nnode_modules/\n');
});
