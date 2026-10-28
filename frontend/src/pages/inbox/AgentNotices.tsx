import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { HelmEvent } from '../../shared/types.js';

interface AgentNotice { kind: string; agentId?: string; reason?: string; command?: string }
const affectsAgents = (event: HelmEvent) => event.object.type === 'agent';

export function AgentNotices() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<AgentNotice[]>('list-pending', {}, affectsAgents);
  const notices = data?.filter(item => item.kind === 'agent-unavailable' && item.agentId) ?? [];
  if (error) return <ErrorNotice error={error} retry={reload} />;
  if (!notices.length) return null;
  return <section aria-label={t('unavailable')}>
    <h2 className="sect">{t('agents')}<span className="count">{notices.length}</span></h2>
    {notices.map(notice => <div key={notice.agentId} className="error" role="status">
      <Link href={`/settings/agents/${encodeURIComponent(notice.agentId!)}`}>{notice.agentId} · {t('unavailable')}</Link>
      <span>{notice.reason}</span>{notice.command && <code>{notice.command}</code>}
    </div>)}
  </section>;
}
