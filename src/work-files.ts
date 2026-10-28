import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { RuleError, type TaskStore } from './store.js';
import { projectPath } from './alignment.js';
import { attachmentDirectory, maxAttachmentBytes } from './attachments.js';

// Read from the work branch rather than the work copy, so files stay readable after the copy is removed.
function git(store: TaskStore, workId: string, args: string[]) {
  return execFileSync('git', ['-C', projectPath(store, workId), ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: maxAttachmentBytes + 1024, timeout: 10_000 });
}

export function listWorkFiles(store: TaskStore, workId: string): string[] {
  const branch = store.work(workId).workBranch;
  if (!branch) return [];
  try { return git(store, workId, ['ls-tree', '-r', '--name-only', '-z', branch]).toString('utf8').split('\0').filter(Boolean); }
  catch { return []; }
}

function attachment(store: TaskStore, workId: string, path: string) {
  let source: string;
  try { source = realpathSync(path); }
  catch { throw new RuleError('FILE_NOT_FOUND', '找不到这个文件。', 404); }
  const suffix = relative(realpathSync(attachmentDirectory(store, workId)), source);
  if (!suffix || suffix.startsWith('..') || isAbsolute(suffix)) throw new RuleError('FILE_SCOPE', '只能读取工作分支上的文件或这项工作的附件。', 400);
  if (statSync(source).size > maxAttachmentBytes) throw new RuleError('FILE_TOO_LARGE', '文件超过 20 MiB，无法预览。', 413);
  return readFileSync(source);
}

function branchFile(store: TaskStore, workId: string, path: string) {
  const branch = store.work(workId).workBranch;
  if (!branch) throw new RuleError('FILE_NOT_FOUND', '工作副本尚未创建。', 404);
  const object = `${branch}:${path}`;
  let size: number;
  try { size = Number(git(store, workId, ['cat-file', '-s', object]).toString().trim()); }
  catch { throw new RuleError('FILE_NOT_FOUND', '工作分支上没有这个文件。', 404); }
  if (size > maxAttachmentBytes) throw new RuleError('FILE_TOO_LARGE', '文件超过 20 MiB，无法预览。', 413);
  try { return git(store, workId, ['cat-file', 'blob', object]); }
  catch { throw new RuleError('FILE_NOT_FOUND', '工作分支上没有这个文件。', 404); }
}

export function readWorkFile(store: TaskStore, workId: string, path: string, encoding: 'utf8' | 'base64' = 'utf8') {
  const content = isAbsolute(path) ? attachment(store, workId, path) : branchFile(store, workId, path);
  return { path, size: content.length, content: content.toString(encoding) };
}
