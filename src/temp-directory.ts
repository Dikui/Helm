import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStore } from './store.js';

// Executors get <data>/tmp/<card>, coordinators <data>/tmp/<work>. Card and
// work ids are UUIDs, so one flat level stays short enough for Unix sockets.
export function tempPath(store: TaskStore, ownerId: string) {
  return join(store.dataDir, 'tmp', ownerId);
}

// Create the directory and return the variables pointing the Agent at it.
export function tempEnvironment(store: TaskStore, ownerId: string) {
  const path = tempPath(store, ownerId);
  mkdirSync(path, { recursive: true });
  return { TMPDIR: path, TMP: path, TEMP: path };
}

export function removeTempDirectory(store: TaskStore, ownerId: string) {
  rmSync(tempPath(store, ownerId), { recursive: true, force: true });
}

// Helm owns <data>/tmp entirely. rmSync removes a symlink entry itself, never its target.
export function reconcileTempDirectories(store: TaskStore) {
  const root = join(store.dataDir, 'tmp');
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const active = entry.isDirectory() && store.db.prepare(`SELECT 1 FROM works WHERE id = ? AND status NOT IN ('completed', 'cancelled')
      UNION ALL SELECT 1 FROM cards c JOIN works w ON w.id = c.work_id
      WHERE c.id = ? AND c.status NOT IN ('completed', 'cancelled') AND w.status NOT IN ('completed', 'cancelled')`).get(entry.name, entry.name);
    if (!active) removeTempDirectory(store, entry.name);
  }
}
