import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const platformFixture = fileURLToPath(new URL('./fixtures/service-platform.js', import.meta.url));

async function fixture(t: TestContext, platform: string) {
  const directory = await mkdtemp(join(tmpdir(), 'helm-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home & tools');
  const bin = join(directory, 'bin');
  await mkdir(home);
  await mkdir(bin);
  const calls = join(directory, 'calls.jsonl');
  for (const manager of ['launchctl', 'systemctl']) {
    await writeFile(join(bin, manager), `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.HELM_TEST_CALLS, JSON.stringify([${JSON.stringify(manager)}, ...args]) + '\\n');
if (args.includes(process.env.HELM_TEST_FAIL)) {
  console.error('service manager refused');
  process.exit(1);
}
if (${JSON.stringify(manager)} === 'launchctl') {
  const state = process.env.HELM_TEST_CALLS + '.loaded';
  if (args[0] === 'print' && !existsSync(state)) process.exit(113);
  if (args[0] === 'bootstrap') writeFileSync(state, 'loaded');
}
`, { mode: 0o755 });
  }
  const env: NodeJS.ProcessEnv = {
    HOME: home, PATH: `${bin}:/usr/bin:/bin`,
    HELM_TEST_SERVICE_PLATFORM: platform, HELM_TEST_CALLS: calls,
    // The install command must stay local even with an unusable HTTP endpoint.
    HELM_URL: 'http://127.0.0.1:1',
    ANTHROPIC_API_KEY: 'must-not-be-persisted', CODEX_HOME: '/must-not-be-persisted',
    HTTP_PROXY: 'http://proxy.test:8080', HTTPS_PROXY: 'http://proxy.test:8443',
    ALL_PROXY: 'socks5://proxy.test:1080', NO_PROXY: 'localhost,127.0.0.1',
    http_proxy: 'http://lower.test:8080', https_proxy: 'http://lower.test:8443',
    all_proxy: 'socks5://lower.test:1080', no_proxy: 'local.test',
  };
  return {
    home, env,
    install: () => exec(process.execPath, ['--import', platformFixture, cli, 'service', 'install'], { env }),
    calls: async () => (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
  };
}

test('helm service install 在 macOS 本地安装并更新自动重启的 LaunchAgent', async t => {
  const f = await fixture(t, 'darwin');
  const installed = await f.install();
  const path = join(f.home, 'Library', 'LaunchAgents', 'io.helm.helmd.plist');
  const plist = await readFile(path, 'utf8');
  assert.ok(installed.stdout.includes(path));
  assert.match(plist, /<key>Label<\/key>\s*<string>io\.helm\.helmd<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.ok(plist.includes(`<string>${process.execPath}</string>`));
  assert.ok(plist.includes(`<string>${cli}</string>`));
  assert.ok(plist.includes('<string>serve</string>'));
  assert.ok(plist.includes(`<string>${f.home.replace('&', '&amp;')}/.helm/logs/helmd.stdout.log</string>`));
  assert.ok(plist.includes(`<string>${f.home.replace('&', '&amp;')}/.helm/logs/helmd.stderr.log</string>`));
  assert.ok((await stat(join(f.home, '.helm', 'logs'))).isDirectory());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(plist.includes(`<key>PATH</key><string>${f.env.PATH}</string>`));
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    assert.ok(plist.includes(`<key>${key}</key><string>${f.env[key]}</string>`));
  }
  assert.ok(!plist.includes('must-not-be-persisted'));
  const domain = `gui/${process.getuid!()}`;
  const target = `${domain}/io.helm.helmd`;
  assert.deepEqual(await f.calls(), [
    ['launchctl', 'print', target], ['launchctl', 'enable', target], ['launchctl', 'bootstrap', domain, path],
  ]);

  f.env.PATH += ':/new tools';
  f.env.HTTPS_PROXY = 'http://user:p&<"word@new.test:8443';
  delete f.env.http_proxy;
  await f.install();
  const updated = await readFile(path, 'utf8');
  assert.ok(updated.includes('/new tools'));
  assert.ok(updated.includes('http://user:p&amp;&lt;&quot;word@new.test:8443'));
  assert.ok(!updated.includes('<key>http_proxy</key>'));
  assert.deepEqual((await f.calls()).slice(3), [
    ['launchctl', 'print', target], ['launchctl', 'bootout', target],
    ['launchctl', 'enable', target], ['launchctl', 'bootstrap', domain, path],
  ]);
});

test('helm service install 在 Linux 启用并更新用户服务，提示 lingering 和未实测', async t => {
  const f = await fixture(t, 'linux');
  const installed = await f.install();
  const path = join(f.home, '.config', 'systemd', 'user', 'helmd.service');
  const unit = await readFile(path, 'utf8');
  assert.ok(installed.stdout.includes(path));
  assert.match(installed.stdout, /loginctl enable-linger/);
  assert.match(installed.stdout, /未实测/);
  assert.match(unit, /^WantedBy=default.target$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^RestartSec=5$/m);
  assert.ok(unit.includes(`ExecStart="${process.execPath}" "${cli}" "serve"`));
  assert.ok(unit.includes(`StandardOutput=append:${f.home}/.helm/logs/helmd.stdout.log`));
  assert.ok(unit.includes(`StandardError=append:${f.home}/.helm/logs/helmd.stderr.log`));
  assert.ok((await stat(join(f.home, '.helm', 'logs'))).isDirectory());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(unit.includes(`Environment="PATH=${f.env.PATH}"`));
  assert.ok(unit.includes(`Environment="HOME=${f.home}"`));
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    assert.ok(unit.includes(`Environment="${key}=${f.env[key]}"`));
  }
  assert.ok(!unit.includes('must-not-be-persisted'));
  assert.deepEqual(await f.calls(), [
    ['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', 'helmd.service'],
    ['systemctl', '--user', 'restart', 'helmd.service'],
  ]);
  f.env.PATH += ':/new tools';
  f.env.HTTPS_PROXY = 'http://user:p%20$word"\\@proxy.test:8443';
  delete f.env.http_proxy;
  await f.install();
  const updated = await readFile(path, 'utf8');
  assert.ok(updated.includes('/new tools'));
  assert.ok(updated.includes('Environment="HTTPS_PROXY=http://user:p%%20$word\\"\\\\@proxy.test:8443"'));
  assert.ok(!updated.includes('Environment="http_proxy='));
  assert.deepEqual((await f.calls()).slice(3), (await f.calls()).slice(0, 3));
});

test('服务管理器拒绝安装时 CLI 返回失败，不报告安装成功', async t => {
  for (const [platform, command] of [['darwin', 'bootstrap'], ['linux', 'daemon-reload']]) {
    const f = await fixture(t, platform!);
    f.env.HELM_TEST_FAIL = command;
    await assert.rejects(f.install(), (error: any) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /service manager refused/);
      assert.ok(!error.stdout.includes('Installed'));
      return true;
    });
    assert.equal((await f.calls()).at(-1).includes(command), true);
  }
});

