import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
export function SaveFeedback({ error, saved }: { error?: Error; saved: boolean }) {
  const { t } = useI18n();
  return <div className="settings-feedback">{error && <ErrorNotice error={error} />}<span role="status">{saved ? t('saved') : ''}</span></div>;
}
