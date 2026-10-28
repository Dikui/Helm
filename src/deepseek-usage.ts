import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { z } from 'zod';
import type { TokenUsage } from './driver.js';

const count = z.number().int().nonnegative().safe();
const usageSchema = z.object({ inputTokens: count, outputTokens: count,
  cacheReadTokens: count.optional(), cacheWriteTokens: count.optional() });

// dsh 0.2.1-rc.2: persistence-jsonl/format and llm/types.TokenUsage.
// Only open this session's file, never scan other users' conversation contents.
export async function deepseekUsage(env: Record<string, string>, sessionId: string, allowMissing = false): Promise<TokenUsage> {
  const root = join(env.DSH_HOME ?? join(env.HOME ?? homedir(), '.dsh'), 'sessions');
  const encodedId = sessionId === '.' || sessionId === '..' ? sessionId.replaceAll('.', '~002E')
    : sessionId.split('').map(char => /^[A-Za-z0-9._-]$/.test(char) ? char : `~${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join('');
  if (!encodedId) throw new Error('DeepSeek session id is empty');
  const total = { inputTokens: 0, outputTokens: 0 };
  let projects;
  try { projects = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const project of projects ?? []) {
    if (!project.isDirectory()) continue;
    let compressed;
    try { compressed = await readFile(join(root, project.name, encodedId, 'session.v4.jsonl.zstd')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const decoded = typeof zlib.zstdDecompress === 'function'
      ? await promisify(zlib.zstdDecompress)(compressed, { maxOutputLength: 64 * 1024 * 1024 })
      : Buffer.from((await import('fzstd')).decompress(compressed));
    const text = decoded.toString('utf8');
    const [first, ...lines] = text.split('\n');
    const header = JSON.parse(first!);
    if (header.type !== 'session' || header.version !== 4 || header.id !== sessionId) throw new Error('DeepSeek usage log has an unexpected session header');
    let reported = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!['assistant/message', 'assistant/attempt', 'compaction/summary'].includes(row.type)) continue;
      // Message usage mirrors its embedded stream; count it once. Failed
      // attempts have only a stream, whose last usage chunk is authoritative.
      const value = row.data?.usage ?? row.data?.stream?.findLast((entry: any) => entry.type === 'chunk' && entry.chunk?.type === 'usage')?.chunk.usage;
      if (value === undefined) continue;
      const usage = usageSchema.parse(value);
      reported = true;
      total.inputTokens += usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      total.outputTokens += usage.outputTokens;
    }
    return reported || allowMissing ? total : { inputTokens: null, outputTokens: null };
  }
  if (allowMissing) return total;
  throw new Error(`DeepSeek session ${sessionId} has no session.v4.jsonl.zstd usage log`);
}