test('LaunchAgent 状态查询失败时停止安装，避免把权限故障当作尚未安装', async t => {
  const f = await fixture(t, 'darwin');
  f.env.HELM_TEST_FAIL = 'print';
  await assert.rejects(f.install(), /service manager refused/);
  assert.deepEqual(await f.calls(), [['launchctl', 'print', `gui/${process.getuid!()}/io.helm.helmd`]]);
});

test('Linux 用户服务遵循绝对 XDG_CONFIG_HOME', async t => {
  const f = await fixture(t, 'linux');
  f.env.XDG_CONFIG_HOME = join(f.home, 'custom config');
  await f.install();
  assert.ok((await readFile(join(f.env.XDG_CONFIG_HOME, 'systemd', 'user', 'helmd.service'), 'utf8')).includes('WantedBy=default.target'));
});

test('service 只接受 install，未知平台明确拒绝且帮助列出本地命令', async t => {
  const f = await fixture(t, 'win32');
  await assert.rejects(f.install(), /not supported on win32/);
  for (const args of [[], ['uninstall'], ['install', '--url', 'http://127.0.0.1:1']]) {
    await assert.rejects(exec(process.execPath, [cli, 'service', ...args], { env: f.env }), /Usage: helm service install/);
  }
  const help = await exec(process.execPath, [cli, '--help'], { env: f.env });
  assert.match(help.stdout, /^helm service install$/m);
});
