import { AgentMark } from '../../shared/AgentMark.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';
import type { Work } from '../../shared/types.js';
import type { AgentEntry } from '../settings/types.js';
import { cardStatusLabels, cardStatusTones } from '../inbox/presentation.js';
import type { WorkDescription } from './aligning/types.js';
import { nodeTitle } from './card-graph/labels.js';
import { cardDisplayStatus, isLiveCardStatus, liveCardStatuses, type CardFilter } from './card-graph/presentation.js';
import type { CardNode, Dispatch, GraphNode } from './card-graph/types.js';
import { headline, visibleSteps } from './conversation/RoundProgress.js';
import type { Round, Rounds, RoundStep } from './conversation/types.js';
import type { Inspection } from './useWorkInspector.js';
import type { useWorkReview } from './brief/useWorkReview.js';
import './now-strip.css';

export function NowStrip({ work, inspection, filter, choose, chooseCards, pushing, report }: {
  work: Work; inspection: Inspection; filter?: CardFilter;
  choose: (inspection: Inspection) => void; chooseCards: (filter: CardFilter) => void; pushing: boolean; report: ReturnType<typeof useWorkReview>;
}) {
  const { t } = useI18n();
  const params = { workId: work.id };
  const graph = useResource<GraphNode[]>('get-card-graph', params);
  const dispatches = useResource<Dispatch[]>('list-dispatches', params);
  const rounds = useResource<Rounds>('list-rounds', params);
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', params);
  const agents = useResource<AgentEntry[]>('list-agents');
  const nodes = graph.data ?? [];
  const cards = nodes.filter((node): node is CardNode => node.type === 'card');
  const status = (card: CardNode) => {
    const value = cardDisplayStatus(card, nodes, dispatches.data);
    return value === 'decision' ? 'blocked' : value;
  };
  const label = (card: CardNode) => t(cardDisplayStatus(card, nodes, dispatches.data) === 'decision'
    ? card.dependencies.some(ref => nodes.some(node => node.id === ref.id && node.type === 'gate' && node.kind === 'git-initialization' && node.status === 'pending')) ? 'nowAwaitingGit' : 'inspectorNeedsDecision'
    : cardStatusLabels[status(card)]!);
  const live = cards.filter(card => isLiveCardStatus(status(card)));
  const other = cards.length - live.length;
  const running = rounds.data?.rounds.find(round => round.status === 'running');
  const latestRound = running ?? rounds.data?.rounds.at(-1);
  const pending = !['paused', 'completed', 'cancelled'].includes(work.status) ? nodes.find(node => node.type === 'gate' && node.status === 'pending') : undefined;
  const gate = pending?.type === 'gate' ? pending : undefined;
  const review = work.status === 'awaiting-review' || gate?.kind === 'review';
  const delivery = ['accepted', 'merge-queued', 'merging', 'completed'].includes(work.status)
    || Boolean(work.delivery?.merge || work.delivery?.push || work.delivery?.resolution || work.delivery?.completedWithoutMerge);
  const deliveryState: MessageKey = pushing ? 'nowPushing' : work.delivery?.push?.status === 'failed' ? 'nowPushFailed'
    : work.status === 'completed' ? work.delivery?.completedWithoutMerge ? 'nowWithoutMerge'
    : work.delivery?.push?.status === 'pushed' ? 'nowPushed' : work.delivery?.merge?.status === 'already-contained' ? 'nowContained'
    : work.delivery?.merge?.status === 'merged' ? 'nowMerged' : 'nowReadOnly'
    : work.status === 'merge-queued' || work.status === 'merging' ? work.status
    : work.delivery?.resolution?.status === 'solving' ? 'deliverySolving'
    : work.delivery?.resolution?.status === 'manual' ? 'deliveryManual'
    : work.delivery?.resolution?.status === 'resolved' ? 'deliveryResolved'
    : work.delivery?.merge?.status === 'conflict' ? 'deliveryConflict'
    : work.delivery?.merge?.status === 'failed' ? 'deliveryMergeFailed' : 'nowAwaitingMerge';
  const deliveryTone = work.delivery?.push?.status === 'failed' ? 'bad' : pushing || ['merge-queued', 'merging'].includes(work.status) || work.delivery?.resolution?.status === 'solving' ? 'run'
    : work.status === 'completed' ? 'quiet' : 'att';
  const reviewGate = report.gate ?? nodes.filter(node => node.type === 'gate').findLast(node => node.kind === 'review');
  const verdict = reviewGate?.report?.verdict;
  const verdictLabels = { accept: 'reportAccept', reservations: 'reportReservations', return: 'reportReturn' } as const;
  const version = descriptions.data?.at(-1)?.version;
  const reportSelected = inspection === 'report' && work.status !== 'aligning';
  const decidedEvent = report.events.data?.findLast(event => event.action === 'gate-decided'
    && nodes.some(node => node.id === event.object.id && node.type === 'gate' && node.kind === 'general' && node.status === 'decided'));
  const decided = nodes.find(node => node.id === decidedEvent?.object.id);
  let notice: { title: MessageKey; detail: string; target: Inspection; tone?: string; idle?: MessageKey } | undefined;
  if (delivery) notice = { title: 'inspectorDelivery', detail: t(deliveryState), target: 'delivery', tone: deliveryTone, idle: deliveryState === 'nowAwaitingMerge' ? 'nowWaitingMerge' : deliveryState };
  else if (reportSelected && (report.conversation.error || report.events.error)) notice = { title: 'reviewReport', detail: t('nowReportFailed'), target: 'report', tone: 'bad', idle: 'nowReportReadFailed' };
  else if (reportSelected && (!report.conversation.data || !report.events.data)) notice = { title: 'reviewReport', detail: t('nowReportLoading'), target: 'report', idle: 'nowReportReading' };
  else if (review) notice = { title: 'nowAwaitingReview', detail: t(verdict ? verdictLabels[verdict] : 'nowLegacyReport'), target: 'report', tone: 'att', idle: 'nowReportSubmitted' };
  else if (reviewGate?.decision === 'return') notice = { title: 'nowReviewReturned', detail: t('nowReturnedHint'), target: 'report', idle: 'nowWaitingReturn' };
  else if (report.invalid) notice = { title: 'reviewReport', detail: t('nowReportIncomplete'), target: 'report', idle: 'nowReportNeedsFields' };
  else if (work.status === 'aligning' && running) notice = { title: 'nowBriefUpdating', detail: `${t('brief')}${version ? ` v${version}` : ''}`, target: 'spec', tone: 'run' };
  else if (gate) notice = { title: gate.kind === 'work-confirmation' ? 'nowAwaitingConfirmation' : gate.kind === 'git-initialization' ? 'nowGitDecision' : 'inspectorNeedsDecision',
    detail: gate.kind === 'work-confirmation' ? `${t('brief')}${version ? ` v${version}` : ''}` : gate.question,
    target: gate.kind === 'work-confirmation' ? 'spec' : `card:${gate.id}`, tone: 'att', idle: gate.kind === 'work-confirmation' ? 'nowDraftReady' : gate.kind === 'git-initialization' ? 'nowWaitingGit' : 'nowWaitingDecision' };
  else if (reportSelected || reviewGate) notice = { title: 'reviewReport', detail: t(reviewGate ? 'nowLegacyReport' : 'nowReportUnsubmitted'), target: 'report', idle: reviewGate ? undefined : 'nowWaitingReport' };
  else if (decided?.type === 'gate') notice = { title: 'nowGateDecided', detail: decided.decision ?? decided.question, target: `card:${decided.id}` };
  if (work.status === 'paused' && !reportSelected) notice = undefined;
  const idle: MessageKey | undefined = work.status === 'paused' ? 'paused' : work.status === 'cancelled' ? 'cancelled' : notice?.idle;
  const showStructure = work.status !== 'aligning' && (cards.length > 0 || Boolean(rounds.data?.rounds.length) || Boolean(notice));
  const currentSteps = visibleSteps(rounds.data?.currentSteps ?? []);
  const latestStep = currentSteps.at(-1);
  const plan = rounds.data?.currentPlan ?? [];
  const position = Math.min(plan.length, plan.filter(entry => entry.status === 'completed').length + 1);
  const current = plan.find(entry => entry.status === 'in_progress') ?? plan[position - 1];
  const progress = plan.length ? `${t('nowPlanPosition').replace('{current}', String(position)).replace('{total}', String(plan.length))} · ${current?.content ?? ''}`
    : latestStep ? `${t('conversationFoldedSteps').replace('{count}', String(currentSteps.length))} · ${headline(latestStep, t)}`
    : `${t('nowNoSteps')} · ${t('conversationWaitingFirstOutput')}`;
  const driver = (card: CardNode) => agents.data?.find(agent => agent.id === (dispatches.data?.find(dispatch => dispatch.id === card.latestDispatchId)?.agentId ?? card.agentId))?.driver;
  const ordinal = (card: CardNode) => cards.findIndex(item => item.id === card.id) + 1;
  const cardTitle = (card: CardNode) => `#${ordinal(card)} · ${nodeTitle(card)} · ${label(card)}`;
  return <>
    <nav className="now-strip" aria-label={t('nowStrip')}>
      <div className="now-scroll"><button type="button" className="now-cell now-coordinator" aria-pressed={inspection === 'coord'} onClick={() => choose('coord')}>
        <span className="now-avatar" aria-hidden="true">{t('nowCoordinatorMark')}</span><span><b>{t('alignmentCoordinator')}</b>
          {running ? <small title={progress}>{progress}</small> : idle ? <small title={idle === 'nowDraftReady' && version ? `v${version} · ${t(idle)}` : t(idle)}>{idle === 'nowDraftReady' && version ? `v${version} · ${t(idle)}` : t(idle)}</small>
            : latestRound ? <EndedProgress workId={work.id} round={latestRound} fallback={t(live.length ? 'nowWaitingCards' : 'conversationIdle')} />
            : <small>{rounds.data ? t('nowNoRounds') : t('loading')}</small>}
        </span>
      </button>
      {notice && <button type="button" title={`${t(notice.title)} · ${notice.detail}`} className={`now-cell now-notice ${notice.tone ?? ''}`} aria-label={notice.target === 'delivery' ? t('inspectorDelivery') : undefined} aria-pressed={inspection === notice.target} onClick={() => choose(notice.target)}>
        <span><b>{t(notice.title)}</b><small>{notice.detail}</small></span>
      </button>}
      {live.length > 4 ? liveCardStatuses.map(group => {
        const members = live.filter(card => status(card) === group);
        return members.length > 0 && <button type="button" key={group} className={`now-cell now-group ${cardStatusTones[group]}`} aria-pressed={filter === group} title={members.map(cardTitle).join('\n')} onClick={() => chooseCards(group)}>
          <span className="now-agent-stack">{members.map(card => <AgentMark key={card.id} driver={driver(card)} />)}</span>
          <span><b>{t(cardStatusLabels[group]!)} × {members.length}</b><small>{members.map(card => `#${ordinal(card)}`).join(' ')}</small></span>
        </button>;
      }) : live.map(card => <button type="button" key={card.id} className={`now-cell ${cardStatusTones[status(card)]}`} aria-pressed={inspection === `card:${card.id}`} title={cardTitle(card)} onClick={() => choose(`card:${card.id}`)}>
        <AgentMark driver={driver(card)} /><span><b>#{ordinal(card)}</b><small>{label(card)}</small></span>
      </button>)}
      {other > 0 && <button type="button" className="now-cell quiet" aria-pressed={filter === 'other'} title={t('nowOtherCards').replace('{count}', String(other))} onClick={() => chooseCards('other')}>+{other}</button>}
      </div><div className="now-fixed">
      <button type="button" className="now-cell quiet" aria-label={t('brief')} aria-pressed={inspection === 'spec'} onClick={() => choose('spec')}>{t('nowSpec')}{version ? ` v${version}` : ''}</button>
      {showStructure && <button type="button" className="now-cell quiet" aria-pressed={['list', 'graph', 'timeline', 'rounds', 'events'].includes(inspection) && !filter} onClick={() => choose('list')}>{t('structure')}</button>}
      </div>
    </nav>
    {[graph, dispatches, rounds, descriptions, agents].map((resource, index) => resource.error && <ErrorNotice key={index} error={resource.error} retry={resource.reload} />)}
  </>;
}

function EndedProgress({ workId, round, fallback }: { workId: string; round: Round; fallback: string }) {
  const { t } = useI18n();
  const output = useResource<RoundStep[] | { status: 'deleted' }>('get-round-output', { workId, roundId: round.id });
  const latest = Array.isArray(output.data) ? visibleSteps(output.data).at(-1) : undefined;
  const text = latest ? `${t('nowRoundEnded')} · ${t('conversationLatest')}${headline(latest, t)}` : fallback;
  return <small title={text}>{text}</small>;
}
