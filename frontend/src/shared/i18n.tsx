import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export const messages = {
  zh: {
    coordinatorRole: '调度者', executorTemplates: '执行者模板', unrecognizedTemplates: '无法识别角色',
    available: '可用', unavailable: '不可用', dispatchCount: '个运行中派单', workCount: '项未结束工作', projectWorkCount: '项工作',
    templateHelp: '按角色配置 Agent，改动从下一次派单或调度轮次生效。', newTemplate: '新建模板',
    templateDetails: '模板详情', templateId: '模板 id', role: '角色', driver: '驱动', model: '模型',
    reasoning: '推理强度', driverDefault: '驱动默认', fastMode: 'fast', billing: '计费方式',
    subscription: '订阅', apiBilling: 'API', description: '职责说明', skills: '技能', noSkills: '无。用户自己的技能照常加载。',
    skillsReadOnly: 'skills/ 只读；复制模板只复制配置和 prompt.md。', save: '保存', saved: '已保存',
    duplicateTemplate: '复制为新模板', templateMissing: '找不到这个模板。', emptyTemplates: '还没有 Agent 模板。',
    roleImmutable: '已有模板的角色不可改。', nextDispatch: '下一次派单或调度轮次生效。',
    apiHomeHint: '请按 CLI 格式在此主目录配置接口和凭据：', sharedHomeHint: '沿用 CLI 默认主目录与已有登录。',
    requiredField: '请填写此项。', invalidTemplateId: '使用 1–64 位小写字母、数字或连字符，以字母或数字开头。',
    reloadTemplate: '重新载入模板', conflictHint: '文件已变化。当前输入已保留；重新载入会替换当前输入。',
    registerProject: '登记项目', projectName: '项目名称（可选）', projectPath: '项目路径',
    defaultCoordinator: '默认调度者模板', projectDefaultHint: '仅影响之后创建的工作。', emptyProjects: '还没有登记项目。',
    dispatchWatchdog: '派单看门狗', roundWatchdog: '轮次看门狗',
    concurrencyLimit: '执行者并发上限', concurrencyHint: '满了按创建顺序排队；调度轮次不占名额。',
    dispatchWall: '派单总时长', dispatchIdle: '派单无输出', roundTotal: '调度轮次总时长', roundIdle: '调度轮次无输出',
    minutes: '分钟', outputThreshold: '输出提示阈值', outputHint: '~/.helm/ 下输出超过阈值时提示。',
    invalidNumber: '请输入范围内的数值。', runtimeHelp: '各组独立保存；看门狗改动对后续派单或轮次生效。',
    unsavedChanges: '有未保存的改动。继续会丢弃这些改动。', discardChanges: '丢弃并继续', keepEditing: '继续编辑',
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
    coordinatorRole: 'Coordinators', executorTemplates: 'Executor templates', unrecognizedTemplates: 'Unrecognized role',
    available: 'Available', unavailable: 'Unavailable', dispatchCount: 'running dispatches', workCount: 'active works', projectWorkCount: 'works',
    templateHelp: 'Configure Agents by role. Changes apply from the next dispatch or round.', newTemplate: 'New template',
    templateDetails: 'Template details', templateId: 'Template id', role: 'Role', driver: 'Driver', model: 'Model',
    reasoning: 'Reasoning effort', driverDefault: 'Driver default', fastMode: 'fast', billing: 'Billing',
    subscription: 'Subscription', apiBilling: 'API', description: 'Responsibilities', skills: 'Skills', noSkills: 'None. Your own skills still load.',
    skillsReadOnly: 'skills/ is read-only; duplication copies config and prompt.md only.', save: 'Save', saved: 'Saved',
    duplicateTemplate: 'Duplicate as new template', templateMissing: 'Template not found.', emptyTemplates: 'No Agent templates yet.',
    roleImmutable: 'An existing template’s role cannot change.', nextDispatch: 'Applies from the next dispatch or round.',
    apiHomeHint: 'Configure the endpoint and credentials in CLI format in this home:', sharedHomeHint: 'Uses the CLI default home and existing login.',
    requiredField: 'Fill in this field.', invalidTemplateId: 'Use 1–64 lowercase letters, digits or hyphens, starting with a letter or digit.',
    reloadTemplate: 'Reload template', conflictHint: 'Files changed. Your input is preserved; reloading replaces it.',
    registerProject: 'Register project', projectName: 'Project name (optional)', projectPath: 'Project path',
    defaultCoordinator: 'Default coordinator template', projectDefaultHint: 'Only affects works created later.', emptyProjects: 'No registered projects yet.',
    dispatchWatchdog: 'Dispatch watchdog', roundWatchdog: 'Round watchdog',
    concurrencyLimit: 'Executor limit', concurrencyHint: 'Extra dispatches queue in order; rounds do not count.',
    dispatchWall: 'Dispatch wall time', dispatchIdle: 'Dispatch idle time', roundTotal: 'Round total time', roundIdle: 'Round idle time',
    minutes: 'min', outputThreshold: 'Output warning threshold', outputHint: 'Warn when outputs under ~/.helm/ exceed the threshold.',
    invalidNumber: 'Enter a number within the allowed range.', runtimeHelp: 'Save each group separately. Watchdogs apply to later dispatches or rounds.',
    unsavedChanges: 'There are unsaved changes. Continuing discards them.', discardChanges: 'Discard and continue', keepEditing: 'Keep editing',
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
