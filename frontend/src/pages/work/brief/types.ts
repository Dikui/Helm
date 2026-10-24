import type { Gate } from '../../../shared/types.js';

export interface ReviewData {
  baseRef: string; baseCommit: string; workBranch: string; workCommit: string; diff: string;
  overallVerification: {
    cardId: string; dispatchId: string | null; status: string | null; endReason: string | null;
    conclusion: 'passed' | 'failed' | 'undeclared'; reason: string | null;
  }[];
  rejectedOperationCount: number; undeclaredDispatchCount: number;
}
export type ReviewGate = Gate & { review?: ReviewData; decision?: string | null; comment?: string | null };
