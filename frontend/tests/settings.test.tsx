import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
// jsdom has no native dialog implementation. Substitute only the platform API.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { selector: 'input,select,textarea' }), { target: { value } });
const agent = async (id: string) => (await daemon!.call('list-agents')).result.find((item: any) => item.id === id);

test('设置页按角色显示可用性与使用数，保存 Agent 并以新 id 复制，API 主目录只显示配置提示', async () => {
  daemon = await uiFixture();
  const skills = join(daemon.directory, 'agents', 'claude-executor', 'skills');
  await mkdir(skills);
  await writeFile(join(skills, 'SKILL.md'), '技能正文');
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  expect(screen.getByRole('region', { name: '调度者' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '执行者 Agent' })).toBeTruthy();
  expect(screen.getAllByText('可用').length).toBeGreaterThan(0);
  expect(screen.getAllByText('0 个运行中派单 · 0 项未结束工作').length).toBeGreaterThan(0);
  expect(screen.getByText('SKILL.md')).toBeTruthy();
  expect((screen.getByLabelText('角色') as HTMLSelectElement).disabled).toBe(true);
  change('职责说明', '维护测试覆盖');
  change('模型', 'test-model');
  change('推理强度', 'high');
  change('驱动', 'codex');
  fireEvent.click(screen.getByLabelText('fast'));
  change('附加提示词（可选）', '保留原文策略');
  const revision = (await agent('claude-executor')).revision;
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  const saved = await agent('claude-executor');
  expect(saved.description).toBe('维护测试覆盖');
  expect(saved.prompt).toBe('保留原文策略');
  expect(saved.model).toBe('test-model');
  expect(saved.reasoningEffort).toBe('high');
  expect(saved.driver).toBe('codex');
  expect(saved.fast).toBe(true);
  expect(saved.revision).not.toBe(revision);
  fireEvent.click(screen.getByRole('button', { name: '复制为新 Agent' }));
  change('Agent id', 'claude-executor');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Agent id').getAttribute('aria-invalid')).toBe('true');
  expect((await agent('claude-executor')).revision).toBe(saved.revision);
  change('Agent id', 'api-copy');
  change('计费方式', 'dedicated');
  expect(screen.getByText(/~\/.helm\/agent-homes\/api-copy\//)).toBeTruthy();
  expect((screen.getByLabelText('角色') as HTMLSelectElement).disabled).toBe(false);
  change('角色', 'coordinator');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(window.location.pathname).toBe('/settings/agents/api-copy'));
  const copy = await agent('api-copy');
  expect(copy.prompt).toBe(saved.prompt);
  expect(copy.billing).toBe('api');
  expect(copy.role).toBe('coordinator');
  expect(copy.skills).toEqual([]);
});

test('删除 Agent 须二次确认，删除后回到列表；项目默认调度者的 Agent 拒绝删除并显示原因', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('form', { name: 'Agent 详情' });
  fireEvent.click(screen.getByRole('button', { name: '删除 Agent' }));
  const dialog = await screen.findByRole('dialog', { name: '删除 Agent' });
  expect(await agent('claude-executor')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认删除 Agent' }));
  await waitFor(() => expect(window.location.pathname).toBe('/settings/agents'));
  expect(await agent('claude-executor')).toBeUndefined();
  await waitFor(() => expect(screen.queryByText('claude-executor')).toBeNull());
  window.history.pushState(null, '', '/settings/agents/claude-coordinator');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await screen.findByRole('heading', { name: 'claude-coordinator' });
  fireEvent.click(screen.getByRole('button', { name: '删除 Agent' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: '删除 Agent' })).getByRole('button', { name: '确认删除 Agent' }));
  expect((await screen.findByRole('alert')).textContent).toContain('1 个项目的默认调度者');
  expect(await agent('claude-coordinator')).toBeTruthy();
});

