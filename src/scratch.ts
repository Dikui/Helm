import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dispatch } from './dispatch.js';
import { copyDispatchFile, redactDispatchText } from './project-environment.js';
import type { TaskStore } from './store.js';

export function scratchPath(store: TaskStore, workId: string, cardId: string) {
  return join(store.dataDir, 'scratch', workId, cardId);
}

export function createScratchDirectory(store: TaskStore, workId: string, cardId: string) {
  const path = scratchPath(store, workId, cardId);
  mkdirSync(path, { recursive: true });
  return path;
}

export function removeScratchDirectory(store: TaskStore, workId: string, cardId: string) {
  rmSync(scratchPath(store, workId, cardId), { recursive: true, force: true });
}

export async function saveScratchArtifacts(store: TaskStore, dispatch: Dispatch) {
  const root = scratchPath(store, dispatch.workId, dispatch.cardId);
  const directory = join(store.dataDir, 'dispatches', dispatch.id, 'artifacts');
  const files: { id: string; kind: 'file' | 'test-output'; name: string; path: string }[] = [];
  const notes: string[] = [];
  let currentName = '.';
  const prepare = (kind: 'file' | 'test-output', name: string) => {
    const id = randomUUID();
    const file = { id, kind, name: redactDispatchText(store, dispatch.id, name), path: join(directory, id) };
    files.push(file);
    return file;
  };
  const visit = async (directory: string, prefix: string) => {
    for (const entry of (await readdir(directory)).sort()) {
      const name = prefix ? `${prefix}/${entry}` : entry;
      currentName = name;
      const path = join(directory, entry);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) notes.push(`跳过符号链接：${name}`);
      else if (stat.isDirectory()) await visit(path, name);
      else if (stat.isFile()) await copyDispatchFile(store, dispatch.id, path, prepare('file', name).path);
    }
  };
  try {
    try { await lstat(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await mkdir(directory, { recursive: true });
    await visit(root, '');
    if (notes.length) {
      currentName = 'scratch-artifacts.txt';
      await writeFile(prepare('test-output', currentName).path, redactDispatchText(store, dispatch.id, notes.join('\n')));
    }
    store.transaction(() => {
      for (const file of files) {
        store.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, NULL, NULL)').run(file.id, dispatch.id, file.kind, file.name, file.path);
        store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'artifact', id: file.id }, 'artifact-saved',
          { kind: file.kind, name: file.name, path: file.path, ref: null, commitSha: null },
          { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id });
      }
    });
  } catch (error) {
    const cleanup = await Promise.allSettled(files.map(file => rm(file.path, { force: true })));
    const name = redactDispatchText(store, dispatch.id, currentName);
    const failures = [error, ...cleanup.filter(result => result.status === 'rejected').map(result => result.reason)];
    const reason = redactDispatchText(store, dispatch.id, failures.map(error => error instanceof Error ? error.message : String(error)).join('; '));
    store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id },
      'scratch-artifacts-unsaved', { name, reason }, { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id }));
    throw new Error(`临时目录成果未保存：${name}：${reason}`);
  }
}

export function reconcileScratchDirectories(store: TaskStore) {
  const root = join(store.dataDir, 'scratch');
  if (!existsSync(root)) return;
  for (const work of readdirSync(root, { withFileTypes: true })) {
    const workPath = join(root, work.name);
    const activeWork = store.db.prepare("SELECT 1 FROM works WHERE id = ? AND status NOT IN ('completed', 'cancelled')").get(work.name);
    if (!work.isDirectory() || !activeWork) { rmSync(workPath, { recursive: true, force: true }); continue; }
    for (const card of readdirSync(workPath, { withFileTypes: true })) {
      const active = store.db.prepare("SELECT 1 FROM cards WHERE id = ? AND work_id = ? AND workspace = 'scratch' AND status NOT IN ('completed', 'cancelled')")
        .get(card.name, work.name);
      if (!card.isDirectory() || !active) rmSync(join(workPath, card.name), { recursive: true, force: true });
    }
  }
}
