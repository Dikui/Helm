import { useRef, useState } from 'react';
import { OperationError } from '../../shared/api.js';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import { useSettingsSave } from './useSettingsSave.js';
import { InstallSkillForm } from './InstallSkillForm.js';
import { RegisterMcpForm } from './RegisterMcpForm.js';
import { UnsavedChanges } from './UnsavedChanges.js';
import { ActionDialog } from '../work/ActionDialog.js';
import '../work/work-actions.css';
import type { LibraryFormState } from './LibraryField.js';
import type { LibraryEntry } from './types.js';
export function LibrarySection() {
  const { t } = useI18n();
  const library = useResource<LibraryEntry[]>('list-library');
  const [installOpen, setInstallOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const installButton = useRef<HTMLButtonElement>(null);
  const mcpButton = useRef<HTMLButtonElement>(null);
  const [deleted, setDeleted] = useState(false);
  const [skillForm, setSkillForm] = useState<LibraryFormState>({ dirty: false, pending: false });
  const [mcpForm, setMcpForm] = useState<LibraryFormState>({ dirty: false, pending: false });
  const heading = useRef<HTMLElement>(null);
  return <section ref={heading} tabIndex={-1} className="settings-simple" aria-label={t('library')}><p className="muted">{t('libraryHelp')}</p>
    <UnsavedChanges dirty={skillForm.dirty || mcpForm.dirty} pending={skillForm.pending || mcpForm.pending} onSave={async () => {
      if (skillForm.dirty && !await skillForm.save?.()) return false;
      if (mcpForm.dirty && !await mcpForm.save?.()) return false;
      return true;
    }} />
    {library.error && <ErrorNotice error={library.error} retry={library.reload} />}
    {!library.data && !library.error && <p role="status">{t('loading')}</p>}

    <span role="status">{deleted ? t('libraryEntryDeleted') : ''}</span>
    {(['skill', 'mcp'] as const).map(type => <section key={type} className="settings-box settings-library-group" aria-label={type === 'skill' ? 'Skills' : 'MCP'}>
      <div className="settings-heading"><h3>{type === 'skill' ? 'Skills' : 'MCP'}</h3><button ref={type === 'skill' ? installButton : mcpButton} type="button" className="btn sm" onClick={() => type === 'skill' ? setInstallOpen(true) : setMcpOpen(true)}>{t(type === 'skill' ? 'libraryInstallSkill' : 'libraryRegisterMcp')}</button></div>
      {library.data && !library.data.some(entry => entry.type === type) && <p className="settings-library-empty">{t(type === 'skill' ? 'libraryEmptySkills' : 'libraryEmptyMcp')}</p>}
      {library.data?.filter(entry => entry.type === type).map(entry => <LibraryRow key={`${entry.type}:${entry.name}`} entry={entry} onDeleted={() => { setDeleted(true); heading.current?.focus(); library.reload(); }} />)}
    </section>)}
    <ActionDialog className="settings-modal" title={t('libraryInstallSkill')} open={installOpen} busy={skillForm.pending} onClose={() => setInstallOpen(false)} returnFocus={installButton}>
      <InstallSkillForm onInstalled={library.reload} onStateChange={setSkillForm} />
    </ActionDialog>
    <ActionDialog className="settings-modal" title={t('libraryRegisterMcp')} open={mcpOpen} busy={mcpForm.pending} onClose={() => setMcpOpen(false)} returnFocus={mcpButton}>
      <RegisterMcpForm onRegistered={library.reload} onStateChange={setMcpForm} />
    </ActionDialog>
  </section>;
}
function AgentLinks({ agents }: { agents: string[] }) {
  return <ul className="settings-files">{agents.map(id => <li key={id}><Link href={`/settings/agents/${encodeURIComponent(id)}`}>{id}</Link></li>)}</ul>;
}
function LibraryRow({ entry, onDeleted }: { entry: LibraryEntry; onDeleted: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const save = useSettingsSave();
  const [expanded, setExpanded] = useState(false);
  const type = entry.type === 'skill' ? 'skill' : `MCP · ${entry.transport === 'http' ? 'HTTP' : 'stdio'}`;
  return <article className="settings-box" aria-label={`${type} ${entry.name}`} aria-busy={save.pending}>
    <div className="settings-tool-head"><h3>{entry.name}</h3><span className="muted">{type}</span><span className="muted">{entry.agents.length} {t('libraryReferenceCount')}</span><button type="button" className="btn sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t('libraryView')}</button></div>
    <div hidden={!expanded} className="settings-library-details">
    {entry.type === 'mcp' && <>
      <code>{entry.transport === 'http' ? entry.url : entry.command}</code>
      <p className="settings-meta">{t(entry.transport === 'http' ? 'libraryHeaderKeys' : 'libraryEnvKeys')}: <code>{(entry.transport === 'http' ? entry.headerKeys : entry.envKeys).join(', ') || '—'}</code></p>
    </>}
    <div><span className="settings-meta">{t('libraryAgents')}</span>{entry.agents.length ? <AgentLinks agents={entry.agents} /> : <p className="muted">{t('libraryUnused')}</p>}</div></div>
    {save.error && (save.error instanceof OperationError ? <div className="error" role="alert"><div><code>{save.error.failure.code}</code><p>{save.error.message}</p>
      {!!save.error.failure.details?.agents?.length && <><p>{t('libraryAgents')}</p><AgentLinks agents={save.error.failure.details.agents} /></>}
    </div></div> : <ErrorNotice error={save.error} />)}
    <div className="row"><button type="button" className="btn work-danger" disabled={save.pending} onClick={() => void save.run(async () => {
      await api.call('delete-library-entry', { type: entry.type, name: entry.name }); onDeleted();
    })}>{t('libraryDelete')}</button></div>
  </article>;
}
