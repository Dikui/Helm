import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Project } from './types.js';

export interface BaseSelection { projectId: string; baseRef: string; ready: boolean }

export function BaseBranchField({ project, selection, preferred, onSelect, onRemember, locked }: {
  project: Project; selection?: BaseSelection; preferred?: string;
  onSelect: Dispatch<SetStateAction<BaseSelection | undefined>>; onRemember: (branch: string) => void; locked: boolean;
}) {
  const { t } = useI18n();
  const resource = useResource<{ branches: string[]; currentBranch: string | null }>('list-project-branches', { projectId: project.id });
  const data = resource.data;
  const branches = resource.error ? [] : data?.branches ?? [];
  const defaultBranch = branches.includes(preferred ?? '') ? preferred! : branches.includes(data?.currentBranch ?? '') ? data!.currentBranch! : branches[0] ?? '';
  const selected = selection?.projectId === project.id && branches.includes(selection.baseRef) ? selection.baseRef : defaultBranch;
  const ready = Boolean(data && !resource.error);
  useEffect(() => {
    onSelect(previous => {
      // A branch read must not replace a choice made after that render.
      const baseRef = previous?.projectId === project.id && branches.includes(previous.baseRef) ? previous.baseRef : defaultBranch;
      return previous?.projectId === project.id && previous.baseRef === baseRef && previous.ready === ready ? previous : { projectId: project.id, baseRef, ready };
    });
  }, [project.id, data, resource.error, defaultBranch, onSelect]);
  return <>
    <label className="new-pill"><span className="new-label">{t('newWorkBase')}</span>
      <select aria-label={t('newWorkBaseBranch')} value={selected} disabled={locked || !selected} onChange={event => {
        onSelect({ projectId: project.id, baseRef: event.target.value, ready }); onRemember(event.target.value);
      }}>
        {!selected && <option value="">{t(resource.error ? 'newWorkBranchesFailed' : data ? 'newWorkBranchesEmpty' : 'newWorkBranchesLoading')}</option>}
        {branches.map(branch => <option key={branch} value={branch}>{branch}{branch === data?.currentBranch ? ` · ${t('newWorkCurrentBranch')}` : ''}</option>)}
      </select>
    </label>
    {(!data || resource.error || data.branches.length === 0) && <div className="new-branch-notice">
      {!data && !resource.error && <p className="new-notice" role="status">{t('newWorkBranchesLoadingHint')}</p>}
      {resource.error && <ErrorNotice error={resource.error} retry={locked ? undefined : resource.reload} />}
      {data?.branches.length === 0 && !resource.error && <p className="new-notice">{t('newWorkBranchesEmptyHint')} <button type="button" className="btn sm" disabled={locked} onClick={resource.reload}>{t('newWorkRefreshBranches')}</button></p>}
    </div>}
  </>;
}
