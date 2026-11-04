import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeEnvironment } from '../src/environment.js';
import { installedVersion, smokeVersions, smokeVersionsFile } from '../src/availability.js';

export const groups = [
  ['browser', 'HELM_BROWSER_REAL'],
  ['claude-executor', 'HELM_CLAUDE_EXECUTOR_REAL'],
  ['claude-coordinator', 'HELM_CLAUDE_COORDINATOR_REAL'],
  ['claude-skills', 'HELM_CLAUDE_SKILLS_REAL'],
  ['codex-executor', 'HELM_CODEX_EXECUTOR_REAL'],
  ['codex-coordinator', 'HELM_CODEX_COORDINATOR_REAL'],
  ['coordinator-resume', 'HELM_COORDINATOR_RESUME_REAL'],
  ['auto-flow', 'HELM_AUTO_FLOW_REAL'],
  ['grok-executor', 'HELM_GROK_EXECUTOR_REAL'],
  ['grok-coordinator', 'HELM_GROK_COORDINATOR_REAL'],
  ['deepseek-executor', 'HELM_DEEPSEEK_EXECUTOR_REAL'],
  ['deepseek-coordinator', 'HELM_DEEPSEEK_COORDINATOR_REAL'],
  ['attachments', 'HELM_ATTACHMENTS_REAL'],
  ['ui', 'HELM_UI_REAL'],
] as const;

// Group-name prefix → driver name and executable; a driver's version is recorded only when all its groups ran and pass.
const drivers = [['claude-', 'claude-sdk', 'claude'], ['codex-', 'codex', 'codex'], ['grok-', 'grok', 'grok'], ['deepseek-', 'deepseek', 'dsh']] as const;
interface VersionRecorder { read(): Record<string, string>; detect(executable: string): Promise<string | null>; write(versions: Record<string, string>): void }
const recorder: VersionRecorder = {
  read: smokeVersions,
  detect: installedVersion,
  write: versions => writeFileSync(smokeVersionsFile, `${JSON.stringify(versions, null, 2)}\n`),
};

export interface HistoryEntry { at: string; commit: string | null; group: string; attempt: number; passed: boolean; failure: Failure | null }
export interface Failure { test: string; error: string }
// Shared by every worktree on this machine, so a failure that keeps coming back is visible across sessions.
const historyFile = join(homedir(), '.cache', 'helm-tests', 'smoke-history.jsonl');
export interface RunnerContext {
  groups?: string[];
  tmpdir?: () => string;
  history?: { read(): HistoryEntry[]; append(entry: HistoryEntry): void };
  commit?: () => string | null;
  prune?: () => void;
}
// Each run leaves its screenshots and any failure scenes under /tmp/hs-*; drop the ones older than a week.
export function pruneOld(root: string, prefix: string, maxAgeMs: number, now = Date.now()) {
  for (const name of readdirSync(root)) {
    if (!name.startsWith(prefix)) continue;
    const path = join(root, name);
    try { if (now - statSync(path).mtimeMs > maxAgeMs) rmSync(path, { recursive: true, force: true }); }
    catch { /* another run removed it */ }
  }
}

const defaults: Required<Omit<RunnerContext, 'groups'>> = {
  prune: () => pruneOld('/tmp', 'hs-', 7 * 24 * 3600_000),
  // Short paths: Playwright's Unix socket under a long TMPDIR exceeds the 104-byte macOS limit.
  tmpdir: () => mkdtempSync('/tmp/hs-'),
  history: {
    read: () => {
      try { return readFileSync(historyFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)); }
      catch { return []; }
    },
    append: entry => { mkdirSync(join(historyFile, '..'), { recursive: true }); appendFileSync(historyFile, `${JSON.stringify(entry)}\n`); },
  },
  commit: () => {
    try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
    catch { return null; }
  },
};

// The first failing test in a node:test TAP report and the first line of its error.
export function firstFailure(tap: string): Failure | null {
  const lines = tap.split('\n');
  const index = lines.findIndex(line => /^\s*not ok \d+ - /.test(line));
  if (index < 0) return null;
  const name = lines[index]!.replace(/^\s*not ok \d+ - /, '').trim();
  const start = lines.findIndex((line, i) => i > index && /^\s*error: /.test(line));
  const end = lines.findIndex((line, i) => i > index && /^\s*(not )?ok \d+ - /.test(line));
  if (start < 0 || (end >= 0 && start > end)) return { test: name, error: '' };
  const inline = lines[start]!.replace(/^\s*error: /, '').trim();
  const message = inline && inline !== '|-' && inline !== '|' && inline !== '>-' ? inline : lines[start + 1]?.trim() ?? '';
  // Generic assertion headers ("Expected values to be strictly equal:") say nothing; add the compared values.
  const block = lines.slice(start, end < 0 ? undefined : end);
  const value = (key: string) => block.find(line => new RegExp(`^\\s*${key}: `).test(line))?.replace(new RegExp(`^\\s*${key}: `), '').trim();
  const actual = value('actual'), expected = value('expected');
  const compared = actual !== undefined && expected !== undefined ? `（actual ${actual}，expected ${expected}）` : '';
  return { test: name, error: `${message.replace(/^'|'$/g, '')}${compared}`.slice(0, 200) };
}

