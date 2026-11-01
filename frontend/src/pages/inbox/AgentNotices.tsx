import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { HelmEvent } from '../../shared/types.js';

interface AgentNotice { kind: string; agentId?: string; reason?: string; command?: string }
const affectsAgents = (event: HelmEvent) => event.object.type === 'agent';

export function AgentNotices({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<AgentNotice[]>('list-pending', {}, affectsAgents);
  const notices = data?.filter(item => item.kind === 'agent-unavailable' && item.agentId) ?? [];
  if (error) return <ErrorNotice error={error} retry={reload} />;
  if (!notices.length) return null;
  return <Link className={compact ? 'rail-alert' : 'inbox-cli-alert'} href="/settings/environment" aria-label={t('inboxCliAlert')}
    title={notices.map(notice => [notice.agentId, notice.reason, notice.command].filter(Boolean).join(' · ')).join('\n')}>
    <span aria-hidden="true">●</span>{!compact && <span>{notices.map(notice => notice.reason || `${notice.agentId} · ${t('unavailable')}`).join(' · ')}</span>}
  </Link>;
}
