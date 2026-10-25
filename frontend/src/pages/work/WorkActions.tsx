import { useEffect, useRef, useState } from 'react';
import { OperationError } from '../../shared/api.js';
import { useData } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { useRouter } from '../../shared/router.js';
import type { Work } from '../../shared/types.js';
import { ExportForm } from './ExportForm.js';
import { CoordinatorChooser } from './CoordinatorChooser.js';
import { ActionDialog } from './ActionDialog.js';
import './work-actions.css';

export interface ActionWork extends Work { allowedOperations?: string[]; coordinatorAgentId?: string; outputsDeletedAt?: string | null }
export function WorkActions({ work, reload }: { work: ActionWork; reload: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'cancel' | 'agent' | 'export' | 'delete' | 'remove'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [restriction, setRestriction] = useState<{ status: string; operations: string[] }>();
  const [deletePrompt, setDeletePrompt] = useState(false);
  const [exportPath, setExportPath] = useState<string>();
  const [keptBranch, setKeptBranch] = useState<string>();
  const pending = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const ended = work.status === 'completed' || work.status === 'cancelled';
  const allowed = restriction?.status === work.status ? restriction.operations : work.allowedOperations;
  const enabled = (operation: string, state = !ended) => !busy && state && (!allowed || allowed.includes(operation));
  const close = () => { setPanel(undefined); trigger.current?.focus(); };
  async function run(operation: string, params: object = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      const result = await api.call<{ requiresConfirmation?: boolean; targetPath?: string; keptBranch?: string | null }>(operation, { workId: work.id, ...params });
      if (result.requiresConfirmation) { setDeletePrompt(true); return; }
      if (operation === 'delete-work') { if (result.keptBranch) setKeptBranch(result.keptBranch); else navigate('/'); return; }
      if (result.targetPath) setExportPath(result.targetPath);
      setRestriction(undefined); setOpen(false); close(); reload();
    } catch (error) {
      setError(error as Error);
      if (error instanceof OperationError) setRestriction({ status: work.status, operations: error.failure.allowedOperations });
      reload();
    } finally { pending.current = false; setBusy(false); }
  }
  return <div ref={container} className="work-actions" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    {work.outputsDeletedAt && <span className="pill">{t('outputsDeleted')}</span>}
    <button ref={trigger} className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{t('workActions')} <span aria-hidden="true">⌄</span></button>
    {open && <div className="work-actions-menu" role="group" aria-label={t('workActionsGroup')}>
      <button className="btn sm" disabled={!enabled(work.status === 'paused' ? 'resume-work' : 'pause-work')}
        onClick={() => void run(work.status === 'paused' ? 'resume-work' : 'pause-work')}>{t(work.status === 'paused' ? 'resumeWork' : 'pauseWork')}</button>
      <button className="btn sm" disabled={!enabled('change-coordinator-agent')} onClick={() => { setError(undefined); setOpen(false); setPanel('agent'); }}>{t('changeCoordinator')}</button>
      <button className="btn sm work-danger" disabled={!enabled('cancel-work')} onClick={() => { setOpen(false); setError(undefined); setPanel('cancel'); }}>{t('cancelWork')}</button>
      <button className="btn sm" disabled={!enabled('export-outputs', ended)} onClick={() => { setError(undefined); setOpen(false); setPanel('export'); }}>{t('exportOutputs')}</button>
      <button className="btn sm work-danger" disabled={!enabled('delete-outputs', ended && !work.outputsDeletedAt)} onClick={() => { setError(undefined); setDeletePrompt(false); setOpen(false); setPanel('delete'); }}>{t('deleteOutputs')}</button>
      <button className="btn sm work-danger" disabled={!enabled('delete-work', ended)} onClick={() => { setError(undefined); setDeletePrompt(false); setOpen(false); setPanel('remove'); }}>{t('deleteWork')}</button>
      <p className="muted">{t(ended ? 'endedWorkActions' : 'outputsWhenEnded')}</p>
      {error && <ErrorNotice error={error} />}
    </div>}
    {exportPath && !open && !panel && <div className="work-export-result" role="status"><div className="row"><span>{t('outputsExported')}</span><button className="btn sm" aria-label={t('dismissActionFeedback')} onClick={() => setExportPath(undefined)}>×</button></div><span className="mono">{exportPath}</span></div>}
    {error && !panel && !open && <div className="work-action-error"><ErrorNotice error={error} /><button className="btn sm" onClick={() => setError(undefined)}>{t('dismissActionFeedback')}</button></div>}
    {panel === 'export' && <ActionDialog key="export" title={t('exportOutputs')} busy={busy} onClose={close} returnFocus={trigger}>
      <p>{work.title}</p>
      {work.outputsDeletedAt && <p>{t('exportAfterDeletion')}</p>}
      {error && <ErrorNotice error={error} />}
      <ExportForm busy={!enabled('export-outputs', ended)} onSubmit={targetPath => void run('export-outputs', { targetPath })} />
    </ActionDialog>}
    {panel === 'delete' && <ActionDialog key="delete" title={t('deleteOutputs')} description={`${work.title} · ${t('deleteOutputsConsequence')}`} busy={busy} onClose={close} returnFocus={trigger}>
      {error && <ErrorNotice error={error} />}
      {deletePrompt && <><p role="status">{t('outputsNotExported')}</p><button className="btn" disabled={!enabled('export-outputs', ended)} onClick={() => { setError(undefined); setPanel('export'); }}>{t('exportFirst')}</button></>}
      <button className="btn work-danger" disabled={!enabled('delete-outputs', ended && !work.outputsDeletedAt)} onClick={() => void run('delete-outputs', deletePrompt ? { confirm: true } : {})}>{t(deletePrompt ? 'deleteAnyway' : 'confirmDeleteOutputs')}</button>
    </ActionDialog>}
    {panel === 'remove' && <ActionDialog key="remove" title={t('deleteWork')} description={`${work.title} · ${t('deleteWorkConsequence')}`} busy={busy} onClose={keptBranch ? () => navigate('/') : close} returnFocus={trigger}>
      {error && <ErrorNotice error={error} />}
      {keptBranch ? <><p role="status">{t('workDeletedBranchKept')} <span className="mono">{keptBranch}</span></p><button className="btn" onClick={() => navigate('/')}>{t('actionBack')}</button></> : <>
        {deletePrompt && <><p role="status">{t('outputsNotExported')}</p><button className="btn" disabled={!enabled('export-outputs', ended)} onClick={() => { setError(undefined); setPanel('export'); }}>{t('exportFirst')}</button></>}
        <button className="btn work-danger" disabled={!enabled('delete-work', ended)} onClick={() => void run('delete-work', deletePrompt ? { confirm: true } : {})}>{t(deletePrompt ? 'deleteAnyway' : 'confirmDeleteWork')}</button>
      </>}
    </ActionDialog>}
    {panel === 'agent' && <ActionDialog title={t('changeCoordinator')} busy={busy} onClose={close} returnFocus={trigger}>
      {error && <ErrorNotice error={error} />}
      <CoordinatorChooser current={work.coordinatorAgentId} busy={busy || !enabled('change-coordinator-agent')} onSubmit={agentId => void run('change-coordinator-agent', { agentId })} />
    </ActionDialog>}
    {panel === 'cancel' && <ActionDialog title={t('cancelWork')} description={`${work.title} · ${t('cancelWorkConsequence')}`} busy={busy} onClose={close} returnFocus={trigger}>
      {error && <ErrorNotice error={error} />}
      <button className="btn work-danger" disabled={!enabled('cancel-work')} onClick={() => void run('cancel-work')}>{t('confirmCancelWork')}</button>
    </ActionDialog>}
  </div>;
}
