// Outside the sandbox only. npm test compiles this file but never executes it.
// Set HELM_DEEPSEEK_MISSING_CREDENTIAL_REAL=1 and HELM_DEEPSEEK_MISSING_MODEL
// to a full [provider, model] selector advertised by the installed dsh.
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import { acpExecutorFixture, ok } from './acp-executor-fixture.js';

async function checkUi(url: string, reason: string) {
  if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '需要有界面的 Chromium');
  const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-deepseek-credential-ui-')));
  const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  const { chromium } = require('playwright') as typeof import('playwright');
  const browser = await chromium.launch({ channel: 'chrome-for-testing', headless: false });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
    page.setDefaultTimeout(30_000);
    await page.goto(url);
    const inbox = page.getByRole('complementary', { name: 'Helm' });
    await inbox.getByText(reason, { exact: true }).waitFor();
    await page.screenshot({ path: join(evidence, 'inbox-unavailable.png'), fullPage: true });
    await inbox.getByRole('link', { name: 'deepseek-executor · 不可用', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Agent 详情' });
    await editor.getByText(reason).waitFor();
    await page.screenshot({ path: join(evidence, 'settings-unavailable.png'), fullPage: true });
    await page.setViewportSize({ width: 945, height: 900 });
    await page.screenshot({ path: join(evidence, 'settings-narrow.png'), fullPage: true });
    await editor.getByLabel('职责说明', { exact: true }).fill('重新检测时保留未保存输入');
    await editor.getByRole('button', { name: '重新检测', exact: true }).focus();
    await page.keyboard.press('Enter');
    await editor.getByText('可用', { exact: true }).waitFor();
    assert.equal(await editor.getByLabel('职责说明', { exact: true }).inputValue(), '重新检测时保留未保存输入');
    await inbox.getByText(reason, { exact: true }).waitFor({ state: 'detached' });
    await page.screenshot({ path: join(evidence, 'settings-rechecked.png'), fullPage: true });
    console.log(`请查看截图并对照 design/INDEX.md：${evidence}`);
  } finally { await browser.close(); }
}

test('真实 dsh 无 key 路由：派单失败后不可用，重新检测清除标记', {
  skip: process.env.HELM_DEEPSEEK_MISSING_CREDENTIAL_REAL !== '1', timeout: 120_000,
}, async t => {
  const model = process.env.HELM_DEEPSEEK_MISSING_MODEL;
  assert.ok(model, '请设置 HELM_DEEPSEEK_MISSING_MODEL 为 dsh 公布的完整无 key 路由');
  const route: unknown = JSON.parse(model);
  assert.ok(Array.isArray(route) && route.length === 2 && route.every(value => typeof value === 'string' && value.length > 0));
  // The fixture creates an empty temporary HOME without linking any credentials.
  // No browser is requested and no real account or API key is used.
  const daemon = await acpExecutorFixture(t, new AcpDriver('deepseek'), { agent: 'deepseek', model,
    content: '只回答 ok。' });
  const entry = async () => (await daemon.call('list-agents')).result.find((agent: any) => agent.id === 'deepseek-executor');
  assert.equal((await entry()).available, true, '该路由必须能在无 key 时通过 ACP 预检');
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'error', dispatch.failure);
  assert.match(dispatch.failure, /MISSING_CREDENTIAL|no API key for provider route/i);
  const unavailable = await entry();
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason, /API key.*dsh web.*Models/);
  assert.ok(unavailable.reason.includes(route[0]));
  assert.equal(unavailable.command, 'dsh web');
  assert.ok((await daemon.call('list-pending')).result.some((item: any) => item.kind === 'agent-unavailable' && item.agentId === unavailable.id));
  // Opt in separately; this branch launches headed Chromium only outside the sandbox.
  if (process.env.HELM_DEEPSEEK_CREDENTIAL_UI === '1') await checkUi(daemon.url, unavailable.reason);
  const rechecked = await daemon.call('recheck-agent', { id: unavailable.id });
  ok(rechecked);
  assert.equal(rechecked.result.available, true);
  assert.equal((await daemon.call('list-pending')).result.some((item: any) => item.agentId === unavailable.id), false);
  console.log(JSON.stringify({ model, failure: dispatch.failure, unavailable: { reason: unavailable.reason, command: unavailable.command }, rechecked: rechecked.result.available }));
});
