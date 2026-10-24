import { useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { AgentInstall } from '../../shared/AgentInstall.js';
import { useRouter } from '../../shared/router.js';
import type { CoordinatorTemplate, Project } from './types.js';
import { useSendMessage } from './useSendMessage.js';
import { RegisterProjectDialog, RegisterProjectForm } from './RegisterProject.js';
import './new-work.css';

export function NewWorkPage() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const projects = useResource<Project[]>('list-projects');
  const templates = useResource<CoordinatorTemplate[]>('list-agent-templates');
  const [projectId, setProjectId] = useState('');
  const [templateId, setTemplateId] = useState<string>();
  const [body, setBody] = useState('');
  const [registering, setRegistering] = useState(false);
  const submission = useSendMessage();
  const project = projects.data?.find(item => item.id === projectId) ?? projects.data?.[0];
  const selectedTemplate = templateId ?? project?.defaultCoordinatorTemplateId ?? '';
  const coordinators = templates.data?.filter(item => item.role === 'coordinator' || item.role === null) ?? [];
  const chosen = coordinators.find(item => item.id === selectedTemplate);
  const available = Boolean(chosen?.available);
  const locked = submission.pending || submission.uncertain;
  const send = async () => {
    if (!project || (!submission.uncertain && !available) || !body.trim()) return;
    const result = await submission.send({ projectId: project.id, coordinatorTemplateId: selectedTemplate, body: body.trim() });
    if (result) navigate(`/works/${encodeURIComponent(result.work.id)}`);
  };
  const registered = (id: string) => {
    setProjectId(id); setTemplateId(undefined); setRegistering(false); projects.reload();
  };
  return <><header className="top"><h1>{t('newWork')}</h1></header><div className="page-body new-work">
    {projects.error && <ErrorNotice error={projects.error} retry={projects.reload} />}
    {templates.error && <ErrorNotice error={templates.error} retry={templates.reload} />}
    {(!projects.data || !templates.data) && <p role="status">{t('loading')}</p>}
    {projects.data?.length === 0 && <section className="new-base"><h2>{t('newWorkRegisterFirst')}</h2><RegisterProjectForm onRegistered={registered} /></section>}
    {project && <div className="new-work-content">
      <div><h2>{t('newWorkGoal')}</h2><p className="muted">{t('newWorkLead')}</p></div>
      <form noValidate className="new-compose" aria-busy={submission.pending} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="new-request">{t('requirements')}<textarea value={body} disabled={locked} placeholder={t('newWorkRequestExample')}
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} /></label>
        <div className="new-tools">
          <label>{t('projects')}<select value={project.id} disabled={locked} onChange={event => { setProjectId(event.target.value); setTemplateId(undefined); }}>
            {projects.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button type="button" className="btn" disabled={locked} onClick={() => setRegistering(true)}>{t('newWorkRegisterProject')}</button>
          <label>{t('newWorkCoordinatorTemplate')}<select value={selectedTemplate} disabled={locked} onChange={event => setTemplateId(event.target.value)}>
            {!coordinators.some(item => item.id === selectedTemplate) && <option value={selectedTemplate} disabled>{selectedTemplate} · {t('newWorkTemplateMissing')}</option>}
            {coordinators.map(item => <option key={item.id} value={item.id}>{item.id}{!item.available ? ` · ${item.reason || t('newWorkTemplateUnavailable')}` : ''}</option>)}
          </select></label>
          <button className="btn primary" disabled={submission.pending || (!submission.uncertain && !available) || !body.trim()}>{t(submission.error ? 'newWorkRetrySend' : 'newWorkStart')}</button>
        </div>
        {!available && templates.data && <p className="hint">{chosen?.reason} {t('newWorkChooseAvailableTemplate')}</p>}
        {chosen?.driver && <AgentInstall key={chosen.driver} driver={chosen.driver} onInstalled={templates.reload} />}
        {submission.error && <ErrorNotice error={submission.error} />}
        {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
      </form>
      <section className="new-base" aria-label={t('newWorkBase')}><h3>{t('newWorkBase')}</h3><p className="mono">{project.currentBranch ?? (project.headCommit ? 'HEAD' : '—')} <span title={project.headCommit ?? undefined}>{project.headCommit?.slice(0, 7)}</span></p>
        <p className="mono">{project.path}</p><p className="muted">{t('newWorkBaseHint')}</p>
        {project.gitStatusReason && <p role="status">{project.gitStatusReason}</p>}
        {Boolean(project.uncommittedChanges) && <p className="new-warning">! {project.uncommittedChanges} {t('newWorkUncommittedHint')}</p>}
      </section>
      <p className="muted">{t('newWorkAlignmentNext')}</p>
    </div>}
  </div>{registering && <RegisterProjectDialog onRegistered={registered} onClose={() => setRegistering(false)} />}</>;
}
