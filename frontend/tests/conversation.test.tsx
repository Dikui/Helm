import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeScript, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
const { existingWorkCopy }: typeof import('../../tests/helmd-fixture.js') = await import('../../dist/tests/' + 'helmd-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
// jsdom has no native dialog implementation. Substitute only the platform API.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function executingWork(scripts: FakeScript[]) {
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '登录功能', boundary: '登录页', criteria: '可登录' }) },
  ], ...scripts]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '对话与引导', key: 'start' })).result.work;
  const descriptions = await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.some((event: any) => event.action === 'round-ended'));
  const description = descriptions.result[0];
  await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
  window.history.replaceState(null, '', `/works/${work.id}`);
  return work;
}
const card: FakeStep = { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '实现验证码' }) };
const gate = (key: string, question: string, body = ''): Extract<FakeStep, { type: 'tool' }> => ({ type: 'tool', name: 'propose-gate', arguments: ctx => ({
  workId: JSON.parse(ctx.input).work.id, key, question, body, options: ['保留一周', '一直保留'],
}) });

// regression, medium — #21。只在 HTTP 边界暂缓用量读取，驱动由 uiFixture 替代。
test.each(['执行', '对齐'])('%s中收件箱用量刷新缓慢时，发送的消息仍立即出现在当前工作的对话中', async phase => {
  if (phase === '执行') await executingWork([[{ type: 'hang' }]]);
  else {
    daemon = await uiFixture([[{ type: 'hang' }]]);
    const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '对话与引导', key: 'start' })).result.work;
    window.history.replaceState(null, '', `/works/${work.id}`);
  }
  let slow = false;
  let blocked = false;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async (input, init) => {
    if (slow && String(input).endsWith('/api/get-settings')) {
      blocked = true;
      await hold;
    }
    return fetch(input, init);
  };
  render(<App baseUrl={daemon!.url} transport={transport} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  await within(chat).findByText('对话与引导', { selector: 'article p' });
  await screen.findByText('实时更新已连接');
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 10'));
  slow = true;
  await daemon!.call('set-concurrency', { limit: 3 });
  await waitFor(() => expect(blocked).toBe(true));
  try {
    const input = within(chat).getByLabelText('消息') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '无需切换工作就能看到这条消息' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input.value).toBe(''));
    expect(await within(chat).findByText('无需切换工作就能看到这条消息', { selector: 'article p' })).toBeTruthy();
    expect(await within(chat).findByRole('region', { name: '下一轮处理' })).toBeTruthy();
  } finally { slow = false; release(); }
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 3'));
});

test('当前关卡钉在对话记录之外，数字键决定且输入框和组合输入不触发', async () => {
  const work = await executingWork([[gate('shortcut', '旧密码保留多久？', '需要兼容旧版客户端。'), { type: 'hang' }]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const pin = await within(chat).findByRole('group', { name: '旧密码保留多久？' });
  expect(within(chat).getByRole('region', { name: '对话记录' }).contains(pin)).toBe(false);
  const reason = within(pin).getByText('需要兼容旧版客户端。').closest('details')!;
  expect(reason.open).toBe(false);
  fireEvent.click(within(pin).getByText('原因'));
  expect(reason.open).toBe(true);
  fireEvent.keyDown(within(chat).getByLabelText('消息'), { key: '1' });
  fireEvent.keyDown(window, { key: '1', isComposing: true });
  expect((await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.question === '旧密码保留多久？').status).toBe('pending');
  fireEvent.keyDown(window, { key: '2' });
  await waitFor(() => expect(within(chat).queryByRole('group', { name: '旧密码保留多久？' })).toBeNull());
  expect((await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.question === '旧密码保留多久？').decision).toBe('一直保留');
});

test('执行中重新起草的工作说明钉在顶部，可查看新版并确认', async () => {
  const work = await executingWork([[{ type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
    key: 'brief-v2', requirements: '以框架图展示', boundary: '登录页', criteria: '可登录' }) }, { type: 'hang' }]]);
  const descriptions = await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 2);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const pin = await within(chat).findByRole('group', { name: '确认工作说明' });
  fireEvent.click(within(pin).getByRole('link', { name: '查看说明' }));
  await waitFor(() => expect(window.location.search).toBe('?inspect=spec'));
  const brief = await screen.findByRole('region', { name: '工作说明' });
  expect(await within(brief).findByText('以框架图展示')).toBeTruthy();
  expect(within(brief).getByText('未确认', { selector: 'span span' })).toBeTruthy();
  fireEvent.keyDown(window, { key: '1' });
  await waitFor(() => expect(within(chat).queryByRole('group', { name: '确认工作说明' })).toBeNull());
  const after = (await daemon!.call('get-work-descriptions', { workId: work.id })).result;
  expect(after.find((item: any) => item.id === descriptions.result[1].id).status).toBe('active');
});

