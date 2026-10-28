// Run outside the sandbox after npm run build:
// HELM_TOKEN_VISUAL=1 node dist/tests/token-usage.visual.js /private/tmp/helm-token-visual /path/to/design
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { uiFixture, until } from './ui-fixture.js';

if (process.env.HELM_TOKEN_VISUAL !== '1') throw new Error('Set HELM_TOKEN_VISUAL=1 outside the sandbox to run headed screenshot acceptance.');
const output = resolve(process.argv[2] ?? '/private/tmp/helm-token-visual');
const design = process.argv[3];
await mkdir(output, { recursive: true });
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const daemon = await uiFixture([[
  { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
    key: 'brief', requirements: 'Token 用量展示', boundary: '本机', criteria: '节点和明细可查' }), check: ok },
  { type: 'end', reason: 'completed', usage: { inputTokens: 10000, outputTokens: 2000 } },
], [
  { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: 'Token 示例卡片' }), saveAs: 'card', check: ok },
  { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
    cardId: (ctx.results.get('card') as any).result.id, key: 'dispatch', agentId: 'claude-executor' }), check: ok },
  { type: 'end', reason: 'completed', usage: { inputTokens: 5000, outputTokens: 1000 } },
]], resolve('dist/ui'), { executorScripts: [[{ type: 'end', reason: 'completed', usage: { inputTokens: 30000, outputTokens: 5000 } }]] });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: 'Token 验收', key: 'start' })).result.work;
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const shot = async (name: string) => page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  await page.goto(`${daemon.url}/works/${work.id}`);
  await page.getByText('Token 1.2万', { exact: true }).first().waitFor();
  await shot('aligning');
  const description = (await daemon.call('get-work-descriptions', { workId: work.id })).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  await until(() => daemon.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'ended');
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
  await page.goto(`${daemon.url}/works/${work.id}/structure`);
  const card = page.getByRole('button', { name: '卡片 1：Token 示例卡片' });
  await card.waitFor();
  await shot('default');
  await card.click();
  await page.getByRole('table', { name: '派单 Token', exact: true }).waitFor();
  await shot('card-tokens');
  await page.getByRole('button', { name: '调度者 Token 明细' }).click();
  await page.getByRole('table', { name: '调度轮次 Token', exact: true }).waitFor();
  await shot('coordinator-tokens');
  // These response fixtures isolate missing/empty display states without mutating the task store.
  for (const state of ['token-missing', 'token-empty']) {
    await page.route('**/api/*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      const unknown = { inputTokens: null, outputTokens: null };
      if (name === 'get-work') body.result.usage = unknown;
      if (['list-works', 'get-card-graph', 'list-dispatches'].includes(name!)) {
        body.result = state === 'token-empty' && name !== 'list-works' ? [] : body.result.map((row: any) => ({ ...row, usage: unknown }));
      }
      if (name === 'list-rounds') body.result.rounds = state === 'token-empty' ? [] : body.result.rounds.map((round: any) => ({ ...round, usage: unknown }));
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await page.getByRole('button', { name: '调度者 Token 明细' }).click();
    await page.getByText('Token 合计 —', { exact: true }).waitFor();
    await shot(state);
    await page.unrouteAll({ behavior: 'wait' });
  }
  if (design) for (const state of ['default', 'card-tokens', 'coordinator-tokens', 'token-missing', 'token-empty', 'aligning']) {
    await page.goto(`${pathToFileURL(resolve(design, 'main.html'))}?state=${state}&bar=0`);
    await shot(`design-${state}`);
  }
  console.log(`Screenshots: ${output}. Compare each state, inbox labels, node spacing, and input/output columns with the design.`);
} finally { await browser?.close(); await daemon.close(); }
