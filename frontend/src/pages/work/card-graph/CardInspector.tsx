import { systemValueLabel } from '../../../shared/system-labels.js';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../shared/i18n.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import { AgentMark } from '../../../shared/AgentMark.js';
import { DispatchArtifacts, DispatchDetails } from './DispatchDetails.js';
import { CardActions } from './CardActions.js';
import { AggregateBadge, conclusionLabels, DispatchStatus, nodeTitle, NodeStatus, ReadOnlyBadge } from './labels.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { cardDisplayStatus, dispatchDuration } from './presentation.js';
import { cardStatusLabels, cardStatusTones } from '../../inbox/presentation.js';
import { formatInspectorUsage, inspectorUsage, UsageSummary, UsageTable } from './TokenDetails.js';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import type { HelmEvent } from '../../../shared/types.js';
import type { AgentEntry } from '../../settings/types.js';
import type { CardNode, Dispatch, GraphNode } from './types.js';

export function CardInspector({ card, number, nodes, agents, select, selectTokens, initialTokens, dispatches, initialDispatchId, initialStep }: {
  card: CardNode; number: number; nodes: GraphNode[]; agents?: AgentEntry[]; select: (id: string) => void; selectTokens: (id: string) => void; initialTokens?: boolean;
  dispatches?: Dispatch[]; initialDispatchId?: string; initialStep?: number;
}) {
  const { t, language } = useI18n();
  const now = useClock();
  const files = useWorkFiles(card.workId);
  const preview = useFilePreview(card.workId);
  const [chosen, choose] = useState<string | null>(initialDispatchId ?? null);
  const selected = dispatches?.find(dispatch => dispatch.id === chosen) ?? dispatches?.at(-1);
  const latest = dispatches?.at(-1);
  const loops = sendBackDispatchIds(dispatches ?? []);
  const [detailOpen, setDetailOpen] = useState(Boolean(initialDispatchId || initialStep));
  const tokens = useRef<HTMLElement>(null);
  const [tokenMode, setTokenMode] = useState(Boolean(initialTokens));
  const detail = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (initialTokens) { tokens.current?.scrollIntoView?.({ block: 'start' }); tokens.current?.focus({ preventScroll: true }); }
  }, [card.id, initialTokens, Boolean(dispatches)]);
  const agent = agents?.find(agent => agent.id === card.agentId);
  const status = cardDisplayStatus(card, nodes, dispatches);
  const gates = card.dependencies.flatMap(ref => nodes.filter(node => node.id === ref.id && node.type === 'gate' && node.status === 'pending'));
  const usage = inspectorUsage(dispatches ?? []);
  const affects = useCallback((event: HelmEvent) => event.workId === card.workId && (!event.dispatchId || event.dispatchId === selected?.id), [card.workId, selected?.id]);
  const showDispatch = (id: string) => { setTokenMode(false); choose(id); setDetailOpen(true); detail.current?.scrollIntoView?.({ block: 'nearest' }); detail.current?.querySelector('summary')?.focus({ preventScroll: true }); };
  const refButton = (id: string) => {
    const node = nodes.find(node => node.id === id);
    const ordinal = nodes.filter(node => node.type === 'card').findIndex(node => node.id === id) + 1;
    return node ? <button className="ref" key={id} title={nodeTitle(node)} aria-label={`${t(node.type === 'card' ? 'graphCard' : 'graphGate')} ${node.type === 'card' ? ordinal : ''}：${nodeTitle(node)}`} onClick={() => select(id)}>{node.type === 'card' ? `#${ordinal}` : nodeTitle(node)}</button> : null;
  };
  const tokensView = <section ref={tokens} tabIndex={-1} className="cg-usage" aria-label={t('tokenDispatches')}>
        <nav className="cg-token-cards" aria-label={t('inspectorTokenCardChoice')}>{nodes.filter(node => node.type === 'card').map((node, index) => ({ node, index })).sort((a, b) => Number(b.node.id === card.id) - Number(a.node.id === card.id)).map(({ node, index }) => <button key={node.id} aria-label={`${t('graphCard')} ${index + 1}`} aria-pressed={node.id === card.id} onClick={() => selectTokens(node.id)}>#{index + 1}</button>)}</nav>
        <h3 className="sect">{t('tokenDispatches')}</h3>
        {dispatches ? <><UsageSummary usage={usage} /><UsageTable kind="dispatch" select={showDispatch} rows={dispatches.map((dispatch, index) => ({ ...dispatch, label: `#${index + 1} · ${t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}${loops.has(dispatch.id) ? ` · ↺${[...loops].indexOf(dispatch.id) + 1}` : ''}${dispatch.status !== 'ended' ? ` · ${t(dispatch.status === 'queued' ? 'graphQueued' : 'structureRunning')}` : dispatch.conclusion === 'failed' ? ` · ${t('graphReportedFailed')}` : ''}` }))} /></> : <p role="status">{t('loading')}</p>}
      </section>;
  if (tokenMode) return <div className="card-inspector"><header className="cg-inspector-head"><small className="muted">{t('graphCard')} {number} · Token</small><h2>{nodeTitle(card)}</h2><button className="cg-text-link" onClick={() => setTokenMode(false)}>{t('graphInspector')}</button></header><div className="cg-inspector-body">{tokensView}</div></div>;
  return <div className="card-inspector">
    <header className="cg-inspector-head"><small className="muted">{t('graphCard')} {number}</small><h2>{nodeTitle(card)}</h2>
      <div className="row cg-card-identity">
        {card.status === 'skipped' ? <NodeStatus node={card} /> : <span className={`pill ${status === 'decision' ? 'att' : cardStatusTones[status] ?? ''}`}>{t(status === 'decision' ? 'inspectorNeedsDecision' : cardStatusLabels[status]!)}</span>}
        {loops.size > 0 && <span className="cg-rework">↺ {t('graphSendBackPrefix')} {loops.size} {t('graphSendBackSuffix')}</span>}
        {card.readOnly && <ReadOnlyBadge />}{card.aggregate && <AggregateBadge />}
        <span className="cg-agent"><AgentMark driver={agent?.driver} /><span>{card.agentId ? [card.agentId, agent?.model, agent?.reasoningEffort].filter(Boolean).join(' · ') : t('graphNoAgent')}</span></span>
      </div>
    </header>
    <div className="cg-inspector-body">
      <dl className="cg-kv"><dt>{t('graphDependency')}</dt><dd>{card.dependencies.length ? card.dependencies.map(ref => refButton(ref.id)) : '—'}</dd>
        <dt>{t('graphDownstream')}</dt><dd>{nodes.some(node => node.dependencies.some(ref => ref.id === card.id)) ? nodes.filter(node => node.dependencies.some(ref => ref.id === card.id)).map(node => refButton(node.id)) : '—'}</dd>
        <dt>{t('inspectorDuration')}</dt><dd>{dispatches ? elapsed(new Date(0).toISOString(), dispatchDuration(dispatches, now)) : '—'} · {t('inspectorDispatchDuration')}</dd>
        <dt>Token</dt><dd>{formatInspectorUsage(usage, language)} <button className="cg-text-link" onClick={() => setTokenMode(true)}>{t('inspectorByDispatch')}</button></dd>
      </dl>
      {status === 'decision' && <p className="cg-blocked-notice">{t('inspectorWaitingDecision')} {gates.map(gate => nodeTitle(gate)).join(' · ')}</p>}
      {status === 'blocked' && latest?.conclusionReason && <p className="cg-blocked-notice">{latest.conclusionReason}</p>}
      {card.status === 'waiting' && !gates.length && <p className="hint">{t('inspectorWaitingDependencies')}</p>}
      <section aria-label={t('inspectorRecentSteps')}><h3 className="sect">{t('inspectorRecentSteps')}</h3>
        {!dispatches ? <p role="status">{t('loading')}</p> : latest ? <RecentDispatchSteps card={card} dispatch={latest} /> : <p className="muted">{t('graphNoSteps')}</p>}
      </section>
      <section aria-label={t('graphDispatches')}><h3 className="sect">{t('graphDispatches')} <span className="count">{dispatches?.length ?? '—'}</span></h3>
        {!dispatches ? <p role="status">{t('loading')}</p> : !dispatches.length ? <p className="muted">{t('graphNoDispatches')}</p> : <ol className="cg-history">
          {dispatches.map((dispatch, index) => <Fragment key={dispatch.id}>
            {loops.has(dispatch.id) && <li className="cg-loop"><span className="cg-history-dot" aria-hidden="true">↺</span><span>{t('graphLoop')}</span></li>}
            <li className={dispatch.conclusion === 'failed' ? 'cg-failed' : ''}>
              <span className={`cg-history-dot ${dispatch.status === 'queued' ? '' : dispatch.conclusion === 'failed' || (dispatch.status === 'ended' && dispatch.endReason !== 'completed') ? 'bad' : dispatch.status === 'ended' ? 'ok' : 'run'}`} aria-hidden="true">{dispatch.status === 'running' ? <span className="spin" /> : dispatch.status === 'queued' ? '·' : dispatch.conclusion === 'failed' || dispatch.endReason !== 'completed' ? '✗' : '✓'}</span>
              <div className="cg-history-entry"><div className="row"><button className="cg-history-select" aria-pressed={selected?.id === dispatch.id} onClick={() => showDispatch(dispatch.id)}>{t('graphDispatch')} #{index + 1} · {t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}</button>
                <DispatchStatus dispatch={dispatch} /><time className="mono">{elapsed(dispatch.startedAt ?? dispatch.createdAt, dispatch.endedAt ? Date.parse(dispatch.endedAt) : now)}</time></div>
                <span className="muted">{dispatch.agentId} · {dispatch.status === 'ended' ? t(conclusionLabels[dispatch.conclusion]) : '—'}</span>
                {dispatch.conclusionReason && <p className={dispatch.conclusion === 'failed' ? 'cg-why' : 'cg-prose'}>{dispatch.conclusionReason}</p>}
                <time className="muted" dateTime={dispatch.startedAt ?? dispatch.createdAt}>{new Date(dispatch.startedAt ?? dispatch.createdAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en')}</time>
              </div>
            </li>
          </Fragment>)}
        </ol>}
      </section>
      {selected && <><DispatchArtifacts key={selected.id} workId={card.workId} dispatchId={selected.id} affects={affects} />
        <div className="row"><button className="btn sm" onClick={() => showDispatch(selected.id)}>{t('inspectorFullOutput')}</button></div>
        <details ref={detail} className="cg-dispatch-fold" open={detailOpen} onToggle={event => setDetailOpen(event.currentTarget.open)}><summary>{t('graphDispatchDetail')}</summary>{detailOpen && <DispatchDetails key={selected.id} workId={card.workId} dispatchId={selected.id} initialStep={selected.id === initialDispatchId ? initialStep : undefined} lastStep={selected.id === card.latestDispatchId ? card.currentStep : undefined} showArtifacts={false} />}</details></>}
      <details className="cg-card-description"><summary>{t('inspectorCardDescription')}</summary><Markdown text={card.content} workId={card.workId} files={files} onOpen={preview.open} />
      </details>
      {card.autoFlow && <p className="cg-prose">{card.autoFlow.verifications.length
          ? t('graphAutoFlow').replace('{count}', String(card.autoFlow.verifications.length)).replace('{agents}', card.autoFlow.verifications.map(vote => vote.agentId).join(', '))
          : t(card.needsVerification ? 'graphAutoFlowManualVerification' : 'graphAutoFlowExecution')}</p>}
      <section aria-label={t('inspectorBranchCopy')}><h3 className="sect">{t('inspectorBranchCopy')}</h3>
        <dl className="cg-kv"><dt>{t('graphBranch')}</dt><dd className="mono">{card.cardBranch ?? '—'}</dd><dt>{t('graphCopy')}</dt><dd className="mono">{card.workPath ?? '—'}</dd></dl>
        {card.workPath && <p className="cg-copy-warning">{t('graphCopyWarning')}</p>}
        <CardActions card={card} />
      </section>

      {tokensView}
    </div>
    {preview.preview}
  </div>;
}

function RecentDispatchSteps({ card, dispatch }: { card: CardNode; dispatch: Dispatch }) {
  const { t, language } = useI18n();
  const affects = useCallback((event: HelmEvent) => event.workId === card.workId && event.dispatchId === dispatch.id, [card.workId, dispatch.id]);
  const output = useResource<HelmEvent[]>('get-events', { workId: card.workId, dispatchId: dispatch.id }, affects);
  const steps = output.data?.filter(event => event.action === 'dispatch-step').slice(-3) ?? [];
  return <>{output.error && <ErrorNotice error={output.error} retry={output.reload} />}
    {!output.data ? !output.error && <p role="status">{t('loading')}</p> : !steps.length ? <p className="muted">{card.latestStepSummary ? systemValueLabel(card.latestStepSummary, t) : t('graphNoSteps')}</p> : <ol className="cg-recent-log">{steps.map(event => { const step = event.details as { step: number; summary?: string }; return <li key={event.id}><time dateTime={event.time}>{new Date(event.time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time><span>{step.summary ? systemValueLabel(step.summary, t) : t('conversationOutput')}</span></li>; })}</ol>}
  </>;
}
