import { useRef, useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Work } from '../../shared/types.js';
import type { Project, AgentEntry } from './types.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';

export function ProjectsSection() {
  const { t } = useI18n();
  const { api } = useData();
  const projects = useResource<Project[]>('list-projects');
  const agents = useResource<AgentEntry[]>('list-agents');
  const works = useResource<Work[]>('list-works');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [invalidPath, setInvalidPath] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const save = useSettingsSave();
  return <section className="settings-simple settings-projects" aria-label={t('projects')}><div className="settings-heading"><h2 ref={heading} tabIndex={-1}>{t('projects')}</h2><button type="button" className="btn sm" onClick={() => document.getElementById('register-project-path')?.focus()}>＋ {t('newWorkRegisterProject')}</button></div>
    {[projects, agents, works].map((resource, index) => resource.error && <ErrorNotice key={index} error={resource.error} retry={resource.reload} />)}
    {!projects.data && !projects.error && <p role="status">{t('loading')}</p>}
    {projects.data?.length === 0 && <p>{t('emptyProjects')}</p>}
    <span role="status">{deleted ? t('projectDeleted') : ''}</span>
    {projects.data?.map(project => <ProjectRow key={project.id} project={project} agents={agents.data ?? []}
      workCount={works.error ? undefined : works.data?.filter(work => work.projectId === project.id).length} onSaved={projects.reload}
      onDeleted={() => { setDeleted(true); heading.current?.focus(); projects.reload(); }} />)}
    <form className="settings-box" aria-label={t('registerProject')} noValidate aria-busy={save.pending} onSubmit={event => {
      event.preventDefault();
      if (!path.trim()) { setInvalidPath(true); document.getElementById('register-project-path')?.focus(); return; }
      setInvalidPath(false);
      void save.run(async () => { await api.call('register-project', { path, ...(name.trim() ? { name: name.trim() } : {}) }); setPath(''); setName(''); projects.reload(); });
    }}>
      <h3>{t('registerProject')}</h3><label>{t('projectName')}<input value={name} disabled={save.pending} onChange={event => { setName(event.target.value); save.clear(); }} /></label>
      <label>{t('projectPath')}<input id="register-project-path" value={path} disabled={save.pending} aria-invalid={invalidPath} aria-describedby={invalidPath ? 'register-project-path-error' : undefined} onChange={event => { setPath(event.target.value); save.clear(); setInvalidPath(false); }} /></label>
      {invalidPath && <p className="settings-reason" id="register-project-path-error">{t('requiredField')}</p>}
      <SaveFeedback {...save} /><div className="row"><button className="btn primary" disabled={save.pending}>{t('registerProject')}</button></div>
    </form>
  </section>;
}
function ProjectRow({ project, agents, workCount, onSaved, onDeleted }: { project: Project; agents: AgentEntry[]; workCount?: number; onSaved: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const [selected, setSelected] = useState<string>();
  const save = useSettingsSave();
  const coordinators = agents.filter(agent => agent.role === 'coordinator');
  return <form className="settings-box" aria-label={`${t('projects')} ${project.name}`} noValidate aria-busy={save.pending} onSubmit={event => {
    event.preventDefault(); void save.run(async () => { await api.call('set-project-coordinator-agent', { projectId: project.id, agentId: selected ?? project.defaultCoordinatorAgentId }); onSaved(); });
  }}><div className="settings-project-summary"><div><h3>{project.name}</h3><code>{project.path}</code></div><span className="ref">{project.currentBranch ?? (project.headCommit ? 'HEAD' : '—')}</span><span className="muted">{workCount === undefined ? t('loading') : `${workCount} ${t('projectWorkCount')}`}</span></div>
    <details className="settings-project-config"><summary>{t('projectSettings')}</summary><div>
    <label>{t('defaultCoordinator')}<select aria-label={t('defaultCoordinator')} disabled={save.pending || !coordinators.length} value={selected ?? project.defaultCoordinatorAgentId} onChange={event => { setSelected(event.target.value); save.clear(); }}>
      {!coordinators.some(agent => agent.id === project.defaultCoordinatorAgentId) && <option>{project.defaultCoordinatorAgentId}</option>}
      {coordinators.map(agent => <option key={agent.id} value={agent.id} disabled={!agent.available}>{agent.id}{agent.available ? '' : ` · ${t('unavailable')}: ${agent.reason}`}</option>)}
    </select></label><small className="muted">{t('projectDefaultHint')}</small>
    <small className="muted" id={`project-delete-${project.id}`}>{t(workCount ? 'projectDeleteInUse' : 'projectDeleteHelp')}</small>
    <SaveFeedback {...save} /><div className="row"><button className="btn" disabled={save.pending || !coordinators.length}>{t('save')}</button>
      <button type="button" className="btn work-danger" disabled={save.pending || workCount !== 0} aria-describedby={`project-delete-${project.id}`} onClick={() => void save.run(async () => {
        await api.call('delete-project', { projectId: project.id }); onDeleted();
      })}>{t('deleteProject')}</button></div></div></details>
  </form>;
}
