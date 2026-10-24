import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export const messages = {
  zh: {
    newWorkRegisterProject: '登记项目', newWorkRegisterFirst: '先登记一个项目', newWorkRegister: '登记', newWorkCancel: '取消', newWorkProjectPath: '项目路径',
    newWorkRegisterHint: 'Helm 在本机 git 项目里工作。路径会归一到项目根目录；已登记的路径直接返回原项目。',
    alignmentYou: '你', alignmentCoordinator: '调度者', alignmentMessage: '消息', alignmentSend: '发送', alignmentVersion: '版本', alignmentUnconfirmed: '未确认', alignmentNeedsChanges: '还要改',
    alignmentConfirmBrief: '确认工作说明', alignmentConfirmBriefHint: '草稿已写好，确认后开始执行。', alignmentReply: '回答调度者，或说明要改哪里…',
    alignmentNewEntriesHint: '绿色底 = 比上一版新增。', alignmentHistoricalDraft: '正在查看历史草稿，请切回最新版本后确认。',
    newWorkCoordinatorTemplate: '调度者模板', newWorkGoal: '要做什么？', newWorkLead: '说清目标就行，细节调度者会和你对齐。', newWorkRequestExample: '例如：登录改成邮箱 + 验证码，旧的密码登录先保留。',
    newWorkStart: '开始', newWorkRetrySend: '重试发送', newWorkTemplateMissing: '模板不存在', newWorkTemplateUnavailable: '模板不可用', newWorkChooseAvailableTemplate: '请选择可用的调度者模板。',
    newWorkRetrySameMessage: '发送结果尚未确认。重试会发送同一条消息，不会重复新建工作。', newWorkBase: '基准', newWorkBaseHint: '确认工作说明时固定基准提交，从它开工作分支。',
    newWorkUncommittedHint: '个未提交改动不会进入工作分支。先提交，或接受不带它们。', newWorkAlignmentNext: '接下来：调度者提问 → 起草工作说明 → 你确认 → 开始执行',
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
    newWorkRegisterProject: 'Register project', newWorkRegisterFirst: 'Register a project first', newWorkRegister: 'Register', newWorkCancel: 'Cancel', newWorkProjectPath: 'Project path',
    newWorkRegisterHint: 'Helm works in a local git project. Paths are normalized to the project root; an already registered path returns the existing project.',
    alignmentYou: 'You', alignmentCoordinator: 'Coordinator', alignmentMessage: 'Message', alignmentSend: 'Send', alignmentVersion: 'Version', alignmentUnconfirmed: 'Unconfirmed', alignmentNeedsChanges: 'Needs changes',
    alignmentConfirmBrief: 'Confirm brief', alignmentConfirmBriefHint: 'The draft is ready. Work starts once you confirm.', alignmentReply: 'Answer, or say what to change…',
    alignmentNewEntriesHint: 'Green = new since the previous version.', alignmentHistoricalDraft: 'Viewing a historical draft. Return to the latest version to confirm.',
    newWorkCoordinatorTemplate: 'Coordinator template', newWorkGoal: 'What do you need?', newWorkLead: 'State the goal. The coordinator will align the details with you.', newWorkRequestExample: 'e.g. Switch login to email + code. Keep password login for now.',
    newWorkStart: 'Start', newWorkRetrySend: 'Retry sending', newWorkTemplateMissing: 'Template missing', newWorkTemplateUnavailable: 'Template unavailable', newWorkChooseAvailableTemplate: 'Choose an available coordinator template.',
    newWorkRetrySameMessage: 'The send result is unknown. Retry sends the same message without creating a duplicate work.', newWorkBase: 'Base', newWorkBaseHint: 'The base commit is pinned when you confirm the brief; the work branch starts there.',
    newWorkUncommittedHint: 'uncommitted changes will not be in the work branch. Commit first, or continue without them.', newWorkAlignmentNext: 'Next: coordinator asks → drafts a brief → you confirm → work starts',
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
