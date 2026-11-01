// Outside the sandbox only, after npm run build:
// HELM_THINKING_UI_REAL=1 node --test dist/tests/thinking-ui.real.js
// Uses fake Agents and headed Chromium; no real CLI login is needed.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';

test('现在条与调度者检查器：思考、计划、原始步骤与结束折叠状态截图', { skip: process.env.HELM_THINKING_UI_REAL !== '1', timeout: 90_000 }, async t => {
  if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '须在沙箱外的显示服务运行，禁止无头模式');
  const evidence = await mkdtemp(join(tmpdir(), 'helm-thinking-ui-'));
  const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  const { chromium } = require('playwright') as typeof import('playwright');
  const browser = await chromium.launch({ channel: 'chrome-for-testing', headless: false });
  t.after(() => browser.close());
  const hold = () => {
    let release!: () => void;
    const until = new Promise<void>(resolve => { release = resolve; });
    return { step: { type: 'hang' as const, until }, release };
  };
  const alignOutput = hold(), alignFinish = hold(), firstOutput = hold(), clearPlan = hold(), finish = hold();
  const plan = [{ content: '读取验收结果', status: 'completed' as const }, { content: '安排后续卡片', status: 'in_progress' as const }, { content: '汇报进度', status: 'pending' as const }];
  const daemon = await uiFixture([[
    alignOutput.step, { type: 'output', text: '正在将验证码有效期补进工作说明\n保留原文第二行' }, alignFinish.step,
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: '邮箱验证码登录', boundary: '登录页', criteria: '有效期十分钟' }) },
  ], [
    firstOutput.step, { type: 'plan', entries: plan },
    { type: 'output', text: '读取卡片 3 的派单结果' }, { type: 'output', text: '安排卡片 3 验收' },
    { type: 'output', text: '卡片 3 的验收已安排，接下来检查邮件模板\n此行只在原始输出里显示' },
    clearPlan.step, { type: 'plan', entries: [] }, finish.step,
  ]], resolve('dist/ui'));
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '登录改版', key: 'start' })).result.work;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const chat = page.getByRole('region', { name: '对话', exact: true });
  const thinking = chat.getByRole('status').filter({ has: page.getByLabel('本轮用时', { exact: true }) });
  const nowStrip = page.getByRole('navigation', { name: '现在条', exact: true });
  const coordinator = nowStrip.getByRole('button', { name: /^调度者\s/ });
  const inspector = page.getByRole('complementary', { name: '调度者检查器', exact: true });
  const progress = inspector.getByRole('region', { name: '本轮步骤', exact: true });
  const screenshot = async (name: string) => {
    assert.deepEqual(errors, [], '页面不应报错');
    assert.equal(await chat.getByRole('alert').count(), 0);
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' });
  };
  await page.goto(`${daemon.url}/works/${work.id}`);
  await thinking.getByText('等待首次输出', { exact: true }).waitFor();
  await nowStrip.getByText('尚无步骤 · 等待首次输出', { exact: true }).waitFor();
  alignOutput.release();
  await thinking.getByText('正在将验证码有效期补进工作说明', { exact: true }).waitFor();
  await nowStrip.getByText('本轮 1 步 · 正在将验证码有效期补进工作说明', { exact: true }).waitFor();
  await screenshot('aligning-thinking-now-strip');
  alignFinish.release();
  const descriptions = await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  const description = descriptions.result[0];
  assert.equal((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  await thinking.getByText('等待首次输出', { exact: true }).waitFor();
  await coordinator.click();
  assert.equal(new URL(page.url()).searchParams.get('inspect'), 'coord');
  await progress.getByRole('heading', { name: '尚无步骤', exact: true }).waitFor();
  const elapsed = await progress.getByLabel('本轮用时', { exact: true }).innerText();
  await until(() => progress.getByLabel('本轮用时', { exact: true }).innerText(), value => value !== elapsed);
  await screenshot('thinking-start-coordinator-inspector');
  firstOutput.release();
  await progress.getByRole('heading', { name: '本轮第 2 / 3 步', exact: true }).waitFor();
  await nowStrip.getByText('第 2/3 步 · 安排后续卡片', { exact: true }).waitFor();
  await page.getByRole('button', { name: '收起检查器', exact: true }).click();
  await screenshot('thinking-now-strip-inspector-folded');
  await coordinator.click();
  await progress.getByRole('list', { name: '本轮计划', exact: true }).waitFor();
  await screenshot('thinking-coordinator-plan');
  const raw = progress.getByText('查看原始步骤 · 与计划分别计数 · 3', { exact: true });
  assert.equal(await raw.evaluate(element => element.closest('details')!.open), false);
  await raw.click();
  await progress.getByText('安排卡片 3 验收', { exact: true }).first().waitFor();
  assert.equal((await progress.getByLabel(/^输出间隔 \d+$/).allTextContents()).includes('00:00'), false);
  await screenshot('thinking-coordinator-raw-steps');
  await page.getByRole('button', { name: '收起检查器', exact: true }).click();
  clearPlan.release();
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.currentPlan.length === 0);
  await nowStrip.getByText('本轮 3 步 · 卡片 3 的验收已安排，接下来检查邮件模板', { exact: true }).waitFor();
  await screenshot('thinking-no-plan-now-strip');
  await coordinator.click();
  await progress.getByRole('heading', { name: '本轮 3 步 · 无本轮计划', exact: true }).waitFor();
  await progress.getByText('安排卡片 3 验收', { exact: true }).first().waitFor();
  assert.equal(await progress.getByRole('list', { name: '本轮计划', exact: true }).count(), 0);
  await screenshot('thinking-no-plan-coordinator-steps');
  finish.release();
  await progress.getByRole('heading', { name: '本轮 3 步 · 已结束', exact: true }).waitFor();
  assert.equal(await thinking.count(), 0);
  const ended = progress.getByText('调度轮次 #2 · 已结束 · 最近步骤', { exact: true });
  assert.equal(await ended.evaluate(element => element.closest('details')!.open), false);
  await screenshot('round-ended-coordinator-folded');
  await page.setViewportSize({ width: 945, height: 900 });
  await screenshot('round-ended-coordinator-narrow');
  console.log(`请按设计稿及提供的截图人工核对：${evidence}`);
});
