// Scripted JSON-RPC peer. Never runs Codex or reads the caller's home.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const script = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const emit = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
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
    : {};
  emit({ id: message.id, result });
  if (message.method === 'initialize') emit({ method: 'fixture/environment', params: { env: process.env, cwd: process.cwd() } });
  if (message.method === 'turn/start') {
    for (const notification of script.notifications ?? []) emit(notification);
  }
});
