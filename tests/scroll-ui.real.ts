// Outside the sandbox only, after npm run build:
// HELM_SCROLL_UI_REAL=1 node --test dist/tests/scroll-ui.real.js
// Uses fake Agents and headed Chromium; no real CLI login is needed.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';

test('对齐与执行对话滚动跟随、阅读历史、回到最新与切换工作的真实布局验收', {
  skip: process.env.HELM_SCROLL_UI_REAL !== '1', timeout: 90_000,
}, async t => {
  if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '须在沙箱外的显示服务运行，禁止无头模式');
  const evidence = await mkdtemp(join(tmpdir(), 'helm-scroll-ui-'));
  const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  const { chromium } = require('playwright') as typeof import('playwright');
  const browser = await chromium.launch({ channel: 'chrome-for-testing', headless: false });
  t.after(() => browser.close());
  let finishAlignment!: () => void;
  let finishExecution!: () => void;
  const daemon = await uiFixture([[
    { type: 'output', text: '正在整理工作说明' },
    { type: 'hang', until: new Promise<void>(resolve => { finishAlignment = resolve; }) },
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({
      workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: '登录', boundary: '登录页', criteria: '可登录',
    }) },
  ], [
    { type: 'output', text: '检查邮件模板' },
    { type: 'hang', until: new Promise<void>(resolve => { finishExecution = resolve; }) },
  ], [{ type: 'hang' }]], resolve('dist/ui'));
  t.after(() => daemon.close());
  const body = '滚动验收\n\n' + Array.from({ length: 70 }, (_, index) => `历史消息段落 ${index + 1}：用户正在阅读较早的内容。`).join('\n\n');
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body, key: 'start' })).result.work;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const history = page.getByRole('region', { name: '对话记录', exact: true });
  const arrow = page.getByRole('button', { name: '回到最新内容', exact: true });
  const bottom = () => history.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop <= 2);
  const latest = async () => {
    await until(bottom, value => value);
    assert.equal(await arrow.count(), 0);
    assert.ok(await history.evaluate(element => element.scrollTop > 0), '历史必须足够长以验证实际滚动');
  };
  const screenshot = async (name: string) => {
    assert.deepEqual(errors, [], '页面不应报错');
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' });
  };
  await page.goto(`${daemon.url}/works/${work.id}`);
  await history.getByText('历史消息段落 70：用户正在阅读较早的内容。', { exact: true }).waitFor();
  await latest();
  for (const phase of ['aligning', 'executing']) {
    if (phase === 'executing') {
      finishAlignment();
      const descriptions = await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
      await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
      const description = descriptions.result[0];
      assert.equal((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
      await page.locator('.conversation-dock').waitFor();
      await history.getByText('检查邮件模板', { exact: true }).waitFor();
      await latest();
    }
    for (const width of [1440, 945, 600]) {
      await page.setViewportSize({ width, height: 900 });
      await latest();
      const summary = page.getByRole('region', { name: '对话', exact: true }).locator('.conversation-round > summary');
      await summary.click();
      await latest();
      await summary.click();
      await latest();
      await history.evaluate(element => { element.scrollTop = 300; });
      await arrow.waitFor();
      const top = await history.evaluate(element => element.scrollTop);
      const message = `${phase}-${width}：阅读历史时到达的新消息`;
      assert.equal((await daemon.call('send-message', { workId: work.id, body: message, key: message })).ok, true);
      await history.getByText(message, { exact: true }).waitFor();
      // Let layout, ResizeObserver and scroll events settle before checking stability.
      await history.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.equal(await history.evaluate(element => element.scrollTop), top);
      const geometry = await arrow.evaluate(element => {
        const button = element.getBoundingClientRect(), region = element.parentElement!.getBoundingClientRect();
        return { width: button.width, height: button.height, radius: getComputedStyle(element).borderRadius,
          center: Math.abs((button.left + button.right - region.left - region.right) / 2), bottomGap: region.bottom - button.bottom };
      });
      assert.equal(geometry.width, 34);
      assert.equal(geometry.height, 34);
      assert.equal(geometry.radius, '50%');
      assert.ok(geometry.center <= 1 && Math.abs(geometry.bottomGap - 12) <= 1, '箭头须固定在对话区底部并居中');
      await screenshot(`${phase}-${width}-scrolled`);
      await arrow.click();
      await latest();
      await screenshot(`${phase}-${width}-latest`);
      const followMessage = `${phase}-${width}：回到最新后继续跟随`;
      await daemon.call('send-message', { workId: work.id, body: followMessage, key: followMessage });
      await history.getByText(followMessage, { exact: true }).waitFor();
      await latest();
    }
  }
  finishExecution();
  await page.getByText('本轮 1 步 · 已结束 · 最新：检查邮件模板', { exact: true }).waitFor();
  await latest();
  await screenshot('round-ended');
  const other = (await daemon.call('send-message', { projectId: daemon.project.id, body: `另一项工作\n\n${body}`, key: 'other' })).result.work;
  await page.goto(`${daemon.url}/works/${other.id}`);
  await history.getByText('历史消息段落 70：用户正在阅读较早的内容。', { exact: true }).waitFor();
  await latest();
  await history.evaluate(element => { element.scrollTop = 300; });
  await arrow.waitFor();
  await page.goBack();
  await history.getByText('executing-600：回到最新后继续跟随', { exact: true }).waitFor();
  await latest();
  assert.deepEqual(errors, []);
  console.log(`请按设计稿人工核对箭头位置、平滑滚动及截图：${evidence}`);
});
