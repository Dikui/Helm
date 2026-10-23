// Explicitly run outside the agent sandbox: npm run test:claude-executor.
// Requires Claude login in a disposable HOME and the bundled, headed Chromium.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { query, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeExecutorDriver } from '../src/claude-driver.js';
import { TemplateCatalog } from '../src/templates.js';
import { fixture } from './browser-fixture.js';
import { assertInitialization, helmToolNames } from './claude-init.js';

const enabled = process.env.HELM_CLAUDE_EXECUTOR_REAL === '1';
before(async () => {
  if (enabled) assert.notEqual(await realpath(homedir()), await realpath(userInfo().homedir), '请先设置并登录临时 HOME，禁止使用用户真实主目录');
});
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test('Claude 订阅模板在临时 HOME 的默认主目录已登录', { skip: !enabled, timeout: 20_000 }, async () => {
  const availability = await new ClaudeExecutorDriver().checkAvailability(new TemplateCatalog().get('claude-executor'));
  assert.equal(availability.available, true, `${availability.reason}\n${availability.command}`);
});

// Observe the real SDK boundary without replacing its CLI, tools or messages.
function observedDriver() {
  const messages: SDKMessage[] = [];
  const permissions: { tool: string; input: Record<string, unknown>; behavior: PermissionResult['behavior'] }[] = [];
  const endpoints: string[] = [];
  const helmTools: string[] = [];
  const driver = new ClaudeExecutorDriver({ query: args => {
    assert.equal(Object.hasOwn(args.options!.env!, 'CLAUDE_CONFIG_DIR'), false);
    assert.equal(args.options?.model, 'haiku');
    assert.equal(args.options.effort, 'low');
    assert.deepEqual(Object.keys(args.options.mcpServers ?? {}), ['helm']);
    const endpoint = args.options.mcpServers!.helm!;
    assert.ok('url' in endpoint && endpoint.type === 'http');
    assert.match(endpoint.headers?.Authorization ?? '', /^Bearer .+/);
    endpoints.push(endpoint.url);
    const canUseTool = args.options.canUseTool!;
    const stream = query({ ...args, options: { ...args.options, maxTurns: 12,
      canUseTool: async (tool, input, context) => {
        const decision = await canUseTool(tool, input, context);
        assert.ok(decision);
        if (decision.behavior === 'allow') assert.equal(decision.updatedPermissions, undefined);
        permissions.push({ tool, input, behavior: decision.behavior });
        return decision;
      },
    } });
    const deadline = setTimeout(() => args.options!.abortController!.abort(), 150_000);
    return {
      close() { clearTimeout(deadline); stream.close(); },
      async *[Symbol.asyncIterator]() {
        try {
          helmTools.push(...await helmToolNames(endpoint));
          for await (const message of stream) { messages.push(message); yield message; }
        }
        finally { clearTimeout(deadline); stream.close(); }
      },
    };
  } });
  return { driver, messages, permissions, endpoints, helmTools };
}

function toolCalls(messages: SDKMessage[]) {
  return messages.flatMap(message => message.type === 'assistant'
    ? message.message.content.filter(block => block.type === 'tool_use') : []);
}

function toolResult(messages: SDKMessage[], id: string) {
  return messages.flatMap(message => message.type === 'user' && Array.isArray(message.message.content)
    ? message.message.content : []).filter(block => block.type === 'tool_result')
    .find(block => block.tool_use_id === id);
}

function connected(observed: ReturnType<typeof observedDriver>) {
  assertInitialization(observed.messages, 'executor', observed.helmTools);
  const servers = observed.messages.flatMap(message => message.type === 'system' && message.subtype === 'init' ? message.mcp_servers : []);
  assert.ok(!servers.some(server => server.name === 'helm' && server.status === 'needs-auth'),
    'needs-auth reproduced: replace per-dispatch HTTP injection with the specified token-preserving stdio forwarder before accepting this smoke');
  assert.ok(servers.some(server => server.name === 'helm' && server.status === 'connected'), JSON.stringify(servers));
  assert.equal(observed.endpoints.length, 1);
}