test('不可用原因直接显示，字段错误不清空输入，文件冲突须重新载入后保存', async () => {
  daemon = await uiFixture();
  const configPath = join(daemon.directory, 'agents', 'claude-executor', 'config.json');
  const existing = await agent('claude-executor');
  const config = { role: existing.role, driver: existing.driver, model: existing.model, reasoningEffort: existing.reasoningEffort,
    fast: true, home: existing.home, description: existing.description };
  await writeFile(configPath, JSON.stringify(config));
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('form', { name: 'Agent 详情' });
  expect(screen.getAllByText(/Claude fast 在订阅下/).length).toBeGreaterThan(0);
  change('职责说明', '');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(screen.getByLabelText('职责说明').getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('请填写此项。')).toBeTruthy();
  change('职责说明', '尚未保存的输入');
  await writeFile(configPath, JSON.stringify({ ...config, description: '外部编辑的内容' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Agent 文件已被修改');
  expect((screen.getByLabelText('职责说明') as HTMLTextAreaElement).value).toBe('尚未保存的输入');
  expect((await agent('claude-executor')).description).toBe('外部编辑的内容');
  fireEvent.click(screen.getByRole('button', { name: '重新载入 Agent' }));
  await waitFor(() => expect((screen.getByLabelText('职责说明') as HTMLTextAreaElement).value).toBe('外部编辑的内容'));
  fireEvent.click(screen.getByLabelText('fast'));
  change('职责说明', '重新载入后保存');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  expect((await agent('claude-executor')).description).toBe('重新载入后保存');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('form', { name: 'Agent details' })).toBeTruthy();
  expect((screen.getByLabelText('Responsibilities') as HTMLTextAreaElement).value).toBe('重新载入后保存');
});

test('项目登记显示工作数，修改默认调度者 Agent 经 HTTP 生效', async () => {
  daemon = await uiFixture();
  await daemon.call('send-message', { projectId: daemon.project.id, body: '项目工作', key: 'project-work' });
  window.history.replaceState(null, '', '/settings/projects');
  render(<App baseUrl={daemon.url} />);
  const project = await screen.findByRole('form', { name: `项目 ${daemon.project.name}` });
  expect(await within(project).findByText('1 项工作')).toBeTruthy();
  const config = await agent('claude-coordinator');
  await daemon.call('save-agent', { id: 'second-coordinator', mode: 'create', prompt: config.prompt,
    config: { role: 'coordinator', driver: 'claude-sdk', model: null, reasoningEffort: null, fast: false, home: 'shared', description: '第二调度者' } });
  const select = within(project).getByLabelText('默认调度者 Agent');
  await waitFor(() => expect(within(select).getByRole('option', { name: 'second-coordinator' })).toBeTruthy());
  fireEvent.change(select, { target: { value: 'second-coordinator' } });
  fireEvent.click(within(project).getByRole('button', { name: '保存' }));
  await within(project).findByText('已保存');
  expect((await daemon.call('list-projects')).result[0].defaultCoordinatorAgentId).toBe('second-coordinator');
  const repo = join(daemon.directory, 'another-project');
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  change('项目名称（可选）', '新项目');
  change('项目路径', repo);
  fireEvent.click(screen.getByRole('button', { name: '登记项目' }));
  expect(await screen.findByRole('form', { name: '项目 新项目' })).toBeTruthy();
  const projects = (await daemon.call('list-projects')).result;
  expect(projects.find((item: any) => item.name === '新项目').path).toBe(repo);
});

test('运行设置校验后分别保存并发、派单和轮次看门狗及输出阈值，重新载入仍保留数值', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/runtime');
  render(<App baseUrl={daemon.url} />);
  const concurrency = await screen.findByRole('form', { name: '执行者并发上限' });
  change('执行者并发上限', '0');
  fireEvent.click(within(concurrency).getByRole('button', { name: '保存' }));
  expect(screen.getByText('请输入范围内的数值。')).toBeTruthy();
  expect((await daemon.call('get-settings')).result.concurrencyLimit).toBe(10);
  change('执行者并发上限', '3');
  fireEvent.click(within(concurrency).getByRole('button', { name: '保存' }));
  await within(concurrency).findByText('已保存');
  change('派单总时长', '12'); change('派单无输出', '4');
  const dispatch = screen.getByRole('form', { name: '派单看门狗' });
  fireEvent.click(within(dispatch).getByRole('button', { name: '保存' }));
  await within(dispatch).findByText('已保存');
  change('调度轮次总时长', '15'); change('调度轮次无输出', '5');
  const round = screen.getByRole('form', { name: '轮次看门狗' });
  fireEvent.click(within(round).getByRole('button', { name: '保存' }));
  await within(round).findByText('已保存');
  change('输出提示阈值', '0.5');
  const output = screen.getByRole('form', { name: '输出提示阈值' });
  fireEvent.click(within(output).getByRole('button', { name: '保存' }));
  await within(output).findByText('已保存');
  const settings = (await daemon.call('get-settings')).result;
  expect(settings).toMatchObject({ concurrencyLimit: 3, dispatchWallTimeoutMs: 720_000, dispatchIdleTimeoutMs: 240_000,
    roundTotalTimeoutMs: 900_000, roundIdleTimeoutMs: 300_000, outputThresholdBytes: 500_000_000 });
  cleanup(); render(<App baseUrl={daemon.url} />);
  await waitFor(() => expect((screen.getByLabelText('派单总时长') as HTMLInputElement).value).toBe('12'));
  expect((screen.getByRole('spinbutton', { name: '输出提示阈值' }) as HTMLInputElement).value).toBe('0.5');
});

test('新建 Agent 使用独立路由，允许 id 为 new；离开未保存 Agent 时可继续编辑', async () => {
  daemon = await uiFixture();
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('form', { name: 'Agent 详情' });
  change('职责说明', '未保存的职责');
  fireEvent.click(within(screen.getByRole('navigation', { name: '设置' })).getByRole('link', { name: '项目' }));
  expect(window.location.pathname).toBe('/settings/agents/claude-executor');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((screen.getByLabelText('职责说明') as HTMLTextAreaElement).value).toBe('未保存的职责');
  fireEvent.click(screen.getByRole('link', { name: '新建 Agent' }));
  fireEvent.click(screen.getByRole('button', { name: '丢弃并继续' }));
  change('Agent id', 'new'); change('职责说明', '新 Agent'); change('附加提示词（可选）', '新策略');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(window.location.pathname).toBe('/settings/agents/new'));
  expect((screen.getByLabelText('Agent id') as HTMLInputElement).value).toBe('new');
  expect((screen.getByLabelText('角色') as HTMLSelectElement).disabled).toBe(true);
  expect((await agent('new')).prompt).toBe('新策略');
});


