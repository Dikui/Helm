import { useI18n } from '../../shared/i18n.js';
import type { Gate } from '../../shared/types.js';

export function GitInitializationDetails({ gate }: { gate: Gate }) {
  const { t, language } = useI18n();
  const details = gate.gitInitialization;
  if (!details) return null;
  const number = (value: number) => value.toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
  return <div className="git-initialization-details">
    <p>{t('gitInitHint')}</p>
    <code>{details.projectPath}</code>
    <dl className="brief-preview"><dt>{t('gitInitFiles')}</dt><dd>{number(details.fileCount)}</dd>
      <dt>{t('gitInitSize')}</dt><dd>{number(details.totalBytes)} B</dd></dl>
    <p className="hint">{t(details.hasGitignore ? 'gitInitExistingIgnore' : 'gitInitEstimate')}</p>
    {details.suspiciousPaths.length > 0 && <details open><summary>{t('gitInitSuspicious')}</summary>
      <ul>{details.suspiciousPaths.map(item => <li key={item.path}><code>{item.path}</code> · {t(item.reason === 'secret' ? 'gitInitSecret' : item.reason === 'dependency' ? 'gitInitDependency' : 'gitInitLarge')} · {number(item.bytes)} B</li>)}</ul>
    </details>}
    {gate.status !== 'pending' && <><p>{t(details.initialized ? details.existingRepository ? 'gitInitAlreadyInitialized' : 'gitInitCompleted' : 'gitInitRefused')}</p>
      {gate.comment && <p>{gate.comment}</p>}</>}
    {(gate.status !== 'pending' || details.hasGitignore) && <details><summary>{t('gitInitIgnoreRules')}</summary><pre>{details.ignoreRules}</pre></details>}
  </div>;
}
