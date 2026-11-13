import { accessSync, constants, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { RuleError, type Actor, type TaskStore } from './store.js';

// A configured location gets a helm-tmp subdirectory, so Helm only ever manages (and reconciles away)
// entries it created, never other files already in that location. Unset means <data>/tmp.
export function tempRoot(store: TaskStore) {
  const configured = store.db.prepare('SELECT temp_root FROM settings WHERE id = 1').get()!.temp_root;
  return configured ? join(String(configured), 'helm-tmp') : join(store.dataDir, 'tmp');
}

// Executors get <root>/<card>, coordinators <root>/<work>. Card and
// work ids are UUIDs, so one flat level stays short enough for Unix sockets.
export function tempPath(store: TaskStore, ownerId: string) {
  return join(tempRoot(store), ownerId);
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

// The current root is Helm's entirely. rmSync removes a symlink entry itself, never its target.
export function reconcileTempDirectories(store: TaskStore) {
  const root = tempRoot(store);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const active = entry.isDirectory() && store.db.prepare(`SELECT 1 FROM works WHERE id = ? AND status NOT IN ('completed', 'cancelled')
      UNION ALL SELECT 1 FROM cards c JOIN works w ON w.id = c.work_id
      WHERE c.id = ? AND c.status NOT IN ('completed', 'cancelled') AND w.status NOT IN ('completed', 'cancelled')`).get(entry.name, entry.name);
    if (!active) removeTempDirectory(store, entry.name);
  }
}

// null or blank restores the default. The data left under the previous root is deleted: Helm owns it, and
// keeping it would leave temporary data nobody cleans. Refused while an Agent may be writing there.
export function setTempRoot(store: TaskStore, actor: Actor, input: string | null) {
  const path = input?.trim() ? resolve(input.trim()) : null;
  if (input?.trim() && !isAbsolute(input.trim())) throw new RuleError('INVALID_TEMP_ROOT', '临时数据目录的位置必须是绝对路径。');
  const previous = tempRoot(store);
  const current = store.db.prepare('SELECT temp_root FROM settings WHERE id = 1').get()!.temp_root ?? null;
  if (current === path) return { tempRoot: path, tempDirectory: previous };
  if (store.db.prepare(`SELECT 1 FROM dispatches WHERE status = 'running' UNION ALL SELECT 1 FROM coordinator_rounds WHERE status = 'running'`).get()) {
    throw new RuleError('TEMP_ROOT_IN_USE', '有运行中的派单或调度轮次，结束后再修改临时数据目录。', 409);
  }
  const next = path ? join(path, 'helm-tmp') : join(store.dataDir, 'tmp');
  const nested = (outer: string, inner: string) => { const rest = relative(outer, inner); return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest); };
  // Deleting the previous root would also delete a new root inside it, and the reverse.
  if (nested(previous, next) || nested(next, previous)) throw new RuleError('INVALID_TEMP_ROOT', `新位置不能在当前临时数据目录 ${previous} 之内，也不能包含它。`);
  try { mkdirSync(next, { recursive: true }); accessSync(next, constants.W_OK); }
  catch (error) { throw new RuleError('INVALID_TEMP_ROOT', `无法在该位置创建可写的临时数据目录：${(error as Error).message}`); }
  store.transaction(() => {
    store.db.prepare('UPDATE settings SET temp_root = ? WHERE id = 1').run(path);
    store.appendEvent(actor, { type: 'settings', id: 'global' }, 'temp-root-set', { tempRoot: path });
  });
  if (previous !== next) rmSync(previous, { recursive: true, force: true });
  return { tempRoot: path, tempDirectory: next };
}
