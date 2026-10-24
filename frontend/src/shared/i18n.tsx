import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export const messages = {
  zh: {
    outputsNotExported: '尚未导出这项工作的输出，建议先导出。', outputsWhenEnded: '工作结束后可导出或删除输出。',
    outputUsageReadFailed: '读取输出空间失败', dismissActionFeedback: '关闭操作反馈',
    outputWarning: '输出空间提示', outputThresholdExceeded: '输出总量已超过阈值。', adjustOutputThreshold: '调整输出阈值',
    manageEndedOutputs: '已结束工作：导出 / 删除输出', noEndedOutputs: '暂无可清理的已结束工作。',
    exportOutputs: '导出输出', deleteOutputs: '删除输出', exportAction: '导出', exportPath: '本机保存路径（.tar.gz）',
    exportPathHelp: '归档保存到运行 helmd 的本机路径，包含输出、成果文件和任务库记录；不会覆盖已有文件。',
    outputsDeleted: '已删除', outputsExported: '已导出', confirmDeleteOutputs: '确认删除输出', exportFirst: '先导出', deleteAnyway: '仍然删除',
    deleteOutputsConsequence: '删除原始事件流后无法恢复。成果文件、代码和任务库记录会保留，建议先导出。',
    exportAfterDeletion: '原始事件流已删除，归档仅包含仍保留的成果文件和任务库记录。',
    coordinatorNextRound: '从下一调度轮次起生效。', availableCoordinators: '可用的调度者模板', noAvailableCoordinators: '暂无可用的调度者模板。', applyCoordinator: '更换模板',
    workActions: '操作', workActionsGroup: '工作操作', pauseWork: '暂停工作', resumeWork: '恢复工作', cancelWork: '取消工作',
    changeCoordinator: '换调度者模板', actionBack: '返回', confirmCancelWork: '确认取消工作',
    cancelWorkConsequence: '取消后会中止全部派单、删除卡片副本和工作副本，工作不能恢复。', endedWorkActions: '工作已结束，可管理输出。',
    duration: '工作用时', clearSearch: '清除搜索', inboxHelp: '在收件箱中展开工作，可直接处理关卡。', newWork: '新建工作', settings: '设置', search: '搜索工作', attention: '等你处理', running: '进行中', ended: '已结束',
    executors: '执行者', concurrency: '执行者并发', queued: '排队', work: '工作', open: '打开',
    empty: '还没有工作。新建一项工作开始吧。', noMatches: '没有匹配的工作。', choose: '选择一项工作查看进展',
    loading: '正在读取…', retry: '重新读取', connecting: '正在连接…', reconnecting: '连接已断开，正在重连…', connected: '实时更新已连接',
    aligning: '对齐中', executing: '执行中', paused: '已暂停', completed: '已完成', cancelled: '已取消', 'awaiting-review': '待你审核',
    cards: '卡片', elapsed: '状态计时', untitled: '未命名工作', confirm: '确认这一版', answer: '回答', decide: '决定',
    accept: '接受', return: '退回', comment: '意见', noDescription: '调度者尚未起草工作说明。',
    overview: '工作概况', pagePending: '此视图暂未开放。', requirements: '需求', boundary: '边界', criteria: '标准',
    projects: '项目', templates: 'Agent 模板', runtime: '运行', chat: '对话', structure: '调度结构', brief: '工作说明',
  },
  en: {
    outputsNotExported: 'This work has not been exported. Export its outputs first if needed.', outputsWhenEnded: 'Outputs can be exported or deleted after this work ends.',
    outputUsageReadFailed: 'Could not read output storage usage', dismissActionFeedback: 'Dismiss action feedback',
    outputWarning: 'Output storage notice', outputThresholdExceeded: 'Total output size exceeds the threshold.', adjustOutputThreshold: 'Adjust output threshold',
    manageEndedOutputs: 'Ended works: export / delete outputs', noEndedOutputs: 'No ended works to clean up yet.',
    exportOutputs: 'Export outputs', deleteOutputs: 'Delete outputs', exportAction: 'Export', exportPath: 'Local save path (.tar.gz)',
    exportPathHelp: 'The archive is saved on the machine running helmd and contains outputs, artifacts and task records. Existing files are never overwritten.',
    outputsDeleted: 'Deleted', outputsExported: 'Exported', confirmDeleteOutputs: 'Confirm output deletion', exportFirst: 'Export first', deleteAnyway: 'Delete anyway',
    deleteOutputsConsequence: 'Deleting raw event streams cannot be undone. Artifacts, code and task records are retained. Export first if needed.',
    exportAfterDeletion: 'Raw event streams have been deleted. The archive contains only retained artifacts and task records.',
    coordinatorNextRound: 'Takes effect from the next coordinator round.', availableCoordinators: 'Available coordinator templates', noAvailableCoordinators: 'No coordinator templates are available.', applyCoordinator: 'Change template',
    workActions: 'Actions', workActionsGroup: 'Work actions', pauseWork: 'Pause work', resumeWork: 'Resume work', cancelWork: 'Cancel work',
    changeCoordinator: 'Change coordinator', actionBack: 'Back', confirmCancelWork: 'Confirm cancellation',
    cancelWorkConsequence: 'Cancelling stops all dispatches and removes card and work copies. This work cannot be resumed.', endedWorkActions: 'This work has ended. You can manage its outputs.',
    duration: 'Work duration', clearSearch: 'Clear search', inboxHelp: 'Expand a work in the inbox to respond to gates.', newWork: 'New work', settings: 'Settings', search: 'Search work', attention: 'Needs you', running: 'Running', ended: 'Ended',
    executors: 'Executors', concurrency: 'Executor concurrency', queued: 'Queued', work: 'Work', open: 'Open',
    empty: 'No work yet. Create a work to get started.', noMatches: 'No matching work.', choose: 'Select a work to see progress',
    loading: 'Loading…', retry: 'Reload', connecting: 'Connecting…', reconnecting: 'Connection lost. Reconnecting…', connected: 'Live updates connected',
    aligning: 'Aligning', executing: 'Executing', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled', 'awaiting-review': 'Review',
    cards: 'Cards', elapsed: 'Time in status', untitled: 'Untitled work', confirm: 'Confirm this version', answer: 'Answer', decide: 'Decide',
    accept: 'Accept', return: 'Send back', comment: 'Comment', noDescription: 'The coordinator has not drafted a brief yet.',
    overview: 'Work overview', pagePending: 'This view is not available yet.', requirements: 'Requirements', boundary: 'Boundary', criteria: 'Criteria',
    projects: 'Projects', templates: 'Agent templates', runtime: 'Runtime', chat: 'Chat', structure: 'Structure', brief: 'Brief',
  },
} as const;
export type Language = keyof typeof messages;
export type MessageKey = keyof typeof messages.zh;
const Context = createContext<{ language: Language; setLanguage: (value: Language) => void; t: (key: MessageKey) => string } | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem('helm.language') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
  });
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem('helm.language', language); } catch { /* Storage can be disabled. */ }
  }, [language]);
  return <Context value={{ language, setLanguage, t: key => messages[language][key] }}>{children}</Context>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error('I18nProvider is required');
  return value;
}
