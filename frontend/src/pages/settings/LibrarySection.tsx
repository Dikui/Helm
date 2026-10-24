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
import type { LibraryEntry } from './types.js';
export function LibrarySection() {
  const { t } = useI18n();
  const library = useResource<LibraryEntry[]>('list-library');
  const [deleted, setDeleted] = useState(false);
  const [skillForm, setSkillForm] = useState({ dirty: false, pending: false });
  const [mcpForm, setMcpForm] = useState({ dirty: false, pending: false });
  const heading = useRef<HTMLHeadingElement>(null);
  return <section className="settings-simple" aria-label={t('library')}><h2 ref={heading} tabIndex={-1}>{t('library')}</h2><p className="muted">{t('libraryHelp')}</p>
    <UnsavedChanges dirty={skillForm.dirty || mcpForm.dirty} pending={skillForm.pending || mcpForm.pending} />
    {library.error && <ErrorNotice error={library.error} retry={library.reload} />}
    {!library.data && !library.error && <p role="status">{t('loading')}</p>}
    {library.data?.length === 0 && <p>{t('emptyLibrary')}</p>}
    <span role="status">{deleted ? t('outputsDeleted') : ''}</span>
    {library.data?.map(entry => <LibraryRow key={`${entry.type}:${entry.name}`} entry={entry} onDeleted={() => { setDeleted(true); heading.current?.focus(); library.reload(); }} />)}
    <InstallSkillForm onInstalled={library.reload} onStateChange={setSkillForm} />
    <RegisterMcpForm onRegistered={library.reload} onStateChange={setMcpForm} />
  </section>;
}
function AgentLinks({ agents }: { agents: string[] }) {
  return <ul className="settings-files">{agents.map(id => <li key={id}><Link href={`/settings/agents/${encodeURIComponent(id)}`}>{id}</Link></li>)}</ul>;
}
function LibraryRow({ entry, onDeleted }: { entry: LibraryEntry; onDeleted: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const save = useSettingsSave();
  const type = entry.type === 'skill' ? 'skill' : `MCP · ${entry.transport === 'http' ? 'HTTP' : 'stdio'}`;
  return <article className="settings-box" aria-label={`${type} ${entry.name}`} aria-busy={save.pending}>
    <div className="settings-tool-head"><h3><code>{entry.name}</code></h3><span className="muted">{type}</span></div>
    {entry.type === 'mcp' && <>
      <code>{entry.transport === 'http' ? entry.url : entry.command}</code>
      <p className="settings-meta">{t(entry.transport === 'http' ? 'libraryHeaderKeys' : 'libraryEnvKeys')}: <code>{(entry.transport === 'http' ? entry.headerKeys : entry.envKeys).join(', ') || '—'}</code></p>
    </>}
    <div><span className="settings-meta">{t('libraryAgents')}</span>{entry.agents.length ? <AgentLinks agents={entry.agents} /> : <p className="muted">{t('libraryUnused')}</p>}</div>
    {save.error && (save.error instanceof OperationError ? <div className="error" role="alert"><div><code>{save.error.failure.code}</code><p>{save.error.message}</p>
      {!!save.error.failure.details?.agents?.length && <><p>{t('libraryAgents')}</p><AgentLinks agents={save.error.failure.details.agents} /></>}
    </div></div> : <ErrorNotice error={save.error} />)}
    <div className="row"><button type="button" className="btn work-danger" disabled={save.pending} onClick={() => void save.run(async () => {
      await api.call('delete-library-entry', { type: entry.type, name: entry.name }); onDeleted();
    })}>{t('libraryDelete')}</button></div>
  </article>;
}
