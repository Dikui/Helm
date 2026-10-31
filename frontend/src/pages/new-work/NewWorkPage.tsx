import { useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { CliStatus } from '../../shared/CliStatus.js';
import { Link, useRouter } from '../../shared/router.js';
import type { CoordinatorAgent, Project } from './types.js';
import { useSendMessage } from './useSendMessage.js';
import { AttachmentPicker, encodeFiles } from '../../shared/attachments.js';
import { RegisterProjectDialog, RegisterProjectForm } from './RegisterProject.js';
import { BaseBranchField, type BaseSelection } from './BaseBranchField.js';
import './new-work.css';

export function NewWorkPage() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const projects = useResource<Project[]>('list-projects');
  const agents = useResource<CoordinatorAgent[]>('list-agents');
  const [projectId, setProjectId] = useState('');
  const [agentId, setAgentId] = useState<string>();
  const [base, setBase] = useState<BaseSelection>();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<string[]>([]);
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
  const branchReady = !project?.isGit || (base?.projectId === project.id && Boolean(base?.baseRef));
  const locked = submission.pending || submission.uncertain;
  const send = async () => {
    if (!project || (!submission.uncertain && (!available || !branchReady)) || !body.trim()) return;
    const result = await submission.send({ projectId: project.id, coordinatorAgentId: selectedAgent,
      ...(project.isGit && base?.projectId === project.id ? { baseRef: base.baseRef } : {}), body: body.trim(), attachments: await encodeFiles(files), references });
    if (result) navigate(`/works/${encodeURIComponent(result.work.id)}`);
  };
  const registered = (id: string) => {
    setProjectId(id); setAgentId(undefined); setRegistering(false); projects.reload();
  };
  return <><header className="top"><nav className="new-crumb" aria-label={t('breadcrumb')}><span>{t('workLabel')}</span><span aria-hidden="true">/</span><h1>{t('newWork')}</h1></nav></header><div className="page-body new-work">
    {projects.error && <ErrorNotice error={projects.error} retry={projects.reload} />}
    {agents.error && <ErrorNotice error={agents.error} retry={agents.reload} />}
    {!projects.data && !projects.error && <p role="status">{t('loading')}</p>}
    {projects.data?.length === 0 && <section className="new-base new-register-first"><h2>{t('newWorkRegisterFirst')}</h2><RegisterProjectForm onRegistered={registered} /></section>}
    {project && <div className="new-work-content">
      <div><h2>{t('newWorkGoal')}</h2><p className="muted">{t('newWorkLead')}</p></div>
      <form noValidate className="new-compose" aria-busy={submission.pending} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="new-request"><span className="sr">{t('requirements')}</span><textarea className="resize-none" value={body} disabled={locked} placeholder={t('newWorkRequestExample')}
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} /></label>
        <AttachmentPicker files={files} onChange={setFiles} disabled={locked} references={references} onReferencesChange={setReferences} />
        <div className="new-tools">
          <label className="new-project" title={project.path}><span className="sr">{t('projects')}</span><select value={project.id} disabled={locked} onChange={event => { setProjectId(event.target.value); setAgentId(undefined); }}>
            {projects.data?.map(item => <option key={item.id} value={item.id}>{item.name} · {item.currentBranch ?? (item.headCommit ? 'HEAD' : '—')}</option>)}
          </select></label>
          <button type="button" className="btn sm new-register" disabled={locked} onClick={() => setRegistering(true)}>{t('newWorkRegisterProject')}</button>
          <label className="new-agent"><span className="sr">{t('newWorkCoordinatorAgent')}</span><select value={selectedAgent} disabled={locked} onChange={event => setAgentId(event.target.value)}>
            {!agents.data && <option value={selectedAgent} disabled>{t('loading')}</option>}
            {agents.data && !coordinators.some(item => item.id === selectedAgent) && <option value={selectedAgent} disabled>{selectedAgent} · {t('newWorkAgentMissing')}</option>}
            {coordinators.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.id}{!item.available ? ` · ${item.reason || t('newWorkAgentUnavailable')}` : ''}</option>)}
          </select></label>
          <button className="btn primary new-send" disabled={submission.pending || (!submission.uncertain && (!available || !branchReady)) || !body.trim()}><span className="sr">{t(submission.error ? 'newWorkRetrySend' : 'newWorkStart')}</span><span aria-hidden="true">↑</span></button>
        </div>
        {agents.data && coordinators.length === 0 ? <p className="hint">{t('newWorkNoCoordinator')} <Link href="/settings/new-agent">{t('newAgent')}</Link></p>
          : !available && agents.data && <p className="hint">{chosen?.reason} {t('newWorkChooseAvailableAgent')}</p>}
        {chosen?.driver && <CliStatus key={chosen.driver} driver={chosen.driver} />}
        {submission.error && <ErrorNotice error={submission.error} />}
        {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
      </form>
      <div className="new-context">{project.isGit ? <BaseBranchField key={project.id} project={project} selection={base} onSelect={setBase} locked={locked} />
        : <section className="new-base"><p className="mono">{project.path}</p><p className="muted">{t('projectWithoutGitHint')}</p></section>}
      {Boolean(project.uncommittedChanges) && <p className="warn"><span>!</span><span>{project.uncommittedChanges} {t('newWorkUncommittedHint')}</span></p>}</div>
      <div className="new-tips"><span><kbd>⏎</kbd> {t('newWorkStart')}</span><span><kbd>⇧⏎</kbd> {t('conversationNewline')}</span><span>{t('newWorkAlignmentNext')}</span></div>
    </div>}
  </div>{registering && <RegisterProjectDialog onRegistered={registered} onClose={() => setRegistering(false)} />}</>;
}
