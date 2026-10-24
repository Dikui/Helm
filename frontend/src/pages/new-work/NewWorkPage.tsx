import { useI18n } from '../../shared/i18n.js';
export function NewWorkPage() {
  const { t } = useI18n();
  return <><header className="top"><h1>{t('newWork')}</h1></header><div className="page-body"><p className="muted">{t('pagePending')}</p></div></>;
}
