import { afterEach, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
const { copyAgents, configureTestAgent }: typeof import('../../tests/helmd-fixture.js') = await import('../../dist/tests/' + 'helmd-fixture.js');
const { FakeDriver }: typeof import('../../src/driver.js') = await import('../../dist/src/' + 'driver.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
let agentDirectory: string | undefined;
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  if (agentDirectory) await rm(agentDirectory, { recursive: true, force: true });
  agentDirectory = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

test('选项目默认 Agent 创建工作：响应丢失后重试沿用完整请求，只有一项工作并进入对齐中', async () => {
  agentDirectory = await mkdtemp(join(tmpdir(), 'helm-new-work-retry-'));
  const agentDir = await copyAgents(agentDirectory);
  daemon = await uiFixture([], undefined, { agentDir });
  await daemon.call('set-project-coordinator-agent', { projectId: daemon.project.id, agentId: 'codex-coordinator' });
  const realFetch = fetch;
  const submissions: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    const response = await realFetch(input, init);
    if (String(input).endsWith('/api/send-message')) {
      submissions.push(JSON.parse(String(init?.body)));
      if (submissions.length === 1) { await response.text(); throw new Error('响应丢失，请重试'); }
    }
    return response;
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  const agent = await screen.findByLabelText('调度者 Agent');
  await waitFor(() => expect((agent as HTMLSelectElement).value).toBe('codex-coordinator'));
  const base = await screen.findByLabelText('基准分支');
  await waitFor(() => expect((base as HTMLSelectElement).value).toBe('main'));
  fireEvent.change(screen.getByLabelText('需求'), { target: { value: '邮箱验证码登录' } });
  fireEvent.keyDown(screen.getByLabelText('需求'), { key: 'Enter', isComposing: true, keyCode: 229 });
  expect((await daemon.call('list-works')).result).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  expect((await screen.findByRole('alert')).textContent).toContain('响应丢失，请重试');
  expect((screen.getByLabelText('需求') as HTMLTextAreaElement).value).toBe('邮箱验证码登录');
  expect((screen.getByLabelText('需求') as HTMLTextAreaElement).disabled).toBe(true);
  // A later availability change must not block replay of an already accepted request.
  await configureTestAgent(agentDir, 'codex-coordinator', { driver: 'grok' });
  await daemon.call('list-agents');
  await within(agent).findByRole('option', { name: /codex-coordinator · / });
  expect((screen.getByRole('button', { name: '重试发送' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '重试发送' }));
  expect(await screen.findByRole('heading', { name: '邮箱验证码登录' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '对话' })).toBeTruthy();
  const works = (await daemon.call('list-works')).result;
  expect(works).toHaveLength(1);
  expect((await daemon.call('get-work', { workId: works[0].id })).result.coordinatorAgentId).toBe('codex-coordinator');
  expect(submissions[0].key).toBeTruthy();
  expect(submissions[1]).toEqual(submissions[0]);
  expect(window.location.pathname).toBe(`/works/${works[0].id}`);
  expect(within(screen.getByRole('complementary', { name: 'Helm' })).getByText('对齐中')).toBeTruthy();
});

test('基准分支默认当前检出分支，可选择其他分支并用它创建对齐副本', async () => {
  daemon = await uiFixture();
  execFileSync('git', ['-C', daemon.repo, 'branch', 'release/1.0']);
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} />);
  const base = await screen.findByLabelText('基准分支');
  await waitFor(() => expect((base as HTMLSelectElement).value).toBe('main'));
  expect(within(base).getByRole('option', { name: 'main · 当前检出分支' })).toBeTruthy();
  fireEvent.change(base, { target: { value: 'release/1.0' } });
  fireEvent.change(screen.getByLabelText('需求'), { target: { value: '从发布分支开始' } });
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByRole('heading', { name: '从发布分支开始' });
  const work = (await daemon.call('list-works')).result[0];
  expect(work.baseRef).toBe('release/1.0');
  expect(await readFile(join(work.workPath, 'README.md'), 'utf8')).toBe('baseline\n');
  expect(await screen.findByText(/工作副本已创建；对齐阶段只读此副本/)).toBeTruthy();
});

test('基准加载、失败和空分支时不能开始，重试和刷新后可创建工作', async () => {
  daemon = await uiFixture();
  const realFetch = fetch;
  let failRead!: (error: Error) => void;
  const firstRead = new Promise<Response>((_resolve, reject) => { failRead = reject; });
  let held = false;
  const transport: typeof fetch = (input, init) => {
    if (!held && String(input).endsWith('/api/list-project-branches')) { held = true; return firstRead; }
    return realFetch(input, init);
  };
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} transport={transport} />);
  const base = await screen.findByLabelText('基准分支');
  expect((base as HTMLSelectElement).disabled).toBe(true);
  expect(within(base).getByRole('option', { name: '正在读取分支…' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('需求'), { target: { value: '等分支可用' } });
  expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText('需求'), { key: 'Enter' });
  expect((await daemon.call('list-works')).result).toHaveLength(0);
  failRead(new Error('无法读取项目分支：测试读取失败'));
  expect((await screen.findByRole('alert')).textContent).toContain('测试读取失败');
  expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon!.repo, ...args], { stdio: 'pipe' });
  git('checkout', '--detach');
  git('branch', '-D', 'main');
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await screen.findByText(/此项目尚无可用分支/);
  expect((base as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
  git('branch', 'restored');
  fireEvent.click(screen.getByRole('button', { name: '刷新分支' }));
  await waitFor(() => expect((base as HTMLSelectElement).value).toBe('restored'));
  await waitFor(() => expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始' }));
  await screen.findByRole('heading', { name: '等分支可用' });
  expect((await daemon.call('list-works')).result[0].baseRef).toBe('restored');
});

const draft = (key: string, requirements: string): import('../../src/driver.js').FakeStep => ({
  type: 'tool', name: 'draft-work-description', arguments: ctx => ({
    workId: JSON.parse(ctx.input).work.id, key, requirements, boundary: '仅登录页', criteria: '旧登录仍可用',
  }), check: value => expect((value as any).ok).toBe(true),
});

test('对齐对话经 SSE 更新草稿、逐版标出新增条目，草稿入口确认后进入执行', async () => {
  daemon = await uiFixture([[draft('first', '邮箱验证码登录')], [
    { type: 'tool', name: 'send-message', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'reply', body: '已补充过期时间，请确认。' }) },
    draft('second', '邮箱验证码登录\n验证码十分钟过期'),
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '改登录', key: 'start' })).result.work;
  await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const brief = await screen.findByRole('complementary', { name: '工作说明' });
  expect(await within(brief).findByText('邮箱验证码登录')).toBeTruthy();
  const chat = screen.getByRole('region', { name: '对话' });
  fireEvent.change(within(chat).getByLabelText('消息'), { target: { value: '验证码十分钟过期' } });
  fireEvent.click(within(chat).getByRole('button', { name: '发送' }));
  expect(await within(chat).findByText('已补充过期时间，请确认。')).toBeTruthy();
  const added = await within(brief).findByText('验证码十分钟过期');
  expect(added.closest('mark')).toBeTruthy();
  expect(within(brief).getByText('邮箱验证码登录').closest('mark')).toBeNull();
  const versions = within(brief).getByLabelText('版本');
  fireEvent.change(versions, { target: { value: '1' } });
  expect(within(brief).queryByText('验证码十分钟过期')).toBeNull();
  expect((within(brief).getByRole('button', { name: '确认这一版' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(versions, { target: { value: '2' } });
  await waitFor(() => expect((within(brief).getByRole('button', { name: '确认这一版' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(brief).getByRole('button', { name: '确认这一版' }));
  await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'executing');
  await waitFor(() => expect(within(screen.getByRole('main')).getByText('执行中')).toBeTruthy());
  const descriptions = (await daemon.call('get-work-descriptions', { workId: work.id })).result;
  expect(descriptions[1].status).toBe('active');
  expect((await daemon.call('get-conversation', { workId: work.id })).result.filter((item: any) => item.type === 'message' && item.sender === 'user')).toHaveLength(2);
});

test('对话确认入口确认所查看的草稿版本，运行层只记录一次决定', async () => {
  daemon = await uiFixture([[draft('first', '邮件登录')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '确认入口', key: 'start' })).result.work;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const button = await within(chat).findByRole('button', { name: '确认这一版' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'executing');
  const events = (await daemon.call('get-events', { workId: work.id })).result;
  expect(events.filter((event: any) => event.action === 'gate-decided')).toHaveLength(1);
});

test('无项目时直接登记，非 git 路径保留输入并显示原始原因；弹窗登记归一并选中新项目', async () => {
  daemon = await uiFixture([], undefined, { registerProject: false });
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('heading', { name: '先登记一个项目' })).toBeTruthy();
  const empty = join(daemon.directory, 'empty');
  await mkdir(empty);
  fireEvent.change(screen.getByLabelText('项目路径'), { target: { value: empty } });
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  expect((await screen.findByRole('alert')).textContent).toContain('这个目录还不是 git 仓库。');
  expect((screen.getByLabelText('项目路径') as HTMLInputElement).value).toBe(empty);
  fireEvent.click(screen.getByRole('button', { name: '初始化为 git 仓库并登记' }));
  expect(await screen.findByLabelText('需求')).toBeTruthy();
  expect(execFileSync('git', ['-C', empty, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('1');
  const trigger = screen.getByRole('button', { name: '登记项目' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: '登记项目' });
  const path = within(dialog).getByLabelText('项目路径');
  expect(document.activeElement).toBe(path);
  fireEvent.keyDown(path, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
  expect(document.activeElement).toBe(path);
  fireEvent.keyDown(path, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  const reopened = screen.getByRole('dialog');
  // Invalid paths stay in the modal so the user can correct them.
  fireEvent.change(within(reopened).getByLabelText('项目路径'), { target: { value: `${daemon.repo}/.git` } });
  fireEvent.click(within(reopened).getByRole('button', { name: '登记' }));
  expect((await within(reopened).findByRole('alert')).textContent).toContain('项目路径必须位于本机 git 工作树中。');
  expect(within(reopened).queryByRole('button', { name: '初始化为 git 仓库并登记' })).toBeNull();
  const second = join(daemon.directory, 'second');
  execFileSync('git', ['clone', daemon.repo, second], { stdio: 'ignore' });
  await mkdir(join(second, 'nested'));
  fireEvent.change(within(reopened).getByLabelText('项目路径'), { target: { value: join(second, 'nested') } });
  fireEvent.click(within(reopened).getByRole('button', { name: '登记' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const projects = (await daemon.call('list-projects')).result;
  expect(projects).toHaveLength(2);
  const registered = projects.find((project: any) => project.path === second);
  await waitFor(() => expect((screen.getByLabelText('项目') as HTMLSelectElement).value).toBe(registered.id));
});

test('项目路径下拉列出子目录，选择后进入下一级；不存在的路径可新建目录并登记', async () => {
  daemon = await uiFixture([], undefined, { registerProject: false });
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} />);
  const path = await screen.findByLabelText('项目路径') as HTMLInputElement;
  await mkdir(join(daemon.directory, 'apps', 'web'), { recursive: true });
  fireEvent.change(path, { target: { value: `${daemon.directory}/a` } });
  fireEvent.click(await screen.findByRole('option', { name: 'apps/' }));
  expect(path.value).toBe(`${daemon.directory}/apps/`);
  fireEvent.keyDown(await screen.findByRole('option', { name: 'web/' }), { key: 'ArrowDown' });
  fireEvent.keyDown(path, { key: 'ArrowDown' });
  fireEvent.keyDown(path, { key: 'Enter' });
  expect(path.value).toBe(`${daemon.directory}/apps/web/`);
  const created = join(daemon.directory, 'apps', 'fresh');
  fireEvent.change(path, { target: { value: created } });
  fireEvent.click(screen.getByRole('button', { name: '登记' }));
  expect((await screen.findByRole('alert')).textContent).toContain('项目路径不存在。');
  fireEvent.click(screen.getByRole('button', { name: '新建目录并登记' }));
  expect(await screen.findByLabelText('需求')).toBeTruthy();
  expect(execFileSync('git', ['-C', created, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('1');
});

test('草稿更新但网络未送达页面时，确认被运行层拒绝，显示原因且保持对齐', async () => {
  daemon = await uiFixture([[draft('first', '最初的需求')], [draft('second', '更新后的需求')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '过期草稿', key: 'start' })).result.work;
  await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  const realFetch = fetch;
  let offline = false;
  let controller: AbortController | undefined;
  const transport: typeof fetch = async (input, init) => {
    if (!String(input).endsWith('/events')) return realFetch(input, init);
    if (offline) throw new Error('测试断线');
    controller = new AbortController();
    const current = controller;
    init?.signal?.addEventListener('abort', () => current.abort(), { once: true });
    return realFetch(input, { ...init, signal: current.signal });
  };
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  const brief = await screen.findByRole('complementary', { name: '工作说明' });
  const button = await within(brief).findByRole('button', { name: '确认这一版' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  await screen.findByText('实时更新已连接');
  // Wait for replay to finish before dropping the shared stream.
  await screen.findByText('调度轮次结束');
  offline = true; controller?.abort();
  await screen.findByText('连接已断开，正在重连…');
  await daemon.call('send-message', { workId: work.id, body: '请更新草稿', key: 'update' });
  await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 2);
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toContain('工作说明已更新，请重新查看关卡后确认。');
  expect((await daemon.call('get-work', { workId: work.id })).result.status).toBe('aligning');
});

test('项目切换重选默认 Agent，不可用 Agent 显示原因且不能开始；未提交改动提醒来自 git', async () => {
  agentDirectory = await mkdtemp(join(tmpdir(), 'helm-new-work-agents-'));
  const agentDir = await copyAgents(agentDirectory);
  await configureTestAgent(agentDir, 'claude-coordinator', { driver: 'grok' });
  daemon = await uiFixture([], undefined, { agentDir });
  await writeFile(join(daemon.repo, 'pending.md'), 'uncommitted');
  window.history.replaceState(null, '', '/new');
  render(<App baseUrl={daemon.url} />);
  const agents = await screen.findByLabelText('调度者 Agent');
  const unavailable = await within(agents).findByRole('option', { name: /claude-coordinator.*Grok 本阶段只支持执行者/ });
  expect((unavailable as HTMLOptionElement).selected).toBe(true);
  expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
  expect(await screen.findByText(/1 个未提交改动不会进入工作分支/)).toBeTruthy();
  fireEvent.change(agents, { target: { value: 'codex-coordinator' } });
  const second = join(daemon.directory, 'second');
  execFileSync('git', ['clone', daemon.repo, second], { stdio: 'ignore' });
  execFileSync('git', ['-C', second, 'checkout', '-b', 'second-base'], { stdio: 'ignore' });
  const project = (await daemon.call('register-project', { path: second })).result;
  await within(screen.getByLabelText('项目')).findByRole('option', { name: /^second · / });
  fireEvent.change(screen.getByLabelText('项目'), { target: { value: project.id } });
  expect((agents as HTMLSelectElement).value).toBe('claude-coordinator');
  await waitFor(() => expect((screen.getByLabelText('基准分支') as HTMLSelectElement).value).toBe('second-base'));
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByLabelText('Coordinator agent')).toBeTruthy();
  expect(screen.getByText(/Choose an available coordinator agent/)).toBeTruthy();
});

test('选中 CLI 未安装的调度者 Agent 时提示去「环境」，在环境页安装后显示已安装', async () => {
  agentDirectory = await mkdtemp(join(tmpdir(), 'helm-new-work-install-'));
  const bin = join(agentDirectory, 'bin');
  const cli = join(bin, 'helm-fake-codex');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const command = `mkdir -p '${bin}' && printf '#!/bin/sh\\n' > '${cli}' && chmod +x '${cli}'`;
    const codexDriver = Object.assign(new FakeDriver([], () => existsSync(cli) ? { available: true } : { available: false, reason: 'Codex 未安装' }),
      { install: { executable: 'helm-fake-codex', command, login: 'helm-fake-codex login' } });
    daemon = await uiFixture([], undefined, { codexDriver });
    window.history.replaceState(null, '', '/new');
    const view = render(<App baseUrl={daemon.url} />);
    const agents = await screen.findByLabelText('调度者 Agent');
    await waitFor(() => expect((agents as HTMLSelectElement).value).toBe('claude-coordinator'));
    expect(screen.queryByText(/未检测到这个驱动的 CLI/)).toBeNull();
    fireEvent.change(agents, { target: { value: 'codex-coordinator' } });
    expect(await screen.findByText(/未检测到这个驱动的 CLI/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '去「环境」安装' }).getAttribute('href')).toBe('/settings/environment');
    fireEvent.change(screen.getByLabelText('需求'), { target: { value: '安装后开始' } });
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    window.history.replaceState(null, '', '/settings/environment');
    render(<App baseUrl={daemon.url} />);
    const row = await screen.findByRole('group', { name: 'Codex' });
    expect(within(row).getByText('未安装')).toBeTruthy();
    expect(within(row).getByText(command)).toBeTruthy();
    expect(within(row).getByText('helm-fake-codex login')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: '下载安装' }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Codex' })).getByText(/^已安装/)).toBeTruthy());
    expect(existsSync(cli)).toBe(true);
    expect(screen.getByRole('group', { name: 'Chromium（浏览器检查）' })).toBeTruthy();
  } finally { process.env.PATH = path; }
});
