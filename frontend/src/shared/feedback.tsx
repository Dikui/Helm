import { useI18n } from './i18n.js';
export function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  const { t } = useI18n();
  return <div className="error" role="alert"><span>{error.message}</span>{retry && <button className="btn sm" onClick={retry}>{t('retry')}</button>}</div>;
}
