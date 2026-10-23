import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import type { TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

function missing(error: unknown) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }

// Paths in the task store keep their original names, including after compression.
export function readOutput(path: string): Buffer {
  try { return readFileSync(path); }
  catch (error) {
    if (!missing(error)) throw error;
    return gunzipSync(readFileSync(`${path}.gz`));
  }
}

function outputFiles(store: TaskStore, workId?: string): string[] {
  const paths: string[] = [];
  for (const row of store.db.prepare('SELECT output_path FROM dispatches WHERE (? IS NULL OR work_id = ?)').all(workId ?? null, workId ?? null)) {
    const directory = String(row.output_path);
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && /^\d+\.json(?:\.gz)?$/.test(entry.name)) paths.push(join(directory, entry.name));
      }
    } catch (error) { if (!missing(error)) throw error; }
  }
  for (const row of store.db.prepare('SELECT output_path FROM coordinator_rounds WHERE (? IS NULL OR work_id = ?)').all(workId ?? null, workId ?? null)) {
    for (const path of [String(row.output_path), `${row.output_path}.gz`]) {
      try { if (lstatSync(path).isFile()) paths.push(path); }
      catch (error) { if (!missing(error)) throw error; }
    }
  }
  return paths;
}

// Called in the same transaction as the triggering operation or dispatch ending.
export function checkOutputUsage(store: TaskStore) {
  let totalBytes = 0;
  for (const path of outputFiles(store)) {
    try { totalBytes += lstatSync(path).size; }
    catch (error) { if (!missing(error)) throw error; }
  }
  const settings = store.db.prepare('SELECT output_threshold_bytes, output_threshold_exceeded FROM settings WHERE id = 1').get()!;
  const thresholdBytes = Number(settings.output_threshold_bytes);
  const exceeded = totalBytes > thresholdBytes;
  store.db.prepare('UPDATE settings SET output_total_bytes = ?, output_threshold_exceeded = ? WHERE id = 1').run(totalBytes, Number(exceeded));
  if (exceeded && !settings.output_threshold_exceeded) {
    store.appendEvent(runtime, { type: 'outputs', id: 'global' }, 'needs-user-attention', { kind: 'output-threshold', totalBytes, thresholdBytes });
  } else if (!exceeded && settings.output_threshold_exceeded) {
    store.appendEvent(runtime, { type: 'outputs', id: 'global' }, 'output-threshold-cleared', { totalBytes, thresholdBytes });
  }
}

export function pendingOutputWarning(store: TaskStore) {
  const settings = store.db.prepare('SELECT output_total_bytes, output_threshold_bytes, output_threshold_exceeded FROM settings WHERE id = 1').get()!;
  return settings.output_threshold_exceeded ? [{
    type: 'outputs', id: 'global', kind: 'output-threshold',
    totalBytes: Number(settings.output_total_bytes), thresholdBytes: Number(settings.output_threshold_bytes),
  }] : [];
}

const compressions = new WeakMap<TaskStore, Map<string, Promise<void>>>();

export function compressWorkOutputs(store: TaskStore, workId: string): Promise<void> {
  let pending = compressions.get(store);
  if (!pending) { pending = new Map(); compressions.set(store, pending); }
  const existing = pending.get(workId);
  if (existing) return existing;
  const compression = compress(store, workId).finally(() => pending.delete(workId));
  pending.set(workId, compression);
  return compression;
}

async function compress(store: TaskStore, workId: string) {
  if (!['completed', 'cancelled'].includes(store.work(workId).status)) return;
  // A cancelled work becomes terminal before its writers have stopped.
  if (store.db.prepare(`SELECT id FROM dispatches WHERE work_id = ? AND status IN ('queued', 'running')
    UNION ALL SELECT id FROM coordinator_rounds WHERE work_id = ? AND status = 'running'`).get(workId, workId)) return;
  for (const path of outputFiles(store, workId).filter(path => !path.endsWith('.gz'))) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await pipeline(createReadStream(path), createGzip(), createWriteStream(temporary, { flags: 'wx' }));
      await rename(temporary, `${path}.gz`);
      await rm(path);
    } finally { await rm(temporary, { force: true }); }
  }
  store.transaction(() => checkOutputUsage(store));
}
