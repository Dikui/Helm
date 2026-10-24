import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export const messages = {
  zh: {
    duration: '工作用时', clearSearch: '清除搜索', inboxHelp: '在收件箱中展开工作，可直接处理关卡。', newWork: '新建工作', settings: '设置', search: '搜索工作', attention: '等你处理', running: '进行中', ended: '已结束',
    executors: '执行者', concurrency: '执行者并发', queued: '排队', work: '工作', open: '打开',
    empty: '还没有工作。新建一项工作开始吧。', noMatches: '没有匹配的工作。', choose: '选择一项工作查看进展',
    loading: '正在读取…', retry: '重新读取', connecting: '正在连接…', reconnecting: '连接已断开，正在重连…', connected: '实时更新已连接',
    aligning: '对齐中', executing: '执行中', paused: '已暂停', completed: '已完成', cancelled: '已取消', 'awaiting-review': '待你审核',
    cards: '卡片', elapsed: '状态计时', untitled: '未命名工作', confirm: '确认这一版', answer: '回答', decide: '决定',
    accept: '接受', return: '退回', comment: '意见', noDescription: '调度者尚未起草工作说明。',
    overview: '工作概况', pagePending: '此视图暂未开放。', requirements: '需求', boundary: '边界', criteria: '标准',
    projects: '项目', templates: 'Agent 模板', runtime: '运行', chat: '对话', structure: '调度结构', brief: '工作说明',
    graphTab: '图', graphTitle: '卡片图', graphCard: '卡片', graphGate: '关卡', graphInspector: '卡片检查器', graphGateInspector: '关卡检查器',
    graphReady: '待开始', graphWaiting: '等待依赖', graphVerifying: '验收中', graphPending: '待你决定', graphDecided: '已决定', graphWithdrawn: '已撤回',
    graphParallel: '同一层 = 可以并行', graphZoomOut: '缩小', graphZoomIn: '放大', graphZoom: '缩放比例', graphFit: '适应画布',
    graphPanHelp: '拖动画布平移，也可用滚动条或方向键', graphEmpty: '调度者尚未创建卡片或关卡。', graphSelect: '选择节点查看派单、成果和依赖。',
    graphDependency: '依赖', graphDownstream: '后续', graphSendBacks: '打回次数', graphStep: '步骤', graphNoTemplate: '尚未派单', graphNoSteps: '暂无步骤',
    graphLegend: '箭头表示依赖 · 虚线保留取消卡片 · ↺ 表示打回次数', graphNoDispatches: '还没有派单。',
    graphDispatches: '派单历史', graphDispatch: '派单', graphExecution: '执行', graphVerification: '验收', graphLoop: '↺ 调度者打回，同一张卡片重新执行',
    graphEndCompleted: '正常完成', graphEndError: '出错退出', graphEndQuota: '额度用完', graphEndTimeout: '超时终止', graphEndAborted: '被中止', graphEndContext: '上下文超限',
    graphReportedCompleted: '自报完成', graphReportedBlocked: '自报受阻', graphReportedPassed: '自报通过', graphReportedFailed: '自报不通过', graphUndeclared: '未声明',
    graphQueued: '派单排队中', graphDispatchRunning: '派单运行中', graphDispatchDetail: '派单详情', graphEnd: '结束方式', graphAbortReason: '中止原因', graphConclusion: '自报结论', graphReason: '理由',
    graphFinalAnswer: '最终回答', graphNoFinalAnswer: '此派单没有最终回答。', graphDeleted: '已删除', graphOutput: '派单输出',
    graphPreviousSteps: '上一页步骤', graphNextSteps: '下一页步骤', graphFromStep: '从步骤', graphGoStep: '查看步骤', graphInvalidStep: '请输入有效的正整数步骤号。', graphEmptySteps: '此范围暂无步骤，可继续翻页或指定步骤。',
    graphArtifact: '成果', graphCompaction: '上下文压缩', graphRawStep: '原始步骤', graphArtifacts: '成果', graphNoArtifacts: '暂无成果。', graphReadArtifact: '读取成果',
    graphBranch: '分支', graphFile: '文件', graphTestOutput: '测试输出', graphText: '文本', graphBase64: '二进制（Base64）', graphCopy: '卡片副本', graphCopyWarning: '别在副本目录开终端，看代码去工作分支。',
    graphPause: '暂停卡片', graphResume: '恢复卡片', graphCancel: '取消卡片', graphKeepCard: '保留卡片', graphConfirmCancel: '确认取消卡片',
    graphCancelConsequence: '取消后会中止这张卡片的派单、删除卡片副本，且不能恢复。卡片会保留在图中。', graphCancelReason: '取消理由', graphReasonRequired: '请填写取消理由。', graphDefaultCancelReason: '用户取消卡片',
    graphPausedFeedback: '卡片已暂停。', graphResumedFeedback: '卡片已恢复。', graphCancelledFeedback: '卡片已取消。',
  },
  en: {
    duration: 'Work duration', clearSearch: 'Clear search', inboxHelp: 'Expand a work in the inbox to respond to gates.', newWork: 'New work', settings: 'Settings', search: 'Search work', attention: 'Needs you', running: 'Running', ended: 'Ended',
    executors: 'Executors', concurrency: 'Executor concurrency', queued: 'Queued', work: 'Work', open: 'Open',
    empty: 'No work yet. Create a work to get started.', noMatches: 'No matching work.', choose: 'Select a work to see progress',
    loading: 'Loading…', retry: 'Reload', connecting: 'Connecting…', reconnecting: 'Connection lost. Reconnecting…', connected: 'Live updates connected',
    aligning: 'Aligning', executing: 'Executing', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled', 'awaiting-review': 'Review',
    cards: 'Cards', elapsed: 'Time in status', untitled: 'Untitled work', confirm: 'Confirm this version', answer: 'Answer', decide: 'Decide',
    accept: 'Accept', return: 'Send back', comment: 'Comment', noDescription: 'The coordinator has not drafted a brief yet.',
    overview: 'Work overview', pagePending: 'This view is not available yet.', requirements: 'Requirements', boundary: 'Boundary', criteria: 'Criteria',
    projects: 'Projects', templates: 'Agent templates', runtime: 'Runtime', chat: 'Chat', structure: 'Structure', brief: 'Brief',
    graphTab: 'Graph', graphTitle: 'Card graph', graphCard: 'Card', graphGate: 'Gate', graphInspector: 'Card inspector', graphGateInspector: 'Gate inspector',
    graphReady: 'Ready', graphWaiting: 'Waiting for dependencies', graphVerifying: 'Verifying', graphPending: 'Needs your decision', graphDecided: 'Decided', graphWithdrawn: 'Withdrawn',
    graphParallel: 'Same layer = can run in parallel', graphZoomOut: 'Zoom out', graphZoomIn: 'Zoom in', graphZoom: 'Zoom level', graphFit: 'Fit graph',
    graphPanHelp: 'Drag to pan, or use scrollbars or arrow keys', graphEmpty: 'The coordinator has not created cards or gates yet.', graphSelect: 'Select a node to see dispatches, artifacts and dependencies.',
    graphDependency: 'Dependency', graphDownstream: 'Unblocks', graphSendBacks: 'Send-backs', graphStep: 'Step', graphNoTemplate: 'Not dispatched yet', graphNoSteps: 'No steps yet',
    graphLegend: 'Arrows show dependencies · Dashed cards are cancelled · ↺ counts send-backs', graphNoDispatches: 'No dispatches yet.',
    graphDispatches: 'Dispatch history', graphDispatch: 'Dispatch', graphExecution: 'Execution', graphVerification: 'Verification', graphLoop: '↺ Coordinator sent this card back for another execution',
    graphEndCompleted: 'Completed normally', graphEndError: 'Exited with an error', graphEndQuota: 'Quota exhausted', graphEndTimeout: 'Timed out', graphEndAborted: 'Aborted', graphEndContext: 'Context limit exceeded',
    graphReportedCompleted: 'Reported completed', graphReportedBlocked: 'Reported blocked', graphReportedPassed: 'Reported passed', graphReportedFailed: 'Reported failed', graphUndeclared: 'Undeclared',
    graphQueued: 'Dispatch queued', graphDispatchRunning: 'Dispatch running', graphDispatchDetail: 'Dispatch details', graphEnd: 'End reason', graphAbortReason: 'Abort reason', graphConclusion: 'Self-reported conclusion', graphReason: 'Reason',
    graphFinalAnswer: 'Final answer', graphNoFinalAnswer: 'This dispatch has no final answer.', graphDeleted: 'Deleted', graphOutput: 'Dispatch output',
    graphPreviousSteps: 'Previous steps', graphNextSteps: 'Next steps', graphFromStep: 'From step', graphGoStep: 'View steps', graphInvalidStep: 'Enter a valid positive integer step number.', graphEmptySteps: 'No steps in this range. Continue paging or enter a step number.',
    graphArtifact: 'Artifact', graphCompaction: 'Context compaction', graphRawStep: 'Raw step', graphArtifacts: 'Artifacts', graphNoArtifacts: 'No artifacts yet.', graphReadArtifact: 'Read artifact',
    graphBranch: 'Branch', graphFile: 'File', graphTestOutput: 'Test output', graphText: 'Text', graphBase64: 'Binary (Base64)', graphCopy: 'Card copy', graphCopyWarning: 'Do not open a terminal in the card copy. Read code on the work branch.',
    graphPause: 'Pause card', graphResume: 'Resume card', graphCancel: 'Cancel card', graphKeepCard: 'Keep card', graphConfirmCancel: 'Confirm cancel card',
    graphCancelConsequence: 'Cancelling aborts this card’s dispatches and removes its card copy. It cannot be resumed. The card stays in the graph.', graphCancelReason: 'Cancellation reason', graphReasonRequired: 'Enter a cancellation reason.', graphDefaultCancelReason: 'Card cancelled by user',
    graphPausedFeedback: 'Card paused.', graphResumedFeedback: 'Card resumed.', graphCancelledFeedback: 'Card cancelled.',
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
