import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CodexDriver } from '../src/codex-driver.js';
import type { SessionOptions } from '../src/driver.js';
import { coordinatorFixture } from './codex-coordinator-fixture.js';
import { until } from './claude-coordinator-fixture.js';
import { codexErrors } from './fixtures/codex-errors.js';

test('Codex 调度轮次真实错误样本触发额度暂停和 SSE 通知，旧事件不重投', async t => {
  const driver = new CodexDriver({ command: { file: process.execPath,
    args: ['-e', 'process.exit(process.argv.slice(1).join(" ") === "login status" ? 0 : 1)'] } });
  let observed: SessionOptions | undefined;
  let starts = 0;
  const daemon = await coordinatorFixture(t, {
    checkAvailability: agent => driver.checkAvailability(agent),
    async start(options) {
      observed = options;
      starts++;
      const script = join(options.dataDir!, 'script.json');
      await mkdir(options.dataDir!, { recursive: true });
      await writeFile(script, JSON.stringify({ record: join(options.dataDir!, 'requests.jsonl'), notifications: [
        { method: 'turn/completed', params: { threadId: 'thread-scripted', turn: { id: 'turn-scripted', status: 'failed', error: codexErrors[0].error } } },
      ] }));
      return new CodexDriver({ command: { file: process.execPath, args: [
        fileURLToPath(new URL('./fixtures/codex-app-server.js', import.meta.url)), script,
      ] } }).start(options);
    },
  });
  const stream = await fetch(`${daemon.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
  const reader = stream.body!.getReader();
  t.after(() => reader.cancel());
  const notification = (async () => {
    let text = '';
    while (!text.includes('"kind":"runtime-pause"')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
    }
    return text;
  })();
  await daemon.confirm();
  const events = await until(daemon.events, values => values.some(e => e.action === 'work-paused'));
  assert.match(await notification, /event: needs-user-attention/);
  await reader.cancel();
  assert.equal((await daemon.call('get-work', daemon.params)).status, 'paused');
  assert.equal((await daemon.call('get-work', daemon.params)).runtimePauseReason, '调度者额度用完');
  assert.equal((await daemon.call('list-pending')).find((p: any) => p.kind === 'runtime-pause').workId, daemon.work.id);
  assert.match((await daemon.call('get-conversation', daemon.params)).at(-1).body, /调度者额度用完/);
  const end = events.filter(e => e.action === 'round-ended').at(-1);
  assert.equal(end.details.reason, 'quota-exhausted');
  assert.equal(end.details.processed, false);
  assert.deepEqual(observed!.sandbox, { mode: 'read-only', writableRoots: [] });
  assert.equal(observed!.resumeSessionId, undefined);
  assert.equal(observed!.dataDir, join(daemon.dataDir, 'rounds', end.object.id));
  const requests = (await readFile(join(observed!.dataDir!, 'requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(requests.find(r => r.method === 'thread/start').params.sandbox, 'read-only');
  const before = (await daemon.events()).filter(e => e.action === 'round-started').length;
  // A read operation yields to the scheduler without introducing a wake event.
  for (let i = 0; i < 3; i++) await daemon.call('list-works');
  assert.equal((await daemon.events()).filter(e => e.action === 'round-started').length, before);
  assert.equal(starts, 1);
});
