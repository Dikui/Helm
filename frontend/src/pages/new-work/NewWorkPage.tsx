import { useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { CliStatus } from '../../shared/CliStatus.js';
import { Link, useRouter } from '../../shared/router.js';
import type { CoordinatorAgent, Project } from './types.js';
import { useSendMessage } from './useSendMessage.js';
import { RegisterProjectDialog, RegisterProjectForm } from './RegisterProject.js';
import './new-work.css';

export function NewWorkPage() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const projects = useResource<Project[]>('list-projects');
  const agents = useResource<CoordinatorAgent[]>('list-agents');
  const [projectId, setProjectId] = useState('');
  const [agentId, setAgentId] = useState<string>();
  const [body, setBody] = useState('');
  const [registering, setRegistering] = useState(false);
  const submission = useSendMessage();
  const project = projects.data?.find(item => item.id === projectId) ?? projects.data?.[0];
  const coordinators = agents.data?.filter(item => item.role === 'coordinator' || item.role === null) ?? [];
  const projectDefault = project?.defaultCoordinatorAgentId ?? '';
  // A default that no longer names an agent falls back to the first available coordinator.
  const selectedAgent = agentId ?? (coordinators.some(item => item.id === projectDefault) ? projectDefault
    : coordinators.find(item => item.available)?.id ?? projectDefault);
  const chosen = coordinators.find(item => item.id === selectedAgent);
  const available = Boolean(chosen?.available);
  const locked = submission.pending || submission.uncertain;
  const send = async () => {
    if (!project || (!submission.uncertain && !available) || !body.trim()) return;
    const result = await submission.send({ projectId: project.id, coordinatorAgentId: selectedAgent, body: body.trim() });
    if (result) navigate(`/works/${encodeURIComponent(result.work.id)}`);
  };
  const registered = (id: string) => {
    setProjectId(id); setAgentId(undefined); setRegistering(false); projects.reload();
  };
  return <><header className="top"><h1>{t('newWork')}</h1></header><div className="page-body new-work">
    {projects.error && <ErrorNotice error={projects.error} retry={projects.reload} />}
    {agents.error && <ErrorNotice error={agents.error} retry={agents.reload} />}
    {(!projects.data || !agents.data) && <p role="status">{t('loading')}</p>}
    {projects.data?.length === 0 && <section className="new-base"><h2>{t('newWorkRegisterFirst')}</h2><RegisterProjectForm onRegistered={registered} /></section>}
    {project && <div className="new-work-content">
      <div><h2>{t('newWorkGoal')}</h2><p className="muted">{t('newWorkLead')}</p></div>
      <form noValidate className="new-compose" aria-busy={submission.pending} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="new-request">{t('requirements')}<textarea value={body} disabled={locked} placeholder={t('newWorkRequestExample')}
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} /></label>
        <div className="new-tools">
          <label>{t('projects')}<select value={project.id} disabled={locked} onChange={event => { setProjectId(event.target.value); setAgentId(undefined); }}>
            {projects.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <button type="button" className="btn" disabled={locked} onClick={() => setRegistering(true)}>{t('newWorkRegisterProject')}</button>
          <label>{t('newWorkCoordinatorAgent')}<select value={selectedAgent} disabled={locked} onChange={event => setAgentId(event.target.value)}>
            {!coordinators.some(item => item.id === selectedAgent) && <option value={selectedAgent} disabled>{selectedAgent} · {t('newWorkAgentMissing')}</option>}
            {coordinators.map(item => <option key={item.id} value={item.id}>{item.id}{!item.available ? ` · ${item.reason || t('newWorkAgentUnavailable')}` : ''}</option>)}
          </select></label>
          <button className="btn primary" disabled={submission.pending || (!submission.uncertain && !available) || !body.trim()}>{t(submission.error ? 'newWorkRetrySend' : 'newWorkStart')}</button>
        </div>
        {agents.data && coordinators.length === 0 ? <p className="hint">{t('newWorkNoCoordinator')} <Link href="/settings/new-agent">{t('newAgent')}</Link></p>
          : !available && agents.data && <p className="hint">{chosen?.reason} {t('newWorkChooseAvailableAgent')}</p>}
        {chosen?.driver && <CliStatus key={chosen.driver} driver={chosen.driver} />}
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