test('关卡撤回后钉栏提供跳过原因入口，原问题和撤回原因留在对话', async () => {
  const work = await executingWork([[
    { ...gate('withdraw', '旧方向确认'), saveAs: 'choice' },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, gateId: (ctx.results.get('choice') as any).result.id, reason: '不再采用旧方向' }) },
  ]]);
  await until(() => daemon!.call('get-conversation', { workId: work.id }), value => value.result.some((item: any) => item.status === 'withdrawn'));
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const pin = await within(chat).findByRole('group', { name: '已撤回' });
  expect(within(pin).getByText('旧方向确认')).toBeTruthy();
  fireEvent.keyDown(window, { key: '1' });
  await waitFor(() => expect(window.location.search).toBe('?inspect=list'));
  fireEvent.click(within(chat).getByText(/撤回关卡 · 旧方向确认/));
  expect(within(chat).getByText('不再采用旧方向')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(chat).getByRole('group', { name: 'Withdrawn' })).toBeTruthy();
  expect(within(chat).getByRole('button', { name: 'View skip reasons' })).toBeTruthy();
});

test.each(['对齐', '执行'])('%s阶段从启动到结束显示思考、展开的当前步骤和折叠的历史步骤，重新打开保留已结束步骤', async phase => {
  let output!: () => void;
  let finish!: () => void;
  const script: FakeStep[] = [
    { type: 'hang', until: new Promise<void>(resolve => { output = resolve; }) },
    { type: 'output', text: '正在检查邮件模板\n第二行原文' },
    { type: 'hang', until: new Promise<void>(resolve => { finish = resolve; }) },
  ];
  let work: any;
  if (phase === '执行') work = await executingWork([script]);
  else {
    daemon = await uiFixture([script]);
    work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '对齐思考', key: 'start' })).result.work;
    window.history.replaceState(null, '', `/works/${work.id}`);
  }
  const view = render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const thinking = await within(chat).findByText('调度者正在思考…');
  expect(within(chat).getByRole('region', { name: '对话记录' }).contains(thinking)).toBe(true);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  expect(await within(strip).findByText('尚无步骤 · 等待首次输出')).toBeTruthy();
  expect(within(chat).queryByText('本轮 0 步 · 等待首次输出')).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: /调度者/ }));
  const inspector = screen.getByRole('complementary', { name: '检查器' });
  expect(await within(inspector).findByText('尚无本轮计划或执行步骤；等待首次输出。')).toBeTruthy();
  expect(within(inspector).queryByRole('list', { name: '本轮计划' })).toBeNull();
  output();
  expect(await within(inspector).findByRole('heading', { name: '本轮 1 步 · 无本轮计划' })).toBeTruthy();
  expect(within(inspector).getByText('正在检查邮件模板', { selector: 'summary' })).toBeTruthy();
  finish();
  await waitFor(() => expect(within(chat).queryByText('调度者正在思考…')).toBeNull());
  expect(await within(strip).findByText(phase === '对齐' ? '已起草，等你确认' : '本轮已结束 · 最新：正在检查邮件模板')).toBeTruthy();
  await within(inspector).findByRole('heading', { name: /本轮 \d+ 步 · 已结束/ });
  const ended = await within(inspector).findByText(/调度轮次 #\d+ · 已结束 · 最近步骤/, { selector: 'summary' });
  expect(ended.closest('details')!.open).toBe(false);
  const duration = within(inspector).getByLabelText('本轮用时').textContent;
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(within(inspector).getByLabelText('本轮用时').textContent).toBe(duration);
  view.unmount();
  render(<App baseUrl={daemon!.url} />);
  const reopened = await within(await screen.findByRole('complementary', { name: '检查器' })).findByText(/调度轮次 #\d+ · 已结束 · 最近步骤/, { selector: 'summary' });
  expect(reopened.closest('details')!.open).toBe(false);
  fireEvent.click(reopened);
  expect(await within(reopened.closest('details')!).findByText('正在检查邮件模板', { selector: 'summary' })).toBeTruthy();
});

