import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { saveArtifact, type Dispatch } from './dispatch.js';
import { maxAttachmentBytes } from './attachments.js';
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

export function saveScratchArtifacts(store: TaskStore, dispatch: Dispatch) {
  const root = scratchPath(store, dispatch.workId, dispatch.cardId);
  if (!existsSync(root)) return;
  const notes: string[] = [];
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory).sort()) {
      const name = prefix ? `${prefix}/${entry}` : entry;
      const path = join(directory, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) notes.push(`跳过符号链接：${name}`);
      else if (stat.isDirectory()) visit(path, name);
      else if (stat.isFile()) {
        if (stat.size > maxAttachmentBytes) notes.push(`跳过超过 20 MiB 的文件：${name}`);
        else saveArtifact(store, dispatch, 'file', name, readFileSync(path));
      }
    }
  };
  store.transaction(() => {
    visit(root, '');
    if (notes.length) saveArtifact(store, dispatch, 'test-output', 'scratch-artifacts.txt', notes.join('\n'));
  });
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
