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

test('思考提示与折叠步骤的五种设计状态截图', { skip: process.env.HELM_THINKING_UI_REAL !== '1', timeout: 90_000 }, async t => {
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
  const thinking = chat.locator('.conversation-thinking');
  const round = chat.locator('.conversation-round');
  const screenshot = async (name: string) => {
    assert.deepEqual(errors, [], '页面不应报错');
    assert.equal(await chat.getByRole('alert').count(), 0);
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' });
  };
  await page.goto(`${daemon.url}/works/${work.id}`);
  await thinking.getByText('等待首次输出', { exact: true }).waitFor();
  alignOutput.release();
  await thinking.getByText('正在将验证码有效期补进工作说明', { exact: true }).waitFor();
  assert.equal(await round.evaluate(element => (element as HTMLDetailsElement).open), false);
  await screenshot('aligning-thinking');
  alignFinish.release();
  const descriptions = await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  const description = descriptions.result[0];
  assert.equal((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  await chat.locator('.conversation-dock').waitFor();
  await thinking.getByText('等待首次输出', { exact: true }).waitFor();
  const elapsed = await thinking.locator('time').innerText();
  await page.waitForFunction(previous => document.querySelector('.conversation-thinking time')?.textContent !== previous, elapsed);
  await screenshot('thinking-start');
  firstOutput.release();
  await round.getByText('本轮 3 步 · 最新：卡片 3 的验收已安排，接下来检查邮件模板', { exact: true }).waitFor();
  await screenshot('thinking');
  await round.locator(':scope > summary').click();
  await round.getByRole('list', { name: '本轮计划', exact: true }).waitFor();
  await screenshot('thinking-expanded');
  await round.getByText('执行步骤 · 3', { exact: true }).click();
  await round.locator('.conversation-steps summary').filter({ hasText: /^安排卡片 3 验收$/ }).waitFor();
  assert.equal(await round.locator('li time').filter({ hasText: /^00:00$/ }).count(), 0);
  await screenshot('thinking-expanded-steps');
  await round.locator(':scope > summary').click();
  clearPlan.release();
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.currentPlan.length === 0);
  await round.locator('.plan-steps').waitFor({ state: 'detached' });
  await screenshot('thinking-no-plan');
  await round.locator(':scope > summary').click();
  await round.locator('.conversation-steps summary').filter({ hasText: /^安排卡片 3 验收$/ }).waitFor();
  assert.equal(await round.getByRole('list', { name: '本轮计划', exact: true }).count(), 0);
  await screenshot('thinking-no-plan-expanded');
  finish.release();
  await round.getByText('本轮 3 步 · 已结束 · 最新：卡片 3 的验收已安排，接下来检查邮件模板', { exact: true }).waitFor();
  assert.equal(await thinking.count(), 0);
  assert.equal(await round.evaluate(element => (element as HTMLDetailsElement).open), false);
  await screenshot('round-ended');
  await page.setViewportSize({ width: 945, height: 900 });
  await screenshot('round-ended-narrow');
  console.log(`请按设计稿及提供的截图人工核对：${evidence}`);
});
