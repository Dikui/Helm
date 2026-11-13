import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStore } from './store.js';
import { removeTempDirectory } from './temp-directory.js';

export function coordinatorPath(store: TaskStore, workId: string) {
  return join(store.dataDir, 'coordinator', workId);
}

export function createCoordinatorDirectory(store: TaskStore, workId: string) {
  const path = coordinatorPath(store, workId);
  mkdirSync(path, { recursive: true });
  return path;
}

// The temporary data directories of the work and of all its cards share the coordinator directory's lifetime:
// cards that never complete or get cancelled (skipped, still waiting) are not left until the next startup.
export function removeCoordinatorDirectory(store: TaskStore, workId: string) {
  rmSync(coordinatorPath(store, workId), { recursive: true, force: true });
  removeTempDirectory(store, workId);
  for (const row of store.db.prepare('SELECT id FROM cards WHERE work_id = ?').all(workId)) removeTempDirectory(store, String(row.id));
}

export function reconcileCoordinatorDirectories(store: TaskStore) {
  const root = join(store.dataDir, 'coordinator');
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const active = store.db.prepare("SELECT 1 FROM works WHERE id = ? AND status NOT IN ('completed', 'cancelled')").get(entry.name);
    if (!entry.isDirectory() || !active) removeCoordinatorDirectory(store, entry.name);
  }
}
