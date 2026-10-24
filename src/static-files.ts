import { readFile, realpath, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleError } from './store.js';

export const defaultStaticDir = fileURLToPath(new URL('../ui/', import.meta.url));
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
};

export function staticPath(target: string) {
  let path: string;
  try { path = decodeURIComponent(target.split('?', 1)[0]!); }
  catch { throw new RuleError('INVALID_PATH', '请求路径无效。', 400); }
  if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) {
    throw new RuleError('INVALID_PATH', '静态路径不能越出静态目录。', 400);
  }
  return path;
}

export async function serveStatic(directory: string, path: string, response: ServerResponse) {
  const root = await realpath(directory);
  const inside = (target: string) => {
    const suffix = relative(root, target);
    return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  };
  const read = async (target: string) => {
    const canonical = await realpath(target);
    if (!inside(canonical)) throw new RuleError('INVALID_PATH', '静态路径不能越出静态目录。', 400);
    if (!(await stat(canonical)).isFile()) return undefined;
    return { data: await readFile(canonical), extension: extname(canonical) };
  };
  let file;
  try { file = await read(resolve(root, '.' + path)); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
  file ??= await read(resolve(root, 'index.html'));
  if (!file) throw new RuleError('NOT_FOUND', '未找到界面，请先运行 npm run build。', 404);
  response.writeHead(200, { 'content-type': contentTypes[file.extension] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  response.end(file.data);
}
