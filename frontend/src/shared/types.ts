export interface Usage { inputTokens: number; outputTokens: number }
export type WorkStatus = 'aligning' | 'executing' | 'paused' | 'awaiting-review' | 'completed' | 'cancelled';
export interface Work {
  id: string; projectId: string; title: string; status: WorkStatus; createdAt: string;
  runtimePauseReason: string | null; usage: Usage;
}
export interface WorkSummary extends Work {
  summary: string; statusSince: string; completedCards: number; totalCards: number;
  hasPendingGate: boolean; pendingGates: { id: string; kind: string; question: string }[];
}
export interface Settings { concurrencyLimit: number; runningDispatches: number; queuedDispatches: number }
export interface HelmEvent {
  id: number; action: string; time: string; workId: string | null; cardId: string | null; dispatchId: string | null;
  object: { type: string; id: string }; details: unknown;
}
export interface Gate {
  id: string; workId: string; kind: string; status: string; question: string; body: string; options: string[];
  descriptionId: string | null; description?: { id: string; requirements: string; boundary: string; criteria: string };
}
