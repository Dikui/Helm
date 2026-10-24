import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent } from '../../../shared/types.js';
import { conclusionLabels, DispatchStatus, endLabels } from './labels.js';
import type { Artifact, ArtifactContent, Dispatch, DispatchOutput } from './types.js';

const pageSize = 20;
export function DispatchDetails({ workId, dispatchId, lastStep, initialStep }: { workId: string; dispatchId: string; lastStep?: number; initialStep?: number }) {
  const { t } = useI18n();
  const affects = useCallback((event: HelmEvent) => event.workId === workId && (!event.dispatchId || event.dispatchId === dispatchId), [workId, dispatchId]);
  const detail = useResource<Dispatch>('get-dispatch', { workId, dispatchId }, affects);
  return <section className="cg-dispatch-detail" aria-label={t('graphDispatchDetail')}>
    {detail.error && <ErrorNotice error={detail.error} retry={detail.reload} />}
    {!detail.data ? <p role="status">{detail.error ? '' : t('loading')}</p> : <>
      <dl className="cg-kv"><dt>{t('graphEnd')}</dt><dd><DispatchStatus dispatch={detail.data} /></dd>
        {detail.data.abortReason && <><dt>{t('graphAbortReason')}</dt><dd>{detail.data.abortReason}</dd></>}
        <dt>{t('graphConclusion')}</dt><dd>{t(conclusionLabels[detail.data.conclusion])}</dd>
        {detail.data.conclusionReason && <><dt>{t('graphReason')}</dt><dd>{detail.data.conclusionReason}</dd></>}
      </dl>
      {detail.data.failure && <p className="error">{detail.data.failure}</p>}
      {detail.data.status === 'ended' && <section aria-label={t('graphFinalAnswer')}><h3>{t('graphFinalAnswer')}</h3><p className="cg-prose">{detail.data.finalAnswer || t('graphNoFinalAnswer')}</p></section>}
      {detail.data.outputStatus === 'deleted' ? <p>{t('graphDeleted')}</p> : <OutputSteps workId={workId} dispatchId={dispatchId} lastStep={lastStep} initialStep={initialStep} affects={affects} />}
      <DispatchArtifacts workId={workId} dispatchId={dispatchId} affects={affects} />
    </>}
  </section>;
}
export function OutputSteps({ workId, dispatchId, roundId, lastStep, initialStep, affects }: {
  workId: string; lastStep?: number; initialStep?: number; affects: (event: HelmEvent) => boolean;
} & ({ dispatchId: string; roundId?: never } | { roundId: string; dispatchId?: never })) {
  const { t } = useI18n();
  const [fromStep, setFromStep] = useState(initialStep ?? 1);
  const [targetStep, setTargetStep] = useState(String(initialStep ?? 1));
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const target = useRef<HTMLLIElement>(null);
  const toStep = fromStep + pageSize - 1;
  const output = useResource<DispatchOutput>(roundId ? 'get-round-output' : 'get-dispatch-output', { workId, ...(roundId ? { roundId } : { dispatchId }), fromStep, toStep }, affects);
  useEffect(() => {
    if (initialStep && target.current) {
      target.current.focus({ preventScroll: true });
      target.current.scrollIntoView?.({ block: 'nearest' });
    }
  }, [initialStep, Boolean(output.data)]);
  const changePage = (step: number) => { setFromStep(step); setTargetStep(String(step)); setInvalid(false); };
  return <section className="cg-output" aria-label={t(roundId ? 'structureRoundOutput' : 'graphOutput')}>
    <h3>{t(roundId ? 'structureRoundOutput' : 'graphOutput')}</h3>
    <div className="cg-pagination">
      <button className="btn sm" disabled={fromStep === 1 || !output.data} onClick={() => changePage(Math.max(1, fromStep - pageSize))}>{t('graphPreviousSteps')}</button>
      <span className="mono">{t('graphStep')} {fromStep}–{toStep}</span>
      <button className="btn sm" disabled={!output.data || (lastStep !== undefined && toStep >= lastStep)} onClick={() => changePage(toStep + 1)}>{t('graphNextSteps')}</button>
    </div>
    <form noValidate className="cg-step-jump" onSubmit={event => {
      event.preventDefault();
      const step = Number(targetStep);
      if (!Number.isSafeInteger(step) || step < 1 || step > Number.MAX_SAFE_INTEGER - pageSize) { setInvalid(true); return; }
      changePage(step);
    }}>
      <label>{t('graphFromStep')}<input type="number" min="1" step="1" value={targetStep} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => setTargetStep(event.target.value)} /></label>
      <button className="btn sm" type="submit">{t('graphGoStep')}</button>
      {invalid && <p className="error" id={errorId} role="alert">{t('graphInvalidStep')}</p>}
    </form>
    {output.error && <ErrorNotice error={output.error} retry={output.reload} />}
    {!output.data ? <p role="status">{output.error ? '' : t('loading')}</p> : !Array.isArray(output.data) ? <p>{t('graphDeleted')}</p> : output.data.length === 0 ? <p className="muted">{t('graphEmptySteps')}</p> : <ol className="cg-steps">
      {output.data.map(step => <li key={step.step} ref={step.step === initialStep ? target : undefined} tabIndex={step.step === initialStep ? -1 : undefined} aria-current={step.step === initialStep ? 'step' : undefined}>
        <span className="cg-step-number">{t('graphStep')} {step.step}</span>
        {step.type === 'output' ? <pre>{step.text}</pre> : step.type === 'artifact' ? <p className="cg-prose">{t('graphArtifact')} · {step.path}</p> : step.type === 'compaction' ? <p>{t('graphCompaction')}</p> : <p>{t('graphEnd')} · {t(endLabels[step.reason])}</p>}
        <details><summary>{t('graphRawStep')}</summary><pre>{JSON.stringify(step, null, 2)}</pre></details>
      </li>)}
    </ol>}
  </section>;
}
function DispatchArtifacts({ workId, dispatchId, affects }: { workId: string; dispatchId: string; affects: (event: HelmEvent) => boolean }) {
  const { t } = useI18n();
  const artifacts = useResource<Artifact[]>('get-dispatch-artifacts', { workId, dispatchId }, affects);
  const [selected, select] = useState<string | null>(null);
  return <section className="cg-artifacts" aria-label={t('graphArtifacts')}>
    <h3>{t('graphArtifacts')}</h3>
    {artifacts.error && <ErrorNotice error={artifacts.error} retry={artifacts.reload} />}
    {!artifacts.data ? <p role="status">{artifacts.error ? '' : t('loading')}</p> : !artifacts.data.length ? <p className="muted">{t('graphNoArtifacts')}</p> : <ul>
      {artifacts.data.map(artifact => <li key={artifact.id}>{artifact.kind === 'branch' ? <><span>{t('graphBranch')}</span><code>{artifact.ref}</code><code>{artifact.commitSha}</code></>
        : <><button className="btn sm" aria-label={`${t('graphReadArtifact')}：${artifact.name}`} aria-pressed={selected === artifact.id} onClick={() => select(artifact.id)}>{artifact.name}</button><small className="muted">{t(artifact.kind === 'test-output' ? 'graphTestOutput' : 'graphFile')}</small></>}</li>)}
    </ul>}
    {selected && <ReadArtifact key={selected} workId={workId} artifactId={selected} />}
  </section>;
}
function ReadArtifact({ workId, artifactId }: { workId: string; artifactId: string }) {
  const { t } = useI18n();
  const [encoding, setEncoding] = useState<'utf8' | 'base64'>('utf8');
  const artifact = useResource<ArtifactContent>('read-artifact', { workId, artifactId, encoding });
  return <div className="cg-artifact-content">
    <div className="row"><button className="btn sm" aria-pressed={encoding === 'utf8'} onClick={() => setEncoding('utf8')}>{t('graphText')}</button><button className="btn sm" aria-pressed={encoding === 'base64'} onClick={() => setEncoding('base64')}>{t('graphBase64')}</button></div>
    {artifact.error && <ErrorNotice error={artifact.error} retry={artifact.reload} />}
    {artifact.data ? <pre aria-label={artifact.data.name}>{artifact.data.content}</pre> : <p role="status">{artifact.error ? '' : t('loading')}</p>}
  </div>;
}
