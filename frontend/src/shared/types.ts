export interface Usage { inputTokens: number | null; outputTokens: number | null; incomplete?: boolean }
export type WorkStatus = 'aligning' | 'executing' | 'paused' | 'awaiting-review' | 'accepted' | 'merge-queued' | 'merging' | 'merged' | 'pushing' | 'completed' | 'cancelled';
export interface Delivery {
  merge?: { status: 'merged' | 'already-contained' | 'conflict' | 'failed'; baseBranch: string | null; workBranch: string; commit?: string; reason?: string; conflictFiles?: string[] };
  push?: { status: 'pushed' | 'failed'; reason?: string; baseBranch: string };
  cleanup?: { reason?: string };
  resolution?: { status: 'solving' | 'manual' | 'resolved'; fromCommit: string; toCommit?: string; baseBranch: string; baseCommit: string;
    cards?: { cardId: string; verificationId: string }[] };
}
export interface Work {
  id: string; projectId: string; title: string; status: WorkStatus; createdAt: string;
  delivery?: Delivery; runtimePauseReason: string | null; usage: Usage; workBranch?: string | null;
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
  report?: import('../../../src/review-report.js').ReviewReport | null;
}