test('冒烟①⑤：三次真实派单在同端点使用结论与浏览器工具，无 needs-auth，保存截图和 token',
  { skip: !enabled, timeout: 600_000 }, async t => {
    if (process.platform === 'linux') assert.ok(process.env.DISPLAY, '需要有显示服务的沙箱外环境，禁止无头模式');
    const evidence = await mkdtemp(join(tmpdir(), 'helm-claude-smoke-evidence-'));
    const site = createServer((_request, response) => response.end('<h1>Helm browser dispatch</h1>'));
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
    const address = site.address();
    assert.ok(address && typeof address !== 'string');
    for (const round of [1, 2, 3]) {
      await t.test(`新会话 ${round}`, async subtest => {
        const observed = observedDriver();
        const filename = `round-${round}.png`;
        const daemon = await fixture(subtest, [], { needsBrowser: true, realBrowser: true, executorDriver: observed.driver, model: 'haiku',
          content: `这是 Helm 执行者冒烟。仅用 helm MCP 的 browser_navigate 打开 http://127.0.0.1:${address.port}，
然后用 browser_snapshot 读取页面标题，用 browser_take_screenshot 保存 PNG（filename: ${filename}）。
最后调用同一 helm MCP 的 submit-conclusion，conclusion 为 completed，reason 写实际看到的标题。
必须实际调用上述四个工具；工具失败就报告受阻，不重试、不安装、不使用其他浏览器、不派生子代理、不推送、不部署。`,
        });
        const dispatch = await daemon.ended();
        connected(observed);
        assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? dispatch.endReason);
        assert.equal(dispatch.conclusion, 'completed');
        assert.match(dispatch.conclusionReason, /Helm browser dispatch/);
        for (const name of ['browser_navigate', 'browser_snapshot', 'browser_take_screenshot', 'submit-conclusion']) {
          const call = toolCalls(observed.messages).find(call => call.name === `mcp__helm__${name}`);
          assert.ok(call, `未调用同端点工具 ${name}`);
          const result = toolResult(observed.messages, call.id);
          assert.ok(result && !result.is_error, `工具 ${name} 未成功`);
          if (name === 'browser_snapshot') assert.match(JSON.stringify(result.content), /Helm browser dispatch/);
        }
        assert.ok(dispatch.usage.inputTokens > 0 && dispatch.usage.outputTokens > 0, '必须记录真实 modelUsage');
        const screenshot = join(dirname(dispatch.outputPath), 'browser', filename);
        const png = await readFile(screenshot);
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.ok(png.length > 100);
        const params = { workId: daemon.work.id, dispatchId: dispatch.id };
        const artifacts = (await daemon.call('get-dispatch-artifacts', params)).result;
        const artifact = artifacts.find((item: any) => item.kind === 'file' && item.name === `browser/${filename}`);
        assert.ok(artifact, '截图必须登记为派单成果');
        const read = await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: artifact.id, encoding: 'base64' });
        assert.equal(read.ok, true, JSON.stringify(read));
        assert.deepEqual(Buffer.from(read.result.content, 'base64'), png);
        assert.equal(dispatch.endCommit, dispatch.startCommit, '浏览器截图不应产生卡片提交');
        const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
        assert.equal(execFileSync('git', ['-C', card.workPath, 'ls-tree', '-r', '--name-only', dispatch.endCommit], { encoding: 'utf8' }), 'index.html\n');
        const saved = join(evidence, filename);
        await copyFile(screenshot, saved);
        console.log(`请打开截图核对页面标题「Helm browser dispatch」：${saved}`);
      });
    }
  });

