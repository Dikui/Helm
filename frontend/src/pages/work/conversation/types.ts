import type { Gate, Usage } from '../../../shared/types.js';

export interface Message {
  id: string; sender: string; body: string; createdAt: string;
  cardId: string | null; gateId: string | null;
}
export type ConversationItem = (Message & { type: 'message' }) | (Gate & {
  type: 'gate'; createdAt: string; decision: string | null; withdrawalReason: string | null;
});
export interface CardReference { type: 'card' | 'gate'; id: string; content?: string }
export interface Round {
  id: string; number: number; templateId: string | null; status: 'running' | 'ended';
  startedAt: string; endedAt: string | null; usage: Usage; reason: string | null;
}
export interface RoundStep {
  step: number; time?: string; type: 'output' | 'artifact' | 'compaction' | 'end';
  text?: string; path?: string;
}
export interface Rounds { rounds: Round[]; queuedMessages: Message[]; currentSteps: RoundStep[] }
