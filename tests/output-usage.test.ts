import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { checkOutputUsage, pendingOutputWarning, reconcileOutputUsage, recordDispatchOutput } from '../src/outputs.js';
import { TaskStore } from '../src/store.js';

async function storeWithWork(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-output-usage-')));
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(join(directory, 'agents')));
  t.after(async () => { store.db.close(); await rm(directory, { recursive: true, force: true }); });
  store.db.exec(`
    INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', '${directory}/project', '2026-01-01');
    INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'start', '2026-01-01');
    INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at) VALUES ('card', 'work', 'card', '卡片', 0, 'executing', '2026-01-01');
    UPDATE settings SET output_threshold_bytes = 0 WHERE id = 1;`);
  // Each dispatch keeps its step files and artifacts under its own directory.
  const dispatch = async (id: string) => {
    const steps = join(store.dataDir, 'dispatches', id, 'steps');
    await mkdir(steps, { recursive: true });
    store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_snapshot, content, status, created_at, output_path)
      VALUES (?, 'work', 'card', ?, 'execution', '{}', '派单', 'ended', '2026-01-01', ?)`).run(id, id, steps);
    const artifact = async (name: string, content: string | Buffer) => {
      const path = join(store.dataDir, 'dispatches', id, 'artifacts', name);
      await mkdir(join(store.dataDir, 'dispatches', id, 'artifacts'), { recursive: true });
      await writeFile(path, content);
      store.db.prepare(`INSERT INTO artifacts VALUES (?, ?, 'file', ?, ?, NULL, NULL)`).run(`${id}-${name}`, id, name, path);
      return path;
    };
    return { id, steps, artifact };
  };
  const total = () => {
    store.transaction(() => checkOutputUsage(store));
    return pendingOutputWarning(store)[0]?.totalBytes ?? 0;
  };
  return { store, dispatch, total };
}

const allocated = async (path: string) => (await stat(path)).blocks * 512;

test('输出总量按分配空间计，稀疏文件只算实际占用的块', async t => {
  const { store, dispatch, total } = await storeWithWork(t);
  const run = await dispatch('sparse');
  await writeFile(join(run.steps, '1.json'), '{"type":"output"}');
  const sparse = await run.artifact('sparse.bin', 'head');
  await truncate(sparse, 256 * 1024 * 1024);
  const length = (await stat(sparse)).size;
  store.transaction(() => recordDispatchOutput(store, run.id));
  const expected = await allocated(join(run.steps, '1.json')) + await allocated(sparse);
  assert.ok(expected < length, '测试环境须支持稀疏文件');
  assert.equal(total(), expected);
});

test('结束一次派单只量自己的输出，不读取其他派单的目录', async t => {
  const { store, dispatch, total } = await storeWithWork(t);
  const earlier = await dispatch('earlier');
  await writeFile(join(earlier.steps, '1.json'), 'x'.repeat(10_000));
  await earlier.artifact('result.txt', 'y'.repeat(10_000));
  store.transaction(() => recordDispatchOutput(store, earlier.id));
  const earlierBytes = total();
  assert.equal(earlierBytes, await allocated(join(earlier.steps, '1.json')) + await allocated(join(store.dataDir, 'dispatches', earlier.id, 'artifacts', 'result.txt')));

  // Grow the earlier dispatch and lock its directories: any read of them would now fail.
  await writeFile(join(earlier.steps, '2.json'), 'z'.repeat(1_000_000));
  await earlier.artifact('late.txt', 'w'.repeat(1_000_000));
  const locked = [earlier.steps, join(store.dataDir, 'dispatches', earlier.id, 'artifacts')];
  const current = await dispatch('current');
  await writeFile(join(current.steps, '1.json'), 'c'.repeat(5_000));
  const shared = await current.artifact('shared.txt', 's'.repeat(5_000));
  // A second record of the same file is counted once.
  store.db.prepare(`INSERT INTO artifacts VALUES ('again', ?, 'file', 'shared.txt', ?, NULL, NULL)`).run(current.id, shared);
  let usage: number;
  for (const path of locked) await chmod(path, 0o000);
  try {
    store.transaction(() => recordDispatchOutput(store, current.id));
    usage = total();
  } finally { for (const path of locked) await chmod(path, 0o755); }
  assert.equal(usage,earlierBytes + await allocated(join(current.steps, '1.json')) + await allocated(shared));
});

test('启动对账为没有记录的已结束运行补算占用，目录已不存在的记 0', async t => {
  const { store, dispatch, total } = await storeWithWork(t);
  const kept = await dispatch('kept');
  await writeFile(join(kept.steps, '1.json'), 'k'.repeat(10_000));
  const gone = await dispatch('gone');
  await rm(join(store.dataDir, 'dispatches', gone.id), { recursive: true });
  const roundPath = join(store.dataDir, 'rounds', 'round.jsonl.gz');
  await mkdir(join(store.dataDir, 'rounds'), { recursive: true });
  await writeFile(roundPath, 'r'.repeat(10_000));
  store.db.prepare(`INSERT INTO coordinator_rounds (id, work_id, status, started_at, event_ids, output_path)
    VALUES ('round', 'work', 'ended', '2026-01-01', '[]', ?)`).run(roundPath.slice(0, -3));
  assert.equal(total(), 0);
  store.transaction(() => reconcileOutputUsage(store));
  assert.equal(total(), await allocated(join(kept.steps, '1.json')) + await allocated(roundPath));
});
