import { reviewReport } from './review-report.js';
// A separate helmd process lets recovery tests stop it without running close().
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FakeDriver, type FakeScript } from '../../src/driver.js';
import { startTestHelmd as startHelmd } from '../helmd-fixture.js';
import { watchTestProcess } from './test-process.js';

const [dataDir, purpose, testPid] = process.argv.slice(2);
watchTestProcess(Number(testPid)).unref();
let executingRounds = 0;
const round: FakeScript = ctx => {
  const brief = JSON.parse(ctx.input);
  process.send?.({ type: 'round', token: ctx.options.mcpServers.helm!.headers.Authorization });
  if (brief.work.status === 'aligning') return [
    { type: 'tool', name: 'draft-work-description', arguments: { workId: brief.work.id, key: 'draft', requirements: '启动对账', boundary: '本机', criteria: '崩溃后可接续' } },
  ];
  if (purpose === 'delivery') return [
    { type: 'tool', name: 'request-review', arguments: { workId: brief.work.id, key: 'review', report: reviewReport('检查合入顺序') } },
  ];
  if (purpose === 'failures' && (++executingRounds <= 2 || existsSync(join(dataDir!, 'fail-round')))) return [{ type: 'end', reason: 'error' }];
  return [{ type: 'hang' }];
};
const executor: FakeScript = [
  { type: 'write', path: 'progress.txt', content: 'saved progress\n' },
  { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: purpose === 'verification' ? 'passed' : 'completed', reason: '检查结果' } },
  ...(purpose === 'settled' ? [] : [{ type: 'hang' as const }]),
];
const daemon = await startHelmd({ port: 0, dataDir, driver: new FakeDriver(Array(100).fill(round)),
  roundRetryDelaysMs: [20, 40],
  executorDriver: new FakeDriver(Array(100).fill(executor)),
  browserCommand: { file: process.execPath, args: [fileURLToPath(new URL('./browser-mcp.js', import.meta.url)), '--test-process-pid', testPid!, '--stubborn'] },
});
process.send?.({ type: 'ready', url: daemon.url });
process.on('message', message => {
  if (message === 'close') void daemon.close().then(() => process.exit(0));
});
