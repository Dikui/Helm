// Manual real-Codex/Claude/browser run only. Never included in npm test.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/src/cli.js', import.meta.url));
const [action, path, ...args] = process.argv.slice(2);
const url = process.env.HELM_URL ?? 'http://127.0.0.1:4242';
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const git = (...values) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function helm(url, command, ...values) {
  const output = execFileSync(process.execPath, [cli, command, ...values, '--url', url], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const body = JSON.parse(output);
  if (!body.ok) throw new Error(output);
  return body.result;
}

const request = `在这个空仓库实现可玩的网页版 2048，用 main 作为基准分支。
需求：4×4 棋盘；方向键移动，同值方块每次移动只合并一次；有效移动生成 2 或 4；累计计分、最高分；localStorage 保存棋盘和分数，刷新可恢复；重开按钮；胜利和无路可走的提示；页面有使用说明。
边界：本机桌面浏览器，静态前端，无后端、账号或外部服务，不部署。执行者不推送，只有审核接受后由运行层推送到已配置的本地 origin。npm 命令使用 --cache /private/tmp/helm-npm-cache。
标准：有可重复运行的逻辑测试（移动、单次合并、无效移动不生新块、计分、胜负判断、保存恢复和重开）；构建成功；使用分配端口起服务，通过 Helm 转发的真实有界面浏览器检查初始棋盘、方向键操作、分数变化、刷新恢复和重开，查看并保存截图，把命令、检查过程和截图证据写入最终回答。
先起草包含需求、边界和标准的工作说明，等我通过确认关卡。确认后期望拆为 4～5 张有依赖的卡片（包含游戏逻辑、页面渲染、计分/存档、重开等实现，以及最后一张整体验收卡片），实现卡片需要验收，页面验收及整体验收设置 needsBrowser=true。执行者 Claude（claude-executor）和 Codex（codex-executor）都必须有执行派单。每张实现卡片的每次验收都派给与被验收执行派单不同的一家：Claude 执行交 Codex 验收，Codex 执行交 Claude 验收，使用独立新上下文。整体验收依赖所有其他卡片，只派验收单，由两家分别验收，覆盖另一家完成的实现；页面相关验收和整体验收的派单都设置 needsBrowser=true。不要用直接 CLI 或脚本代替 Helm 的调度、派单与验收流程。
验收不通过允许同一卡片重新派执行单返工，再由另一家验收；有冲突才建修复卡片，不必刻意制造。整体验收通过后发起审核，逐卡写结果、验收是否通过、由谁完成、成果链接；由我决定接受或退回。`;

async function main() {
  if (!action || action === '--help') {
    console.log('node scripts/2048-e2e.mjs init [new-directory] | start <directory> | helm <directory> <command> [...flags] | export <directory>');
    return;
  }
  if (action === 'init') {
    // Refuse an existing explicit directory; each run gets a fresh project and local remote.
    const root = path ? await mkdir(resolve(path)).then(() => realpath(path))
      : await realpath(await mkdtemp(join(tmpdir(), 'helm-2048-')));
    const repo = join(root, 'project');
    const remote = join(root, 'origin.git');
    git('init', '--bare', '--initial-branch=main', remote);
    git('init', '--initial-branch=main', repo);
    git('-C', repo, 'config', 'user.name', 'Helm E2E');
    git('-C', repo, 'config', 'user.email', 'helm-e2e@example.invalid');
    git('-C', repo, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Empty 2048 baseline');
    git('-C', repo, 'remote', 'add', 'origin', remote);
    git('-C', repo, 'push', '-u', 'origin', 'main');
    await save(join(root, 'run.json'), { root, repo, remote, baseline: git('-C', repo, 'rev-parse', 'HEAD') });
    console.log(root);
    return;
  }
  if (!path) throw new Error('Missing run directory. See scripts/2048-e2e.md.');
  const root = await realpath(path);
  const run = await json(join(root, 'run.json'));
  if (action === 'helm') {
    const [command, ...values] = args;
    if (!command) throw new Error('Missing helm command');
    console.log(JSON.stringify({ ok: true, result: helm(url, command, ...values) }, null, 2));
  } else if (action === 'start') {
    helm(url, 'set-concurrency', '--limit', '2');
    const project = helm(url, 'register-project', '--path', run.repo);
    const { work } = helm(url, 'send-message', '--projectId', project.id, '--key', '2048-start', '--coordinatorTemplateId', 'codex-coordinator', '--body', request);
    await save(join(root, 'work.json'), { projectId: project.id, workId: work.id });
    console.log(JSON.stringify({ workId: work.id, url }, null, 2));
  } else if (action === 'export') {
    const { workId } = await json(join(root, 'work.json'));
    const read = (name, ...values) => helm(url, name, '--workId', workId, ...values);
    const work = read('get-work');
    const graph = read('get-card-graph');
    const dispatches = read('list-dispatches');
    const events = read('get-events');
    const artifacts = dispatches.map(dispatch => ({ dispatchId: dispatch.id,
      artifacts: read('get-dispatch-artifacts', '--dispatchId', dispatch.id) }));
    const snapshot = { exportedAt: new Date().toISOString(), run, work, graph, dispatches, events, artifacts,
      conversation: read('get-conversation'), descriptions: read('get-work-descriptions'),
      templates: helm(url, 'list-agent-templates'), settings: helm(url, 'get-settings') };
    const directory = join(root, 'evidence');
    await mkdir(directory, { recursive: true });
    await save(join(directory, 'snapshot.json'), snapshot);
    const lines = [`工作 ${workId} ${work.status}`, `token 总计（含调度轮次和所有结束方式）：${JSON.stringify(work.usage)}`];
    const rounds = events.filter(event => event.action === 'round-ended');
    const roundUsage = rounds.reduce((total, event) => ({
      inputTokens: total.inputTokens + event.details.usage.inputTokens,
      outputTokens: total.outputTokens + event.details.usage.outputTokens,
    }), { inputTokens: 0, outputTokens: 0 });
    lines.push(`调度轮次 ${rounds.length} 次，token：${JSON.stringify(roundUsage)}`);
    const roundTemplates = new Map(events.filter(event => event.action === 'round-template-loaded')
      .map(event => [event.object.id, event.details.template]));
    for (const event of events.filter(event => event.action === 'round-started')) {
      const template = roundTemplates.get(event.object.id);
      const ended = rounds.find(round => round.object.id === event.object.id);
      lines.push(`  轮次 ${event.object.id}：template=${template?.id ?? '未加载'} driver=${template?.driver ?? '-'} model=${template?.model ?? '-'} effort=${template?.reasoningEffort ?? '-'} fast=${template?.fast ?? '-'}；${ended?.details.reason ?? '运行中'}；output=${event.details.outputPath}`);
    }
    for (const card of graph.filter(node => node.type === 'card')) {
      lines.push(`\n卡片 ${card.id} ${card.status}：${card.content.split('\n')[0]}`, `token：${JSON.stringify(card.usage)}`);
      const attempts = dispatches.filter(dispatch => dispatch.cardId === card.id);
      const completedBy = attempts.filter(dispatch => dispatch.purpose === 'execution' && dispatch.endReason === 'completed' && dispatch.conclusion === 'completed');
      lines.push(`完成执行派单：${completedBy.map(dispatch => `${dispatch.templateId}/${dispatch.id}`).join(', ') || '无（可能为只验收卡片或尚未完成）'}`);
      const verification = attempts.filter(dispatch => dispatch.purpose === 'verification').at(-1);
      lines.push(`最近验收：${verification ? `${verification.endReason}/${verification.conclusion}；${verification.conclusionReason ?? ''}` : '未派验收'}`);
      for (const dispatch of attempts) lines.push(`  ${dispatch.purpose} ${dispatch.id}：${dispatch.templateId} driver=${dispatch.template.driver} model=${dispatch.template.model} effort=${dispatch.template.reasoningEffort} fast=${dispatch.template.fast} session=${dispatch.sessionId}；${dispatch.status}/${dispatch.endReason}/${dispatch.conclusion}；浏览器=${dispatch.needsBrowser}；token=${JSON.stringify(dispatch.usage)}；理由=${dispatch.conclusionReason ?? dispatch.failure ?? ''}`);
    }
    lines.push('\n事件时间线（完整 details、最终回答和成果索引见 snapshot.json）：');
    for (const event of events) {
      const template = event.object.type === 'coordinator-round' ? roundTemplates.get(event.object.id)
        : dispatches.find(dispatch => dispatch.id === event.dispatchId)?.template;
      lines.push(`${event.id} ${event.time} ${event.actor.type}/${event.actor.id} ${event.action} ${event.object.type}/${event.object.id} card=${event.cardId ?? '-'} dispatch=${event.dispatchId ?? '-'} template=${template?.id ?? '-'} driver=${template?.driver ?? '-'}`);
    }
    lines.push('\n需核对的问题/运行层结果：');
    for (const event of events.filter(event => ['operation-rejected', 'work-paused', 'base-merge-result', 'base-push-result'].includes(event.action)
      || event.action === 'dispatch-ended' && (event.details.endReason !== 'completed' || ['failed', 'blocked', 'undeclared'].includes(event.details.conclusion))
      || event.action === 'round-ended' && event.details.reason !== 'completed')) {
      lines.push(`${event.id} ${event.action} ${JSON.stringify(event.details)}`);
    }
    await writeFile(join(directory, 'timeline.txt'), lines.join('\n') + '\n');
    console.log(directory);
  } else throw new Error(`Unknown action: ${action}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
