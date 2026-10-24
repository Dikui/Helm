import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver, ClaudeExecutorDriver, type ClaudeQuery } from '../src/claude-driver.js';
import { fixture as executorFixture } from './browser-fixture.js';
import { fixture as coordinatorFixture, until } from './claude-coordinator-fixture.js';

for (const role of ['coordinator', 'executor'] as const) {
  test(`${role}: 父环境只传运行必需项，实际子进程无桌面会话变量且关闭自动记忆`, async t => {
    const home = await mkdtemp(join(tmpdir(), 'helm-environment-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const injected = {
      HOME: home, CLAUDE_CONFIG_DIR: '/parent/claude', CODEX_HOME: '/parent/codex',
      CLAUDE_CODE_DESKTOP_SESSION: 'desktop-sentinel', HELM_TEST_ARBITRARY: 'arbitrary-sentinel',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0', ANTHROPIC_API_KEY: 'credential-sentinel',
      HELM_PORT_START: '9999', NODE_OPTIONS: '--no-warnings',
      LANG: 'en_US.UTF-8', LC_CTYPE: 'UTF-8', HTTPS_PROXY: 'http://proxy.invalid',
      NO_PROXY: 'upper.test', no_proxy: 'lower.test',
    };
    const previous = Object.keys(injected).map(key => process.env[key]);
    Object.assign(process.env, injected);
    t.after(() => Object.keys(injected).forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }));
    let childEnv: NodeJS.ProcessEnv | undefined;
    const query: ClaudeQuery = args => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        const sdk = args.options!;
        const child = sdk.spawnClaudeCodeProcess!({ command: process.execPath,
          args: ['-e', 'console.log(JSON.stringify(process.env))'], cwd: sdk.cwd, env: sdk.env!, signal: new AbortController().signal });
        let output = '';
        child.stdout.on('data', chunk => { output += String(chunk); });
        await Promise.all([
          new Promise<void>((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(`environment probe exited ${code}`)));
          }),
          new Promise<void>((resolve, reject) => { child.stdout.once('end', resolve); child.stdout.once('error', reject); }),
        ]);
        childEnv = JSON.parse(output);
        yield { type: 'result', subtype: 'success', is_error: false, result: '环境探针完成', modelUsage: {} } as SDKMessage;
      },
    });
    const config = { pathToClaudeCodeExecutable: '/fake/claude', query };
    if (role === 'executor') {
      const daemon = await executorFixture(t, [], { executorDriver: new ClaudeExecutorDriver(config) });
      assert.equal((await daemon.ended()).endReason, 'completed');
    } else {
      const daemon = await coordinatorFixture(t, new ClaudeCoordinatorDriver(config));
      await until(daemon.events, events => events.some(event => event.action === 'round-ended' && event.details.finalAnswer === '环境探针完成'));
    }
    assert.ok(childEnv, '必须实际运行 Node 子进程探针');
    for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'CLAUDE_CODE_DESKTOP_SESSION', 'HELM_TEST_ARBITRARY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']) {
      assert.equal(childEnv[key], undefined, key);
    }
    assert.equal(childEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_CTYPE', 'HTTPS_PROXY']) {
      assert.equal(childEnv[key], process.env[key], key);
    }
    assert.equal(childEnv.NO_PROXY, 'upper.test,lower.test,127.0.0.1,localhost');
    assert.equal(childEnv.no_proxy, childEnv.NO_PROXY);
    if (role === 'executor') {
      assert.ok(Number(childEnv.HELM_PORT_START) >= 20000);
      assert.ok(Number(childEnv.HELM_PORT_END) > Number(childEnv.HELM_PORT_START));
      assert.equal(childEnv.GH_TOKEN, 'helm-push-disabled');
      assert.ok(childEnv.GIT_CONFIG_PARAMETERS);
      assert.equal(childEnv.GIT_CONFIG_COUNT, undefined);
    } else {
      assert.equal(childEnv.HELM_PORT_START, undefined);
      assert.equal(childEnv.GH_TOKEN, undefined);
      assert.equal(childEnv.GIT_CONFIG_COUNT, undefined);
      assert.equal(childEnv.GIT_CONFIG_PARAMETERS, undefined);
    }
  });
}
