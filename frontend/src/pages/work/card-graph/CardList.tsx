import { AgentMark } from '../../../shared/AgentMark.js';
import { useResource } from '../../../shared/data.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n, type MessageKey } from '../../../shared/i18n.js';
import type { AgentEntry } from '../../settings/types.js';
import { cardStatusLabels, cardStatusTones } from '../../inbox/presentation.js';
import { AggregateBadge, nodeTitle, NodeStatus, ReadOnlyBadge } from './labels.js';
import { cardDisplayStatus, dispatchDuration, isLiveCardStatus, type CardFilter } from './presentation.js';
import type { CardNode, Dispatch, GraphNode } from './types.js';

const defaultGroups = ['decision', 'executing', 'verifying', 'verification-failed', 'blocked', 'waiting', 'ready', 'paused', 'completed', 'skipped', 'cancelled'];
export function CardList({ nodes, dispatches, select, filter }: { nodes: GraphNode[]; dispatches?: Dispatch[]; select: (id: string) => void; filter?: CardFilter }) {
  const { t } = useI18n();
  const now = useClock();
  const agents = useResource<AgentEntry[]>('list-agents');
  const cards = nodes.filter((node): node is CardNode => node.type === 'card');
  const labels: Record<string, MessageKey> = { ...cardStatusLabels, decision: 'inspectorNeedsDecision' };
  const status = (card: CardNode) => cardDisplayStatus(card, nodes, dispatches);
  const groups = cards.filter(card => isLiveCardStatus(status(card))).length > 4
    ? ['decision', 'verification-failed', 'executing', 'verifying', 'blocked', 'waiting', 'ready', 'paused', 'completed', 'skipped', 'cancelled'] : defaultGroups;
  const shown = cards.filter(card => {
    const value = status(card) === 'decision' ? 'blocked' : status(card);
    return !filter || (filter === 'other' ? !isLiveCardStatus(value) : value === filter);
  });
  return <div className="work-card-list">
    {!shown.length && <p className="muted">{t('graphEmpty')}</p>}
    {groups.map(group => {
      const members = shown.filter(card => status(card) === group);
      return members.length > 0 && <section key={group} aria-label={t(labels[group]!)}>
        <h3>{t(labels[group]!)} · {members.length}</h3>
        <div className="work-card-rows">{members.map(card => {
          const history = dispatches?.filter(dispatch => dispatch.cardId === card.id);
          const latest = history?.find(dispatch => dispatch.id === card.latestDispatchId);
          const driver = agents.data?.find(agent => agent.id === (latest?.agentId ?? card.agentId))?.driver;
          const pending = card.dependencies.map(ref => nodes.find(node => node.id === ref.id)).find(node => node?.type === 'gate' && node.status === 'pending');
          const detail = pending ? nodeTitle(pending) : latest?.conclusionReason || card.latestStepSummary;
          const label = `${t(labels[group]!)}${detail ? ` · ${detail}` : ''}`;
          const ordinal = cards.findIndex(item => item.id === card.id) + 1;
          return <button type="button" key={card.id} className={`work-card-row ${group === 'decision' ? 'blocked' : cardStatusTones[group] ?? ''}`} aria-label={`${t('graphCard')} ${ordinal}：${nodeTitle(card)}`} title={`${nodeTitle(card)} · ${label}`} onClick={() => select(card.id)}>
            <AgentMark driver={driver} /><span className="work-card-number">#{ordinal}</span>
            <span className="work-card-title">{nodeTitle(card)}{card.aggregate && <AggregateBadge />}{card.readOnly && <ReadOnlyBadge />}</span>
            <time>{history?.some(dispatch => dispatch.startedAt) ? elapsed(new Date(0).toISOString(), dispatchDuration(history, now)) : '—'}</time>
            <span className="work-card-detail">{group === 'skipped' ? <NodeStatus node={card} /> : label}</span>
          </button>;
        })}</div>
      </section>;
    })}
  </div>;
}
