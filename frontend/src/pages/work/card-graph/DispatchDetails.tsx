import { stepSummary } from '../../../shared/step-summary.js';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useData, useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { extension, imageTypes } from '../../../shared/files.js';
import { ActionDialog } from '../ActionDialog.js';
import { PlanSteps } from '../../../shared/PlanSteps.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent } from '../../../shared/types.js';
import { conclusionLabels, DispatchStatus, endLabels } from './labels.js';
import type { Artifact, ArtifactContent, Dispatch, DispatchOutput } from './types.js';

const pageSize = 20;
// The artifact never changes once saved, so the preview does not re-read on events.
const unchanged = () => false;
export function DispatchDetails({ workId, dispatchId, lastStep, initialStep, showArtifacts = true }: { workId: string; dispatchId: string; lastStep?: number; initialStep?: number; showArtifacts?: boolean }) {
  const { t } = useI18n();
  const affects = useCallback((event: HelmEvent) => event.workId === workId && (!event.dispatchId || event.dispatchId === dispatchId), [workId, dispatchId]);
  const detail = useResource<Dispatch>('get-dispatch', { workId, dispatchId }, affects);
  return <section className="cg-dispatch-detail" aria-label={t('graphDispatchDetail')}>
    {detail.error && <ErrorNotice error={detail.error} retry={detail.reload} />}
    {!detail.data ? <p role="status">{detail.error ? '' : t('loading')}</p> : <>
      <dl className="cg-kv"><dt>{t('graphEnd')}</dt><dd><DispatchStatus dispatch={detail.data} /></dd>
        {detail.data.abortReason && <><dt>{t('graphAbortReason')}</dt><dd>{detail.data.abortReason}</dd></>}
        <dt>{t('graphConclusion')}</dt><dd>{detail.data.status === 'ended' ? t(conclusionLabels[detail.data.conclusion]) : '—'}</dd>
        {detail.data.conclusionReason && <><dt>{t('graphReason')}</dt><dd>{detail.data.conclusionReason}</dd></>}
      </dl>
      {detail.data.failure && <p className="error">{detail.data.failure}</p>}
      {detail.data.status === 'ended' && <section aria-label={t('graphFinalAnswer')}><h3>{t('graphFinalAnswer')}</h3><p className="cg-prose">{detail.data.finalAnswer || t('graphNoFinalAnswer')}</p></section>}
      {detail.data.outputStatus === 'deleted' ? <p>{t('graphDeleted')}</p> : <OutputSteps workId={workId} dispatchId={dispatchId} lastStep={lastStep} initialStep={initialStep} affects={affects} />}
      {showArtifacts && <DispatchArtifacts workId={workId} dispatchId={dispatchId} affects={affects} />}
    </>}
  </section>;
}

