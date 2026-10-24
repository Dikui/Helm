export interface Project {
  id: string; name: string; path: string; defaultCoordinatorAgentId: string;
  currentBranch: string | null; headCommit: string | null;
  uncommittedChanges: number | null; gitStatusReason: string | null;
}
export interface CoordinatorAgent {
  id: string; role: 'coordinator' | 'executor' | null; driver: string | null; available: boolean; reason: string | null;
}