test.each(['刚保存', '未保存'])('%s后复制 Agent 使用编辑器全部当前值，副本保存不回退', async mode => {
  daemon = await uiFixture();
  const original = await agent('claude-executor');
  // Keep the list stale after saving to exercise copying before its refresh arrives.
  const entries = (await daemon.call('list-agents')).result;
  const transport: typeof fetch = (input, init) => String(input).endsWith('/api/list-agents')
    ? Promise.resolve(new Response(JSON.stringify({ ok: true, result: entries }), { headers: { 'content-type': 'application/json' } }))
    : fetch(input, init);
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} transport={transport} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  change('职责说明', '当前职责'); change('模型', 'current-model'); change('驱动', 'codex');
  change('推理强度', 'high'); change('计费方式', 'dedicated'); change('附加提示词（可选）', '当前策略');
  fireEvent.click(screen.getByLabelText('fast'));
  if (mode === '刚保存') {
    const save = within(editor).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await within(editor).findByText('已保存');
  }
  const duplicate = within(editor).getByRole('button', { name: '复制为新 Agent' }) as HTMLButtonElement;
  await waitFor(() => expect(duplicate.disabled).toBe(false));
  fireEvent.click(duplicate);
  await waitFor(() => expect(window.location.pathname).toBe('/settings/new-agent'));
  for (const [label, value] of [['职责说明', '当前职责'], ['模型', 'current-model'], ['驱动', 'codex'],
    ['推理强度', 'high'], ['计费方式', 'dedicated'], ['角色', 'executor'], ['附加提示词（可选）', '当前策略']]) {
    expect((screen.getByLabelText(label!) as HTMLInputElement).value).toBe(value);
  }
  expect((screen.getByLabelText('fast') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Agent id') as HTMLInputElement).value).toBe('');
  change('Agent id', 'current-copy');
  const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(window.location.pathname).toBe('/settings/agents/current-copy'));
  expect(await agent('current-copy')).toMatchObject({ description: '当前职责', model: 'current-model',
    driver: 'codex', reasoningEffort: 'high', fast: true, home: 'dedicated', role: 'executor', prompt: '当前策略' });
  expect((await agent('claude-executor')).description).toBe(mode === '刚保存' ? '当前职责' : original.description);
});
