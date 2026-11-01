import type { MessageKey } from '../../shared/i18n.js';
import type { WorkSummary } from '../../shared/types.js';

export type InboxGroup = 'attention' | 'running' | 'quiet';
export const groupLabels: Record<InboxGroup, MessageKey> = { attention: 'shellAttention', running: 'shellRunning', quiet: 'inboxQuiet' };
export function inboxGroup(work: WorkSummary): InboxGroup {
  if (work.status === 'paused' || work.status === 'cancelled') return 'quiet';
  if (work.delivery?.push?.status === 'failed') return 'attention';
  if (work.status === 'completed') return 'quiet';
  if (work.hasPendingGate || work.status === 'awaiting-review') return 'attention';
  if (work.status === 'merge-queued' || work.status === 'merging' || work.delivery?.resolution?.status === 'solving') return 'running';
  return work.status === 'accepted' ? 'attention' : 'running';
}

export const cardStatusLabels: Record<string, MessageKey> = {
  ready: 'graphReady', waiting: 'graphWaiting', executing: 'executing', verifying: 'graphVerifying',
  'verification-failed': 'inboxVerificationFailed', blocked: 'inboxBlocked',
  paused: 'paused', completed: 'completed', cancelled: 'cancelled', skipped: 'skipped',
};
export const cardStatusTones: Record<string, string> = {
  completed: 'ok', executing: 'run', verifying: 'run', 'verification-failed': 'bad', blocked: 'blocked', skipped: 'skipped', cancelled: 'cut',
};

// Translate runtime-owned fallback text; user and Agent summaries keep their original language.
const summaryLabels: Record<string, MessageKey> = {
  '开始对齐': 'aligning', '工作说明草稿已更新': 'progressBriefDrafted', '调度者正在处理': 'inboxCoordinatorWorking',
  '调度轮次结束': 'progressRoundEnded', '调度者已就绪': 'inboxCoordinatorReady', '调度笔记已更新': 'structureNotes',
  '有待决定的关卡': 'progressGateCreated', '关卡已更新': 'inboxGateUpdated', '关卡已决定': 'graphDecided', '关卡已撤回': 'graphGateWithdrawn',
  '卡片已跳过': 'skipped', '卡片等待前置': 'graphWaiting', '卡片已解除阻塞': 'inboxUnblocked', '卡片已创建': 'inboxCardCreated',
  '卡片已更新': 'inboxCardUpdated', '卡片等待派单': 'graphReady', '卡片已完成': 'completed', '卡片已取消': 'cancelled',
  '卡片已暂停': 'paused', '卡片已恢复': 'inboxResumed', '派单正在排队': 'graphQueued', '执行者开始处理': 'progressDispatchStarted',
  '派单已结束': 'progressDispatchEnded', '派单已撤销': 'graphEndAborted', '派单已超时': 'graphEndTimeout',
  '执行者已提交结论': 'inboxConclusionSubmitted', '工作已暂停': 'paused', '工作没有在推进': 'inboxStalled', '工作已恢复': 'inboxResumed',
  '工作已取消': 'cancelled', '工作已完成': 'completed', '等你处理': 'shellAttention', '操作被拒绝': 'reviewRejected',
  '调度轮次已打断': 'inboxInterrupted', '调度者 Agent 已更换': 'inboxCoordinatorChanged',
  '卡片依赖已添加': 'inboxDependencyAdded', '卡片依赖已移除': 'inboxDependencyRemoved', '成果已保存': 'graphArtifacts',
  '输出已导出': 'inboxOutputsExported', '输出已删除': 'inboxOutputsDeleted', '工作已删除': 'inboxWorkDeleted',
  '上下文已压缩': 'conversationCompaction', 'Agent 已启动': 'inboxAgentStarted', '浏览器已启动': 'inboxBrowserStarted',
  '浏览器已停止': 'inboxBrowserStopped', '工作记录已更新': 'inboxRecordUpdated',
  '调度者额度用完': 'inboxQuotaExhausted',
};
export function workSituation(work: WorkSummary, t: (key: MessageKey) => string) {
  const delivery = work.delivery;
  const translated = (text: string) => summaryLabels[text] ? t(summaryLabels[text]) : text;
  if (work.status === 'paused') return [t('paused'), work.runtimePauseReason && translated(work.runtimePauseReason)].filter(Boolean).join(' · ');
  if (work.status === 'cancelled') return t('inboxCancelled');
  if (delivery?.push?.status === 'failed') return `${t('shellAttention')}：${t('deliveryPushFailed')}`;
  if (work.status === 'completed') return t(delivery?.completedWithoutMerge ? 'deliveryFinishedWithoutMerge'
    : delivery?.push?.status === 'pushed' ? 'deliveryPushed'
    : delivery?.merge?.status === 'already-contained' ? 'deliveryContained'
    : delivery?.merge?.status === 'merged' ? 'inboxMerged' : 'deliveryNoCodeChanges');
  if (work.hasPendingGate) {
    const gate = work.pendingGates[0];
    const question = gate?.kind === 'work-confirmation' ? t('inboxConfirmSpec') : gate?.kind === 'review' ? t('inboxReview')
      : gate?.kind === 'git-initialization' ? t('gitInitTitle') : gate?.question || t('progressGateCreated');
    return `${t('shellAttention')}：${question}`;
  }
  if (work.status === 'awaiting-review') return `${t('shellAttention')}：${t('inboxReview')}`;
  if (work.status === 'merge-queued' || work.status === 'merging') return t(work.status);
  if (delivery?.resolution?.status === 'solving') return t('deliverySolving');
  if (delivery?.resolution?.status === 'resolved') return `${t('shellAttention')}：${t('deliveryResolved')}`;
  if (delivery?.resolution?.status === 'manual') return `${t('shellAttention')}：${t('deliveryManual')}`;
  if (delivery?.merge?.status === 'conflict') return `${t('shellAttention')}：${t('deliveryConflict')}`;
  if (delivery?.merge?.status === 'failed') return `${t('shellAttention')}：${t('deliveryMergeFailed')}`;
  if (work.status === 'accepted') return `${t('shellAttention')}：${t('accepted')}`;
  const running = work.cardStatuses.filter(status => status === 'executing' || status === 'verifying').length;
  const status = running ? t('inboxRunningCards').replace('{count}', String(running)) : t(work.status);
  const summary = translated(work.summary);
  return summary && summary !== status ? `${status} · ${summary}` : status;
}
