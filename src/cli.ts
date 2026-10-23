#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { operations } from './operations.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    console.log('helm serve [--port 4242] [--data-dir ~/.helm/]');
    console.log('helm service install');
    for (const operation of operations.filter(item => item.callers.includes('user'))) {
      console.log(`helm ${operation.name} ${Object.keys(operation.schema.shape).map(key => `--${key} <value>`).join(' ')}  ${operation.description}`);
    }
    return;
  }
  if (command === 'service') {
    if (args.length !== 1 || args[0] !== 'install') throw new Error('Usage: helm service install');
    const { installUserService } = await import('./service.js');
    console.log(await installUserService());
    return;
  }
  if (command === 'serve') {
    const { values } = parseArgs({ args, options: { port: { type: 'string' }, 'data-dir': { type: 'string' } } });
    const port = Number(values.port ?? 4242);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer between 0 and 65535');
    const { startHelmd } = await import('./server.js');
    const { ClaudeDriver } = await import('./claude-driver.js');
    const { CodexDriver } = await import('./codex-driver.js');
    const { FakeDriver } = await import('./driver.js');
    // HELM_FAKE_COORDINATOR lets subprocess tests start helmd without launching claude.
    const claude = new ClaudeDriver();
    const fake = new FakeDriver();
    const drivers = { 'claude-sdk': process.env.HELM_FAKE_COORDINATOR === '1'
      ? { checkAvailability: (template: Parameters<typeof claude.checkAvailability>[0]) => fake.checkAvailability(template),
        start: (options: Parameters<typeof claude.start>[0]) => (options.template?.role === 'coordinator' ? fake : claude).start(options) }
      : claude, codex: process.env.HELM_FAKE_COORDINATOR === '1' ? new FakeDriver() : new CodexDriver() };
    const daemon = await startHelmd({ port, dataDir: values['data-dir'], drivers });
    console.log(JSON.stringify({ url: daemon.url }));
    const stop = () => { daemon.close().catch(error => { console.error(error); process.exitCode = 1; }); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return;
  }
  const definition = operations.find(item => item.name === command && item.callers.includes('user'));
  if (!definition) throw new Error(`Unknown command: ${command}. Run helm --help.`);
  const schema = z.toJSONSchema(definition.schema);
  const fields = schema.properties ?? {};
  const options: Record<string, { type: 'string' }> = { url: { type: 'string' } };
  for (const key of Object.keys(fields)) options[key] = { type: 'string' };
  const { values } = parseArgs({ args, options });
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === 'url' || value === undefined) continue;
    const field = fields[key];
    const type = field && typeof field === 'object' ? field.type : undefined;
    if (type === 'boolean' && value !== 'true' && value !== 'false') throw new Error(`${key} must be true or false`);
    params[key] = type === 'boolean' ? value === 'true' : type === 'integer' || type === 'number' ? Number(value) : value;
  }
  const url = values.url ?? process.env.HELM_URL ?? 'http://127.0.0.1:4242';
  const response = await fetch(`${url}/api/${command}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
