import type { Gate, Usage } from '../../../shared/types.js';
import type { Attachment } from '../../../shared/attachments.js';

export interface Message {
  id: string; sender: string; body: string; createdAt: string;
  cardId: string | null; gateId: string | null; attachments?: Attachment[];
}
export type ConversationItem = (Message & { type: 'message' }) | (Gate & {
  type: 'gate'; createdAt: string; decision: string | null; withdrawalReason: string | null;
});
export interface CardReference { type: 'card' | 'gate'; id: string; content?: string }
export interface Round {
  id: string; number: number; agentId: string | null; status: 'running' | 'ended';
  startedAt: string; endedAt: string | null; usage: Usage; reason: string | null;
}
export interface RoundStep {
  step: number; time?: string; type: 'output' | 'artifact' | 'compaction' | 'end';
  text?: string; path?: string;
}
export interface Rounds { rounds: Round[]; queuedMessages: Message[]; currentSteps: RoundStep[] }
