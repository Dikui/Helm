import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { App } from '../src/App.js';
const { uiFixture }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
const { FakeDriver }: typeof import('../../src/driver.js') = await import('../../dist/src/' + 'driver.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
// jsdom has no native dialog implementation. Substitute only the platform API.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); });
const change = (label: string, value: string) => {
  const field = screen.queryByLabelText(label, { selector: 'input,select,textarea' });
  if (field) fireEvent.change(field, { target: { value } });
  else fireEvent.click(screen.getByLabelText(label, { selector: 'fieldset' }).querySelector(`input[value="${value}"]`)!);
};
const fieldValue = (label: string) => {
  const field = screen.getByLabelText(label) as HTMLInputElement;
  return field.tagName === 'FIELDSET' ? (field.querySelector('input:checked') as HTMLInputElement)?.value : field.value;
};
const expandProject = (project: HTMLElement) => { fireEvent.click(within(project).getByText('项目设置', { selector: 'summary' })); return project; };
const agent = async (id: string) => (await daemon!.call('list-agents')).result.find((item: any) => item.id === id);

test('设置页按角色显示可用性与使用数，保存 Agent 并以新 id 复制，API 主目录只显示配置提示', async () => {
  daemon = await uiFixture();
  const skills = join(daemon.directory, 'agents', 'claude-executor', 'skills');
  await mkdir(skills);
  await writeFile(join(skills, 'SKILL.md'), '技能正文');
  const source = join(daemon.directory, 'library-skill');
  await mkdir(source);
  await writeFile(join(source, 'SKILL.md'), '共享技能');
  expect((await daemon.call('install-skill', { path: source })).ok).toBe(true);
  expect((await daemon.call('register-mcp', { name: 'remote', config: { type: 'http', url: 'https://tools.example.invalid/mcp' } })).ok).toBe(true);
  const original = await agent('claude-executor');
  expect((await daemon.call('save-agent', { id: original.id, mode: 'update', baseRevision: original.revision,
    config: { ...original.config, skills: ['library-skill'], mcp: ['remote'] }, prompt: original.prompt })).ok).toBe(true);
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  expect(screen.getByRole('region', { name: '调度者' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '执行者' })).toBeTruthy();
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
  expect(saved.config.skills).toEqual(['library-skill']);
  expect(saved.config.mcp).toEqual(['remote']);
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
  expect(copy.config.skills).toEqual(['library-skill']);
  expect(copy.config.mcp).toEqual(['remote']);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('region', { name: 'Coordinators' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Executors' })).toBeTruthy();
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
  const project = expandProject(await screen.findByRole('form', { name: `项目 ${daemon.project.name}` }));
  expect(await within(project).findByText('1 项工作')).toBeTruthy();
  expect((within(project).getByRole('button', { name: '删除项目' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(project).getByText('请先删除此项目下的所有工作，再删除项目登记。')).toBeTruthy();
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
  const emptyProject = expandProject(screen.getByRole('form', { name: '项目 新项目' }));
  const remove = within(emptyProject).getByRole('button', { name: '删除项目' }) as HTMLButtonElement;
  await waitFor(() => expect(remove.disabled).toBe(false));
  expect(within(emptyProject).getByText('只删除项目登记，磁盘上的仓库和文件会保留。')).toBeTruthy();
  fireEvent.click(remove);
  expect(remove.disabled).toBe(true);
  await screen.findByText('项目已删除');
  await waitFor(() => expect(screen.queryByRole('form', { name: '项目 新项目' })).toBeNull());
  expect((await daemon.call('list-projects')).result.map((item: any) => item.id)).toEqual([daemon.project.id]);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect((within(project).getByRole('button', { name: 'Delete project' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(project).getByText('Delete all works in this project before removing its registration.')).toBeTruthy();
});

test('项目删除遇到新增工作的竞争时显示服务端错误并保留项目', async () => {
  daemon = await uiFixture();
  const transport: typeof fetch = async (url, options) => {
    if (String(url).endsWith('/api/delete-project')) {
      expect((await daemon!.call('send-message', { projectId: daemon!.project.id, body: '并发新增工作', key: 'delete-race' })).ok).toBe(true);
    }
    return fetch(url, options);
  };
  window.history.replaceState(null, '', '/settings/projects');
  render(<App baseUrl={daemon.url} transport={transport} />);
  const project = expandProject(await screen.findByRole('form', { name: `项目 ${daemon.project.name}` }));
  const remove = within(project).getByRole('button', { name: '删除项目' }) as HTMLButtonElement;
  await waitFor(() => expect(remove.disabled).toBe(false));
  fireEvent.click(remove);
  expect((await within(project).findByRole('alert')).textContent).toContain('项目下还有 1 项工作，请先删除这些工作');
  await waitFor(() => expect(remove.disabled).toBe(true));
  expect((await daemon.call('list-projects')).result[0].id).toBe(daemon.project.id);
});

test('保存后的 reload 取消事件触发的刷新，不会断开实时更新', async () => {
  daemon = await uiFixture();
  let streams = 0;
  let reads = 0;
  // Slow later reads so the event-driven refresh is still in flight when the delete response triggers reload().
  const transport: typeof fetch = async (url, options) => {
    if (String(url).endsWith('/events')) streams++;
    if (String(url).endsWith('/api/list-projects') && reads++ > 0) await new Promise(resolve => setTimeout(resolve, 300));
    return fetch(url, options);
  };
  window.history.replaceState(null, '', '/settings/projects');
  render(<App baseUrl={daemon.url} transport={transport} />);
  await screen.findByText('实时更新已连接');
  const remove = within(expandProject(await screen.findByRole('form', { name: `项目 ${daemon.project.name}` }))).getByRole('button', { name: '删除项目' }) as HTMLButtonElement;
  await waitFor(() => expect(remove.disabled).toBe(false));
  fireEvent.click(remove);
  await screen.findByText('项目已删除');
  await new Promise(resolve => setTimeout(resolve, 1_000));
  expect(screen.queryByText('连接已断开，正在重连…')).toBeNull();
  expect(streams).toBe(1);
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
    expect(fieldValue(label!)).toBe(value);
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

test('模型和推理强度从 CLI 报出的选项中选择，换模型时只保留新模型支持的强度', async () => {
  const codexDriver = Object.assign(new FakeDriver(), { listModels: async () => [
    { id: null, label: 'Sol', efforts: ['low', 'ultra'], defaultEffort: 'low' },
    { id: 'gpt-sol', label: 'Sol', efforts: ['low', 'ultra'], defaultEffort: 'low' },
    { id: 'gpt-luna', label: 'Luna', efforts: ['low', 'medium'], defaultEffort: 'medium' },
  ] });
  daemon = await uiFixture([], undefined, { codexDriver });
  window.history.replaceState(null, '', '/settings/agents/codex-executor');
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('form', { name: 'Agent 详情' });
  const model = await screen.findByLabelText('模型', { selector: 'select' }) as HTMLSelectElement;
  expect([...model.options].map(option => option.textContent)).toEqual(['驱动默认', 'gpt-6-luna · CLI 未提供', 'Sol (gpt-sol)', 'Luna (gpt-luna)']);
  change('模型', 'gpt-sol');
  const effort = screen.getByLabelText('推理强度', { selector: 'fieldset' });
  expect(fieldValue('推理强度')).toBe('low');
  change('推理强度', 'ultra');
  change('模型', 'gpt-luna');
  expect(fieldValue('推理强度')).toBe('medium');
  expect(within(effort).getAllByRole('radio').map(option => (option as HTMLInputElement).value)).toEqual(['', 'low', 'medium']);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存');
  const saved = JSON.parse(await readFile(join(daemon.directory, 'agents', 'codex-executor', 'config.json'), 'utf8'));
  expect([saved.model, saved.reasoningEffort]).toEqual(['gpt-luna', 'medium']);
});

test('Agent 外部编辑入口保留直接编辑和草稿，等待时禁用并显示启动失败原文，可重试', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const calls: { command: string; args: string[] }[] = [];
  let fail = true;
  daemon = await uiFixture([], undefined, { promptEditor: { platform: 'darwin', async launch(command, args) {
    calls.push({ command, args });
    if (fail) { await wait; throw new Error('editor unavailable: 原始错误 ENOENT'); }
  } } });
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  const editor = await screen.findByRole('form', { name: 'Agent 详情' });
  const prompt = within(editor).getByLabelText('附加提示词（可选）') as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: '界面里未保存的提示词' } });
  const open = within(editor).getByRole('button', { name: '在编辑器中打开' });
  fireEvent.click(open);
  expect((open as HTMLButtonElement).disabled).toBe(true);
  release();
  expect((await within(editor).findByRole('alert')).textContent).toContain('editor unavailable: 原始错误 ENOENT');
  expect(prompt.value).toBe('界面里未保存的提示词');
  expect((await agent('claude-executor')).prompt).not.toBe(prompt.value);
  fail = false;
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toEqual({ command: 'open', args: ['-t', join(daemon!.directory, 'agents', 'claude-executor', 'prompt.md')] });
  expect(prompt.value).toBe('界面里未保存的提示词');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(editor).getByRole('button', { name: 'Open in editor' })).toBeTruthy();
});
