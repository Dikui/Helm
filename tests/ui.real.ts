// Outside the sandbox only, after building:
// Requires Claude login in the runner's HOME, like the other Claude real tests.
// HELM_UI_REAL=1 node --test dist/tests/ui.real.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser, Locator, Page } from 'playwright';
import { ClaudeDriver } from '../src/claude-driver.js';
import { startHelmd } from '../src/server.js';
import { TemplateCatalog, defaultTemplateDir } from '../src/templates.js';
import { configureTestTemplate } from './helmd-fixture.js';

const enabled = process.env.HELM_UI_REAL === '1';
const title = 'UI 冒烟：添加 smoke.txt';
const readyMessage = 'UI_SMOKE_READY_FOR_REVIEW';
const reviewMessage = '请发起审核';
const changeTitle = '添加 smoke.txt';
const verificationTitle = '整体验收 smoke.txt';
const contents = 'helm-ui-smoke\n';

// Keep the real model's job small, and hold the review until the UI has visited execution views.
const coordinatorPrompt = `这是界面真实冒烟，使用真实 Helm 工具，所有 key 稳定复用，不重复建对象。
只用 helm MCP 工具；不启动浏览器、不安装、不派生子代理、不推送、不部署、不用 shell 写代码。
对齐：立即 draft-work-description（key=ui-brief），需求为新增 smoke.txt，边界为仅一个文件，
标准为文件内容恰好是 helm-ui-smoke 加一个换行；不追问。未确认前退出等待。
确认后：只创建两张卡片：
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
两张卡片都完成后 send-message（key=ui-ready，body=${readyMessage}），写笔记后退出。
只有用户最新消息的正文完全等于「${reviewMessage}」才 request-review（key=ui-review），body 记录实际派单和验收证据。
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
    assert.equal(await page.locator('.error').count(), 0, `运行错误：${await page.locator('.error').allTextContents()}`);
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function visible(locator: Locator) { await locator.waitFor({ state: 'visible' }); }

function workHeader(page: Page) {
  return page.locator('header').filter({ has: page.getByRole('heading', { level: 1, name: title, exact: true }) });
}

test('界面真实冒烟：新建 → 对齐 → 执行 → 审核，真实 Claude 与有界面 Chromium 截图',
  { skip: !enabled, timeout: 600_000 }, async t => {
    if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '请在有显示服务的沙箱外运行，禁止无头模式');
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-ui-real-')));
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'helm-ui-real-output-')));
    console.log(`UI 冒烟截图目录（保留供人工对照 design/INDEX.md）：${evidence}`);
    let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
    let browser: Browser | undefined;
    t.after(async () => {
      try { await browser?.close(); }
      finally {
        try { await daemon?.close(); }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
    });

    const templateDir = join(directory, 'templates');
    for (const id of ['claude-coordinator', 'claude-executor']) {
      await cp(join(defaultTemplateDir, id), join(templateDir, id), { recursive: true });
      await configureTestTemplate(templateDir, id, { model: 'haiku', reasoningEffort: 'low', fast: false, home: 'shared' });
    }
    await writeFile(join(templateDir, 'claude-coordinator', 'prompt.md'), coordinatorPrompt);
    const claude = new ClaudeDriver();
    const availability = await claude.checkAvailability(new TemplateCatalog(templateDir).get('claude-coordinator'));
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

    // This is the same helmd HTTP/MCP/SSE/static server used by `helm serve`, with real drivers.
    // Limit the catalog to Claude so availability probes cannot start other agent CLIs.
    daemon = await startHelmd({ port: 0, dataDir: join(evidence, 'data'), templateDir, drivers: { 'claude-sdk': claude } });
    const require = createRequire(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    // Playwright's bundled Chromium, headed; never system Chrome.
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const main = page.getByRole('main');
    const sidebar = page.getByRole('complementary', { name: 'Helm', exact: true });
    const screenshot = async (name: string, ...state: Locator[]) => {
      for (const element of state) await visible(element);
      await visible(sidebar.getByText('实时更新已连接', { exact: true }));
      assert.equal(await page.getByRole('alert').count(), 0, await page.getByRole('alert').allTextContents().then(lines => lines.join('\n')));
      assert.equal(await page.locator('.error').count(), 0, await page.locator('.error').allTextContents().then(lines => lines.join('\n')));
      assert.deepEqual(pageErrors, [], '截图前必须没有页面异常');
      const path = join(evidence, `${name}.png`);
      await page.screenshot({ path, fullPage: true, animations: 'disabled' });
      console.log(`UI 截图 ${name}：${path}`);
    };

    await page.goto(daemon.url);
    await screenshot('01-inbox', sidebar.getByText('还没有工作。新建一项工作开始吧。', { exact: true }), main.getByRole('heading', { level: 1 }));
    await click(sidebar.getByRole('link', { name: '＋ 新建工作', exact: true }));
    await visible(main.getByRole('heading', { name: '新建工作', level: 1, exact: true }));
    await main.getByLabel('项目路径', { exact: true }).fill(repo);
    await click(main.getByRole('button', { name: '登记', exact: true }));
    await main.getByRole('combobox', { name: '调度者模板', exact: true }).selectOption('claude-coordinator');
    await main.getByLabel('需求', { exact: true }).fill(`${title}\n只新增 smoke.txt，内容恰好是 helm-ui-smoke 加一个换行，其他文件不改。请直接起草工作说明，确认后交真实 Claude 执行和整体验收。完成后发 ${readyMessage} 并等待下一条用户消息再审核。`);
    await screenshot('02-new-work', main.getByRole('button', { name: '开始', exact: true }), main.getByText(repo, { exact: true }));
    await click(main.getByRole('button', { name: '开始', exact: true }));
    await visible(workHeader(page));
    const brief = main.getByRole('complementary', { name: '工作说明', exact: true });
    const confirm = brief.getByRole('button', { name: '确认这一版', exact: true });
    await eventually(page, () => confirm.isEnabled().catch(() => false), '等待真实调度者起草工作说明超时');
    assert.match(await brief.innerText(), /smoke\.txt/);
    await screenshot('03-aligning', workHeader(page).getByText('对齐中', { exact: true }), brief.getByRole('heading', { name: '标准', exact: true }), confirm);
    await click(confirm);
    await visible(workHeader(page).getByText('执行中', { exact: true }));
    await screenshot('04-conversation', main.getByRole('region', { name: '对话', exact: true }), main.getByLabel('消息', { exact: true }));

    await click(workHeader(page).getByRole('link', { name: '调度结构', exact: true }));
    const graph = main.getByRole('region', { name: '卡片图', exact: true });
    const card = graph.getByRole('button', { name: /^卡片 \d+：添加 smoke\.txt$/ });
    await eventually(page, () => card.isVisible(), '等待真实调度者建卡超时');
    await click(card);
    const inspector = main.getByRole('complementary', { name: '卡片检查器', exact: true });
    await eventually(page, () => inspector.getByRole('button', { name: '派单 #1 · 执行', exact: true }).isVisible(), '等待真实执行派单超时');
    await screenshot('05-card-graph-inspector', graph, inspector.getByRole('heading', { name: changeTitle, exact: true }), inspector.getByRole('heading', { name: '派单历史', exact: true }));

    await click(workHeader(page).getByRole('link', { name: '对话', exact: true }));
    const conversation = main.getByRole('region', { name: '对话', exact: true });
    await eventually(page, () => conversation.getByText(readyMessage, { exact: true }).isVisible(), '等待真实执行和整体验收完成超时');
    await click(workHeader(page).getByRole('link', { name: '调度结构', exact: true }));
    await click(card);
    await visible(inspector.getByText('自报完成', { exact: true }));
    assert.equal(await graph.getByRole('button', { name: /^卡片 \d+：/ }).count(), 2);
    await click(main.getByRole('tab', { name: '时间线', exact: true }));
    const timeline = main.getByRole('region', { name: '时间线', exact: true });
    await visible(timeline.getByRole('button', { name: '派单 #1 · 执行', exact: true }));
    await screenshot('06-timeline', timeline.getByRole('group', { name: /^卡片 \d+：添加 smoke\.txt$/ }),
      timeline.getByRole('group', { name: /^卡片 \d+：整体验收 smoke\.txt$/ }).getByRole('button', { name: '派单 #1 · 验收 ✓', exact: true }));

    await click(workHeader(page).getByRole('link', { name: '对话', exact: true }));
    await visible(conversation.getByText(readyMessage, { exact: true }));
    await conversation.getByLabel('消息', { exact: true }).fill(reviewMessage);
    await click(conversation.getByRole('button', { name: '发送', exact: true }));
    await eventually(page, () => workHeader(page).getByText('待你审核', { exact: true }).isVisible(), '等待真实调度者发起审核超时');
    await click(workHeader(page).getByRole('link', { name: '工作说明', exact: true }));
    const review = main.getByRole('region', { name: '审核', exact: true });
    const gate = review.getByRole('group', { name: '审核', exact: true });
    await visible(review.getByText('通过', { exact: true }));
    await click(gate.getByRole('button', { name: '查看 diff', exact: true }));
    const diff = gate.getByLabel('Diff 内容', { exact: true });
    await visible(diff);
    assert.match(await diff.innerText(), /\+helm-ui-smoke/);
    assert.equal(await gate.getByLabel('未声明结论的派单', { exact: true }).innerText(), '0');
    await screenshot('07-review', gate.getByRole('button', { name: '接受', exact: true }), review.getByRole('heading', { name: '整体验收', exact: true }), diff);
    await click(gate.getByRole('button', { name: '接受', exact: true }));
    await visible(workHeader(page).getByText('已完成', { exact: true }));
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches), true);
    const lightBackground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    await screenshot('08-main-light', review.getByText('已决定 · 接受', { exact: true }), workHeader(page).getByText('已完成', { exact: true }));
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg')), lightBackground);
    await screenshot('09-main-dark', workHeader(page).getByText('已完成', { exact: true }), review);

    await click(sidebar.getByRole('link', { name: '设置', exact: true }));
    await screenshot('10-settings', main.getByRole('heading', { name: '设置', level: 1, exact: true }), main.getByRole('heading', { name: 'Agent 模板', exact: true }), main.getByRole('heading', { name: 'claude-coordinator', exact: true }));

    // Read-only evidence after the UI has accepted the review; never seed business state via APIs.
    assert.equal(await readFile(join(repo, 'smoke.txt'), 'utf8'), contents);
    assert.equal(git('diff', '--name-only', baseline, 'main'), 'smoke.txt');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('rev-parse', 'main'), git('rev-parse', 'refs/remotes/origin/main'));
    const verification = execFileSync('git', ['--git-dir', remote, 'show', 'main:smoke.txt'], { encoding: 'utf8' });
    assert.equal(verification, contents);
    assert.deepEqual(pageErrors, []);
  });
