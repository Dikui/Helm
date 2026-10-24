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
