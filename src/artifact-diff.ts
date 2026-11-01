import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { RuleError } from './store.js';

export const artifactDiffLimits = { files: 200, pathBytes: 4096, summaryBytes: 128 * 1024, patchBytes: 256 * 1024, timeoutMs: 5000 } as const;
export interface ArtifactDiffFile { path: string; previousPath?: string; additions: number | null; deletions: number | null; binary: boolean }
export type ArtifactDiff = { limits: typeof artifactDiffLimits } & (
  { status: 'unavailable'; reason: 'repository-unavailable' | 'base-missing' | 'commit-unavailable' | 'read-failed' } |
  { status: 'available'; baseCommit: string; headCommit: string; branchAvailable: boolean; copyAvailable: boolean;
    files: ArtifactDiffFile[]; truncated: boolean; patch?: { path: string; text: string; truncated: boolean } }
);

export function validArtifactDiffPath(path: string) {
  return path.length > 0 && Buffer.byteLength(path) <= artifactDiffLimits.pathBytes && !path.includes('\0') && !isAbsolute(path)
    && !path.split('/').some(part => part === '..' || part === '.' || part === '');
}

// These commands compare saved trees only. Never run external diff/textconv or interpret a file as a pathspec.
function git(project: string, args: string[], limit: number) {
  const options = { stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], maxBuffer: limit, timeout: artifactDiffLimits.timeoutMs };
  try { return { bytes: execFileSync('git', ['--no-pager', '--literal-pathspecs', '-C', project, ...args], options), truncated: false }; }
  catch (error) {
    const failure = error as { code?: string; stdout?: Buffer };
    if (failure.code === 'ENOBUFS' && Buffer.isBuffer(failure.stdout)) return { bytes: failure.stdout.subarray(0, limit), truncated: true };
    throw error;
  }
}

function numstat(bytes: Buffer, clipped: boolean) {
  const last = bytes.lastIndexOf(0);
  const records = bytes.subarray(0, last + 1).toString('utf8').split('\0');
  records.pop();
  const files: ArtifactDiffFile[] = [];
  let truncated = clipped || last + 1 !== bytes.length;
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const first = record.indexOf('\t'); const second = record.indexOf('\t', first + 1);
    if (first < 0 || second < 0) { truncated = true; break; }
    const added = record.slice(0, first); const removed = record.slice(first + 1, second);
    let path = record.slice(second + 1); let previousPath: string | undefined;
    if (!path) { previousPath = records[++index]; path = records[++index] ?? ''; }
    if (!validArtifactDiffPath(path) || previousPath !== undefined && !validArtifactDiffPath(previousPath)) { truncated = true; continue; }
    if (files.length === artifactDiffLimits.files) { truncated = true; break; }
    const binary = added === '-' || removed === '-';
    files.push({ path, ...(previousPath ? { previousPath } : {}), binary, additions: binary ? null : Number(added), deletions: binary ? null : Number(removed) });
  }
  return { files, truncated };
}

export function readArtifactDiff(context: { project: string; baseCommit: string | null; headCommit: string | null; branch: string | null; copyPath: string | null }, path?: string): ArtifactDiff {
  if (path !== undefined && !validArtifactDiffPath(path)) throw new RuleError('INVALID_ARTIFACT_PATH', '请选择成果列表中的相对文件路径（最多 4096 字节）。', 400);
  const unavailable = (reason: Extract<ArtifactDiff, { status: 'unavailable' }>['reason']): ArtifactDiff => ({ status: 'unavailable', reason, limits: artifactDiffLimits });
  const { project, baseCommit, headCommit } = context;
  try {
    if (!existsSync(join(project, '.git')) || realpathSync(project) !== realpathSync(git(project, ['rev-parse', '--show-toplevel'], 8192).bytes.toString('utf8').trimEnd())) return unavailable('repository-unavailable');
  } catch { return unavailable('repository-unavailable'); }
  if (!baseCommit) return unavailable('base-missing');
  if (!headCommit || ![baseCommit, headCommit].every(commit => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit))) return unavailable('commit-unavailable');
  try {
    for (const commit of new Set([baseCommit, headCommit])) git(project, ['cat-file', '-e', `${commit}^{commit}`], 8192);
  } catch { return unavailable('commit-unavailable'); }
  try {
    const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];
    const summary = git(project, [...args, '--numstat', '-z', baseCommit, headCommit, '--'], artifactDiffLimits.summaryBytes);
    const { files, truncated } = numstat(summary.bytes, summary.truncated);
    let branchAvailable = false;
    if (context.branch) {
      try { git(project, ['show-ref', '--verify', '--quiet', `refs/heads/${context.branch}`], 8192); branchAvailable = true; }
      catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
    }
    let patch: Extract<ArtifactDiff, { status: 'available' }>['patch'];
    if (path !== undefined) {
      const file = files.find(file => file.path === path);
      if (!file) throw new RuleError('INVALID_ARTIFACT_PATH', '这个文件不在成果变更列表中，可能已被截断。', 400);
      const result = git(project, [...args, '--patch', '--unified=3', baseCommit, headCommit, '--', ...(file.previousPath ? [file.previousPath] : []), file.path], artifactDiffLimits.patchBytes);
      patch = { path: file.path, text: new StringDecoder('utf8').write(result.bytes), truncated: result.truncated };
    }
    return { status: 'available', baseCommit, headCommit, files, truncated, branchAvailable,
      copyAvailable: Boolean(context.copyPath && existsSync(context.copyPath)), ...(patch ? { patch } : {}), limits: artifactDiffLimits };
  } catch (error) {
    if (error instanceof RuleError) throw error;
    return unavailable('read-failed');
  }
}
