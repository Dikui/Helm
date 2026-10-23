import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { startHelmd } from '../src/server.js';
import { defaultTemplateDir, TemplateCatalog } from '../src/templates.js';
import { acpFixture } from './acp-fixture.js';
import { grokFixture } from './grok-executor-fixture.js';

for (const purpose of ['execution', 'verification'] as const) test(`Grok ${purpose} 派单通过假 ACP 调用同一 Helm 端点的结论和浏览器，保存结果、用量与卡片改动`, async t => {
  const site = createServer((_request, response) => response.end('<h1>Grok ACP fixture</h1>'));
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
  const address = site.address();
  assert.ok(address && typeof address !== 'string');
  const acp = await acpFixture(t, { uniqueSession: true, writes: [{ path: 'inside.txt', content: 'inside\n' }], mcpTools: [
    { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } },
    { name: 'browser_snapshot', arguments: {} },
    { name: 'browser_take_screenshot', arguments: { filename: 'grok.png', type: 'png' } },
    { name: 'submit-conclusion', arguments: { conclusion: purpose === 'execution' ? 'completed' : 'passed', reason: '脚本检查通过' } },
  ] }, false);
  const daemon = await grokFixture(t, acp.driver, { purpose, needsBrowser: true });
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'completed', dispatch.failure);
  assert.equal(dispatch.finalAnswer, '已完成');
  assert.equal(dispatch.conclusion, purpose === 'execution' ? 'completed' : 'passed');
  assert.deepEqual(dispatch.usage, { inputTokens: 120, outputTokens: 9 });
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
  assert.deepEqual(card.usage, { inputTokens: 120, outputTokens: 9 });
  assert.deepEqual((await daemon.call('get-work', { workId: daemon.work.id })).result.usage, { inputTokens: 120, outputTokens: 9 });
  if (purpose === 'execution') {
    assert.equal((await readFile(join(card.workPath, 'inside.txt'), 'utf8')).trim(), 'inside');
    assert.equal(daemon.git('show', `${card.cardBranch}:inside.txt`), 'inside');
    assert.notEqual(dispatch.startCommit, dispatch.endCommit, '执行改动由运行层提交');
  } else {
    await assert.rejects(stat(join(card.workPath, 'inside.txt')), { code: 'ENOENT' });
    assert.equal(dispatch.startCommit, dispatch.endCommit, '验收改动被运行层重置');
    assert.equal(dispatch.resumeSessionId, null);
  }
  const requests = await acp.requests();
  const tools = requests.find(r => r.method === 'fixture/tools').result.tools.map((tool: any) => tool.name);
  assert.ok(tools.includes('submit-conclusion') && tools.includes('browser_navigate'));
  assert.ok(!tools.includes('create-card'), '执行者不能拿到调度者工具');
  const spawns = requests.filter(r => r.method === 'fixture/spawn');
  assert.ok(spawns.every(r => r.env.HOME === daemon.home));
  const calls = requests.filter(r => r.method === 'fixture/mcp');
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => !call.result.isError));
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: dispatch.id })).result;
  assert.ok(artifacts.some((a: any) => a.name === 'browser/grok.png'));
});

test('startHelmd 默认登记 Grok 驱动和内置模板；调度者模板不可用并将原因写入待处理（CLI 替身）', async t => {
  const acp = await acpFixture(t);
  const bin = join(acp.directory, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'grok');
  const fixture = fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url));
  await writeFile(executable, `#!${process.execPath}\nprocess.argv.splice(1, 1, ${JSON.stringify(fixture)}, ${JSON.stringify(join(acp.directory, 'script.json'))});\nimport(${JSON.stringify(pathToFileURL(fixture).href)});\n`);
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const templateDir = join(acp.directory, 'templates');
  await cp(join(defaultTemplateDir, 'grok-executor'), join(templateDir, 'grok-executor'), { recursive: true });
  await cp(join(defaultTemplateDir, 'grok-executor'), join(templateDir, 'grok-coordinator'), { recursive: true });
  const configPath = join(templateDir, 'grok-coordinator', 'config.json');
  await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, 'utf8')), role: 'coordinator' }));
  const daemon = await startHelmd({ port: 0, dataDir: join(acp.directory, 'data'), templateDir });
  try {
    assert.throws(() => new TemplateCatalog(templateDir, ['grok']).get('grok-coordinator', 'coordinator'), /本阶段只支持执行者/,
      '设置调度者模板的同步入口同样拒绝 Grok');
    const call = async (name: string) => (await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', body: '{}' })).json() as any).result;
    const templates = await call('list-agent-templates');
    assert.equal(templates.find((t: any) => t.id === 'grok-executor').available, true);
    const coordinator = templates.find((t: any) => t.id === 'grok-coordinator');
    assert.equal(coordinator.available, false);
    assert.match(coordinator.reason, /本阶段只支持执行者/);
    assert.match((await call('list-pending')).find((p: any) => p.templateId === 'grok-coordinator').reason, /本阶段只支持执行者/);
    assert.ok((await acp.requests()).every(r => ['fixture/spawn', 'initialize'].includes(r.method)), '启动检查不建模型会话');
  } finally { await daemon.close(); }
});
