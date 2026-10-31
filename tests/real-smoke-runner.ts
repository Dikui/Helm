import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment } from '../src/environment.js';
import { installedVersion, smokeVersions, smokeVersionsFile } from '../src/availability.js';

// Group-name prefix → driver name and executable; a driver's version is recorded only when all its groups pass.
const drivers = [['claude-', 'claude-sdk', 'claude'], ['codex-', 'codex', 'codex'], ['grok-', 'grok', 'grok'], ['deepseek-', 'deepseek', 'dsh']] as const;
interface VersionRecorder { read(): Record<string, string>; detect(executable: string): Promise<string | null>; write(versions: Record<string, string>): void }
const recorder: VersionRecorder = {
  read: smokeVersions,
  detect: installedVersion,
  write: versions => writeFileSync(smokeVersionsFile, `${JSON.stringify(versions, null, 2)}\n`),
};

type SmokeProcess = (args: string[], options: { cwd: string; env: Record<string, string> }) => {
  status: number | null; signal: NodeJS.Signals | null; error?: Error;
};

// The replaceable boundary is the external process; unit tests never run a browser or Claude.
export async function runRealSmoke(run: SmokeProcess = (args, options) => spawnSync(process.execPath, args, { ...options, stdio: 'inherit' }),
  parent: NodeJS.ProcessEnv = process.env, versions = recorder) {
  const env = runtimeEnvironment(parent);
  // Headed Chromium needs the host display and its authorization/runtime directory on Linux.
  for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  const cwd = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  // Groups are independent; one flaky group must not hide the rest, so run all and report at the end.
  const failed: { file: string; code: number }[] = [];
  for (const [file, flag] of [
    ['browser', 'HELM_BROWSER_REAL'],
    ['claude-executor', 'HELM_CLAUDE_EXECUTOR_REAL'],
    ['claude-coordinator', 'HELM_CLAUDE_COORDINATOR_REAL'],
    ['claude-skills', 'HELM_CLAUDE_SKILLS_REAL'],
    ['codex-executor', 'HELM_CODEX_EXECUTOR_REAL'],
    ['codex-coordinator', 'HELM_CODEX_COORDINATOR_REAL'],
    ['coordinator-resume', 'HELM_COORDINATOR_RESUME_REAL'],
    ['auto-flow', 'HELM_AUTO_FLOW_REAL'],
    ['grok-executor', 'HELM_GROK_EXECUTOR_REAL'],
    ['deepseek-executor', 'HELM_DEEPSEEK_EXECUTOR_REAL'],
    ['attachments', 'HELM_ATTACHMENTS_REAL'],
    ['ui', 'HELM_UI_REAL'],
  ] as const) {
    const result = run(['--test', `dist/tests/${file}.real.js`], { cwd, env: { ...env, [flag]: '1' } });
    if (result.error || result.signal || result.status !== 0) failed.push({ file, code: result.status || 1 });
  }
  const recorded = { ...versions.read() };
  for (const [prefix, name, executable] of drivers) {
    if (failed.some(f => f.file.startsWith(prefix))) continue;
    const version = await versions.detect(executable);
    if (version) recorded[name] = version;
  }
  versions.write(recorded);
  if (failed.length) console.error(`真实冒烟失败的组：${failed.map(f => f.file).join('、')}`);
  return failed[0]?.code ?? 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runRealSmoke();
