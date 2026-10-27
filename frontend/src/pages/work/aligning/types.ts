import type { Gate } from '../../../shared/types.js';
import type { Attachment } from '../../../shared/attachments.js';

export interface WorkDescription {
  id: string; workId: string; version: number; status: string;
  requirements: string; boundary: string; criteria: string;
  gateId: string; baseRef: string; baseCommit: string;
}
export type ConversationItem = (Gate & { type: 'gate'; createdAt: string }) | {
  id: string; type: 'message'; sender: string; body: string; createdAt: string; attachments?: Attachment[]; withdrawnAt?: string | null;
};
