import { existsSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStore } from './store.js';

// Codex backfills every past session into each fresh CODEX_SQLITE_HOME (about 60 MB per run, measured 2026-11-12),
// and a later run never reads it: with Codex CLI 0.167.2 a new app-server process resumed the thread and recalled
// the previous turn after the first run's directory had been deleted (ADR 0017 saw the same with a fresh directory).
// Call only once the run's driver processes have exited. Returns whether the directory is gone.
export function removeDriverState(store: TaskStore, run: 'dispatches' | 'rounds', id: string) {
  const parent = join(store.dataDir, run, id);
  try {
    if (!existsSync(parent)) return true;
    // A linked run directory leads outside the data directory; a linked ancestor of the data directory itself is fine.
    // rmSync unlinks links below it without following them.
    if (realpathSync(parent) !== join(realpathSync(store.dataDir), run, id)) return false;
    rmSync(join(parent, 'codex-sqlite'), { recursive: true, force: true });
    return true;
  } catch { return false; } // Kept on disk and in sqlite_path; the next startup tries again.
}

// Startup only: covers runs that ended without their own cleanup, and directories kept by earlier versions.
export function removeEndedDriverState(store: TaskStore) {
  const dispatches = store.db.prepare(`SELECT id, sqlite_path FROM dispatches WHERE status = 'ended'`).all();
  const cleared = dispatches.filter(row => removeDriverState(store, 'dispatches', String(row.id)) && row.sqlite_path !== null);
  store.transaction(() => {
    for (const row of cleared) store.db.prepare('UPDATE dispatches SET sqlite_path = NULL WHERE id = ?').run(String(row.id));
  });
  for (const row of store.db.prepare(`SELECT id FROM coordinator_rounds WHERE status = 'ended'`).all()) removeDriverState(store, 'rounds', String(row.id));
}
