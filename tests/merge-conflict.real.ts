// Outside the sandbox only, after npm run build:
// HELM_MERGE_CONFLICT_REAL=1 node --test dist/tests/merge-conflict.real.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { AgentCatalog } from '../src/agents.js';
import { ClaudeDriver } from '../src/claude-driver.js';
import { startHelmd } from '../src/server.js';
import { configureTestAgent, fixtureAgentDir } from './helmd-fixture.js';

test('真实合入冲突：本地检测、调度者卡片解决与验收、查看改动、再次合入（有界面 Chromium）',
  { skip: process.env.HELM_MERGE_CONFLICT_REAL !== '1', timeout: 600_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-conflict-real-')));
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-conflict-evidence-')));
    console.log(`冲突冒烟截图和任务库：${evidence}`);
    let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
    let browser: Browser | undefined;
    t.after(async () => {
      try { await browser?.close(); }
      finally { try { await daemon?.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
    });
    const agentDir = join(directory, 'agents');
    for (const id of ['claude-coordinator', 'claude-executor']) {
      await cp(join(fixtureAgentDir, id), join(agentDir, id), { recursive: true });
      await configureTestAgent(agentDir, id, { model: 'haiku', reasoningEffort: 'low', fast: false, home: 'shared' });
    }
    await writeFile(join(agentDir, 'claude-coordinator', 'prompt.md'), `这是合入冲突真实冒烟。
对齐时 draft-work-description：需求是解决 shared.txt 的合并冲突，边界只改 shared.txt，标准是解决后 shared.txt 只有一行字面文本 RESOLVED-BOTH 加一个换行，基准提交是工作分支的祖先。
首次确认后（没有 delivery.resolution）直接 request-review，key=initial-review，按工具 schema 提交 report：verdict=accept，summary 写“冲突冒烟的起始审核”，exceptions=[]，criteria 填工作说明标准、status=passed、evidence=[{label:"初始代码",kind:"file",ref:"shared.txt"}]，cards=[]，suggestions=[]；初始代码由测试夹具准备，不建卡不派单。不提交 body。
收到 conflict-resolution-requested 后严格按角色规则的“接受后的合入冲突”执行。
只建一张 needsVerification=true 的冲突卡片，key=resolve，首行“解决 shared.txt 冲突”。只派 claude-executor，执行 key=resolve-execute。
执行者把 shared.txt 整个改写为一行字面文本 RESOLVED-BOTH 加一个换行（不保留 work 或 base 原文），禁止自行 git merge/add/commit，使用运行层预备的合并。
执行结束后派同一 Agent 的新上下文验收 key=resolve-verify，purpose=verification：用 Node 严格比较 shared.txt 内容为 'RESOLVED-BOTH\\n'，运行 git merge-base --is-ancestor <delivery.resolution.baseCommit> HEAD，必须提交 passed 或 failed 及证据。
验收 passed 后 complete-card，发消息、写笔记，最后 finish-conflict-resolution，立即退出。不要再 request-review，不合入基准、不推送。
各轮按启动简报接续，稳定 key，不重复派单；等派单时立即退出，不轮询，失败或受阻只报告。`);
    const claude = new ClaudeDriver();
    const availability = await claude.checkAvailability(new AgentCatalog(agentDir).get('claude-coordinator'));
    assert.equal(availability.available, true, availability.reason);
    const repo = join(directory, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    git('config', 'user.name', 'Helm Conflict Smoke'); git('config', 'user.email', 'smoke@localhost');
    await writeFile(join(repo, 'shared.txt'), 'baseline\n');
    git('add', 'shared.txt'); git('commit', '-m', 'baseline');
    daemon = await startHelmd({ port: 0, dataDir: join(evidence, 'data'), agentDir, drivers: { 'claude-sdk': claude } });
    const call = async (name: string, params: object = {}): Promise<any> => {
      const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      const body = await response.json() as any;
      assert.equal(body.ok, true, JSON.stringify(body));
      return body.result;
    };
    async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
      const deadline = Date.now() + 240_000;
      for (;;) {
        const value = await read();
        if (ready(value)) return value;
        assert.ok(Date.now() < deadline, `等待冲突流程超时：${JSON.stringify(value)}`);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    browser = await chromium.launch({ channel: 'chrome-for-testing', headless: false });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN' });
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const project = await call('register-project', { path: repo });
    for (const mode of ['manual', 'coordinator'] as const) {
      const { work } = await call('send-message', { projectId: project.id, key: mode, body: `冲突冒烟 ${mode}` });
      const descriptions = await until(() => call('get-work-descriptions', { workId: work.id }), values => values.length > 0);
      const description = descriptions.at(-1);
      await call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
      const gates = await until(() => call('get-conversation', { workId: work.id }), values => values.some((item: any) => item.kind === 'review'));
      const review = gates.find((item: any) => item.kind === 'review');
      const details = await call('get-work', { workId: work.id });
      // Create genuinely divergent Git histories, independently of the runtime merge implementation.
      await writeFile(join(details.workPath, 'shared.txt'), 'work\n');
      execFileSync('git', ['-C', details.workPath, 'add', 'shared.txt']);
      execFileSync('git', ['-C', details.workPath, 'commit', '-m', 'work change']);
      await writeFile(join(repo, 'shared.txt'), `base ${mode}\n`);
      git('add', 'shared.txt'); git('commit', '-m', `base ${mode}`);
      await call('decide-gate', { workId: work.id, gateId: review.id, decision: 'accept' });
      await page.goto(`${daemon.url}/works/${work.id}/brief`);
      const panel = page.getByRole('region', { name: '合入与推送', exact: true });
      await panel.getByRole('button', { name: '合入', exact: true }).click();
      await panel.getByRole('heading', { name: '合入冲突，待合入', exact: true }).waitFor();
      assert.equal(await panel.getByRole('cell', { name: 'shared.txt', exact: true }).count(), 1);
      await page.screenshot({ path: join(evidence, `${mode}-conflict.png`) });
      if (mode === 'manual') {
        await panel.getByRole('button', { name: '我自己处理', exact: true }).click();
        await panel.getByRole('heading', { name: '等待你处理冲突', exact: true }).waitFor();
        await panel.getByRole('button', { name: '重新检测', exact: true }).click();
        await panel.getByRole('status').waitFor();
        await page.screenshot({ path: join(evidence, 'conflict-manual.png') });
        assert.throws(() => git('merge', '--no-edit', details.workBranch));
        await writeFile(join(repo, 'shared.txt'), 'manual resolution\n');
        git('add', 'shared.txt'); git('commit', '-m', 'manual resolution');
        await panel.getByRole('button', { name: '重新检测', exact: true }).click();
        await panel.getByRole('heading', { name: '已包含，待推送', exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, 'already-merged.png') });
      } else {
        await panel.getByRole('button', { name: '交给调度者解决', exact: true }).click();
        await panel.getByRole('heading', { name: '调度者正在解决冲突', exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, 'conflict-solving.png') });
        await until(() => call('get-work', { workId: work.id }), value => value.status === 'accepted' && value.delivery.resolution?.status === 'resolved');
        await panel.getByRole('button', { name: '查看冲突解决改动', exact: true }).click();
        await panel.locator('pre').waitFor();
        assert.match(await panel.locator('pre').innerText(), /\+RESOLVED-BOTH/);
        await page.screenshot({ path: join(evidence, 'conflict-resolved.png') });
        const changes = await call('get-conflict-resolution', { workId: work.id });
        assert.equal(changes.cards.length, 1);
        assert.ok(changes.cards[0].verificationId);
        await panel.getByRole('button', { name: '再次合入', exact: true }).click();
        await panel.getByRole('heading', { name: '已合入，待推送', exact: true }).waitFor();
        assert.equal(await readFile(join(repo, 'shared.txt'), 'utf8'), 'RESOLVED-BOTH\n');
      }
      assert.equal((await call('get-work', { workId: work.id })).status, 'merged');
      const finalGates = (await call('get-conversation', { workId: work.id })).filter((item: any) => item.kind === 'review');
      assert.equal(finalGates.length, 1); assert.equal(finalGates[0].decision, 'accept');
      assert.equal(git('status', '--porcelain'), '');
    }
    assert.deepEqual(errors, []);
  });
