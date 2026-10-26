import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { RuleError, type TaskStore } from './store.js';

export const maxAttachmentBytes = 20 * 1024 * 1024;

export const attachmentsSchema = z.array(z.object({
  name: z.string().min(1).max(255).refine(name => name === basename(name) && !['.', '..'].includes(name) && !/[\\\0]/.test(name), '文件名不能包含路径。'),
  // A grouped base64 regex overflows the stack on multi-MiB strings; a flat class plus length check stays linear.
  content: z.string().refine(content => content.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(content), '内容必须是 base64。'),
}).strict()).max(10).refine(items => new Set(items.map(item => item.name)).size === items.length, '同一条消息的附件不能重名。');

export function attachmentDirectory(store: TaskStore, workId: string) {
  return join(store.dataDir, 'attachments', workId);
}

// Agents read the files by absolute path, so nothing is copied into the project or card copies.
export function saveAttachments(store: TaskStore, workId: string, messageId: string, attachments: z.infer<typeof attachmentsSchema>) {
  const files = attachments.map(item => ({ name: item.name, content: Buffer.from(item.content, 'base64') }));
  if (files.reduce((total, file) => total + file.content.length, 0) > maxAttachmentBytes) {
    throw new RuleError('ATTACHMENTS_TOO_LARGE', '一条消息的附件合计不能超过 20 MiB。', 413);
  }
  if (!files.length) return [];
  const directory = join(attachmentDirectory(store, workId), messageId);
  mkdirSync(directory, { recursive: true });
  return files.map(file => {
    const path = join(directory, file.name);
    writeFileSync(path, file.content, { flag: 'wx' });
    return { name: file.name, path, size: file.content.length };
  });
}