test('执行中对话支持三种消息范围；切换检查器时对话、输入和范围常驻', async () => {
  const work = await executingWork([[card, gate('password', '旧密码保留多久？'), { type: 'hang' }]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const scope = await within(chat).findByLabelText('关于');
  await within(scope).findByRole('option', { name: '卡片 · 实现验证码' });
  const input = within(chat).getByLabelText('消息');
  const send = async (body: string, target: string) => {
    fireEvent.change(scope, { target: { value: target } });
    fireEvent.change(input, { target: { value: body } });
    fireEvent.click(within(chat).getByRole('button', { name: '发送' }));
    await within(chat).findByText(body, { selector: 'article p' });
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
  };
  const graph = (await daemon!.call('get-card-graph', { workId: work.id })).result;
  const cardId = graph.find((node: any) => node.type === 'card').id;
  const gateId = graph.find((node: any) => node.kind === 'general').id;
  await send('请先整理整体进度', 'work');
  await send('验证码十分钟过期', `card:${cardId}`);
  await send('先解释迁移成本', `gate:${gateId}`);
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(conversation.find((item: any) => item.body === '请先整理整体进度').cardId).toBeNull();
  expect(conversation.find((item: any) => item.body === '验证码十分钟过期').cardId).toBe(cardId);
  expect(conversation.find((item: any) => item.body === '先解释迁移成本').gateId).toBe(gateId);
  const cardMessage = within(chat).getByText('验证码十分钟过期', { selector: 'article p' }).closest('article')!;
  expect(within(cardMessage).getByText('卡片 · 实现验证码')).toBeTruthy();
  fireEvent.change(input, { target: { value: '切换期间保留的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '结构' }));
  expect(window.location.pathname).toBe(`/works/${work.id}`);
  expect(await screen.findByRole('region', { name: '结构' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '工作说明' }));
  expect(window.location.search).toBe('?inspect=spec');
  expect(await screen.findByRole('region', { name: '工作说明' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '对话' })).toBe(chat);
  expect((input as HTMLTextAreaElement).value).toBe('切换期间保留的草稿');
  expect((scope as HTMLSelectElement).value).toBe(`gate:${gateId}`);
});

test('待决定关卡在顶部，决定后原文回到对话，选项和自由回答保存且退出消息范围', async () => {
  const work = await executingWork([[
    gate('password', '旧密码保留多久？'),
    { type: 'tool', name: 'send-message', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'between', body: '还有发送频率需要确认。' }) },
    gate('frequency', '验证码发送频率？'), { type: 'hang' },
  ]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const password = await within(chat).findByRole('group', { name: '旧密码保留多久？' });
  const frequency = await within(chat).findByRole('group', { name: '验证码发送频率？' });
  const between = within(chat).getByText('还有发送频率需要确认。', { selector: 'article p' });
  expect(password.compareDocumentPosition(between) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(frequency.compareDocumentPosition(between) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scope = within(chat).getByLabelText('关于');
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  const passwordId = conversation.find((item: any) => item.question === '旧密码保留多久？').id;
  fireEvent.change(scope, { target: { value: `gate:${passwordId}` } });
  fireEvent.click(within(password).getByRole('button', { name: '保留一周' }));
  await waitFor(() => expect(within(chat).queryByRole('group', { name: '旧密码保留多久？' })).toBeNull());
  await waitFor(() => expect(within(scope).queryByRole('option', { name: '关卡 · 旧密码保留多久？' })).toBeNull());
  fireEvent.change(within(chat).getByLabelText('消息'), { target: { value: '待发送' } });
  expect((within(chat).getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(scope, { target: { value: 'work' } });
  fireEvent.click(within(frequency).getByText('回答', { selector: 'summary' }));
  fireEvent.change(within(frequency).getByLabelText('回答'), { target: { value: '每分钟最多一次' } });
  fireEvent.click(within(frequency).getByRole('button', { name: '决定' }));
  await waitFor(() => expect(within(chat).queryByRole('group', { name: '验证码发送频率？' })).toBeNull());
  expect(await within(chat).findByText('每分钟最多一次')).toBeTruthy();
  expect(within(chat).getAllByText('已决定').length).toBeGreaterThanOrEqual(2);
  const decided = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(decided.find((item: any) => item.id === passwordId).decision).toBe('保留一周');
  expect(decided.find((item: any) => item.question === '验证码发送频率？').decision).toBe('每分钟最多一次');
});

test('对齐中的多选关卡可勾选多项并补充回答，决定后留在对齐对话里', async () => {
  daemon = await uiFixture([[
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'platforms',
      question: '要支持哪些平台？', options: ['macOS', 'Linux', 'Windows'], multiSelect: true }) }, { type: 'hang' },
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '多选提问', key: 'start' })).result.work;
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const question = await screen.findByRole('group', { name: '要支持哪些平台？' });
  fireEvent.click(within(question).getByRole('button', { name: 'Windows' }));
  fireEvent.click(within(question).getByRole('button', { name: 'macOS' }));
  fireEvent.keyDown(question, { key: '3' });
  expect(within(question).getByRole('button', { name: 'macOS' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(question).getByRole('button', { name: 'Windows' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(within(question).getByText('补充（可选）', { selector: 'summary' }));
  fireEvent.change(within(question).getByLabelText('补充（可选）'), { target: { value: '先做 Apple Silicon' } });
  fireEvent.click(within(question).getByRole('button', { name: '决定' }));
  await waitFor(() => expect(screen.queryByRole('group', { name: '要支持哪些平台？' })).toBeNull());
  expect(await screen.findByText('已决定')).toBeTruthy();
  const decided = (await daemon.call('get-conversation', { workId: work.id })).result;
  expect(decided.find((item: any) => item.question === '要支持哪些平台？').decision).toBe('macOS\n先做 Apple Silicon');
});

test('步骤与用时实时更新，Enter 排队，⌘Enter 发送并打断，下一轮接收后清空队列，空闲不可打断', async () => {
  let advance!: () => void;
  let finishNext!: () => void;
  const moreOutput = new Promise<void>(resolve => { advance = resolve; });
  const nextDone = new Promise<void>(resolve => { finishNext = resolve; });
  const work = await executingWork([[
    { type: 'output', text: '读取派单结果' }, { type: 'hang', until: moreOutput },
    { type: 'output', text: '整理调度笔记' }, { type: 'hang' },
  ], ctx => {
    expect(JSON.parse(ctx.input).recentConversation.some((item: any) => item.body === '紧急补充')).toBe(true);
    return [{ type: 'output', text: '已接收紧急消息' }, { type: 'hang', until: nextDone }];
  }]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  expect(await within(strip).findByText('本轮 1 步 · 读取派单结果')).toBeTruthy();
  const initialTime = await within(chat).findByLabelText('本轮用时').then(element => element.textContent);
  await waitFor(() => expect(within(chat).getByLabelText('本轮用时').textContent).not.toBe(initialTime));
  const input = within(chat).getByLabelText('消息');
  fireEvent.change(input, { target: { value: '下一轮检查测试' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect((await daemon!.call('get-conversation', { workId: work.id })).result.filter((item: any) => item.body === '下一轮检查测试')).toHaveLength(0);
  fireEvent.keyDown(input, { key: 'Enter' });
  const queue = await within(chat).findByRole('region', { name: '下一轮处理' });
  expect(await within(queue).findByText('下一轮检查测试')).toBeTruthy();
  advance();
  expect(await within(strip).findByText('本轮 2 步 · 整理调度笔记')).toBeTruthy();
  fireEvent.change(input, { target: { value: '紧急补充' } });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(await within(strip).findByText('本轮 1 步 · 已接收紧急消息')).toBeTruthy();
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '下一轮处理' })).toBeNull());
  const rounds = (await daemon!.call('list-rounds', { workId: work.id })).result;
  expect(rounds.rounds[1].reason).toBe('aborted');
  expect(rounds.queuedMessages).toHaveLength(0);
  expect(rounds.rounds[2].status).toBe('running');
  finishNext();
  await waitFor(() => expect((within(chat).getByRole('button', { name: '打断本轮' }) as HTMLButtonElement).disabled).toBe(true));
  const before = (await daemon!.call('get-events', { workId: work.id })).result.filter((event: any) => event.action === 'round-interrupted').length;
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect((await daemon!.call('get-events', { workId: work.id })).result.filter((event: any) => event.action === 'round-interrupted')).toHaveLength(before);
});

test('针对卡片的发送响应丢失后保留正文和范围，重试同一请求且只保存一条消息；英文不翻译正文', async () => {
  const work = await executingWork([[card, { type: 'hang' }]]);
  const submissions: any[] = [];
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (String(input).endsWith('/api/send-message')) {
      submissions.push(JSON.parse(String(init?.body)));
      if (submissions.length === 1) { await response.text(); throw new Error('响应丢失'); }
    }
    return response;
  };
  render(<App baseUrl={daemon!.url} transport={transport} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const scope = within(chat).getByLabelText('关于');
  const option = await within(scope).findByRole('option', { name: '卡片 · 实现验证码' });
  fireEvent.change(scope, { target: { value: (option as HTMLOptionElement).value } });
  const input = within(chat).getByLabelText('消息');
  fireEvent.change(input, { target: { value: '保留原文 English' } });
  fireEvent.click(within(chat).getByRole('button', { name: '发送' }));
  expect((await within(chat).findByRole('alert')).textContent).toContain('响应丢失');
  expect((input as HTMLTextAreaElement).value).toBe('保留原文 English');
  expect((scope as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(within(chat).getByRole('button', { name: '重试发送' }));
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));
  expect(submissions[1]).toEqual(submissions[0]);
  expect((await daemon!.call('get-conversation', { workId: work.id })).result.filter((item: any) => item.body === '保留原文 English')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(chat).getByLabelText('About')).toBeTruthy();
  expect(await within(chat).findByText('保留原文 English', { selector: 'article p' })).toBeTruthy();
});

test('本轮步骤提取真实驱动输出中的文字与工具名称，详情仍可读取原始输出', async () => {
  const assistant = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '核对登录边界' }] } });
  const command = JSON.stringify({ method: 'item/started', params: { item: { type: 'commandExecution', command: 'npm run check' } } });
  const categories = [
    [{ type: 'user', message: { content: [{ type: 'tool_result', content: '\n检查通过\n更详细的工具结果' }] } }, '工具返回 · 检查通过', 'Tool result · 检查通过'],
    [{ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '块状工具结果\n详情' }] }] } }, '工具返回 · 块状工具结果', 'Tool result · 块状工具结果'],
    [{ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '{"ok":true,"result":{"id":"card-1","workId":"w"}}' }] }] } }, '工具返回 · 成功', 'Tool result · ok'],
    [{ type: 'user', message: { content: [{ type: 'tool_result', content: '{"ok":false,"error":{"code":"CARD_NOT_DISPATCHABLE","reason":"等待前置的卡片不能派单"}}' }] } }, '工具返回 · 被拒：等待前置的卡片不能派单', 'Tool result · rejected：等待前置的卡片不能派单'],
    [{ type: 'system', subtype: 'init' }, '会话初始化', 'Session initialized'],
    [{ type: 'system', subtype: 'status' }, '系统消息', 'System message'],
    [{ type: 'system', subtype: 'hook_response' }, 'Hook 执行', 'Hook execution'],
    [{ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, '限额更新', 'Rate limits updated'],
    [{ method: 'thread/tokenUsage/updated', params: {} }, 'Token 用量更新', 'Token usage updated'],
    [{ method: 'account/rateLimits/updated', params: {} }, '限额更新', 'Rate limits updated'],
    [{ method: 'thread/status/changed', params: { status: { type: 'active' } } }, '线程状态变化', 'Thread status changed'],
    [{ method: 'unknown/event', params: {} }, '调度者输出', 'Coordinator output'],
  ] as const;
  await executingWork([[
    { type: 'output', text: assistant }, { type: 'output', text: command },
    ...categories.map(([message]): FakeStep => ({ type: 'output', text: JSON.stringify(message) })), { type: 'hang' },
  ]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  fireEvent.click(within(await screen.findByRole('navigation', { name: '现在条' })).getByRole('button', { name: /调度者/ }));
  const inspector = await screen.findByRole('region', { name: '本轮步骤' });
  expect(await within(inspector).findByText('核对登录边界', { selector: 'summary' })).toBeTruthy();
  expect(await within(inspector).findByText('npm run check', { selector: 'summary' })).toBeTruthy();
  expect(within(inspector).getByText(assistant, { selector: 'pre' })).toBeTruthy();
  for (const [message, zh] of categories) {
    const summaries = await within(inspector).findAllByText(zh, { selector: 'summary' });
    expect(summaries.length).toBeGreaterThan(0);
    const raw = within(inspector).getByText(JSON.stringify(message), { selector: 'pre' });
    fireEvent.click(raw.closest('details')!.querySelector('summary')!);
    expect(raw.closest('details')!.open).toBe(true);
  }
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  for (const [, , en] of categories) expect(within(inspector).getAllByText(en, { selector: 'summary' }).length).toBeGreaterThan(0);
});

