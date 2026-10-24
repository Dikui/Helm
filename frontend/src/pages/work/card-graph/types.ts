import type { Gate, Usage } from '../../../shared/types.js';

export interface NodeRef { type: 'card' | 'gate'; id: string }
export interface CardNode {
  type: 'card'; id: string; workId: string; content: string;
  status: 'ready' | 'waiting' | 'executing' | 'verifying' | 'paused' | 'completed' | 'cancelled';
  templateId: string | null; latestDispatchId: string | null; currentStep: number; latestStepSummary: string | null;
  cardBranch: string | null; workPath: string | null; usage: Usage; dependencies: NodeRef[];
}
export interface GateNode extends Gate {
  type: 'gate'; dependencies: NodeRef[]; decision: string | null; withdrawalReason: string | null;
}
export type GraphNode = CardNode | GateNode;
export interface Dispatch {
  id: string; cardId: string; purpose: 'execution' | 'verification'; templateId: string;
  status: 'queued' | 'running' | 'ended'; createdAt: string; startedAt: string | null; endedAt: string | null;
  endReason: 'completed' | 'error' | 'quota-exhausted' | 'timed-out' | 'aborted' | 'context-overflow' | null;
  abortReason: string | null; finalAnswer: string | null; failure: string | null;
  conclusion: 'completed' | 'blocked' | 'passed' | 'failed' | 'undeclared'; conclusionReason: string | null;
  usage: Usage; outputStatus: 'available' | 'deleted';
}
export type OutputStep =
  | { type: 'output'; step: number; text: string }
  | { type: 'artifact'; step: number; kind: 'file' | 'test-output'; path: string }
  | { type: 'compaction'; step: number }
  | { type: 'end'; step: number; reason: NonNullable<Dispatch['endReason']>; finalAnswer?: string; usage: Usage; failure?: string };
export type DispatchOutput = OutputStep[] | { status: 'deleted'; message: string };
export interface Artifact { id: string; kind: 'branch' | 'file' | 'test-output'; name: string; ref: string | null; commitSha: string | null }
export interface ArtifactContent extends Artifact { content: string | null }