test('冒烟③执行者：宽松项目设置不能放行副本外 Write 或 Bash 写，副本内写入和本机绑定成功',
  { skip: !enabled, timeout: 240_000 }, async t => {
    // The disposable HOME must sit outside Claude's writable temp roots.
    // Never create the protected destination in the user's actual home.
    const outside = await realpath(await mkdtemp(join(homedir(), '.helm-executor-smoke-')));
    t.after(() => rm(outside, { recursive: true, force: true }));
    const outsideWrite = join(outside, 'write-outside.txt');
    const outsideBash = join(outside, 'bash-outside.txt');
    const outsideCommand = `node -e ${shellQuote(`require("fs").writeFileSync(${JSON.stringify(outsideBash)},"outside")`)}`;
    const insideCommand = `node -e ${shellQuote('require("fs").writeFileSync("inside-bash.txt","inside"); const s=require("http").createServer(); s.listen(0,"127.0.0.1",()=>s.close(()=>console.log("local-binding-ok")));')}`;
    const observed = observedDriver();
    const daemon = await fixture(t, [], { executorDriver: observed.driver, model: 'haiku',
      projectSettings: {
        permissions: { defaultMode: 'acceptEdits', allow: ['Write', `Write(${outside}/**)`, `Edit(${outside}/**)`, 'Bash(*)'] },
        sandbox: { enabled: false, allowUnsandboxedCommands: true, excludedCommands: ['printf *', 'node *'], filesystem: { allowWrite: [outside] } },
        fastMode: true,
      },
      content: `这是隔离冒烟，只对下面的全新临时文件操作，不读凭据、不安装、不派生子代理、不提交、不推送、不部署。
按顺序各尝试一次：
1. 用 Write 向 ${outsideWrite} 写 outside，预期被 canUseTool 拒绝。
2. 用 Bash 原样执行 ${outsideCommand}，预期被沙箱拦下。必须实际调用 Bash，不使用 dangerouslyDisableSandbox，不重试或寻找绕过方法。
3. 用 Write 向当前副本的 inside-write.txt 写 inside。
4. 用 Bash 原样执行 ${insideCommand}，验证副本内写入及 127.0.0.1 监听成功。
拒绝是预期结果，继续完成剩余检查。最后调用 helm MCP 的 submit-conclusion，符合预期时 conclusion 为 completed，否则为 blocked。`,
    });
    const dispatch = await daemon.ended();
    connected(observed);
    assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? dispatch.endReason);
    assert.equal(dispatch.conclusion, 'completed');
    assert.ok(observed.permissions.some(item => item.tool === 'Write' && item.input.file_path === outsideWrite && item.behavior === 'deny'), '必须实际触发 canUseTool 的副本外 Write 拒绝');
    const bash = toolCalls(observed.messages).find(call => call.name === 'Bash' && (call.input as Record<string, unknown>).command === outsideCommand);
    assert.ok(bash, '必须实际尝试副本外 Bash 写入');
    const denied = toolResult(observed.messages, bash.id);
    assert.equal(denied?.is_error, true);
    assert.match(JSON.stringify(denied?.content), /operation not permitted|permission denied|read-only file system|sandbox/i);
    assert.ok(!observed.permissions.some(item => item.tool === 'Bash' && item.input.command === outsideCommand && item.behavior === 'deny'), 'Bash 越界必须由真实沙箱拒绝');
    await assert.rejects(readFile(outsideWrite), { code: 'ENOENT' });
    await assert.rejects(readFile(outsideBash), { code: 'ENOENT' });
    const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
    assert.match(execFileSync('git', ['-C', card.workPath, 'show', `${dispatch.startCommit}:.claude/settings.json`], { encoding: 'utf8' }), /excludedCommands/,
      '宽松设置必须已提交并随卡片副本加载');
    assert.equal((await readFile(join(card.workPath, 'inside-write.txt'), 'utf8')).trim(), 'inside');
    assert.equal(await readFile(join(card.workPath, 'inside-bash.txt'), 'utf8'), 'inside');
    // The model may requote the command; match on its marker instead of the exact string.
    const binding = toolCalls(observed.messages).find(call => call.name === 'Bash' && String((call.input as Record<string, unknown>).command).includes('local-binding-ok'));
    assert.ok(binding);
    const bound = toolResult(observed.messages, binding.id);
    assert.ok(bound && !bound.is_error);
    assert.match(JSON.stringify(bound.content), /local-binding-ok/);
  });
