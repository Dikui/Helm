import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { projectPath } from './alignment.js';
import type { ReviewReport } from './review-report.js';
import { RuleError, type TaskStore } from './store.js';
import { readWork, workContentRef } from './work-reads.js';

export const referencesSchema = z.array(z.string().min(1)).max(5)
  .refine(ids => new Set(ids).size === ids.length, '同一条消息不能重复引用同一项工作。');

const maxListedFiles = 200;

function changedFiles(project: string, baseCommit: string | null, ref: string | null) {
  try {
    if (!ref) throw new Error('没有工作分支或合入提交。');
    const commit = execFileSync('git', ['-C', project, 'rev-parse', ref], { encoding: 'utf8', timeout: 10_000 }).trim();
    const files = baseCommit ? execFileSync('git', ['-C', project, 'diff', '--name-status', '--no-renames', baseCommit, commit, '--'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }).split('\n').filter(Boolean) : [];
    return { commit, files };
  } catch (error) {
    return { commit: null, files: [], error: error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : String(error) };
  }
}

function reportText(report: ReviewReport) {
  const evidence = (items: ReviewReport['criteria'][number]['evidence']) => items.map(item => `${item.label}（${item.kind}: ${item.ref}）`).join('；');
  return [
    `结论：${report.verdict}。${report.summary}`,
    ...report.exceptions.map(item => `- 例外（${item.kind}）：${item.what}。${item.why}。证据：${evidence(item.evidence)}`),
    '', '标准：', ...report.criteria.map(item => `- [${item.status}] ${item.criterion}。证据：${evidence(item.evidence)}`),
    '', '卡片：', ...report.cards.map(item => `- ${item.title}：${item.result}（验收 ${item.verification}）`),
    ...(report.suggestions.length ? ['', '建议：', ...report.suggestions.map(item => `- ${item}`)] : []),
  ].join('\n');
}

// A snapshot taken when the message is sent; agents read the original files through git when they need them.
// shortcut: artifact evidence ids are listed as-is and cannot be read from another work; add a cross-work read when someone needs it.
export function referenceSnapshot(store: TaskStore, workId: string, referencedId: string) {
  if (referencedId === workId) throw new RuleError('INVALID_REFERENCE', '不能引用这项工作本身。', 400);
  const work = (() => {
    try { return readWork(store, referencedId); }
    catch { throw new RuleError('NOT_FOUND', '找不到被引用的工作。', 404); }
  })();
  const project = projectPath(store, work.id);
  const { commit, files, error } = changedFiles(project, work.baseCommit, workContentRef(store, work.id));
  const descriptions = store.descriptions(work.id);
  const description = descriptions.find(item => item.id === work.activeDescriptionId) ?? descriptions.at(-1);
  const report = store.gates(work.id).filter(gate => gate.kind === 'review' && gate.report).at(-1)?.report;
  const lines = [
    `# 引用的工作：${work.title}`, '',
    `- 工作 id：${work.id}`, `- 状态：${work.status}`, `- 项目仓库：${project}`,
    `- 基准：${work.baseRef ?? '未知'} @ ${work.baseCommit ?? '未知'}`,
    commit ? `- 成果提交：${commit}` : `- 成果提交：无法读取（${error}）`,
  ];
  if (commit) {
    lines.push('', '## 改动的文件', '', `读取原文件：\`git -C ${project} show ${commit}:<路径>\``, '');
    lines.push(...files.slice(0, maxListedFiles).map(line => `- ${line.replace('\t', ' ')}`));
    if (files.length > maxListedFiles) lines.push(`- ……另有 ${files.length - maxListedFiles} 个文件，用 \`git -C ${project} diff --name-status ${work.baseCommit} ${commit}\` 查看`);
    if (!files.length) lines.push('- 没有相对基准的改动');
  }
  if (description) {
    lines.push('', `## 工作说明（第 ${description.version} 版${description.status === 'active' ? '' : '，未生效'}）`, '',
      '### 需求', '', description.requirements, '', '### 边界', '', description.boundary, '', '### 标准', '', description.criteria);
  }
  if (report) lines.push('', '## 汇总报告', '', reportText(report));
  return { name: `引用工作-${work.id.slice(0, 8)}.md`, content: Buffer.from(lines.join('\n') + '\n').toString('base64') };
}
