import { useResource } from '../../shared/data.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { Settings } from '../../shared/types.js';
import type { ActionWork } from './WorkActions.js';
import './work-actions.css';

interface OutputSettings extends Settings { outputTotalBytes: number; outputThresholdBytes: number; outputThresholdExceeded: boolean }
export function OutputWarning() {
  const { t, language } = useI18n();
  const { data, error, reload } = useResource<OutputSettings>('get-settings');
  if (error) return <div className="output-warning error" role="status"><span>{t('outputUsageReadFailed')}: {error.message}</span><button className="btn sm" onClick={reload}>{t('retry')}</button></div>;
  if (!data?.outputThresholdExceeded) return null;
  const number = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US');
  return <section className="output-warning" aria-label={t('outputWarning')}>
    <p role="status">{t('outputThresholdExceeded')} <span className="mono">{number.format(data.outputTotalBytes)} B / {number.format(data.outputThresholdBytes)} B</span></p>
    <Link href="/settings/runtime">{t('adjustOutputThreshold')}</Link>
    <EndedOutputs />
  </section>;
}
function EndedOutputs() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<ActionWork[]>('list-works');
  const works = data?.filter(work => (work.status === 'completed' || work.status === 'cancelled') && !work.outputsDeletedAt);
  return <div className="row"><span>{t('manageEndedOutputs')}</span>
    {error && <div className="error" role="status"><span>{error.message}</span><button className="btn sm" onClick={reload}>{t('retry')}</button></div>}
    {!data && !error && <span>{t('loading')}</span>}
    {works?.map(work => <Link key={work.id} href={`/works/${encodeURIComponent(work.id)}`}>{work.title || t('untitled')}</Link>)}
    {works?.length === 0 && <span className="muted">{t('noEndedOutputs')}</span>}
  </div>;
}
