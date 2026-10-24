export type TemplateRole = 'coordinator' | 'executor';
export interface TemplateConfig {
  role: TemplateRole; driver: 'claude-sdk' | 'codex' | 'grok' | 'deepseek'; model: string | null;
  reasoningEffort: 'low' | 'medium' | 'high' | 'max' | null; fast: boolean;
  home: 'shared' | 'template'; description: string;
}
export interface TemplateEntry {
  id: string; revision: string | null; role: TemplateRole | null; driver: TemplateConfig['driver'] | null;
  model: string | null; reasoningEffort?: TemplateConfig['reasoningEffort']; fast?: boolean;
  home?: TemplateConfig['home']; description: string | null; prompt?: string; directory?: string;
  skillsPath?: string | null; skills?: string[]; billing: string | null; available: boolean; reason: string | null; command?: string;
  runningDispatches: number; activeWorks: number;
}
export interface Project { id: string; name: string; path: string; defaultCoordinatorTemplateId: string }
export interface RuntimeSettings {
  concurrencyLimit: number; dispatchWallTimeoutMs: number; dispatchIdleTimeoutMs: number;
  roundTotalTimeoutMs: number; roundIdleTimeoutMs: number; outputThresholdBytes: number;
}
