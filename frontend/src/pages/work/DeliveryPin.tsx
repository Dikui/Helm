import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { GatePin } from './GatePin.js';
import type { WorkDeliveryState } from './useWorkDelivery.js';

export function DeliveryPin({ delivery: d }: { delivery: WorkDeliveryState }) {
  const { t } = useI18n();
  if (!d.visible || d.solving || d.pushing || !d.failedPush && d.work.status !== 'accepted') return null;
  const title = d.failedPush ? 'deliveryPushFailed' : d.manual ? 'deliveryPinManual' : d.resolved ? 'deliveryPinResolved'
    : d.conflict ? 'deliveryPinConflict' : d.failedMerge ? 'deliveryPinMergeFailed' : 'accepted';
  const reason = d.failedPush ? d.work.delivery?.push?.reason : d.failedMerge ? d.merge?.reason : undefined;
  return <GatePin label={t('deliveryTitle')} source={t(d.failedPush || d.failedMerge ? 'pinRetry' : d.manual || d.conflict && !d.resolved ? 'deliveryPinHandle' : 'deliveryPinDeliver')}
    title={t(title)} tone={d.failedPush || d.failedMerge ? 'failure' : 'attention'} busy={d.inFlight}
    reason={reason && <pre>{reason}</pre>}>
    {d.failedPush ? <button disabled={d.inFlight} aria-keyshortcuts="1" onClick={event => d.open('push', event.currentTarget)}><kbd aria-hidden="true">1</kbd>{t('deliveryPinRetryPush')}</button>
      : d.manual ? <button disabled={d.inFlight} aria-keyshortcuts="1" onClick={() => void d.run('recheck-work-merge')}><kbd aria-hidden="true">1</kbd>{t('deliveryRecheck')}</button>
      : d.resolved ? <>
        <button disabled={d.inFlight} aria-keyshortcuts="1" onClick={event => d.open('changes', event.currentTarget)}><kbd aria-hidden="true">1</kbd>{t('deliveryPinChanges')}</button>
        <button disabled={d.inFlight} aria-keyshortcuts="2" onClick={() => void d.run('merge-work')}><kbd aria-hidden="true">2</kbd>{t('deliveryMergeAgain')}</button>
      </> : d.conflict ? <>
        <button disabled={d.inFlight} aria-keyshortcuts="1" onClick={() => void d.run('resolve-merge-conflict', { resolution: 'coordinator' })}><kbd aria-hidden="true">1</kbd>{t('deliveryPinCoordinator')}</button>
        <button disabled={d.inFlight} aria-keyshortcuts="2" onClick={() => void d.run('resolve-merge-conflict', { resolution: 'manual' })}><kbd aria-hidden="true">2</kbd>{t('deliverySelf')}</button>
      </> : <>
        <button disabled={d.inFlight} aria-keyshortcuts="1" onClick={() => void d.run('merge-work')}><kbd aria-hidden="true">1</kbd>{t(d.failedMerge ? 'retryMerge' : 'mergeWork')}</button>
        {!d.failedMerge && <button disabled={d.inFlight} aria-keyshortcuts="2" onClick={() => void d.run('withdraw-acceptance')}><kbd aria-hidden="true">2</kbd>{t('withdrawAcceptance')}</button>}
      </>}
    {d.error && !d.panel && <ErrorNotice error={d.error} />}
    {d.notContained && d.manual && <p role="status">{t('deliveryNotContained')}</p>}
  </GatePin>;
}
