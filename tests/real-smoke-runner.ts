import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment } from '../src/environment.js';

type SmokeProcess = (args: string[], options: { cwd: string; env: Record<string, string> }) => {
  status: number | null; signal: NodeJS.Signals | null; error?: Error;
};

// The replaceable boundary is the external process; unit tests never run a browser or Claude.
export function runRealSmoke(run: SmokeProcess = (args, options) => spawnSync(process.execPath, args, { ...options, stdio: 'inherit' }),
  parent: NodeJS.ProcessEnv = process.env) {
  const env = runtimeEnvironment(parent);
  // Headed Chromium needs the host display and its authorization/runtime directory on Linux.
  for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  const cwd = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  for (const [file, flag] of [
    ['browser', 'HELM_BROWSER_REAL'],
    ['claude-executor', 'HELM_CLAUDE_EXECUTOR_REAL'],
    ['claude-coordinator', 'HELM_CLAUDE_COORDINATOR_REAL'],
    ['claude-skills', 'HELM_CLAUDE_SKILLS_REAL'],
    ['codex-executor', 'HELM_CODEX_EXECUTOR_REAL'],
    ['codex-coordinator', 'HELM_CODEX_COORDINATOR_REAL'],
    ['grok-executor', 'HELM_GROK_EXECUTOR_REAL'],
    ['deepseek-executor', 'HELM_DEEPSEEK_EXECUTOR_REAL'],
  ] as const) {
    const result = run(['--test', `dist/tests/${file}.real.js`], { cwd, env: { ...env, [flag]: '1' } });
    if (result.error || result.signal || result.status !== 0) return result.status || 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runRealSmoke();
