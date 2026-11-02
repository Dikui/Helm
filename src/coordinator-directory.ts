import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStore } from './store.js';

export function coordinatorPath(store: TaskStore, workId: string) {
  return join(store.dataDir, 'coordinator', workId);
}

export function createCoordinatorDirectory(store: TaskStore, workId: string) {
  const path = coordinatorPath(store, workId);
  mkdirSync(path, { recursive: true });
  return path;
}

export function removeCoordinatorDirectory(store: TaskStore, workId: string) {
  rmSync(coordinatorPath(store, workId), { recursive: true, force: true });
}

export function reconcileCoordinatorDirectories(store: TaskStore) {
  const root = join(store.dataDir, 'coordinator');
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const active = store.db.prepare("SELECT 1 FROM works WHERE id = ? AND status NOT IN ('completed', 'cancelled')").get(entry.name);
    if (!entry.isDirectory() || !active) removeCoordinatorDirectory(store, entry.name);
  }
}
