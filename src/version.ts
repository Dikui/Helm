import { readFileSync } from 'node:fs';

// Reported to CLIs and MCP clients on connect; package.json stays the single source.
export const helmVersion: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
