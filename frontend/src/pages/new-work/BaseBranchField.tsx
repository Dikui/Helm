import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Project } from './types.js';

export interface BaseSelection { projectId: string; baseRef: string }

export function BaseBranchField({ project, selection, onSelect, locked }: {
  project: Project; selection?: BaseSelection;
  onSelect: Dispatch<SetStateAction<BaseSelection | undefined>>; locked: boolean;
}) {
  const { t } = useI18n();
  const resource = useResource<{ branches: string[]; currentBranch: string | null }>('list-project-branches', { projectId: project.id });
  const data = resource.data;
  const branches = resource.error ? [] : data?.branches ?? [];
  const defaultBranch = branches.includes(data?.currentBranch ?? '') ? data!.currentBranch! : branches[0] ?? '';
  const selected = selection?.projectId === project.id && branches.includes(selection.baseRef) ? selection.baseRef : defaultBranch;
  useEffect(() => {
    onSelect(previous => previous?.projectId === project.id && previous.baseRef === selected ? previous : { projectId: project.id, baseRef: selected });
  }, [project.id, selected, onSelect]);
  return <section className="new-base" aria-label={t('newWorkBase')}>
    <label className="new-base-field"><span>{t('newWorkBaseBranch')}</span>
      <select value={selected} disabled={locked || !selected} onChange={event => onSelect({ projectId: project.id, baseRef: event.target.value })}>
        {!selected && <option value="">{t(resource.error ? 'newWorkBranchesFailed' : data ? 'newWorkBranchesEmpty' : 'newWorkBranchesLoading')}</option>}
        {branches.map(branch => <option key={branch} value={branch}>{branch}{branch === data?.currentBranch ? ` · ${t('newWorkCurrentBranch')}` : ''}</option>)}
      </select>
    </label>
    <p className="mono">{project.path}</p><p className="muted">{t('newWorkBaseHint')}</p>
    {!data && !resource.error && <p role="status">{t('newWorkBranchesLoading')}</p>}
    {resource.error && <ErrorNotice error={resource.error} retry={resource.reload} />}
    {data?.branches.length === 0 && !resource.error && <p className="hint">{t('newWorkBranchesEmptyHint')} <button type="button" className="btn sm" disabled={locked} onClick={resource.reload}>{t('newWorkRefreshBranches')}</button></p>}
  </section>;
}
