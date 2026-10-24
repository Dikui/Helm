import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeScript, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
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
const gate = (key: string, question: string): FakeStep => ({ type: 'tool', name: 'propose-gate', arguments: ctx => ({
  workId: JSON.parse(ctx.input).work.id, key, question, options: ['保留一周', '一直保留'],
}) });

test('执行中对话支持三种消息范围和顶栏视图切换，消息经 HTTP 保存并显示引用', async () => {
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
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  fireEvent.click(within(header).getByRole('link', { name: '调度结构' }));
  expect(window.location.pathname).toBe(`/works/${work.id}/structure`);
  expect(await screen.findByRole('heading', { name: '调度结构' })).toBeTruthy();
  fireEvent.click(within(header).getByRole('link', { name: '工作说明' }));
  expect(window.location.pathname).toBe(`/works/${work.id}/brief`);
  expect(await screen.findByRole('heading', { name: '工作说明' })).toBeTruthy();
  fireEvent.click(within(header).getByRole('link', { name: '对话' }));
  expect(window.location.pathname).toBe(`/works/${work.id}/chat`);
  expect(await screen.findByRole('region', { name: '对话' })).toBeTruthy();
});

test('消息和关卡按时间穿插，选项和自由回答保存决定；已决定关卡退出消息范围', async () => {
  const work = await executingWork([[
    gate('password', '旧密码保留多久？'),
    { type: 'tool', name: 'send-message', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'between', body: '还有发送频率需要确认。' }) },
    gate('frequency', '验证码发送频率？'), { type: 'hang' },
  ]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const password = await within(chat).findByRole('region', { name: '旧密码保留多久？' });
  const frequency = await within(chat).findByRole('region', { name: '验证码发送频率？' });
  const between = within(chat).getByText('还有发送频率需要确认。', { selector: 'article p' });
  expect(password.compareDocumentPosition(between) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(between.compareDocumentPosition(frequency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const scope = within(chat).getByLabelText('关于');
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  const passwordId = conversation.find((item: any) => item.question === '旧密码保留多久？').id;
  fireEvent.change(scope, { target: { value: `gate:${passwordId}` } });
  fireEvent.click(within(password).getByRole('button', { name: '保留一周' }));
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '旧密码保留多久？' })).toBeNull());
  await waitFor(() => expect(within(scope).queryByRole('option', { name: '关卡 · 旧密码保留多久？' })).toBeNull());
  fireEvent.change(within(chat).getByLabelText('消息'), { target: { value: '待发送' } });
  expect((within(chat).getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(scope, { target: { value: 'work' } });
  fireEvent.change(within(frequency).getByLabelText('回答'), { target: { value: '每分钟最多一次' } });
  fireEvent.click(within(frequency).getByRole('button', { name: '决定' }));
  await waitFor(() => expect(within(chat).queryByRole('region', { name: '验证码发送频率？' })).toBeNull());
  expect(await within(chat).findByText('每分钟最多一次')).toBeTruthy();
  expect(within(chat).getAllByText('已决定').length).toBeGreaterThanOrEqual(2);
  const decided = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(decided.find((item: any) => item.id === passwordId).decision).toBe('保留一周');
  expect(decided.find((item: any) => item.question === '验证码发送频率？').decision).toBe('每分钟最多一次');
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
  expect(await within(chat).findByText('读取派单结果', { selector: 'summary' })).toBeTruthy();
  const initialTime = within(chat).getByLabelText('本轮用时').textContent;
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
  expect(await within(chat).findByText('整理调度笔记', { selector: 'summary' })).toBeTruthy();
  fireEvent.change(input, { target: { value: '紧急补充' } });
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(await within(chat).findByText('已接收紧急消息', { selector: 'summary' })).toBeTruthy();
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
  expect(within(chat).getByText('保留原文 English', { selector: 'article p' })).toBeTruthy();
});

test('本轮步骤提取真实驱动输出中的文字与工具名称，详情仍可读取原始输出', async () => {
  const assistant = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '核对登录边界' }] } });
  const command = JSON.stringify({ method: 'item/started', params: { item: { type: 'commandExecution', command: 'npm run check' } } });
  await executingWork([[
    { type: 'output', text: assistant }, { type: 'output', text: command }, { type: 'hang' },
  ]]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  expect(await within(chat).findByText('核对登录边界', { selector: 'summary' })).toBeTruthy();
  expect(await within(chat).findByText('npm run check', { selector: 'summary' })).toBeTruthy();
  expect(within(chat).getByText(assistant, { selector: 'pre' })).toBeTruthy();
});

test('范围失效时空消息 Ctrl+Enter 仍能打断，打断按钮可终止下一轮且不产生空消息', async () => {
  const work = await executingWork([
    [gate('password', '旧密码保留多久？'), { type: 'hang' }],
    [{ type: 'output', text: '正在处理关卡决定' }, { type: 'hang' }],
  ]);
  render(<App baseUrl={daemon!.url} />);
  const chat = await screen.findByRole('region', { name: '对话' });
  const decision = await within(chat).findByRole('region', { name: '旧密码保留多久？' });
  const scope = within(chat).getByLabelText('关于');
  const option = within(scope).getByRole('option', { name: '关卡 · 旧密码保留多久？' });
  fireEvent.change(scope, { target: { value: (option as HTMLOptionElement).value } });
  fireEvent.click(within(decision).getByRole('button', { name: '保留一周' }));
  await within(chat).findByRole('option', { name: '范围已失效，请重新选择' });
  fireEvent.keyDown(within(chat).getByLabelText('消息'), { key: 'Enter', ctrlKey: true });
  expect(await within(chat).findByText('正在处理关卡决定', { selector: 'summary' })).toBeTruthy();
  const interrupt = within(chat).getByRole('button', { name: '打断本轮' });
  await waitFor(() => expect((interrupt as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(interrupt);
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[2]?.reason === 'aborted');
  const conversation = (await daemon!.call('get-conversation', { workId: work.id })).result;
  expect(conversation.filter((item: any) => item.type === 'message' && item.sender === 'user')).toHaveLength(1);
});
