import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { copyFile, link, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { RuleError, type Actor, type TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;
const exec = promisify(execFile);

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

// Compression, export and deletion must not change the same files concurrently.
const outputTasks = new WeakMap<TaskStore, Map<string, Promise<unknown>>>();

function withWorkOutputs<T>(store: TaskStore, workId: string, run: () => Promise<T>): Promise<T> {
  let pending = outputTasks.get(store);
  if (!pending) { pending = new Map(); outputTasks.set(store, pending); }
  const task = (pending.get(workId) ?? Promise.resolve()).catch(() => {}).then(run).finally(() => {
    if (pending.get(workId) === task) pending.delete(workId);
  });
  pending.set(workId, task);
  return task;
}

export function compressWorkOutputs(store: TaskStore, workId: string): Promise<void> {
  return withWorkOutputs(store, workId, () => compress(store, workId));
}

async function compress(store: TaskStore, workId: string) {
  const work = store.work(workId);
  if (!['completed', 'cancelled'].includes(work.status) || work.outputsDeletedAt) return;
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

function endedWork(store: TaskStore, workId: string) {
  const work = store.work(workId);
  if (!['completed', 'cancelled'].includes(work.status)) throw new RuleError('WORK_NOT_ENDED', '只有已结束的工作可以导出或删除输出。');
  if (store.db.prepare(`SELECT id FROM dispatches WHERE work_id = ? AND status IN ('queued', 'running')
    UNION ALL SELECT id FROM coordinator_rounds WHERE work_id = ? AND status = 'running'`).get(workId, workId)) {
    throw new RuleError('OUTPUTS_BUSY', '工作输出仍在写入，请等待派单和调度轮次结束后重试。');
  }
  return work;
}

function workRecords(store: TaskStore, workId: string) {
  const rows = (table: string) => store.db.prepare(`SELECT * FROM ${table} WHERE work_id = ? ORDER BY rowid`).all(workId);
  return {
    formatVersion: 1,
    work: store.db.prepare('SELECT * FROM works WHERE id = ?').get(workId),
    workDescriptions: rows('work_descriptions'), cards: rows('cards'), dispatches: rows('dispatches'),
    coordinatorRounds: rows('coordinator_rounds'), coordinatorNotes: rows('coordinator_notes'),
    messages: rows('messages'), gates: rows('gates'), events: store.events({ workId }),
    dependencies: rows('dependencies'), wakeQueue: rows('wake_queue'),
    artifacts: store.db.prepare('SELECT * FROM artifacts WHERE dispatch_id IN (SELECT id FROM dispatches WHERE work_id = ?) ORDER BY rowid').all(workId),
  };
}

function filesIn(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesIn(path) : entry.isFile() ? [path] : [];
    });
  } catch (error) { if (missing(error)) return []; throw error; }
}

export function exportWorkOutputs(store: TaskStore, actor: Actor, workId: string, targetPath: string) {
  return withWorkOutputs(store, workId, async () => {
    endedWork(store, workId);
    const target = resolve(targetPath);
    if (!target.endsWith('.tar.gz')) throw new RuleError('INVALID_EXPORT_PATH', '导出目标路径必须以 .tar.gz 结尾。', 400);
    await compress(store, workId);
    const records = workRecords(store, workId);
    const paths = new Set(outputFiles(store, workId));
    // Include browser output and any other dispatch files, not just event streams.
    for (const dispatch of records.dispatches) for (const path of filesIn(dirname(String(dispatch.output_path)))) paths.add(path);
    for (const artifact of records.artifacts) if (artifact.path) paths.add(String(artifact.path));
    const files = [...paths].sort().map(sourcePath => {
      const archivePath = relative(store.dataDir, sourcePath);
      if (archivePath === '..' || archivePath.startsWith('../') || isAbsolute(archivePath)) {
        throw new RuleError('OUTPUT_PATH_SCOPE', '导出文件必须位于 Helm 数据目录中。');
      }
      return { sourcePath, archivePath };
    });
    let temporary: string | undefined;
    try {
      temporary = await mkdtemp(join(dirname(target), '.helm-export-'));
      const contents = join(temporary, 'contents');
      await mkdir(contents);
      for (const file of files) {
        const destination = join(contents, file.archivePath);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(file.sourcePath, destination);
      }
      await writeFile(join(contents, 'records.json'), JSON.stringify({ ...records, files }, null, 2));
      const archive = join(temporary, 'archive.tar.gz');
      await exec('tar', ['-czf', archive, '-C', contents, '.']);
      // Publish a complete archive, and never overwrite an existing user file.
      await link(archive, target);
    } catch (error) {
      throw new RuleError('OUTPUT_EXPORT_FAILED', `导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    store.transaction(() => {
      store.db.prepare('UPDATE works SET outputs_exported_at = ? WHERE id = ?').run(new Date().toISOString(), workId);
      store.appendEvent(actor, { type: 'work', id: workId }, 'outputs-exported', { targetPath: target }, { workId });
    });
    return { targetPath: target };
  });
}

export function deleteWorkOutputs(store: TaskStore, actor: Actor, workId: string, confirm = false) {
  return withWorkOutputs(store, workId, async () => {
    const work = endedWork(store, workId);
    const deleted = { status: 'deleted', message: '已删除' } as const;
    if (work.outputsDeletedAt) return deleted;
    if (!work.outputsExportedAt && !confirm) {
      return { requiresConfirmation: true, message: '尚未导出这项工作的输出，建议先导出。确认删除请设置 confirm: true；成果文件和代码会保留。' };
    }
    for (const path of outputFiles(store, workId)) await rm(path, { force: true });
    store.transaction(() => {
      store.db.prepare('UPDATE works SET outputs_deleted_at = ? WHERE id = ?').run(new Date().toISOString(), workId);
      store.appendEvent(actor, { type: 'work', id: workId }, 'outputs-deleted', { confirmedWithoutExport: !work.outputsExportedAt }, { workId });
      checkOutputUsage(store);
    });
    return deleted;
  });
}