export function OutputSteps({ workId, dispatchId, roundId, lastStep, initialStep, affects }: {
  workId: string; lastStep?: number; initialStep?: number; affects: (event: HelmEvent) => boolean;
} & ({ dispatchId: string; roundId?: never } | { roundId: string; dispatchId?: never })) {
  const { t } = useI18n();
  const [fromStep, setFromStep] = useState(initialStep ?? 1);
  const [toStep, setToStep] = useState((initialStep ?? 1) + pageSize - 1);
  const [targetStep, setTargetStep] = useState(String(initialStep ?? 1));
  const [targetEnd, setTargetEnd] = useState(String((initialStep ?? 1) + pageSize - 1));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const target = useRef<HTMLLIElement>(null);
  const output = useResource<DispatchOutput>(roundId ? 'get-round-output' : 'get-dispatch-output', { workId, ...(roundId ? { roundId } : { dispatchId }), fromStep, toStep }, affects);
  useEffect(() => {
    if (initialStep && target.current) {
      target.current.focus({ preventScroll: true });
      target.current.scrollIntoView?.({ block: 'nearest' });
    }
  }, [initialStep, Boolean(output.data)]);
  const changeRange = (from: number, to = from + pageSize - 1) => { setFromStep(from); setToStep(to); setTargetStep(String(from)); setTargetEnd(String(to)); setInvalid(false); };
  return <section className="cg-output" aria-label={t(roundId ? 'structureRoundOutput' : 'graphOutput')}>
    <h3>{t(roundId ? 'structureRoundOutput' : 'graphOutput')}</h3>
    <div className="cg-pagination">
      <button className="btn sm" disabled={fromStep === 1 || !output.data} onClick={() => changeRange(Math.max(1, fromStep - pageSize))}>{t('graphPreviousSteps')}</button>
      <span className="mono">{t('graphStep')} {fromStep}–{toStep}</span>
      <button className="btn sm" disabled={!output.data || (lastStep !== undefined && toStep >= lastStep)} onClick={() => changeRange(toStep + 1)}>{t('graphNextSteps')}</button>
    </div>
    <p className="hint">{t('inspectorPageSize')}</p>
    <form noValidate className="cg-step-jump" onSubmit={event => {
      event.preventDefault();
      const step = Number(targetStep);
      const end = Number(targetEnd);
      if (!Number.isSafeInteger(step) || step < 1 || !Number.isSafeInteger(end) || end < step || end - step >= pageSize || end > Number.MAX_SAFE_INTEGER - pageSize) { setInvalid(true); return; }
      changeRange(step, end);
    }}>
      <label>{t('graphFromStep')}<input type="number" min="1" step="1" value={targetStep} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => { setTargetStep(event.target.value); const start = Number(event.target.value); if (Number.isSafeInteger(start) && start > 0) setTargetEnd(String(start + pageSize - 1)); }} /></label>
      <label>{t('inspectorToStep')}<input type="number" min="1" step="1" value={targetEnd} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => setTargetEnd(event.target.value)} /></label>
      <button className="btn sm" type="submit">{t('graphGoStep')}</button>
      {invalid && <p className="error" id={errorId} role="alert">{t('inspectorInvalidRange')}</p>}
    </form>
    {output.error && <ErrorNotice error={output.error} retry={output.reload} />}
    {!output.data ? <p role="status">{output.error ? '' : t('loading')}</p> : !Array.isArray(output.data) ? <p>{t('graphDeleted')}</p> : output.data.length === 0 ? <p className="muted">{t('graphEmptySteps')}</p> : <ol className="cg-steps">
      {output.data.map(step => <li key={step.step} ref={step.step === initialStep ? target : undefined} tabIndex={step.step === initialStep ? -1 : undefined} aria-current={step.step === initialStep ? 'step' : undefined}>
        <span className="cg-step-number">{t('graphStep')} {step.step}</span>
        {step.type === 'output' ? <p className="cg-prose">{stepSummary(step.text, t)}</p> : step.type === 'artifact' ? <p className="cg-prose">{t('graphArtifact')} · {step.path}</p> : step.type === 'plan' ? <PlanSteps entries={step.entries} /> : step.type === 'compaction' ? <p>{t('graphCompaction')}</p> : <p>{t('graphEnd')} · {t(endLabels[step.reason])}</p>}
        <details><summary>{t('graphRawStep')}</summary><pre>{JSON.stringify(step, null, 2)}</pre></details>
      </li>)}
    </ol>}
  </section>;
}
export function DispatchArtifacts({ workId, dispatchId, affects }: { workId: string; dispatchId: string; affects: (event: HelmEvent) => boolean }) {
  const { t } = useI18n();
  const artifacts = useResource<Artifact[]>('get-dispatch-artifacts', { workId, dispatchId }, affects);
  const [selected, select] = useState<string | null>(null);
  const branch = artifacts.data?.findLast(artifact => artifact.kind === 'branch');
  const files = branch?.diff?.status === 'available' ? branch.diff.files : undefined;
  return <section className="cg-artifacts" aria-label={t('graphArtifacts')}>
    <h3>{t('graphArtifacts')}{files && ` · ${t(branch?.diff?.status === 'available' && branch.diff.truncated ? 'artifactFileCountTruncated' : 'artifactFileCount').replace('{count}', String(files.length))}`}</h3>
    {artifacts.error && <ErrorNotice error={artifacts.error} retry={artifacts.reload} />}
    {branch && <BranchDiff key={branch.id} workId={workId} artifact={branch} retry={artifacts.reload} />}
    {!artifacts.data ? <p role="status">{artifacts.error ? '' : t('loading')}</p> : !artifacts.data.length ? <p className="muted">{t('graphNoArtifacts')}</p> : <details className="cg-saved-artifacts" open={!branch}><summary>{t('artifactSavedFiles')}</summary><ul>
      {artifacts.data.map(artifact => <li key={artifact.id}>{artifact.kind === 'branch' ? <><span>{t('graphBranch')}</span><code>{artifact.ref}</code><code>{artifact.commitSha}</code></>
        : <><button className="btn sm" aria-label={`${t('graphReadArtifact')}：${artifact.name}`} aria-pressed={selected === artifact.id} onClick={() => select(artifact.id)}>{artifact.name}</button><small className="muted">{t(artifact.kind === 'test-output' ? 'graphTestOutput' : 'graphFile')}</small></>}</li>)}
    </ul></details>}
    {selected && <ReadArtifact key={selected} workId={workId} artifactId={selected} />}
  </section>;
}
export function ReadArtifact({ workId, artifactId, path }: { workId: string; artifactId: string; path?: string }) {
  const { t } = useI18n();
  const { api } = useData();
  const [encoding, setEncoding] = useState<'utf8' | 'base64'>('utf8');
  const artifact = useResource<ArtifactContent>('read-artifact', { workId, artifactId, encoding, ...(path ? { path } : {}) });
  const [previewing, setPreviewing] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const name = artifact.data?.name ?? '';
  const tooLarge = artifact.data?.tooLarge === true;
  const renderable = !tooLarge && artifact.data?.kind !== 'branch' && (Boolean(imageTypes[extension(name)]) || ['html', 'htm'].includes(extension(name)));
  return <div className="cg-artifact-content">
    {artifact.data && artifact.data.kind !== 'branch' && <div className="row"><a className="btn sm" href={`${api.baseUrl}/api/artifact-download?${new URLSearchParams({ workId, artifactId })}`} download>{t('artifactDownload')}</a>
      {!tooLarge && <><button className="btn sm" aria-pressed={encoding === 'utf8'} onClick={() => setEncoding('utf8')}>{t('graphText')}</button><button className="btn sm" aria-pressed={encoding === 'base64'} onClick={() => setEncoding('base64')}>{t('graphBase64')}</button></>}
      {renderable && <button ref={opener} className="btn sm" onClick={() => setPreviewing(true)}>{t('artifactPreview')}</button>}</div>}
    {previewing && <ArtifactPreview workId={workId} artifactId={artifactId} name={name} onClose={() => setPreviewing(false)} returnFocus={opener} />}
    {artifact.error && <ErrorNotice error={artifact.error} retry={artifact.reload} />}
    {artifact.data ? artifact.data.kind === 'branch' ? path && artifact.data.diff?.status === 'available' && artifact.data.diff.patch ? <>{artifact.data.diff.patch.truncated && <p role="status" className="hint">{t('artifactPatchTruncated').replace('{limit}', String(artifact.data.diff.limits.patchBytes / 1024))}</p>}<pre tabIndex={0} className="cg-file-patch" aria-label={`${t('artifactPatch')}：${path}`}>{artifact.data.diff.patch.text}</pre></> : <><div className="cg-prose"><span>{t('graphBranch')}</span><p><code>{artifact.data.ref}</code></p><code>{artifact.data.commitSha}</code><p className="hint">{t('artifactCardChanges')}</p></div><BranchDiff workId={workId} artifact={artifact.data} retry={artifact.reload} /></>
      : tooLarge ? <p className="hint" role="status">{t('artifactTooLarge')}</p> : <pre aria-label={artifact.data.name}>{artifact.data.content}</pre> : <p role="status">{artifact.error ? '' : t('loading')}</p>}
  </div>;
}

