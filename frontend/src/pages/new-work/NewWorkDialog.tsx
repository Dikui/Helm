import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { CliStatus } from '../../shared/CliStatus.js';
import { AgentMark } from '../../shared/AgentMark.js';
import { Link, useRouter } from '../../shared/router.js';
import type { CoordinatorAgent, Project } from './types.js';
import { useSendMessage } from './useSendMessage.js';
import { AttachmentPicker, encodeFiles, withPastedFiles } from '../../shared/attachments.js';
import { RegisterProjectDialog, RegisterProjectForm } from './RegisterProject.js';
import { BaseBranchField, type BaseSelection } from './BaseBranchField.js';
import './new-work.css';

interface Preferences { projectId?: string; agents?: Record<string, string>; bases?: Record<string, string> }
function readPreferences(): Preferences {
  try { return JSON.parse(localStorage.getItem('helm.new-work') ?? '{}') ?? {}; } catch { return {}; }
}

export function NewWorkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const projects = useResource<Project[]>('list-projects');
  const agents = useResource<CoordinatorAgent[]>('list-agents');
  const [preferences, setPreferences] = useState(readPreferences);
  const [base, setBase] = useState<BaseSelection>();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [encodingError, setEncodingError] = useState<Error>();
  const sending = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const projectButton = useRef<HTMLButtonElement>(null);
  const projectMenu = useRef<HTMLDivElement>(null);
  const submission = useSendMessage();
  const project = projects.data?.find(item => item.id === preferences.projectId) ?? projects.data?.[0];
  const coordinators = agents.data?.filter(item => item.role === 'coordinator' || item.role === null) ?? [];
  const projectDefault = project?.defaultCoordinatorAgentId ?? '';
  const selectedAgent = (project && preferences.agents?.[project.id]) ?? (coordinators.some(item => item.id === projectDefault) ? projectDefault
    : coordinators.find(item => item.available)?.id ?? projectDefault);
  const chosen = coordinators.find(item => item.id === selectedAgent);
  const available = Boolean(chosen?.available);
  const branchReady = !project?.isGit || (base?.projectId === project.id && base.ready);
  const pending = encoding || submission.pending;
  const locked = pending || submission.uncertain;
  useEffect(() => {
    try { localStorage.setItem('helm.new-work', JSON.stringify(preferences)); } catch { /* 只影响记忆 */ }
  }, [preferences]);
  useEffect(() => {
    if (!open) return;
    const shell = document.querySelector<HTMLElement>('.shell');
    const opener = document.activeElement as HTMLElement | null;
    const wasInert = shell?.inert ?? false;
    const previousHidden = shell?.getAttribute('aria-hidden');
    const overflow = document.documentElement.style.overflow;
    if (shell) { shell.inert = true; shell.setAttribute('aria-hidden', 'true'); }
    document.documentElement.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      if (shell) { shell.inert = wasInert; if (previousHidden === null) shell.removeAttribute('aria-hidden'); else if (previousHidden) shell.setAttribute('aria-hidden', previousHidden); }
      document.documentElement.style.overflow = overflow;
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else shell?.querySelector<HTMLElement>('a[href="/new"]')?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open) (panel.current?.querySelector<HTMLElement>('textarea, input') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus();
  }, [open, Boolean(projects.data)]);
  useEffect(() => {
    if (open && locked && !registering && (!panel.current?.contains(document.activeElement) || (document.activeElement as HTMLInputElement)?.disabled)) panel.current?.focus();
  }, [open, locked, registering]);
  useEffect(() => {
    if (!menuOpen) return;
    projectMenu.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
    const outside = (event: MouseEvent) => {
      if (!projectMenu.current?.contains(event.target as Node) && !projectButton.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [menuOpen]);
  const chooseProject = (id: string) => {
    setPreferences(previous => ({ ...previous, projectId: id }));
    setBase(undefined); setMenuOpen(false); projectButton.current?.focus();
  };
  const registered = (id: string) => { chooseProject(id); setRegistering(false); projects.reload(); };
  const send = async () => {
    if (sending.current || !project || (!submission.uncertain && (!available || !branchReady)) || !body.trim()) return;
    sending.current = true; setEncoding(true); setEncodingError(undefined);
    try {
      const result = await submission.send({ projectId: project.id, coordinatorAgentId: selectedAgent,
        ...(project.isGit && base?.projectId === project.id && base.baseRef ? { baseRef: base.baseRef } : {}),
        body: body.trim(), attachments: await encodeFiles(files), references });
      if (result) {
        setBody(''); setFiles([]); setReferences([]);
        navigate(`/works/${encodeURIComponent(result.work.id)}`, true);
      }
    } catch (error) { setEncodingError(error as Error); }
    finally { sending.current = false; setEncoding(false); }
  };
  const projectBounds = menuOpen ? projectButton.current?.getBoundingClientRect() : undefined;
  const menuTop = Math.min((projectBounds?.bottom ?? 0) + 6, window.innerHeight - 160);
  if (!open) return null;
  return createPortal(<div className="new-scene">
    <section ref={panel} tabIndex={-1} className="new-card" role="dialog" aria-modal="true" aria-label={t('newWork')} inert={registering} aria-hidden={registering || undefined}
      onKeyDown={event => {
        if (registering || event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          if (menuOpen) { setMenuOpen(false); projectButton.current?.focus(); }
          else onClose();
        }
        if (event.key !== 'Tab') return;
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled):not([hidden]), textarea:not(:disabled), select:not(:disabled), summary')]
          .filter(control => !control.closest('details:not([open])') || control.tagName === 'SUMMARY');
        const first = controls[0], last = controls.at(-1);
        if (!controls.length) { event.preventDefault(); panel.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="new-head"><h1>{t(projects.data?.length === 0 ? 'newWorkRegisterFirst' : 'newWork')}</h1>
        <button type="button" className="btn ghost" aria-label={t('newWorkClose')} onClick={onClose}>×</button></div>
      {projects.error && <ErrorNotice error={projects.error} retry={projects.reload} />}
      {agents.error && <ErrorNotice error={agents.error} retry={agents.reload} />}
      {!projects.data && !projects.error && <p className="new-context" role="status">{t('loading')}</p>}
      {projects.data?.length === 0 && <div className="new-registration"><RegisterProjectForm onRegistered={registered} /></div>}
      {project && <form noValidate aria-busy={pending} onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="new-request"><span className="sr">{t('requirements')}</span><textarea className="resize-none" value={body} disabled={locked} placeholder={t('newWorkPlaceholder')}
          onChange={event => setBody(event.target.value)} onPaste={event => { const pasted = [...event.clipboardData.files]; if (pasted.length) setFiles(current => withPastedFiles(current, pasted)); }} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} /></label>
        <div className="new-tools">
          <div className="new-project-control"><button ref={projectButton} type="button" className="new-pill" title={project.path} disabled={locked}
            aria-label={`${t('newWorkProject')}: ${project.name}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="new-project-menu" onClick={() => setMenuOpen(value => !value)}>
            <span className="new-label">{t('newWorkProject')}</span> {project.name} ▾</button>
            {menuOpen && <div ref={projectMenu} id="new-project-menu" className="new-project-menu" role="menu" aria-label={t('newWorkChooseProject')}
              style={{ top: menuTop, left: Math.max(12, Math.min(projectBounds?.left ?? 12, window.innerWidth - 302)), maxHeight: Math.max(120, window.innerHeight - menuTop - 12) }} onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = [...projectMenu.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
              const index = items.indexOf(document.activeElement as HTMLElement);
              items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }}>
              {projects.data?.map(item => <button key={item.id} type="button" role="menuitemradio" aria-checked={item.id === project.id} onClick={() => chooseProject(item.id)}>
                {item.name}<small>{item.path} · {item.currentBranch ?? (item.headCommit ? 'HEAD' : '—')}</small></button>)}
              <hr /><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); projectButton.current?.focus(); setRegistering(true); }}>{t('newWorkRegisterProject')}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); projectButton.current?.focus(); }}>{t('newWorkCloseMenu')}</button>
            </div>}
          </div>
          {project.isGit ? <BaseBranchField key={project.id} project={project} selection={base} preferred={preferences.bases?.[project.id]} onSelect={setBase} locked={locked}
            onRemember={branch => setPreferences(previous => previous.bases?.[project.id] === branch ? previous : { ...previous, bases: { ...previous.bases, [project.id]: branch } })} />
            : <label className="new-pill"><span className="new-label">{t('newWorkBase')}</span><select aria-label={t('newWorkBaseBranch')} disabled><option>{t('newWorkNonGitBase')}</option></select></label>}
          <label className="new-pill"><AgentMark driver={chosen?.driver} /><span className="sr">{t('newWorkCoordinatorAgent')}</span><select aria-label={t('newWorkCoordinatorAgent')} value={selectedAgent} disabled={locked}
            onChange={event => {
              const id = event.target.value;
              setPreferences(previous => ({ ...previous, agents: { ...previous.agents, [project.id]: id } }));
            }}>
            {!agents.data && <option value={selectedAgent} disabled>{t('loading')}</option>}
            {agents.data && !coordinators.some(item => item.id === selectedAgent) && <option value={selectedAgent} disabled>{selectedAgent} · {t('newWorkAgentMissing')}</option>}
            {coordinators.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.id}{!item.available ? ` · ${item.reason || t('newWorkAgentUnavailable')}` : ''}</option>)}
          </select></label>
          <button className="btn primary new-send" aria-busy={pending} disabled={pending || submission.uncertain || !available || !branchReady || !body.trim()}>
            {t(pending ? 'newWorkCreating' : submission.uncertain ? 'newWorkWaitingResult' : project.isGit && !branchReady ? 'newWorkWaitingBase' : 'newWorkStart')} <span aria-hidden="true">↵</span></button>
        </div>
        <div className="new-context">
          {!project.isGit && <p className="new-notice">{t('newWorkNonGitHint')}</p>}
          {Boolean(project.uncommittedChanges) && <p className="new-notice">{t('newWorkUncommittedPrefix')} {project.uncommittedChanges} {t('newWorkUncommittedHint')}</p>}
          {agents.data && coordinators.length === 0 ? <p>{t('newWorkNoCoordinator')} <Link href="/settings/new-agent">{t('newAgent')}</Link></p>
            : !available && agents.data && <p>{chosen?.reason} {t('newWorkChooseAvailableAgent')}</p>}
          {chosen?.driver && <CliStatus key={chosen.driver} driver={chosen.driver} />}
          {encodingError && <ErrorNotice error={encodingError} />}
          {submission.error && <><ErrorNotice error={submission.error} /><p className="new-notice">{t(submission.uncertain ? 'newWorkRetrySameMessage' : 'newWorkSendFailed')}</p>
            <div className="row"><button type="button" className="btn sm" disabled={pending} onClick={() => void send()}>{t(submission.uncertain ? 'newWorkRetryOriginal' : 'newWorkRetrySend')}</button>
              {submission.uncertain && <button type="button" className="btn sm ghost" disabled={pending} onClick={submission.resumeEditing}>{t('newWorkResumeEditing')}</button>}</div></>}
          {!locked && <details open={files.length > 0 || undefined}><summary>{t('newWorkContext')}</summary><div className="new-context-details">
            <AttachmentPicker files={files} onChange={setFiles} disabled={locked} references={references} onReferencesChange={setReferences} fileLabel={t('newWorkAttachments')} />
            <p className="mono">{project.path}</p><p>{t('newWorkBranchPreview')} <code>helm/&lt;{t('newWorkId')}&gt;</code>{t(project.isGit && base?.baseRef ? 'newWorkBranchPreviewGit' : 'newWorkBranchPreviewInit')}</p>
          </div></details>}
        </div>
        <div className="new-hintline"><span>↵ {t('newWorkStart')}</span><span>⇧↵ {t('conversationNewline')}</span><span>Esc {t('close')}</span><span>{t('newWorkRemember')}</span></div>
      </form>}
    </section>
    {registering && <RegisterProjectDialog onRegistered={registered} onClose={() => setRegistering(false)} />}
  </div>, document.body);
}
