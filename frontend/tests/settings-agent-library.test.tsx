import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });
const agent = async (id = 'claude-executor') => (await daemon!.call('list-agents')).result.find((item: any) => item.id === id);
async function installSkill(name: string) {
  const path = join(daemon!.directory, name);
  await mkdir(path);
  await writeFile(join(path, 'SKILL.md'), '共享技能');
  expect((await daemon!.call('install-skill', { path })).ok).toBe(true);
}

test('Agent 自带 skill 只读，勾选库 skill 和 MCP 保存到 config.json，重开后可取消选择', async () => {
  daemon = await uiFixture();
  await installSkill('shared-skill');
  expect((await daemon.call('register-mcp', { name: 'remote', config: { type: 'http', url: 'https://tools.example.invalid/mcp' } })).ok).toBe(true);
  expect((await daemon.call('register-mcp', { name: 'local', config: { type: 'stdio', command: 'test-mcp' } })).ok).toBe(true);
  const own = join(daemon.directory, 'agents', 'claude-executor', 'skills', 'shared-skill');
  await mkdir(own, { recursive: true }); await writeFile(join(own, 'SKILL.md'), '自带技能');
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  const ownSkills = within(editor).getByRole('group', { name: 'Agent 自带 skill · skills/' });
  expect(within(ownSkills).getByText('shared-skill/')).toBeTruthy();
  expect(within(ownSkills).queryByRole('checkbox')).toBeNull();
  const skills = await within(editor).findByRole('group', { name: '库 skill' });
  const mcp = within(editor).getByRole('group', { name: '库 MCP' });
  fireEvent.click(await within(skills).findByRole('checkbox', { name: 'shared-skill' }));
  fireEvent.click(within(mcp).getByRole('checkbox', { name: 'remote' }));
  fireEvent.click(within(mcp).getByRole('checkbox', { name: 'local' }));
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await within(editor).findByText('已保存');
  const warning = /库 skill shared-skill.*自带.*同名.*覆盖/;
  expect(await within(editor).findByText(warning)).toBeTruthy();
  const row = screen.getByRole('link', { name: /claude-executor.*可用/ });
  expect(within(row).getByText(warning)).toBeTruthy();
  const path = join(daemon.directory, 'agents', 'claude-executor', 'config.json');
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ skills: ['shared-skill'], mcp: ['remote', 'local'] });
  cleanup(); render(<App baseUrl={daemon.url} />);
  const selected = await screen.findByRole('checkbox', { name: 'shared-skill' }) as HTMLInputElement;
  expect(selected.checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: 'remote' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(selected);
  fireEvent.click(screen.getByRole('checkbox', { name: 'remote' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'local' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ skills: [], mcp: [] });
});

test('修复失效库引用后展示全局重名警告，复制提示说明并保留当前库选择', async () => {
  daemon = await uiFixture();
  await installSkill('common'); await installSkill('extra-skill');
  expect((await daemon.call('register-mcp', { name: 'common', config: { type: 'http', url: 'https://tools.example.invalid/mcp' } })).ok).toBe(true);
  const own = join(daemon.directory, 'agents', 'claude-executor', 'skills', 'private-skill');
  await mkdir(own, { recursive: true }); await writeFile(join(own, 'SKILL.md'), '自带技能');
  await mkdir(join(daemon.directory, 'home', '.claude', 'skills', 'common'), { recursive: true });
  const original = await agent();
  expect((await daemon.call('save-agent', { id: original.id, mode: 'update', baseRevision: original.revision,
    config: { ...original.config, skills: ['gone-skill'], mcp: ['gone-mcp'] }, prompt: '复制这段附加提示词' })).ok).toBe(true);
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  for (const name of ['gone-skill', 'gone-mcp']) {
    const missing = await within(editor).findByRole('checkbox', { name: `${name} 不可用` }) as HTMLInputElement;
    expect(missing.checked).toBe(true);
    expect(missing.disabled).toBe(false);
    fireEvent.click(missing);
  }
  for (const name of ['库 skill', '库 MCP']) {
    fireEvent.click(within(within(editor).getByRole('group', { name })).getByRole('checkbox', { name: 'common' }));
  }
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await within(editor).findByText('已保存');
  const warning = await within(editor).findByText(/库 skill common 与全局 skill 目录.*同名/);
  expect(warning.textContent).toContain('此警告不影响 Agent 可用性');
  expect((await agent()).available).toBe(true);
  expect(within(editor).queryByRole('checkbox', { name: /gone-skill|gone-mcp/ })).toBeNull();
  const hint = '复制配置（含库选择）和 prompt.md，不复制 Agent 自带 skills/';
  const hintNode = within(editor).getByText(hint);
  const duplicate = within(editor).getByRole('button', { name: '复制为新 Agent' });
  expect(duplicate.getAttribute('aria-describedby')).toBe(hintNode.id);
  // Copy the current selection even when the latest edit has not been saved yet.
  fireEvent.click(within(editor).getByRole('checkbox', { name: 'extra-skill' }));
  fireEvent.click(duplicate);
  await waitFor(() => expect(window.location.pathname).toBe('/settings/new-agent'));
  const copyEditor = screen.getByRole('form', { name: 'Agent 详情' });
  expect(within(copyEditor).getByText(hint)).toBeTruthy();
  expect(within(copyEditor).queryByText('private-skill/')).toBeNull();
  const copySkills = within(copyEditor).getByRole('group', { name: '库 skill' });
  const copyMcp = within(copyEditor).getByRole('group', { name: '库 MCP' });
  expect((await within(copySkills).findByRole('checkbox', { name: 'common' }) as HTMLInputElement).checked).toBe(true);
  expect((within(copySkills).getByRole('checkbox', { name: 'extra-skill' }) as HTMLInputElement).checked).toBe(true);
  expect((within(copyMcp).getByRole('checkbox', { name: 'common' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(within(copyEditor).getByLabelText('Agent id'), { target: { value: 'library-copy' } });
  fireEvent.click(within(copyEditor).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(window.location.pathname).toBe('/settings/agents/library-copy'));
  expect(await agent('library-copy')).toMatchObject({ skills: [], prompt: '复制这段附加提示词', available: true,
    config: { skills: ['common', 'extra-skill'], mcp: ['common'] } });
  expect((await agent()).config.skills).toEqual(['common']);
  expect(JSON.parse(await readFile(join(daemon.directory, 'agents', 'library-copy', 'config.json'), 'utf8')))
    .toMatchObject({ skills: ['common', 'extra-skill'], mcp: ['common'] });
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('group', { name: 'Library skills' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Library MCP' })).toBeTruthy();
  expect(screen.getByText('Copy config (including library selections) and prompt.md; Agent-owned skills/ are not copied')).toBeTruthy();
});
