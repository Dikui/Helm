// Outside the sandbox only, after building:
// Requires Claude login in the runner's HOME, like the other Claude real tests.
// HELM_UI_REAL=1 node --test dist/tests/ui.real.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Browser, Locator, Page } from 'playwright';
import { ClaudeDriver } from '../src/claude-driver.js';
import { startHelmd } from '../src/server.js';
import { AgentCatalog } from '../src/agents.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { configureTestAgent, removeUnlessFailed } from './helmd-fixture.js';
import { uiFixture, until } from './ui-fixture.js';
import { reviewReport } from './fixtures/review-report.js';
import { gitInitializationFixture } from './fixtures/git-initialization.js';

const enabled = process.env.HELM_UI_REAL === '1';
const title = 'UI 冒烟：添加 smoke.txt';
const readyMessage = 'UI_SMOKE_READY_FOR_REVIEW';
const reviewMessage = '请发起审核';
const changeTitle = '添加 smoke.txt';
const verificationTitle = '整体验收 smoke.txt';
const executionQuestion = '开始 smoke.txt 执行？';
const contents = 'helm-ui-smoke\n';

test('初始化 git 关卡：收件箱与工作对话、中英文、编辑规则、失败重试和拒绝截图', { skip: !enabled, timeout: 90_000 }, async t => {
  const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-git-initialization-ui-')));
  const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  const { chromium } = require('playwright') as typeof import('playwright');
  const browser = await chromium.launch({ channel: 'chrome-for-testing', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', colorScheme: 'light' });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const existingIgnore of [false, true]) {
    const fixture = await gitInitializationFixture(existingIgnore, resolve('dist/ui'));
    try {
      await page.goto(`${fixture.daemon.url}/works/${fixture.work.id}`);
      const chat = page.getByRole('region', { name: '对话', exact: true });
      const pin = chat.getByRole('group', { name: '初始化 git', exact: true });
      await pin.getByRole('button', { name: '检查提交概况', exact: true }).click();
      const gate = page.getByRole('dialog', { name: '检查提交概况', exact: true });
      await gate.getByText('预计提交文件数', { exact: true }).waitFor();
      await page.screenshot({ path: join(evidence, existingIgnore ? 'git-init-existing-rules-dialog-zh.png' : 'git-init-suggested-rules-dialog-zh.png'), animations: 'disabled' });
      if (!existingIgnore) {
        const rules = gate.getByLabel('忽略规则', { exact: true });
        await rules.fill('*\n');
        await gate.getByRole('button', { name: '同意并初始化', exact: true }).click();
        await gate.getByRole('alert').waitFor();
        assert.equal(await rules.inputValue(), '*\n');
        await page.screenshot({ path: join(evidence, 'git-init-rules-dialog-failed-retry.png'), animations: 'disabled' });
        await rules.fill('.env\nnode_modules/\n');
        await gate.getByRole('button', { name: '同意并初始化', exact: true }).click();
        await gate.waitFor({ state: 'hidden' });
        await chat.getByText('关卡已决定 · 初始化 git · initialize', { exact: true }).click();
        await chat.getByText('git 已初始化，卡片已解除这项阻塞，可重新派单。', { exact: true }).waitFor();
        assert.equal(await readFile(join(fixture.projectPath, '.gitignore'), 'utf8'), '.env\nnode_modules/\n');
        await page.screenshot({ path: join(evidence, 'git-init-conversation-initialized.png'), animations: 'disabled' });
      } else {
        assert.equal(await gate.getByLabel('忽略规则', { exact: true }).count(), 0);
        const sidebar = page.getByRole('complementary', { name: 'Helm', exact: true });
        await gate.getByRole('button', { name: '关闭', exact: true }).click();
        await sidebar.getByRole('button', { name: /^快速决定：/ }).click();
        await sidebar.getByRole('button', { name: 'EN', exact: true }).click();
        const inboxGate = sidebar.getByRole('group', { name: 'Initialize git', exact: true });
        await inboxGate.getByText('The existing .gitignore will be used. Helm will leave it unchanged.', { exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, 'git-init-inbox-quick-decision-en.png'), animations: 'disabled' });
        await inboxGate.getByLabel('Comment (required to refuse)', { exact: true }).fill('Keep this directory outside git');
        await inboxGate.getByRole('button', { name: 'Refuse initialization', exact: true }).click();
        const englishChat = page.getByRole('region', { name: 'Chat', exact: true });
        await englishChat.getByText('Gate decided · 初始化 git · refuse', { exact: true }).click();
        await englishChat.getByText('Initialization was refused. The card stays blocked; the coordinator can switch it to a scratch directory or cancel it.', { exact: true }).waitFor();
        await page.setViewportSize({ width: 720, height: 900 });
        await page.screenshot({ path: join(evidence, 'git-init-refused-narrow-en.png'), animations: 'disabled' });
      }
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await fixture.daemon.close(); }
  }
  console.log(`初始化 git 关卡截图：${evidence}`);
});

