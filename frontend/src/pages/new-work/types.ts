export interface Project {
  id: string; name: string; path: string; defaultCoordinatorTemplateId: string;
  currentBranch: string | null; headCommit: string | null;
  uncommittedChanges: number | null; gitStatusReason: string | null;
}
export interface CoordinatorTemplate {
  id: string; role: 'coordinator' | 'executor' | null; available: boolean; reason: string | null;
}
