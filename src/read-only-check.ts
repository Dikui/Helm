import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Dispatch } from './dispatch.js';
import type { TaskStore } from './store.js';

export interface ReadOnlyCheck {
  status: 'unchanged' | 'violated' | 'unchecked'; paths: string[]; projectDirectory: boolean;
  reason?: 'not-git' | 'check-failed' | 'baseline-missing'; note?: string;
}

interface Snapshot {
  root: string; head: string | null; paths: Record<string, string>; projectDirectory: boolean;
}

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
}

function snapshot(root: string, projectDirectory: boolean): Snapshot {
  let head: string | null = null;
  try { head = git(root, 'rev-parse', '--verify', 'HEAD').trim(); } catch {}
  const staged = new Map<string, string>();
  for (const entry of git(root, 'ls-files', '--stage', '-z').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const path = entry.slice(tab + 1);
    staged.set(path, (staged.get(path) ?? '') + entry.slice(0, tab));
  }
  const paths: Record<string, string> = Object.create(null);
  const entries = git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
  const fingerprint = (path: string, status: string) => {
    const hash = createHash('sha256').update(status).update(staged.get(path) ?? '');
    try {
      const file = join(root, path);
      const stat = lstatSync(file);
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink()) hash.update(readlinkSync(file));
      else if (stat.isFile()) hash.update(readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hash.update('missing');
    }
    paths[path] = hash.digest('hex');
  };
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const status = entry.slice(0, 2);
    fingerprint(entry.slice(3), status);
    if (/[RC]/.test(status)) fingerprint(entries[++index]!, status);
  }
  return { root, head, paths, projectDirectory };
}

export function readOnlySnapshot(path: string, projectDirectory: boolean): Snapshot | ReadOnlyCheck {
  let root: string;
  try { root = git(path, 'rev-parse', '--show-toplevel').slice(0, -1); }
  catch { return { status: 'unchecked', paths: [], projectDirectory, reason: 'not-git', note: '非 git 目录，未检查' }; }
  try { return snapshot(root, projectDirectory); }
  catch { return { status: 'unchecked', paths: [], projectDirectory, reason: 'check-failed', note: '无法读取 git 状态，未检查' }; }
}

export function finishReadOnlyCheck(store: TaskStore, dispatch: Dispatch) {
  const row = store.db.prepare('SELECT read_only_snapshot, read_only_check FROM dispatches WHERE id = ?').get(dispatch.id)!;
  if (row.read_only_check) return;
  const before = row.read_only_snapshot ? JSON.parse(String(row.read_only_snapshot)) as Snapshot | ReadOnlyCheck : undefined;
  let result: ReadOnlyCheck;
  if (!before) result = { status: 'unchecked', paths: [], projectDirectory: !store.work(dispatch.workId).workPath,
    reason: 'baseline-missing', note: '缺少派单前的 git 状态，未检查' };
  else if ('status' in before) result = before;
  else {
    try {
      const after = snapshot(before.root, before.projectDirectory);
      const changed = new Set([...Object.keys(before.paths), ...Object.keys(after.paths)]
        .filter(path => before.paths[path] !== after.paths[path]));
      if (before.head !== after.head) {
        const files = before.head && after.head ? git(before.root, 'diff', '--name-only', '--no-renames', '-z', before.head, after.head)
          : git(before.root, 'ls-tree', '-r', '--name-only', '-z', (after.head ?? before.head)!);
        for (const path of files.split('\0').filter(Boolean)) changed.add(path);
      }
      result = { status: before.head !== after.head || changed.size ? 'violated' : 'unchanged', paths: [...changed].sort(), projectDirectory: before.projectDirectory };
      if (before.projectDirectory) result.note = '在项目目录运行，可能包含用户自己的改动';
    } catch {
      result = { status: 'unchecked', paths: [], projectDirectory: before.projectDirectory, reason: 'check-failed', note: '无法读取 git 状态，未检查' };
    }
  }
  store.transaction(() => {
    store.db.prepare('UPDATE dispatches SET read_only_check = ?, read_only_snapshot = NULL WHERE id = ?').run(JSON.stringify(result), dispatch.id);
    if (result.status === 'violated') store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id },
      'dispatch-read-only-violated', result, { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id });
  });
}
