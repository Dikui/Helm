import { CopyText } from '../../shared/CopyText.js';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Work } from '../../shared/types.js';

export function WorkReference({ work }: { work: Work }) {
  const { t } = useI18n();
  const { api } = useData();
  const projects = useResource<{ id: string; name: string; path: string }[]>('list-projects');
  const project = projects.data?.find(item => item.id === work.projectId);
  if (projects.error) return <ErrorNotice error={projects.error} retry={projects.reload} />;
  if (!projects.data) return <p role="status">{t('loading')}</p>;
  if (!project) return <ErrorNotice error={new Error(t('workReferenceProjectMissing'))} retry={projects.reload} />;
  const ended = work.status === 'completed' || work.status === 'cancelled';
  const copyPath = ended ? null : work.workPath;
  const copyState = t(ended ? 'workReferenceCopyRemoved' : 'workReferenceNoCopy');
  const link = new URL(`/works/${encodeURIComponent(work.id)}`, window.location.origin).href;
  const operations = ['get-work', 'get-work-descriptions', 'get-card-graph', 'get-conversation', 'list-rounds', 'list-dispatches', 'get-events'];
  const reference = [
    `${t('workReferenceText')}: ${work.title}`, '',
    `${t('workReferenceId')}: ${work.id}`, `${t('workReferenceLink')}: ${link}`,
    `${t('workReferenceStatus')}: ${t(work.status)} (${work.status})`,
    `${t('projects')}: ${project.name}`, `${t('workReferenceProjectPath')}: ${project.path}`,
    `${t('workReferenceCopyPath')}: ${copyPath || copyState}`,
    ...(work.workBranch ? [`${t('workReferenceBranch')}: ${work.workBranch}`] : []),
    ...(work.baseRef ? [`${t('workReferenceBase')}: ${work.baseRef}${work.baseCommit ? ` @ ${work.baseCommit}` : ''}`] : []),
    '', t('workReferenceReadHelp'), 'Content-Type: application/json', JSON.stringify({ workId: work.id }), '',
    ...operations.map(operation => `POST ${new URL(`${api.baseUrl}/api/${operation}`, window.location.href).href}`),
  ].join('\n');
  return <>
    <p className="muted">{t('workReferenceHelp')}</p>
    <CopyText label={t('workReferenceProjectPath')} action={t('copyProjectPath')} value={project.path} />
    {copyPath ? <CopyText label={t('workReferenceCopyPath')} action={t('copyWorkPath')} value={copyPath} /> : <p>{copyState}</p>}
    <CopyText label={t('workReferenceText')} action={t('copyWorkReference')} value={reference} rows={12} />
  </>;
}
