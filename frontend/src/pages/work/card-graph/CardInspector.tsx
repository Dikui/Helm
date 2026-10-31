import { UsageTable } from './TokenDetails.js';
import { Fragment, useCallback, useState } from 'react';
import { formatTokens, useI18n } from '../../../shared/i18n.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { DispatchDetails } from './DispatchDetails.js';
import { CardActions } from './CardActions.js';
import { conclusionLabels, DispatchStatus } from './labels.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import type { HelmEvent } from '../../../shared/types.js';
import type { CardNode, Dispatch } from './types.js';

export function CardInspector({ card, dispatches, initialDispatchId, initialStep }: { card: CardNode; dispatches?: Dispatch[]; initialDispatchId?: string; initialStep?: number }) {
  const { t, language } = useI18n();
  const now = useClock();
  const [chosen, choose] = useState<string | null>(initialDispatchId ?? null);
  const selected = dispatches?.find(dispatch => dispatch.id === chosen) ?? dispatches?.at(-1);
  const loops = sendBackDispatchIds(dispatches ?? []);
  const [detailOpen, setDetailOpen] = useState(Boolean(initialDispatchId || initialStep));
  return <>
    <dl className="cg-kv"><dt>{t('executors')}</dt><dd>{card.agentId ?? t('graphNoAgent')}</dd><dt>{t('graphStep')}</dt><dd>{card.currentStep || '—'}</dd><dt>{t('graphLatestStep')}</dt><dd>{card.latestStepSummary || t('graphNoSteps')}</dd></dl>
    {card.autoFlow && <p className="cg-prose">{card.autoFlow.verifications.length
      ? t('graphAutoFlow').replace('{count}', String(card.autoFlow.verifications.length)).replace('{agents}', card.autoFlow.verifications.map(vote => vote.agentId).join(', '))
      : t(card.needsVerification ? 'graphAutoFlowManualVerification' : 'graphAutoFlowExecution')}</p>}
    {dispatches && dispatches.length > 0 && <UsageTable kind="dispatch" rows={dispatches.map((dispatch, index) => ({ ...dispatch, label: `#${index + 1} · ${t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}` }))} />}
    <h3 className="sect">{t('graphDispatches')} <span className="count">{dispatches?.length ?? '—'}</span></h3>
    {!dispatches ? <p role="status">{t('loading')}</p> : !dispatches.length ? <p className="muted">{t('graphNoDispatches')}</p> : <ol className="cg-history">
      {dispatches.map((dispatch, index) => <Fragment key={dispatch.id}>
        {loops.has(dispatch.id) && <li className="cg-loop"><span className="cg-history-dot" aria-hidden="true">↺</span><span>{t('graphLoop')}</span></li>}
        <li className={dispatch.conclusion === 'failed' ? 'cg-failed' : ''}>
          <span className={`cg-history-dot ${dispatch.conclusion === 'failed' || (dispatch.status === 'ended' && dispatch.endReason !== 'completed') ? 'bad' : dispatch.status === 'ended' ? 'ok' : 'run'}`} aria-hidden="true">{dispatch.status === 'running' ? <span className="spin" /> : dispatch.status === 'queued' ? '·' : dispatch.conclusion === 'failed' || dispatch.endReason !== 'completed' ? '✗' : '✓'}</span>
          <div className="cg-history-entry"><div className="row"><button className="cg-history-select" aria-pressed={selected?.id === dispatch.id} onClick={() => { choose(dispatch.id); setDetailOpen(true); }}>{t('graphDispatch')} #{index + 1} · {t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}</button>
          <span className="mono">{elapsed(dispatch.startedAt ?? dispatch.createdAt, dispatch.endedAt ? Date.parse(dispatch.endedAt) : now)}</span></div>
          <div className="row"><DispatchStatus dispatch={dispatch} /></div>
          <span className="muted">{dispatch.agentId} · {dispatch.status === 'ended' ? t(conclusionLabels[dispatch.conclusion]) : '—'}</span>
          <span className="muted">{t('tokenInput')} {formatTokens(dispatch.usage.inputTokens, language)} · {t('tokenOutput')} {formatTokens(dispatch.usage.outputTokens, language)}</span>
          {dispatch.conclusionReason && <p className={dispatch.conclusion === 'failed' ? 'cg-why' : 'cg-prose'}>{dispatch.conclusionReason}</p>}
          {dispatch.status === 'running' && <RecentDispatchSteps card={card} dispatch={dispatch} />}
          <time className="muted" dateTime={dispatch.startedAt ?? dispatch.createdAt}>{new Date(dispatch.startedAt ?? dispatch.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en')}</time></div>
        </li>
      </Fragment>)}
    </ol>}
    {selected && <details className="cg-dispatch-fold" open={detailOpen} onToggle={event => setDetailOpen(event.currentTarget.open)}><summary>{t('graphDispatchDetail')}</summary>{detailOpen && <DispatchDetails key={selected.id} workId={card.workId} dispatchId={selected.id} initialStep={selected.id === initialDispatchId ? initialStep : undefined} lastStep={selected.id === card.latestDispatchId ? card.currentStep : undefined} />}</details>}
    {card.cardBranch && <dl className="cg-kv"><dt>{t('graphBranch')}</dt><dd className="mono">{card.cardBranch}</dd></dl>}
    {card.workPath && <><dl className="cg-kv"><dt>{t('graphCopy')}</dt><dd className="mono">{card.workPath}</dd></dl><p className="cg-copy-warning">{t('graphCopyWarning')}</p></>}
    <CardActions card={card} />
  </>;
}

function RecentDispatchSteps({ card, dispatch }: { card: CardNode; dispatch: Dispatch }) {
  const { t } = useI18n();
  const affects = useCallback((event: HelmEvent) => event.workId === card.workId && event.dispatchId === dispatch.id, [card.workId, dispatch.id]);
  const output = useResource<HelmEvent[]>('get-events', { workId: card.workId, dispatchId: dispatch.id }, affects);
  const steps = output.data?.filter(event => event.action === 'dispatch-step').slice(-3) ?? [];
  return <>{output.error && <ErrorNotice error={output.error} retry={output.reload} />}{steps.length > 0 && <ol className="cg-recent-log">{steps.map(event => { const step = event.details as { step: number; summary?: string }; return <li key={event.id}><span className="mono">{step.step}</span><span>{step.summary || t('conversationOutput')}</span></li>; })}</ol>}</>;
}
