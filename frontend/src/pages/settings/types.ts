export type AgentRole = 'coordinator' | 'executor';
export interface AgentSettings {
  role: AgentRole; driver: 'claude-sdk' | 'codex' | 'grok' | 'deepseek'; model: string | null;
  reasoningEffort: string | null; fast: boolean;
  home: 'shared' | 'dedicated'; description: string;
  skills?: string[];
}
export interface AgentEntry {
  config?: AgentSettings;
  id: string; revision: string | null; role: AgentRole | null; driver: AgentSettings['driver'] | null;
  model: string | null; reasoningEffort?: AgentSettings['reasoningEffort']; fast?: boolean;
  home?: AgentSettings['home']; description: string | null; prompt?: string; directory?: string;
  skillsPath?: string | null; skills?: string[]; billing: string | null; available: boolean; reason: string | null; command?: string;
  runningDispatches: number; activeWorks: number;
  warnings?: string[];
}
export interface Project { id: string; name: string; path: string; defaultCoordinatorAgentId: string }
export interface RuntimeSettings {
  concurrencyLimit: number; dispatchWallTimeoutMs: number; dispatchIdleTimeoutMs: number;
  roundTotalTimeoutMs: number; roundIdleTimeoutMs: number; outputThresholdBytes: number;
}
