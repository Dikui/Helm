import { RuleError } from './store.js';

function redactUrlCredentials(text: string) {
  return text.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/]*@/gi, '$1');
}

export function gitFailure(prefix: string, args: string[], error: unknown) {
  const failure = error as { status?: number | null; stderr?: string | Buffer; message?: string } | null;
  // `git add -- <files>` can list thousands of paths, and this ends up in the event log.
  args = args.slice(0, 50).map(redactUrlCredentials);
  const stderr = redactUrlCredentials(String(failure?.stderr ?? '')).trim().slice(-2000);
  const exitCode = failure?.status ?? null;
  const reason = stderr ? undefined : redactUrlCredentials(String(failure?.message ?? error)).slice(-2000);
  const command = `git ${args.map(arg => JSON.stringify(arg)).join(' ')}`;
  return new RuleError('GIT_ERROR', `${prefix} ${command} (exit ${exitCode ?? 'unknown'}): ${stderr || reason}`, 409,
    { args, exitCode, stderr, ...(reason ? { reason } : {}) });
}
