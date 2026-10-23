import { execFile } from 'node:child_process';
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const launchAgent = 'io.helm.helmd';

function xml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Environment= expands % specifiers but leaves $ literal; ExecStart= expands both.
function unitQuote(value: string) {
  return `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

async function saveConfig(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

// A local CLI command: installation never needs a running helmd or its operation table.
export async function installUserService(): Promise<string> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`User services are not supported on ${process.platform}.`);
  }
  const home = homedir();
  const cli = await realpath(process.argv[1]!);
  const logs = join(home, '.helm', 'logs');
  const env: Record<string, string> = { HOME: home, PATH: process.env.PATH ?? '' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  await mkdir(logs, { recursive: true });
  if (process.platform === 'linux') {
    const configHome = process.env.XDG_CONFIG_HOME;
    const path = join(configHome && isAbsolute(configHome) ? configHome : join(home, '.config'), 'systemd', 'user', 'helmd.service');
    await saveConfig(path, `[Unit]
Description=Helm runtime
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${[process.execPath, cli, 'serve'].map(arg => unitQuote(arg).replace(/\$/g, () => '$$')).join(' ')}
WorkingDirectory=${home.replace(/%/g, '%%')}
${Object.entries(env).map(([key, value]) => `Environment=${unitQuote(`${key}=${value}`)}`).join('\n')}
Restart=always
RestartSec=5
StandardOutput=append:${join(logs, 'helmd.stdout.log').replace(/%/g, '%%')}
StandardError=append:${join(logs, 'helmd.stderr.log').replace(/%/g, '%%')}

[Install]
WantedBy=default.target
`);
    await exec('systemctl', ['--user', 'daemon-reload']);
    await exec('systemctl', ['--user', 'enable', 'helmd.service']);
    await exec('systemctl', ['--user', 'restart', 'helmd.service']);
    return `Installed helmd user unit: ${path}\nLogs: ${logs}\nLinux 未实测。请运行 loginctl enable-linger "$USER"（必要时加 sudo），以在开机时启动并在登出后保持用户服务。`;
  }
  const path = join(home, 'Library', 'LaunchAgents', `${launchAgent}.plist`);
  await saveConfig(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${launchAgent}</string>
<key>ProgramArguments</key><array>${[process.execPath, cli, 'serve'].map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(home)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${xml(join(logs, 'helmd.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logs, 'helmd.stderr.log'))}</string>
</dict></plist>
`);
  const domain = `gui/${process.getuid!()}`;
  const target = `${domain}/${launchAgent}`;
  let loaded = true;
  try { await exec('launchctl', ['print', target]); }
  catch (error) {
    // launchctl print reports 113 when the service target is not yet registered.
    if ((error as { code?: number }).code !== 113) throw error;
    loaded = false;
  }
  if (loaded) await exec('launchctl', ['bootout', target]);
  await exec('launchctl', ['enable', target]);
  await exec('launchctl', ['bootstrap', domain, path]);
  return `Installed helmd LaunchAgent: ${path}\nLogs: ${logs}`;
}