test('范围失效时空消息 Ctrl+Enter 仍能打断，打断按钮可终止下一轮且不产生空消息', async () => {
  const work = await executingWork([
    [gate('password', '旧密码保留多久？'), { type: 'hang' }],
    [{ type: 'output', text: '正在处理关卡决定' }, { type: 'hang' }],
  ]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const decision = await within(chat).findByRole('group', { name: '旧密码保留多久？' });
  const scope = within(chat).getByLabelText('关于');
  const option = within(scope).getByRole('option', { name: '关卡 · 旧密码保留多久？' });
  fireEvent.change(scope, { target: { value: (option as HTMLOptionElement).value } });
  fireEvent.click(within(decision).getByRole('button', { name: '保留一周' }));
  await within(chat).findByRole('option', { name: '范围已失效，请重新选择' });
  fireEvent.keyDown(within(chat).getByLabelText('消息'), { key: 'Enter', ctrlKey: true });
  expect(await within(await screen.findByRole('navigation', { name: '现在条' })).findByText('本轮 1 步 · 正在处理关卡决定')).toBeTruthy();
  const interrupt = within(chat).getByRole('button', { name: '打断本轮' });
  const attachments = within(chat).getByText('添加附件', { selector: 'summary' }).closest('details')!;
  expect(attachments.open).toBe(false);
  // jsdom does not reliably hide closed details from role queries; verify the button is outside them.
  expect(interrupt.closest('details')).toBeNull();
  expect(interrupt.closest('.conversation-hints')).not.toBeNull();
  expect(interrupt.nextElementSibling).toBe(within(chat).getByRole('button', { name: '发送' }));
  expect((within(chat).getByLabelText('消息') as HTMLTextAreaElement).value).toBe('');
  expect((within(chat).getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect((interrupt as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(interrupt);
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[2]?.reason === 'aborted');
  await waitFor(() => expect((within(chat).getByRole('button', { name: '打断本轮' }) as HTMLButtonElement).disabled).toBe(true));
  expect(attachments.open).toBe(false);
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(conversation.filter((item: any) => item.type === 'message' && item.sender === 'user')).toHaveLength(1);
});

test('消息按 Markdown 显示，工作分支上的文件和附件可在弹窗预览', async () => {
  const work = await executingWork([[{ type: 'hang' }]]);
  existingWorkCopy(join(daemon!.directory, 'data'), work.id);
  const { workPath } = (await daemon!.call('get-work', { workId: work.id })).result;
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await mkdir(join(workPath, 'outputs'));
  await writeFile(join(workPath, 'outputs', 'report.md'), '# 报告标题\n\n![对比图](plot.png)\n\n[交互页](page.html)\n');
  await writeFile(join(workPath, 'outputs', 'plot.png'), image);
  await writeFile(join(workPath, 'outputs', 'page.html'), '<h1>交互页</h1><script>document.title = "x"</script>');
  execFileSync('git', ['-C', workPath, 'add', 'outputs']);
  execFileSync('git', ['-C', workPath, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'outputs']);
  await daemon!.call('send-message', { workId: work.id, key: 'files', body: '**结果**见 `outputs/report.md`，`outputs/missing.png` 不存在，[外链](https://example.com)，[框架图](/home/u/.helm/dispatches/d/artifacts/a.html)<script>alert(1)</script>',
    attachments: [{ name: 'notes.txt', content: Buffer.from('附件原文').toString('base64') }] });
  const fetches = vi.spyOn(globalThis, 'fetch');
  const reads = (name: string) => fetches.mock.calls.filter(([url]) => String(url).endsWith(`/api/${name}`)).length;
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  // The message re-renders once the branch file list arrives, so wait for the file link before holding nodes.
  const message = (await within(chat).findByRole('link', { name: 'outputs/report.md' })).closest('article')!;
  expect(within(message).getByText('结果', { selector: 'strong' })).toBeTruthy();
  expect(message.querySelector('script')).toBeNull();
  expect(within(message).getByRole('link', { name: '外链' }).getAttribute('target')).toBe('_blank');
  expect(within(message).queryByRole('link', { name: 'outputs/missing.png' })).toBeNull();
  // A server path would open a Helm page, so it stays text.
  expect(within(message).queryByRole('link', { name: '框架图' })).toBeNull();
  expect(within(message).getByText('框架图').getAttribute('title')).toBe('/home/u/.helm/dispatches/d/artifacts/a.html');

  fireEvent.click(within(message).getByRole('link', { name: 'outputs/report.md' }));
  const dialog = await screen.findByRole('dialog', { name: 'outputs/report.md' });
  expect(await within(dialog).findByRole('heading', { name: '报告标题' })).toBeTruthy();
  const plot = within(dialog).getByRole('img', { name: '对比图' }) as HTMLImageElement;
  await waitFor(() => expect(plot.getAttribute('src')).toBe(`data:image/png;base64,${image.toString('base64')}`));
  // Reads settle: re-renders must not re-fetch the file list or abort the open file.
  const settled = [reads('list-work-files'), reads('read-work-file')];
  await new Promise(resolve => setTimeout(resolve, 300));
  expect([reads('list-work-files'), reads('read-work-file')]).toEqual(settled);
  fireEvent.click(within(dialog).getByRole('link', { name: '交互页' }));
  const frame = await within(await screen.findByRole('dialog', { name: 'outputs/page.html' })).findByTitle('outputs/page.html');
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('srcdoc')).toContain('<h1>交互页</h1>');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  fireEvent.click(within(message).getByRole('link', { name: 'notes.txt' }));
  expect(await within(await screen.findByRole('dialog')).findByText('附件原文', { selector: 'pre' })).toBeTruthy();
});

test('粘贴截图成为附件并显示缩略图，同名截图依次编号，发出后消息里也有缩略图', async () => {
  const work = await executingWork([[{ type: 'hang' }], [{ type: 'hang' }]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const input = within(chat).getByLabelText('消息');
  const shot = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' });
  fireEvent.paste(input, { clipboardData: { files: [shot()] } });
  fireEvent.paste(input, { clipboardData: { files: [shot(), shot()] } });
  const attachments = within(chat).getByText('添加附件', { selector: 'summary' }).closest('details')!;
  expect(attachments.open).toBe(true);
  expect(within(attachments).getByText('image-3.png')).toBeTruthy();
  expect([...attachments.querySelectorAll('img.attachment-thumbnail')].map(image => image.getAttribute('src'))).toEqual(['blob:image.png', 'blob:image-2.png', 'blob:image-3.png']);
  fireEvent.change(input, { target: { value: '看截图' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  const conversation = await until(() => daemon!.call('get-conversation', { workId: work.id }),
    value => value.result.some((item: any) => item.type === 'message' && item.body === '看截图'));
  const message = conversation.result.find((item: any) => item.body === '看截图');
  expect(message.attachments.map((item: any) => item.name)).toEqual(['image.png', 'image-2.png', 'image-3.png']);
  await waitFor(() => expect(attachments.open).toBe(false));
  const sent = await within(chat).findByRole('list', { name: '附件' });
  await waitFor(() => expect(sent.querySelectorAll('img[src="data:image/png;base64,iVBORw=="]').length).toBe(3));
});

test('v2 排队条目的立即操作打断本轮，原消息只提交一次', async () => {
  const work = await executingWork([
    [{ type: 'output', text: '正在处理本轮' }, { type: 'hang' }],
    [{ type: 'output', text: '开始处理排队消息' }, { type: 'hang' }],
  ]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  await within(strip).findByText('本轮 1 步 · 正在处理本轮');
  const input = within(chat).getByLabelText('消息');
  fireEvent.change(input, { target: { value: '马上检查边界' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  const queue = await within(chat).findByRole('region', { name: '下一轮处理' });
  fireEvent.click(within(queue).getByRole('button', { name: '立即' }));
  await within(strip).findByText('本轮 1 步 · 开始处理排队消息');
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '下一轮处理' })).toBeNull());
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(conversation.filter((item: any) => item.body === '马上检查边界')).toHaveLength(1);
});

test('排队消息撤回成功经 SSE 更新历史，提交中禁用，失败显示运行层原始原因', async () => {
  const work = await executingWork([[{ type: 'output', text: '处理本轮' }, { type: 'hang' }]]);
  const message = (await daemon!.call('send-message', { workId: work.id, body: '可撤回消息', key: 'withdraw' })).result.message;
  let release!: () => void;
  let first = true;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/api/withdraw-message') && first) {
      first = false;
      await wait;
      return new Response(JSON.stringify({ ok: false, error: { code: 'MESSAGE_CLAIMED', reason: '原始原因：这条消息已被调度者领取', allowedOperations: ['withdraw-message'] } }), { status: 409 });
    }
    return fetch(input, init);
  };
  render(<App baseUrl={daemon!.url} transport={transport} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const queue = await within(chat).findByRole('region', { name: '下一轮处理' });
  const withdraw = within(queue).getByRole('button', { name: '撤回' });
  fireEvent.click(withdraw);
  expect((withdraw as HTMLButtonElement).disabled).toBe(true);
  expect((within(queue).getByRole('button', { name: '立即' }) as HTMLButtonElement).disabled).toBe(true);
  release();
  expect((await within(chat).findByRole('alert')).textContent).toContain('原始原因：这条消息已被调度者领取');
  await waitFor(() => expect((withdraw as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(withdraw);
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '下一轮处理' })).toBeNull());
  const history = within(chat).getByText('可撤回消息', { selector: 'article p' }).closest('article')!;
  expect(within(history).getByText('已撤回')).toBeTruthy();
  const item = (await daemon!.call('get-conversation', { workId: work.id })).result.find((item: any) => item.id === message.id);
  expect(item.withdrawnAt).toBeTruthy();
  const remote = (await daemon!.call('send-message', { workId: work.id, body: '另一客户端撤回', key: 'remote-withdraw' })).result.message;
  await within(chat).findByRole('region', { name: '下一轮处理' });
  await daemon!.call('withdraw-message', { workId: work.id, messageId: remote.id });
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '下一轮处理' })).toBeNull());
  expect(within(within(chat).getByText('另一客户端撤回', { selector: 'article p' }).closest('article')!).getByText('已撤回')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(history).getByText('Withdrawn')).toBeTruthy();
});

test('本轮计划显示真实总数和三种状态，更新至全部完成，原始步骤可展开', async () => {
  let clear!: () => void;
  const clearing = new Promise<void>(resolve => { clear = resolve; });
  let advance!: () => void;
  const ready = new Promise<void>(resolve => { advance = resolve; });
  const entries = [{ content: '读项目', status: 'completed' as const }, { content: '整理边界', status: 'in_progress' as const }, { content: '核对标准', status: 'pending' as const }];
  await executingWork([[
    { type: 'plan', entries }, { type: 'output', text: '原始执行步骤' }, { type: 'hang', until: ready },
    { type: 'plan', entries: entries.map(entry => ({ ...entry, status: 'completed' as const })) }, { type: 'hang', until: clearing },
    { type: 'plan', entries: [] }, { type: 'hang' },
  ]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  expect(await within(strip).findByText('第 2/3 步 · 整理边界')).toBeTruthy();
  expect(within(chat).queryByRole('list', { name: '本轮计划' })).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: /调度者/ }));
  const inspector = await screen.findByRole('region', { name: '本轮步骤' });
  expect(await within(inspector).findByText(/本轮计划 · 第 2 \/ 3 步/)).toBeTruthy();
  const plan = within(inspector).getByRole('list', { name: '本轮计划' });
  expect(within(plan).getAllByRole('listitem')).toHaveLength(3);
  expect(within(plan).getByText('已完成')).toBeTruthy();
  expect(within(plan).getByText('进行中').closest('li')?.getAttribute('aria-current')).toBe('step');
  expect(within(plan).getByText('待做')).toBeTruthy();
  expect(within(plan).getByText('核对标准')).toBeTruthy();
  const raw = within(inspector).getByText(/查看原始步骤 · 与计划分别计数 · \d+/, { selector: 'summary' });
  expect(raw.closest('details')?.open).toBe(false);
  fireEvent.click(raw);
  expect(raw.closest('details')?.open).toBe(true);
  expect(within(inspector).getByText('原始执行步骤', { selector: 'pre' })).toBeTruthy();
  advance();
  expect(await within(inspector).findByText(/本轮计划 · 第 3 \/ 3 步/)).toBeTruthy();
  expect(within(plan).getAllByText('已完成')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(inspector).getByText(/Round plan · Step 3 \/ 3/)).toBeTruthy();
  expect(within(inspector).getByRole('list', { name: 'Round plan' })).toBeTruthy();
  clear();
  await waitFor(() => expect(within(inspector).queryByRole('list', { name: 'Round plan' })).toBeNull());
  expect(within(inspector).queryByText(/Round plan · Step \d+ \/ \d+/)).toBeNull();
  expect(within(inspector).getByText('原始执行步骤', { selector: 'pre' })).toBeTruthy();
});