test('临时目录工作审核显示无代码改动，接受即完成且没有交付按钮', { skip: !enabled, timeout: 90_000 }, async t => {
  const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-scratch-ui-')));
  let release!: () => void;
  const executionEnded = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: '分析项目', boundary: '只读', criteria: '给出分析结论' }) },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'research', content: '分析项目', workspace: 'scratch' }), saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, cardId: (ctx.results.get('card') as any).result.id, key: 'execute', agentId: 'claude-executor' }) },
    { type: 'hang', until: executionEnded },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, cardId: (ctx.results.get('card') as any).result.id }) },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'review', report: reviewReport('只读分析已完成') }) },
  ]], resolve('dist/ui'), { executorScripts: [[{ type: 'output', text: '分析完成，没有代码改动。' }]] });
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '分析项目' })).result.work;
  const description = (await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1)).result[0];
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  assert.equal((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  await until(() => daemon.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'ended');
  release();
  await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'awaiting-review');
  const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
  const { chromium } = require('playwright') as typeof import('playwright');
  const browser = await chromium.launch({ channel: 'chrome-for-testing', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', colorScheme: 'light' });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${daemon.url}/works/${work.id}?inspect=report`);
  const review = page.getByRole('region', { name: '审核', exact: true });
  await review.getByText('退回必须附意见。这项工作没有代码改动，接受后将直接完成。', { exact: true }).waitFor();
  await review.getByText('审核记录与全部改动', { exact: true }).click();
  await review.getByText('这项工作没有代码改动。', { exact: true }).waitFor();
  assert.equal(await review.getByRole('button', { name: '查看 diff', exact: true }).count(), 0);
  assert.equal(await review.getByText(/无法读取.*diff/).count(), 0);
  await page.screenshot({ path: join(evidence, 'scratch-report-inspector.png'), animations: 'disabled' });
  await review.getByRole('button', { name: '接受', exact: true }).click();
  const delivery = page.getByRole('region', { name: '合入与推送', exact: true });
  await delivery.getByRole('heading', { name: '已完成 · 无代码改动', exact: true }).waitFor();
  await delivery.getByText('这项工作没有代码改动，已完成。', { exact: true }).waitFor();
  assert.equal(await delivery.getByRole('button', { name: /合入|推送/ }).count(), 0);
  assert.equal(await delivery.getByText(/只读|违规/).count(), 0);
  await delivery.getByRole('button', { name: '导出', exact: true }).waitFor();
  await delivery.getByRole('button', { name: '删除输出', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(evidence, 'scratch-delivery-completed.png'), animations: 'disabled' });
  console.log(`临时目录工作审核与完成截图：${evidence}`);
});

// Keep the real model's job small, and hold the review until the UI has visited execution views.
const coordinatorPrompt = `这是界面真实冒烟，使用真实 Helm 工具，所有 key 稳定复用，不重复建对象。
只用 helm MCP 工具；不启动浏览器、不安装、不派生子代理、不推送、不部署、不用 shell 写代码。
对齐：立即 draft-work-description（key=ui-brief），需求为新增 smoke.txt，边界为仅一个文件，
标准为文件内容恰好是 helm-ui-smoke 加一个换行；不追问。未确认前退出等待。
确认后：先 propose-gate（key=ui-execution-gate，question 原样为「${executionQuestion}」，options=["继续执行","暂缓执行"]），退出等待。
只有该关卡决定为「继续执行」后才创建以下两张卡片；每轮先读关卡状态，不重复提问：
1. key=ui-change，content 首行必须是「${changeTitle}」，needsVerification=false；
   派 claude-executor 执行（key=ui-execute，purpose=execution，needsBrowser=false），
   content 要求用 Write 新增 smoke.txt，内容为 helm-ui-smoke 加换行，不提交不推送，
   必须调用 submit-conclusion(completed)，最终回答记录实际写入内容。
2. key=ui-overall，content 首行必须是「${verificationTitle}」，needsVerification=true，依赖第一张卡片。
执行派单结束且 conclusion=completed 后 complete-card 第一张卡片；
然后给第二张派 claude-executor 验收（key=ui-verify，purpose=verification，needsBrowser=false），
content 要求用 Read 核对 smoke.txt，用 Node 读取后严格比较含换行的字符串，
并用 git diff --name-only origin/main HEAD 确认只改 smoke.txt；必须 submit-conclusion(passed 或 failed)。
验收结束且 passed 后 complete-card 第二张。异常或受阻只报告，不额外派单、不重试、不假装成功。
两张卡片都完成后 send-message（key=ui-ready，body 原样为：${readyMessage} \`smoke.txt\`），写笔记后退出。
只有用户最新消息的正文完全等于「${reviewMessage}」才 request-review（key=ui-review），按工具 schema 填结构化 report：verdict=accept；summary 一两句结论；exceptions=[]；criteria 覆盖工作说明的标准且 status=passed，每项 evidence 链接实际成果或验收派单回答；cards 列出实际卡片结果、验收、evidence 和 dispatches；suggestions=[]。不提交 body，命令原文和 id 只放证据引用与行详情字段。
每次从启动简报读当前卡片和派单状态，不重复执行已完成的阶段；等待时立即退出，不轮询。
最多一张执行卡片和一张整体验收卡片、一次执行派单和一次验收派单。不要新增技能、文件或测试。`;

async function click(control: Locator) {
  await control.waitFor({ state: 'visible' });
  // Playwright's actionability check waits for enabled, stable and unobscured before clicking.
  await control.click({ trial: true });
  await control.click();
}

// Poll visible UI with a bounded phase deadline. No business API calls or synthetic state.
async function eventually(page: Page, check: () => Promise<boolean>, message: string, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    assert.equal(await page.getByRole('alert').count(), 0, `界面错误：${await page.getByRole('alert').allTextContents()}`);
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function visible(locator: Locator) { await locator.waitFor({ state: 'visible' }); }

function workHeader(page: Page) {
  return page.getByRole('banner', { name: '工作概况', exact: true });
}

test('界面真实冒烟：新建 → 对齐确认 → 关卡 → 执行 → 审核 → 合入，真实 Claude 与 Chromium 截图',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-ui-real-')));
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-ui-real-output-')));
    console.log(`UI 冒烟截图目录（保留供人工对照 design/INDEX.md）：${evidence}`);
    let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
    let browser: Browser | undefined;
    t.after(async () => {
      try { await browser?.close(); }
      finally {
        try { await daemon?.close(); }
        finally { await removeUnlessFailed(t, directory); }
      }
    });

    const agentDir = join(directory, 'agents');
    for (const id of ['claude-coordinator', 'claude-executor']) {
      await cp(join(fixtureAgentDir, id), join(agentDir, id), { recursive: true });
      await configureTestAgent(agentDir, id, { model: 'haiku', reasoningEffort: id === 'claude-coordinator' ? 'medium' : 'low', fast: false, home: 'shared' });
    }
    await writeFile(join(agentDir, 'claude-coordinator', 'prompt.md'), coordinatorPrompt);
    const claude = new ClaudeDriver();
    const availability = await claude.checkAvailability(new AgentCatalog(agentDir).get('claude-coordinator'));
    assert.equal(availability.available, true,
      `${availability.reason}\n请先在沙箱外登录 Claude CLI。`);

    const repo = join(directory, 'project');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    git('config', 'user.name', 'Helm UI Smoke');
    git('config', 'user.email', 'helm-ui@example.invalid');
    await writeFile(join(repo, 'README.md'), 'UI smoke baseline\n');
    git('add', 'README.md');
    git('commit', '-m', 'baseline');
    const remote = join(directory, 'origin.git');
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    git('remote', 'add', 'origin', remote);
    git('push', '-u', 'origin', 'main');
    const baseline = git('rev-parse', 'HEAD');
    git('branch', 'release/1.0');

    // This is the same helmd HTTP/MCP/SSE/static server used by `helm serve`, with real drivers.
    // Limit the catalog to Claude so availability probes cannot start other agent CLIs.
    daemon = await startHelmd({ port: 0, dataDir: join(evidence, 'data'), agentDir, drivers: { 'claude-sdk': claude } });
    const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    // Playwright's bundled Chrome for Testing, headless; never system Chrome.
    browser = await chromium.launch({ channel: 'chrome-for-testing', headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const main = page.getByRole('main');
    // The native file-preview dialog makes the sidebar inert, but its SSE status remains visible.
    const sidebar = page.getByRole('complementary', { name: 'Helm', exact: true, includeHidden: true });
    const screenshot = async (name: string, ...state: Locator[]) => {
      for (const element of state) await visible(element);
      await visible(sidebar.getByText('实时更新已连接', { exact: true }));
      assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allTextContents().then(lines => lines.join('\n')));
      assert.deepEqual(pageErrors, [], '截图前必须没有页面异常');
      const path = join(evidence, `${name}.png`);
      // The app scrolls inside fixed-height panels; fullPage adds off-screen blank overflow.
      await page.screenshot({ path, fullPage: false, animations: 'disabled' });
      console.log(`UI 截图 ${name}：${path}`);
    };

    await page.goto(daemon.url);
    await screenshot('01-empty-inbox', sidebar.getByText('收件箱是空的', { exact: true }), main.getByRole('heading', { name: '还没有工作', level: 1, exact: true }));
    await click(sidebar.getByRole('link', { name: '新建工作', exact: true }));
    const newWork = page.getByRole('dialog', { name: '新建工作', exact: true });
    await visible(newWork.getByRole('heading', { name: '先登记一个项目', level: 1, exact: true }));
    await newWork.getByLabel('项目路径', { exact: true }).fill(repo);
    await click(newWork.getByRole('button', { name: '登记', exact: true }));
    await newWork.getByRole('combobox', { name: '调度者 Agent', exact: true }).selectOption('claude-coordinator');
    const base = newWork.getByRole('combobox', { name: '基准分支', exact: true });
    await eventually(page, async () => await base.isEnabled() && await base.inputValue() === 'main', '等待默认基准分支超时');
    await newWork.getByLabel('需求', { exact: true }).fill(`${title}\n只新增 smoke.txt，内容恰好是 helm-ui-smoke 加一个换行，其他文件不改。请直接起草工作说明，确认后交真实 Claude 执行和整体验收。完成后发 ${readyMessage} 并等待下一条用户消息再审核。`);
    await click(newWork.getByText('附件与项目上下文', { exact: true }));
    await screenshot('02-new-work-dialog', newWork.getByRole('button', { name: '开始', exact: true }), newWork.getByText(repo, { exact: true }));
    await base.selectOption('release/1.0');
    assert.equal(await base.inputValue(), 'release/1.0');
    await screenshot('02b-new-work-base-selected', base);
    await base.selectOption('main');
    const projectMenu = newWork.getByRole('menu', { name: '选择项目', exact: true });
    const plain = join(directory, 'read-only-project');
    await mkdir(plain);
    await click(newWork.getByRole('button', { name: '项目: project', exact: true }));
    await click(projectMenu.getByRole('menuitem', { name: '登记项目', exact: true }));
    const registration = page.getByRole('dialog', { name: '登记项目', exact: true });
    await registration.getByLabel('项目路径', { exact: true }).fill(plain);
    await visible(registration.getByText('选择或输入一个已有的本机目录，也可以新建目录，无需 git。git 项目的路径会归一到工作树根目录；已登记的路径直接返回原项目。', { exact: true }));
    assert.equal(await registration.getByRole('button', { name: /初始化|新建目录/ }).count(), 0);
    await screenshot('02c-new-work-register-project-dialog', registration);
    await click(registration.getByRole('button', { name: '登记', exact: true }));
    await registration.waitFor({ state: 'hidden' });
    await visible(newWork.getByText('本项目尚未初始化 git，可以先对齐或派临时目录卡片。首次写代码或验收派单前，运行层会请你决定是否初始化。', { exact: true }));
    assert.equal(await newWork.getByRole('combobox', { name: '基准分支', exact: true }).isDisabled(), true);
    assert.equal(await newWork.getByRole('button', { name: '开始', exact: true }).isEnabled(), true);
    assert.equal(existsSync(join(plain, '.git')), false);
    await screenshot('02d-new-work-non-git-dialog', newWork.getByText(plain, { exact: true }));
    await click(newWork.getByRole('button', { name: '项目: read-only-project', exact: true }));
    await click(projectMenu.getByRole('menuitemradio', { name: /^project / }));
    await eventually(page, async () => await base.isEnabled() && await base.inputValue() === 'main', '切回 git 项目后等待基准分支超时');
    await click(newWork.getByRole('button', { name: '开始', exact: true }));
    await visible(workHeader(page).getByRole('heading', { level: 1, name: title, exact: true }));
    const nowStrip = page.getByRole('navigation', { name: '现在条', exact: true });
    const conversation = page.getByRole('region', { name: '对话', exact: true });
    const brief = page.getByRole('complementary', { name: '工作说明', exact: true });
    const confirm = conversation.getByRole('button', { name: '确认，开始拆卡片', exact: true });
    await eventually(page, () => confirm.isEnabled().catch(() => false), '等待真实调度者起草工作说明超时');
    assert.match(await brief.innerText(), /smoke\.txt/);
    await visible(brief.getByText('对齐阶段只读项目目录；确认工作说明不会建立工作副本。第一张写代码卡片的执行派单前，才从基准分支的最新提交建立工作分支和工作副本。', { exact: true }));
    await visible(brief.getByText('第一张写代码卡片执行派单前创建', { exact: true }));
    const workId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
    const workPath = join(evidence, 'data', 'worktrees', workId, '_work');
    assert.equal(existsSync(workPath), false, '对齐阶段不建立工作副本');
    assert.equal(git('branch', '--list', `helm/${workId}`), '', '对齐阶段不建立工作分支');
    await screenshot('03-aligning-spec-and-confirmation-pin', workHeader(page).getByText(/^对齐中(?:\s*·|$)/), brief.getByRole('heading', { name: '验收', exact: true }), confirm);
    await click(confirm);
    await visible(workHeader(page).getByText(/^执行中(?:\s*·|$)/));
    const executionGate = conversation.getByRole('group', { name: executionQuestion, exact: true });
    await eventually(page, () => executionGate.isVisible(), '等待执行决策关卡超时');
    await screenshot('04-execution-gate-pin', executionGate.getByRole('button', { name: '继续执行', exact: true }), nowStrip);
    await executionGate.getByRole('button', { name: '继续执行', exact: true }).focus();
    await page.keyboard.press('1');
    await executionGate.waitFor({ state: 'hidden' });
    await visible(conversation.getByText(`关卡已决定 · ${executionQuestion} · 继续执行`, { exact: true }));
    await screenshot('04b-executing-conversation', conversation, conversation.getByLabel('消息', { exact: true }), conversation.getByRole('button', { name: '打断本轮', exact: true }), nowStrip);

    const structureTab = async (name: string) => {
      await click(nowStrip.getByRole('button', { name: '结构', exact: true }));
      await click(page.getByRole('tab', { name, exact: true }));
      assert.equal(new URL(page.url()).searchParams.get('inspect'), name === '依赖图' ? 'graph' : 'timeline');
      await visible(conversation);
    };
    await structureTab('依赖图');
    const graph = page.getByRole('region', { name: '卡片图', exact: true });
    const card = graph.getByRole('button', { name: /^卡片 \d+：添加 smoke\.txt$/ });
    await eventually(page, () => card.isVisible(), '等待真实调度者建卡超时');
    await screenshot('05-structure-graph', graph, conversation);
    await click(card);
    const inspector = page.getByRole('complementary', { name: '卡片检查器', exact: true });
    await eventually(page, () => inspector.getByRole('button', { name: '派单 #1 · 执行', exact: true }).isVisible(), '等待真实执行派单超时');
    assert.match(new URL(page.url()).searchParams.get('inspect')!, /^card:/);
    assert.equal(existsSync(workPath), true, '写代码执行派单前必须建立工作副本');
    assert.equal(execFileSync('git', ['-C', workPath, 'branch', '--show-current'], { encoding: 'utf8' }).trim(), `helm/${workId}`);
    assert.equal(await readFile(join(workPath, 'README.md'), 'utf8'), 'UI smoke baseline\n');
    await screenshot('05b-card-inspector', conversation, inspector.getByRole('heading', { name: changeTitle, exact: true }), inspector.getByRole('heading', { name: /^派单历史\s+1$/ }));

    const ready = conversation.getByRole('article').filter({ has: page.getByText('调度者', { exact: true }), hasText: readyMessage });
    await eventually(page, () => ready.isVisible(), '等待真实执行和整体验收完成超时');
    // The coordinator's message names a file on the work branch; it opens in the preview dialog.
    await click(ready.getByRole('link', { name: 'smoke.txt', exact: true }));
    const preview = page.getByRole('dialog', { name: 'smoke.txt', exact: true });
    const fileContents = preview.getByText(contents.trim(), { exact: true });
    assert.equal((await fileContents.innerText()).trim(), contents.trim());
    await screenshot('05c-conversation-file-preview', fileContents);
    await click(preview.getByRole('button', { name: '关闭', exact: true }));
    await structureTab('依赖图');
    await click(card);
    const executionHistory = inspector.getByRole('listitem').filter({ has: page.getByRole('button', { name: '派单 #1 · 执行', exact: true }) });
    await visible(executionHistory.getByText(/^claude-executor\s*·\s*自报完成$/));
    await structureTab('依赖图');
    assert.equal(await graph.getByRole('button', { name: /^卡片 \d+：/ }).count(), 2);
    await click(page.getByRole('tab', { name: '时间线', exact: true }));
    const timeline = page.getByRole('region', { name: '时间线', exact: true });
    await visible(timeline.getByRole('button', { name: '派单 #1 · 执行', exact: true }));
    await visible(timeline.getByRole('button', { name: /^调度轮次 #\d+$/ }).first());
    await screenshot('06-structure-timeline', timeline.getByRole('group', { name: /^卡片 \d+：添加 smoke\.txt$/ }),
      timeline.getByRole('group', { name: /^卡片 \d+：整体验收 smoke\.txt$/ }).getByRole('button', { name: '派单 #1 · 验收 ✓', exact: true }));

    await visible(ready);
    await conversation.getByLabel('消息', { exact: true }).fill(reviewMessage);
    await click(conversation.getByRole('button', { name: '发送', exact: true }));
    await eventually(page, () => workHeader(page).getByText(/^待你审核(?:\s*·|$)/).isVisible(), '等待真实调度者发起审核超时');
    // The inspector resets to the review default in an effect after the header updates.
    await eventually(page, async () => new URL(page.url()).searchParams.get('inspect') === 'report', '审核阶段检查器未切到汇总报告');
    const review = page.getByRole('region', { name: '审核', exact: true });
    const gate = review.getByRole('group', { name: '审核', exact: true });
    await visible(review.getByRole('heading', { name: '建议接受', exact: true }));
    const reportResponse = await fetch(`${daemon.url}/api/get-conversation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workId }) });
    const report = await reportResponse.json() as any;
    assert.equal(report.ok, true, JSON.stringify(report));
    const reportGate = report.result.find((item: any) => item.kind === 'review');
    assert.equal(reportGate.report.verdict, 'accept');
    assert.ok(reportGate.report.criteria.length > 0);
    assert.ok(reportGate.report.criteria.every((item: any) => item.evidence.length > 0));
    const criteriaSummary = gate.getByText(/^\d+ 条标准均有验收证据$/);
    await visible(criteriaSummary);
    assert.equal(await criteriaSummary.evaluate(element => element.closest('details')!.open), false);
    assert.equal(await gate.getByText(/^卡片表 · \d+ 张卡片$/).evaluate(element => element.closest('details')!.open), false);
    assert.equal(await gate.getByText('建议 · 不构成退回理由', { exact: true }).count(), 0);
    const verdictBox = await gate.getByRole('heading', { name: '建议接受', exact: true }).boundingBox();
    const reviewPin = conversation.getByRole('group', { name: '审核', exact: true });
    const acceptBox = await reviewPin.getByRole('button', { name: '接受，进入待合入', exact: true }).boundingBox();
    assert.ok(verdictBox && acceptBox && verdictBox.y >= 0 && acceptBox.y + acceptBox.height <= page.viewportSize()!.height,
      '审核首屏应同时容纳结论、例外、折叠标准和接受入口');
    await screenshot('07-review-report-and-pin', review, reviewPin);
    await click(gate.getByText('审核记录与全部改动', { exact: true }));
    assert.equal(await gate.getByLabel('未声明结论的派单', { exact: true }).innerText(), '0');
    // Full changes open in a modal; the inspector's audit fold is a separate disclosure.
    await click(gate.getByRole('button', { name: '查看全部改动', exact: true }));
    const changes = page.getByRole('dialog', { name: '查看全部改动', exact: true });
    await visible(changes.getByRole('heading', { name: '整体验收', exact: true }));
    await visible(changes.getByText('通过', { exact: true }));
    assert.equal(await changes.getByLabel('未声明结论的派单', { exact: true }).innerText(), '0');
    await page.screenshot({ path: join(evidence, '07a-review-changes-dialog.png'), animations: 'disabled' });
    await click(changes.getByRole('button', { name: '查看 diff', exact: true }));
    const diff = changes.getByLabel('Diff 内容', { exact: true });
    await visible(diff);
    assert.match(await diff.innerText(), /\+helm-ui-smoke/);
    await screenshot('07b-review-audit-diff', changes, diff);
    await click(changes.getByRole('button', { name: '关闭', exact: true }));
    await changes.waitFor({ state: 'hidden' });
    await click(reviewPin.getByRole('button', { name: '接受，进入待合入', exact: true }));
    const delivery = page.getByRole('region', { name: '合入与推送', exact: true });
    const deliveryPin = conversation.getByRole('group', { name: '合入与推送', exact: true });
    await eventually(page, async () => new URL(page.url()).searchParams.get('inspect') === 'delivery', '接受后检查器未切到交付');
    await visible(delivery.getByRole('heading', { name: '待合入', exact: true }));
    assert.equal(git('rev-parse', 'main'), baseline);
    assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), baseline);
    await screenshot('07c-accepted-delivery-and-pin', delivery, deliveryPin);
    await click(delivery.getByRole('button', { name: '撤回接受', exact: true }));
    await eventually(page, async () => new URL(page.url()).searchParams.get('inspect') === 'report', '撤回接受后检查器未切回汇总报告');
    await visible(gate.getByRole('button', { name: '接受', exact: true }));
    assert.equal(git('rev-parse', 'main'), baseline);
    await click(gate.getByRole('button', { name: '接受', exact: true }));
    await eventually(page, async () => new URL(page.url()).searchParams.get('inspect') === 'delivery', '再次接受后检查器未切到交付');
    await visible(delivery.getByRole('heading', { name: '待合入', exact: true }));
    await click(delivery.getByRole('button', { name: '合入', exact: true }));
    await visible(delivery.getByRole('heading', { name: '已完成 · 已合入', exact: true }));
    assert.notEqual(git('rev-parse', 'main'), baseline);
    assert.equal(execFileSync('git', ['--git-dir', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), baseline);
    await screenshot('07d-delivery-merged', delivery);
    const rejectPush = join(remote, 'hooks', 'pre-receive');
    await writeFile(rejectPush, '#!/bin/sh\necho "smoke push rejected" >&2\nexit 1\n', { mode: 0o755 });
    const push = async (control: Locator, shot?: string) => {
      await click(control);
      const dialog = page.getByRole('dialog', { name: '推送 main 到 origin/main', exact: true });
      await visible(dialog.getByRole('table', { name: '将推出的提交', exact: true }));
      if (shot) await screenshot(shot, dialog);
      await click(dialog.getByRole('button', { name: /^推送这 \d+ 个提交$/ }));
      await dialog.waitFor({ state: 'hidden' });
    };
    await push(delivery.getByRole('button', { name: '推送…', exact: true }), '07e-push-preview-dialog');
    await visible(delivery.getByRole('heading', { name: '已完成 · 推送失败', exact: true }));
    await visible(deliveryPin.getByRole('button', { name: '预览并重试推送', exact: true }));
    await click(deliveryPin.getByText('原因', { exact: true }));
    assert.match(await deliveryPin.innerText(), /smoke push rejected/);
    await screenshot('07f-push-failed-pin', deliveryPin, delivery);
    await rm(rejectPush);
    await push(deliveryPin.getByRole('button', { name: '预览并重试推送', exact: true }));
    await visible(delivery.getByRole('heading', { name: '已完成 · 已推送', exact: true }));
    await deliveryPin.waitFor({ state: 'hidden' });
    assert.equal(await delivery.getByRole('button', { name: /^(推送…|重试推送…)$/ }).count(), 0);
    await visible(workHeader(page).getByText(/^已完成(?:\s*·|$)/));
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches), true);
    const lightBackground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    await click(delivery.getByRole('link', { name: '回看已审核报告', exact: true }));
    await visible(review.getByText('已决定 · 接受', { exact: true }));
    assert.equal(await review.getByRole('button', { name: /^(接受|退回，写明原因)$/ }).count(), 0);
    await screenshot('08-completed-report-paper', review, workHeader(page).getByText(/^已完成(?:\s*·|$)/));
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg')), lightBackground);
    await screenshot('09-completed-report-console', workHeader(page).getByText(/^已完成(?:\s*·|$)/), review);

    await click(sidebar.getByRole('button', { name: 'EN', exact: true }));
    const englishReview = page.getByRole('region', { name: 'Review', exact: true });
    await visible(englishReview.getByRole('heading', { name: 'Recommend accepting', exact: true }));
    await visible(englishReview.getByText('Decided · Accept', { exact: true }));
    assert.equal(await englishReview.getByRole('button', { name: /^(Accept|Return with a reason)$/ }).count(), 0);
    await click(page.getByRole('navigation', { name: 'Now strip', exact: true }).getByRole('button', { name: 'Delivery', exact: true }));
    const englishDelivery = page.getByRole('region', { name: 'Merge and push', exact: true });
    await visible(englishDelivery.getByRole('heading', { name: 'Completed · pushed', exact: true }));
    assert.equal(await englishDelivery.getByRole('button', { name: /^(Push…|Retry push…)$/ }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('helm.language')), 'en');
    await click(sidebar.getByRole('button', { name: 'Chinese', exact: true }));
    await visible(delivery.getByRole('heading', { name: '已完成 · 已推送', exact: true }));

    await click(sidebar.getByRole('link', { name: '设置', exact: true }));
    const settingsNav = main.getByRole('navigation', { name: '设置', exact: true });
    await visible(settingsNav);
    assert.equal(await settingsNav.getByRole('link').count(), 4);
    await screenshot('10-settings-agents-by-driver', main.getByRole('heading', { name: 'Agent', level: 1, exact: true }), main.getByRole('group', { name: 'Claude CLI', exact: true }), main.getByRole('heading', { name: 'claude-coordinator', exact: true }));
    await click(sidebar.getByRole('button', { name: 'EN', exact: true }));
    const englishSettingsNav = main.getByRole('navigation', { name: 'Settings', exact: true });
    for (const name of ['Agents', 'Library', 'Projects', 'Advanced']) await visible(englishSettingsNav.getByRole('link', { name, exact: true }));
    await visible(main.getByRole('form', { name: 'Agent details', exact: true }).getByRole('heading', { name: 'claude-coordinator', exact: true }));
    await click(sidebar.getByRole('button', { name: 'Chinese', exact: true }));
    await visible(main.getByRole('heading', { name: 'Agent', level: 1, exact: true }));

    // Read-only evidence after the UI has accepted the review; never seed business state via APIs.
    assert.equal(await readFile(join(repo, 'smoke.txt'), 'utf8'), contents);
    assert.equal(git('diff', '--name-only', baseline, 'main'), 'smoke.txt');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('rev-parse', 'main'), git('rev-parse', 'refs/remotes/origin/main'));
    const verification = execFileSync('git', ['--git-dir', remote, 'show', 'main:smoke.txt'], { encoding: 'utf8' });
    assert.equal(verification, contents);
    assert.deepEqual(pageErrors, []);
  });
