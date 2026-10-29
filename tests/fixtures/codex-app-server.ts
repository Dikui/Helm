// Scripted JSON-RPC peer. Never runs Codex or reads the caller's home.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';

const script = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const emit = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
let shellPolicy: any;
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'thread/start' || message.method === 'thread/resume') shellPolicy = message.params.config.shell_environment_policy;
  appendFileSync(script.record, `${line}\n`);
  if (message.method === script.exitOn) { process.exit(2); }
  if (message.method === script.hangOn) return;
  if (message.id === undefined) return;
  if (message.method === script.rejectOn) {
    emit({ id: message.id, error: { code: -32000, message: 'scripted RPC failure' } });
    return;
  }
  const result = message.method === 'thread/start' || message.method === 'thread/resume'
    ? { thread: { id: message.params.threadId ?? 'thread-scripted' } }
    : message.method === 'turn/start' ? { turn: { id: 'turn-scripted' } }
    : message.method === 'model/list' ? (script.modelPages ?? [{ data: [] }])[Number(message.params.cursor ?? 0)]
    : {};
  emit({ id: message.id, result });
  if (message.method === 'initialize') emit({ method: 'fixture/environment', params: { env: process.env, cwd: process.cwd() } });
  if (message.method === 'turn/start') {
    if (script.shellProbe) {
      const env = shellPolicy?.inherit === 'all' ? { ...process.env } : {};
      if (!shellPolicy?.ignore_default_excludes) for (const key of Object.keys(env)) if (/KEY|SECRET|TOKEN/i.test(key)) delete env[key];
      const text = execFileSync('/bin/sh', ['-c', 'printf %s "$PROJECT_RUNTIME_KEY"'], { env, encoding: 'utf8' });
      emit({ method: 'fixture/shell', params: { text } });
    }
    for (const notification of script.notifications ?? []) emit(notification);
  }
});
