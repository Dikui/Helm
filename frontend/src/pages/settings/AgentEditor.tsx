import { useRef, useState, type FormEvent } from 'react';
import { OperationError } from '../../shared/api.js';
import { useData } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';
import { UnsavedChanges } from './UnsavedChanges.js';
import { CliStatus } from '../../shared/CliStatus.js';
import { ModelFields } from './ModelFields.js';
import { AgentLibrarySelection } from './AgentLibrarySelection.js';
import { useRouter } from '../../shared/router.js';
import type { AgentSettings, AgentEntry } from './types.js';
import { ActionDialog } from '../work/ActionDialog.js';
import '../work/work-actions.css';

function draft(source?: AgentEntry) {
  return { id: source?.id ?? '', config: { role: source?.role ?? 'executor', driver: source?.driver ?? 'claude-sdk',
    model: source?.model ?? null, reasoningEffort: source?.reasoningEffort ?? null, fast: source?.fast ?? false,
    home: source?.home ?? 'shared', description: source?.description ?? '', skills: source?.config?.skills ?? [],
    mcp: source?.config?.mcp ?? [] } as AgentSettings, prompt: source?.prompt ?? '' };
}
export function AgentEditor({ source, creating = false, initialSaved = false, onSaved, onDuplicate, onDeleted }: {
  source?: AgentEntry; creating?: boolean; initialSaved?: boolean; onSaved: (agent: AgentEntry) => void; onDuplicate?: (source: AgentEntry) => void; onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const { api } = useData();
  const { navigate } = useRouter();
  const [value, setValue] = useState(() => ({ ...draft(source), id: creating ? '' : source!.id }));
  const [baseline, setBaseline] = useState(() => JSON.stringify(value));
  const [revision, setRevision] = useState(source?.revision);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(initialSaved);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [openError, setOpenError] = useState<Error>();
  const [deleting, setDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const config = <K extends keyof AgentSettings>(key: K, next: AgentSettings[K]) => { setSaved(false); setValue(current => ({ ...current, config: { ...current.config, [key]: next } })); };
  const conflict = error instanceof OperationError && error.failure.code === 'AGENT_CONFLICT';
  const labels: Record<string, MessageKey> = { id: 'agentId', role: 'role', driver: 'driver', model: 'model', reasoningEffort: 'reasoning', fast: 'fastMode', home: 'billing', description: 'description', prompt: 'promptOptional' };
  const fieldProps = (name: string) => ({ 'aria-label': t(labels[name]!), id: `agent-${name}`, 'aria-invalid': Boolean(errors[name]), 'aria-describedby': errors[name] ? `agent-${name}-error` : undefined });
  const fieldError = (name: string) => errors[name] && <small className="settings-reason" id={`agent-${name}-error`}>{errors[name]}</small>;
  const focusError = (issues: Record<string, string>) => { setErrors(issues); requestAnimationFrame(() => document.getElementById(`agent-${Object.keys(issues)[0]}`)?.focus()); };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setSaved(false); setError(undefined);
    const issues: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)) issues.id = t('invalidAgentId');
    if (!value.config.description.trim()) issues.description = t('requiredField');
    if (Object.keys(issues).length) { focusError(issues); return; }
    setErrors({}); setPending(true);
    try {
      const result = await api.call<AgentEntry>('save-agent', { ...value,
        config: { ...value.config, model: value.config.model?.trim() || null },
        mode: creating ? 'create' : 'update', ...(creating ? {} : { baseRevision: revision }) });
      setValue(draft(result)); setBaseline(JSON.stringify(draft(result))); setRevision(result.revision); setSaved(true); onSaved(result);
      if (creating) navigate(`/settings/agents/${encodeURIComponent(result.id)}`);
    } catch (failure) {
      setError(failure as Error);
      if (failure instanceof OperationError) {
        const fields: Record<string, string> = {};
        if (failure.failure.code === 'AGENT_EXISTS') fields.id = failure.message;
        if (failure.failure.code === 'INVALID_PARAMS') for (const part of failure.message.split('; ')) {
          const match = part.match(/^(?:config\.)?(id|description|prompt|model|driver|role|reasoningEffort|home|fast): (.+)$/);
          if (match) fields[match[1]!] = match[2]!;
        }
        if (Object.keys(fields).length) focusError(fields);
      }
    } finally { setPending(false); }
  }
  async function reload() {
    setPending(true);
    try {
      const entries = await api.call<AgentEntry[]>('list-agents');
      const latest = entries.find(item => item.id === source?.id);
      if (!latest) throw new Error(t('agentMissing'));
      setValue(draft(latest)); setBaseline(JSON.stringify(draft(latest))); setRevision(latest.revision); setError(undefined); setErrors({}); setSaved(false); onSaved(latest);
    } catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  async function openPrompt() {
    if (creating || pending || openingRef.current) return;
    openingRef.current = true; setOpening(true); setOpenError(undefined);
    try { await api.call('open-agent-prompt', { agentId: source!.id }); }
    catch (failure) { setOpenError(failure as Error); }
    finally { openingRef.current = false; setOpening(false); }
  }
  async function remove() {
    if (pending) return;
    setPending(true); setError(undefined);
    try {
      await api.call('delete-agent', { id: source!.id });
      setBaseline(JSON.stringify(value)); setDeleting(false); onDeleted?.();
      navigate('/settings/agents');
    } catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  return <form className="settings-editor" aria-label={t('agentDetails')} onSubmit={save} noValidate aria-busy={pending}>
    <UnsavedChanges dirty={JSON.stringify(value) !== baseline} pending={pending} />
    <div className="settings-detail-head"><span className="settings-driver mono">{{ 'claude-sdk': 'C', codex: 'X', grok: 'G', deepseek: 'D' }[value.config.driver]}</span><div><h2>{creating ? t('newAgent') : source!.id}</h2><small className="mono muted">{source?.directory ?? `~/.helm/agents/${value.id || '<id>'}/`}</small></div>{!creating && <span className={`pill ${source!.available ? 'ok' : 'bad'}`}>{t(source!.available ? 'available' : 'unavailable')}</span>}</div>
    <fieldset disabled={pending} className="settings-fields">
      <label htmlFor="agent-id">{t('agentId')}<input {...fieldProps('id')} value={value.id} disabled={!creating} onChange={event => { setSaved(false); setValue({ ...value, id: event.target.value }); }} />{fieldError('id')}</label>
      <div className="settings-two">
        <label htmlFor="agent-role">{t('role')}<select {...fieldProps('role')} disabled={!creating} value={value.config.role} onChange={event => config('role', event.target.value as AgentSettings['role'])}>
          <option value="coordinator">{t('coordinatorRole')}</option><option value="executor">{t('executors')}</option></select>{!creating && <small className="muted">{t('roleImmutable')}</small>}{fieldError('role')}</label>
        <label htmlFor="agent-driver">{t('driver')}<select {...fieldProps('driver')} value={value.config.driver} onChange={event => config('driver', event.target.value as AgentSettings['driver'])}>
          {['claude-sdk', 'codex', 'grok', 'deepseek'].map(driver => <option key={driver}>{driver}</option>)}</select>{fieldError('driver')}</label>
      </div>
      <CliStatus key={value.config.driver} driver={value.config.driver} />
      <ModelFields settings={value.config} agentId={value.id} fieldProps={fieldProps} fieldError={fieldError}
        change={next => { setSaved(false); setValue(current => ({ ...current, config: { ...current.config, ...next } })); }} />
      <label className="settings-fast" htmlFor="agent-fast"><span>{t('fastMode')}<small className="muted">{t('fastModeHint')}</small></span><input className="settings-toggle" {...fieldProps('fast')} type="checkbox" checked={value.config.fast} onChange={event => config('fast', event.target.checked)} />{fieldError('fast')}</label>
      <fieldset className="settings-billing" {...fieldProps('home')} tabIndex={-1}><legend>{t('billing')}</legend>
        <label className="settings-billing-option"><input type="radio" name="agent-home" value="shared" checked={value.config.home === 'shared'} onChange={() => config('home', 'shared')} /><span><b>{t('subscription')}</b><small>{t('sharedHomeHint')}</small></span></label>
        <label className="settings-billing-option"><input type="radio" name="agent-home" value="dedicated" checked={value.config.home === 'dedicated'} onChange={() => config('home', 'dedicated')} /><span><b>{t('apiBilling')}</b><small>{t('apiHomeHint')} <code>~/.helm/agent-homes/{value.id || '<id>'}/</code></small></span></label>
        {fieldError('home')}
      </fieldset>
      <label htmlFor="agent-description">{t('description')}<textarea className="resize-none" {...fieldProps('description')} rows={3} value={value.config.description} onChange={event => config('description', event.target.value)} />{fieldError('description')}</label>
      <label htmlFor="agent-prompt">{t('promptOptional')}<small className="muted">{t('promptHint')}</small><textarea {...fieldProps('prompt')} className="resize-none mono settings-prompt" rows={6} value={value.prompt} onChange={event => { setSaved(false); setValue({ ...value, prompt: event.target.value }); }} />{fieldError('prompt')}</label>
      {!creating && <div className="settings-prompt-external"><code>prompt.md</code> <button type="button" className="btn sm" disabled={pending || opening} aria-busy={opening} onClick={() => void openPrompt()}>{t('openAgentPrompt')}</button><p className="hint">{t('openAgentPromptHint')}</p>{openError && <ErrorNotice error={openError} />}</div>}
      <AgentLibrarySelection ownSkills={creating ? [] : source?.skills ?? []} settings={value.config} change={config} />
      {!creating && !!source?.warnings?.length && <div className="settings-box" role="status" aria-label={t('agentWarnings')}>
        <h3>{t('agentWarnings')}</h3>{source.warnings.map(warning => <p key={warning}>{warning}</p>)}
      </div>}
    </fieldset>
    <div className="settings-feedback">{error && !deleting && <ErrorNotice error={error} />}{conflict && <><p>{t('conflictHint')}</p><button type="button" className="btn" disabled={pending} onClick={() => void reload()}>{t('reloadAgent')}</button></>}<span role="status">{saved ? t('saved') : ''}</span></div>
    {(!creating || source) && <p className="settings-duplicate-hint muted" id="agent-duplicate-hint">{t('duplicateAgentHint')}</p>}
    <div className="settings-actions"><span className="muted">{t('nextDispatch')}</span>{!creating && <button type="button" className="btn" aria-describedby="agent-duplicate-hint" disabled={pending} onClick={() => onDuplicate?.({ ...source!, ...value.config, config: value.config, id: value.id, prompt: value.prompt, revision: revision ?? null })}>{t('duplicateAgent')}</button>}
      {!creating && <button ref={deleteButton} type="button" className="btn work-danger" disabled={pending} onClick={() => { setError(undefined); setDeleting(true); }}>{t('deleteAgent')}</button>}
      <button className="btn primary" disabled={pending || conflict}>{t('save')}</button></div>
    {deleting && <ActionDialog title={t('deleteAgent')} description={`${source!.id} · ${t('deleteAgentConsequence')}`} busy={pending} onClose={() => setDeleting(false)} returnFocus={deleteButton}>
      {error && <ErrorNotice error={error} />}
      <button type="button" className="btn work-danger" disabled={pending} onClick={() => void remove()}>{t('confirmDeleteAgent')}</button>
    </ActionDialog>}
  </form>;
}
