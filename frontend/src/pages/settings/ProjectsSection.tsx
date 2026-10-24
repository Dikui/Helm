import { useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Work } from '../../shared/types.js';
import type { Project, TemplateEntry } from './types.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';

export function ProjectsSection() {
  const { t } = useI18n();
  const { api } = useData();
  const projects = useResource<Project[]>('list-projects');
  const templates = useResource<TemplateEntry[]>('list-agent-templates');
  const works = useResource<Work[]>('list-works');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [invalidPath, setInvalidPath] = useState(false);
  const save = useSettingsSave();
  return <section className="settings-simple" aria-label={t('projects')}><h2>{t('projects')}</h2>
    {[projects, templates, works].map((resource, index) => resource.error && <ErrorNotice key={index} error={resource.error} retry={resource.reload} />)}
    {!projects.data && !projects.error && <p role="status">{t('loading')}</p>}
    {projects.data?.length === 0 && <p>{t('emptyProjects')}</p>}
    {projects.data?.map(project => <ProjectRow key={project.id} project={project} templates={templates.data ?? []}
      workCount={works.data?.filter(work => work.projectId === project.id).length} onSaved={projects.reload} />)}
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
function ProjectRow({ project, templates, workCount, onSaved }: { project: Project; templates: TemplateEntry[]; workCount?: number; onSaved: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const [selected, setSelected] = useState<string>();
  const save = useSettingsSave();
  const coordinators = templates.filter(template => template.role === 'coordinator');
  return <form className="settings-box" aria-label={`${t('projects')} ${project.name}`} noValidate aria-busy={save.pending} onSubmit={event => {
    event.preventDefault(); void save.run(async () => { await api.call('set-project-coordinator-template', { projectId: project.id, templateId: selected ?? project.defaultCoordinatorTemplateId }); onSaved(); });
  }}><div><h3>{project.name}</h3><code>{project.path}</code><p className="muted">{workCount === undefined ? t('loading') : `${workCount} ${t('projectWorkCount')}`}</p></div>
    <label>{t('defaultCoordinator')}<select aria-label={t('defaultCoordinator')} disabled={save.pending || !coordinators.length} value={selected ?? project.defaultCoordinatorTemplateId} onChange={event => { setSelected(event.target.value); save.clear(); }}>
      {!coordinators.some(template => template.id === project.defaultCoordinatorTemplateId) && <option>{project.defaultCoordinatorTemplateId}</option>}
      {coordinators.map(template => <option key={template.id} value={template.id} disabled={!template.available}>{template.id}{template.available ? '' : ` · ${t('unavailable')}: ${template.reason}`}</option>)}
    </select></label><small className="muted">{t('projectDefaultHint')}</small><SaveFeedback {...save} /><div className="row"><button className="btn" disabled={save.pending || !coordinators.length}>{t('save')}</button></div>
  </form>;
}
