import { Fragment, useState } from 'react';
import { useI18n } from '../../../shared/i18n.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { DispatchDetails } from './DispatchDetails.js';
import { CardActions } from './CardActions.js';
import { conclusionLabels, DispatchStatus } from './labels.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import type { CardNode, Dispatch } from './types.js';

export function CardInspector({ card, dispatches, initialDispatchId, initialStep }: { card: CardNode; dispatches?: Dispatch[]; initialDispatchId?: string; initialStep?: number }) {
  const { t, language } = useI18n();
  const now = useClock();
  const [chosen, choose] = useState<string | null>(initialDispatchId ?? null);
  const selected = dispatches?.find(dispatch => dispatch.id === chosen) ?? dispatches?.at(-1);
  const loops = sendBackDispatchIds(dispatches ?? []);
  return <>
    <h3>{t('graphDispatches')}</h3>
    {!dispatches ? <p role="status">{t('loading')}</p> : !dispatches.length ? <p className="muted">{t('graphNoDispatches')}</p> : <ol className="cg-history">
      {dispatches.map((dispatch, index) => <Fragment key={dispatch.id}>
        {loops.has(dispatch.id) && <li className="cg-loop">{t('graphLoop')}</li>}
        <li className={dispatch.conclusion === 'failed' ? 'cg-failed' : ''}>
          <button className="cg-history-select" aria-pressed={selected?.id === dispatch.id} onClick={() => choose(dispatch.id)}>{t('graphDispatch')} #{index + 1} · {t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}</button>
          <div className="row"><DispatchStatus dispatch={dispatch} /><span className="mono">{elapsed(dispatch.startedAt ?? dispatch.createdAt, dispatch.endedAt ? Date.parse(dispatch.endedAt) : now)}</span></div>
          <span className="muted">{dispatch.agentId} · {dispatch.status === 'ended' ? t(conclusionLabels[dispatch.conclusion]) : '—'}</span>
          {dispatch.conclusionReason && <p className="cg-prose">{dispatch.conclusionReason}</p>}
          <time className="muted" dateTime={dispatch.startedAt ?? dispatch.createdAt}>{new Date(dispatch.startedAt ?? dispatch.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en')}</time>
        </li>
      </Fragment>)}
    </ol>}
    {selected && <DispatchDetails key={selected.id} workId={card.workId} dispatchId={selected.id} initialStep={selected.id === initialDispatchId ? initialStep : undefined} lastStep={selected.id === card.latestDispatchId ? card.currentStep : undefined} />}
    {card.cardBranch && <dl className="cg-kv"><dt>{t('graphBranch')}</dt><dd className="mono">{card.cardBranch}</dd></dl>}
    {card.workPath && <><dl className="cg-kv"><dt>{t('graphCopy')}</dt><dd className="mono">{card.workPath}</dd></dl><p className="cg-copy-warning">{t('graphCopyWarning')}</p></>}
    <CardActions card={card} />
  </>;
}
