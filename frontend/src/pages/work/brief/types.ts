import type { Gate } from '../../../shared/types.js';
import type { Dispatch } from '../card-graph/types.js';

export interface ReviewData {
  baseRef: string; baseCommit: string; workBranch: string; workCommit: string | null; diff: string | null; diffUnavailableReason?: string | null;
  overallVerification: {
    cardId: string; dispatchId: string | null; status: Dispatch['status'] | null; endReason: Dispatch['endReason'];
    conclusion: 'passed' | 'failed' | 'undeclared'; reason: string | null;
  }[];
  rejectedOperationCount: number; undeclaredDispatchCount: number;
}
export type ReviewGate = Gate & { sequence?: number; review?: ReviewData; decision?: string | null; comment?: string | null };
