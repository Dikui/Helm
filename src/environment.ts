import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

// Inherit only the host facilities needed to run a locally installed CLI.
// Never read credential or desktop-session values, even to discard them later.
export const runtimeEnvironmentNames = [
    ['PATH'], // Find the locally installed CLI and developer tools.
    ['HOME'], // Let the CLI use its own local subscription login; Helm never reads it.
    ['USER', 'LOGNAME'], // User identity expected by shells and developer tools.
    ['SHELL'], // Shell used by the CLI's Bash tool.
    ['LANG', 'LANGUAGE', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME'], // Locale and text encoding.
    ['TMPDIR', 'TMP', 'TEMP'], // Host-selected temporary storage, including macOS sandbox paths.
    ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'], // Network routing and local MCP bypass.
].flat();

export function runtimeEnvironment(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of runtimeEnvironmentNames) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function findExecutable(name: string, env: Record<string, string>) {
  for (const directory of (env.PATH ?? '').split(':').filter(Boolean)) {
    const path = resolve(directory, name);
    try { await access(path, constants.X_OK); return await realpath(path); }
    catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return undefined;
}
