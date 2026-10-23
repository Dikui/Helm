// Inherit only the host facilities needed to run a locally installed CLI.
// Never read credential or desktop-session values, even to discard them later.
export function runtimeEnvironment(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  const groups = [
    ['PATH'], // Find the locally installed CLI and developer tools.
    ['HOME'], // Let the CLI use its own local subscription login; Helm never reads it.
    ['USER', 'LOGNAME'], // User identity expected by shells and developer tools.
    ['SHELL'], // Shell used by the CLI's Bash tool.
    ['LANG', 'LANGUAGE', 'LC_ALL', 'LC_COLLATE', 'LC_CTYPE', 'LC_MESSAGES', 'LC_MONETARY', 'LC_NUMERIC', 'LC_TIME'], // Locale and text encoding.
    ['TMPDIR', 'TMP', 'TEMP'], // Host-selected temporary storage, including macOS sandbox paths.
    ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'], // Network routing and local MCP bypass.
  ];
  for (const key of groups.flat()) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