// HTML and images are what scratch cards hand to people, so they render like branch files in FilePreview.
function ArtifactPreview({ workId, artifactId, name, onClose, returnFocus }: { workId: string; artifactId: string; name: string; onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const image = imageTypes[extension(name)];
  const file = useResource<ArtifactContent>('read-artifact', { workId, artifactId, encoding: image ? 'base64' : 'utf8' }, unchanged);
  const content = file.data?.content;
  return <ActionDialog title={name} busy={false} onClose={onClose} returnFocus={returnFocus} className="file-preview">
    {file.error && <ErrorNotice error={file.error} retry={file.reload} />}
    {content == null ? !file.error && <p role="status">{t('loading')}</p>
      : image ? <img src={`data:${image};base64,${content}`} alt={name} />
      // No allow-same-origin: scripts run, but cannot reach Helm's page or API.
      : <iframe title={name} sandbox="allow-scripts" srcDoc={content} />}
  </ActionDialog>;
}

function BranchDiff({ workId, artifact, retry }: { workId: string; artifact: Artifact; retry?: () => void }) {
  const { t } = useI18n();
  const [path, selectPath] = useState<string>();
  const diff = artifact.diff;
  const reasons = { 'repository-unavailable': 'artifactRepositoryMissing', 'base-missing': 'artifactBaseMissing', 'commit-unavailable': 'artifactCommitMissing', 'read-failed': 'artifactDiffFailed' } as const;
  if (!diff || diff.status === 'unavailable') return <div className="cg-branch-diff"><p className="hint">{t(diff ? reasons[diff.reason] : 'artifactCommitMissing')}</p>{retry && <button className="btn sm" onClick={retry}>{t('retry')}</button>}</div>;
  return <div className="cg-branch-diff">
    {!diff.branchAvailable || !diff.copyAvailable ? <p className="hint">{t('artifactSavedCommit')}</p> : null}
    {diff.truncated && <p className="hint" role="status">{t('artifactFilesTruncated').replace('{files}', String(diff.limits.files)).replace('{size}', String(diff.limits.summaryBytes / 1024)).replace('{path}', String(diff.limits.pathBytes))}</p>}
    {!diff.files.length ? <p className="muted">{t(diff.truncated ? 'artifactNoListedFiles' : 'artifactNoChanges')}</p> : <>
      <ul className="cg-changed-files" aria-label={t('artifactChangedFiles')}>
        {diff.files.map(file => <li key={file.path}>
          <button className="cg-file-diff" aria-label={`${t('artifactViewFileDiff')}：${file.path}`} aria-pressed={path === file.path} onClick={() => selectPath(file.path)}>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</button>
          {file.binary ? <span className="muted">{t('artifactBinary')}</span> : <><span className="cg-file-add">+{file.additions}</span><span className="cg-file-delete">−{file.deletions}</span></>}
        </li>)}
      </ul>
      <div className="row"><button className="btn sm" onClick={() => selectPath(diff.files[0]!.path)}>{t('reviewViewDiff')}</button></div>
    </>}
    {path && <ReadArtifact key={path} workId={workId} artifactId={artifact.id} path={path} />}
  </div>;
}

export function DispatchEvidence({ workId, dispatchId }: { workId: string; dispatchId: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(0);
  const id = useId();
  const detail = useResource<Dispatch>('get-dispatch', { workId, dispatchId });
  const affects = useCallback((event: HelmEvent) => event.workId === workId && (!event.dispatchId || event.dispatchId === dispatchId), [workId, dispatchId]);
  const labels = ['evidenceFiles', 'evidenceAnswer', 'evidenceRecord'] as const;
  return <div className="dispatch-evidence">
    <div className="cs-tabs" role="tablist" aria-label={t('evidencePreview')}>{labels.map((label, index) => <button key={label} id={`${id}-tab-${index}`} role="tab" aria-selected={tab === index} aria-controls={`${id}-panel`} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % labels.length : event.key === 'ArrowLeft' ? (index + labels.length - 1) % labels.length : event.key === 'Home' ? 0 : event.key === 'End' ? labels.length - 1 : undefined;
      if (next !== undefined) { event.preventDefault(); setTab(next); document.getElementById(`${id}-tab-${next}`)?.focus(); }
    }}>{t(label)}</button>)}</div>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
      {tab === 0 ? <DispatchArtifacts workId={workId} dispatchId={dispatchId} affects={affects} /> : tab === 1 ? <>
        {detail.error && <ErrorNotice error={detail.error} retry={detail.reload} />}
        {!detail.data ? <p role="status">{t('loading')}</p> : <><dl className="cg-kv"><dt>{t('graphConclusion')}</dt><dd>{detail.data.status === 'ended' ? t(conclusionLabels[detail.data.conclusion]) : '—'}</dd>{detail.data.conclusionReason && <><dt>{t('graphReason')}</dt><dd>{detail.data.conclusionReason}</dd></>}</dl><h3>{t('graphFinalAnswer')}</h3><p className="cg-prose">{detail.data.finalAnswer || t('graphNoFinalAnswer')}</p></>}
      </> : <><dl className="cg-kv"><dt>Agent id</dt><dd>{detail.data?.agentId ?? '—'}</dd><dt>{t('graphDispatch')}</dt><dd>{dispatchId}</dd></dl><DispatchDetails workId={workId} dispatchId={dispatchId} showArtifacts={false} /></>}
    </section>
  </div>;
}