type SmokeProcess = (args: string[], options: { cwd: string; env: Record<string, string> }) => {
  status: number | null; signal: NodeJS.Signals | null; error?: Error;
};

// The replaceable boundary is the external process; unit tests never run a browser or Claude.
export async function runRealSmoke(run: SmokeProcess = (args, options) => spawnSync(process.execPath, args, { ...options, stdio: 'inherit' }),
  parent: NodeJS.ProcessEnv = process.env, versions = recorder, context: RunnerContext = {}) {
  const { tmpdir, history, commit, prune } = { ...defaults, ...context };
  const unknown = (context.groups ?? []).filter(name => !groups.some(([file]) => file === name));
  if (unknown.length) throw new Error(`未知的冒烟组：${unknown.join('、')}。可选：${groups.map(([file]) => file).join('、')}`);
  const selected = context.groups?.length ? groups.filter(([file]) => context.groups!.includes(file)) : groups;
  const env = runtimeEnvironment(parent);
  // Headed Chromium needs the host display and its authorization/runtime directory on Linux.
  for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  prune();
  const tmp = tmpdir();
  env.TMPDIR = tmp;
  const cwd = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const head = commit();
  const past = history.read();
  // Groups are independent; one flaky group must not hide the rest, so run all and report at the end.
  // A failed group gets one rerun: model slips pass on retry, and the history shows which ones keep recurring.
  const failed: { file: string; code: number }[] = [];
  const retried: string[] = [];
  const recurring: string[] = [];
  for (const [file, flag] of selected) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const report = join(tmp, `${file}-${attempt}.tap`);
      const result = run(['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
        '--test-reporter=tap', `--test-reporter-destination=${report}`, `dist/tests/${file}.real.js`], { cwd, env: { ...env, [flag]: '1' } });
      const passed = !result.error && !result.signal && result.status === 0;
      let failure: Failure | null = null;
      if (!passed) {
        try { failure = firstFailure(readFileSync(report, 'utf8')); } catch { /* the process died before writing a report */ }
      }
      history.append({ at: new Date().toISOString(), commit: head, group: file, attempt, passed, failure });
      if (!passed && attempt === 1 && failure) {
        const runs = past.filter(entry => entry.group === file && entry.attempt === 1).slice(-9);
        const count = 1 + runs.filter(entry => !entry.passed && entry.failure?.test === failure!.test).length;
        if (count >= 2) recurring.push(`${file}「${failure.test}」最近 ${runs.length + 1} 次首跑失败 ${count} 次`);
      }
      if (passed) { if (attempt === 2) retried.push(file); break; }
      if (attempt === 2) failed.push({ file, code: result.status || 1 });
      else console.error(`真实冒烟 ${file} 失败，重跑一次${failure ? `；首个失败：${failure.test}：${failure.error}` : ''}`);
    }
  }
  const recorded = { ...versions.read() };
  for (const [prefix, name, executable] of drivers) {
    const own = groups.filter(([file]) => file.startsWith(prefix));
    if (!own.every(group => selected.includes(group)) || failed.some(f => f.file.startsWith(prefix))) continue;
    const version = await versions.detect(executable);
    if (version) recorded[name] = version;
  }
  versions.write(recorded);
  const firstPass = selected.filter(([file]) => !retried.includes(file) && !failed.some(f => f.file === file)).map(([file]) => file);
  console.log(`真实冒烟首跑通过：${firstPass.join('、') || '无'}`);
  if (retried.length) console.log(`重跑后通过（偶发，已记入 ${historyFile}）：${retried.join('、')}`);
  if (failed.length) console.error(`真实冒烟失败的组：${failed.map(f => f.file).join('、')}`);
  // Retrying hides real defects; the same failing test twice in ten runs is a bug to diagnose, not noise.
  for (const line of recurring) console.error(`⚠ 反复失败，按缺陷排查，不要再判为偶发：${line}`);
  console.log(`临时目录（失败测试的现场也在这里）：${tmp}`);
  return failed[0]?.code ?? 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runRealSmoke(undefined, undefined, undefined, { groups: process.argv.slice(2) });
}
