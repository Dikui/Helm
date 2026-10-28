import { useRef, useState } from 'react';
import type { ReviewReport as Report } from '../../../../../src/review-report.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import { useI18n } from '../../../shared/i18n.js';
import { ActionDialog } from '../ActionDialog.js';
import { DispatchDetails, ReadArtifact } from '../card-graph/DispatchDetails.js';
import './review-report.css';

type Evidence = Report['criteria'][number]['evidence'][number];
const verdictLabels = { accept: 'reportAccept', reservations: 'reportReservations', return: 'reportReturn' } as const;
const statusLabels = { passed: 'reviewPassed', unmet: 'reportUnmet', unverified: 'reportUnverified', 'not-applicable': 'reportNotApplicable', failed: 'reviewFailed' } as const;

export function ReviewReport({ report, workId, compact = false }: { report: Report; workId: string; compact?: boolean }) {
  const { t } = useI18n();
  const files = useWorkFiles(workId);
  const preview = useFilePreview(workId);
  const [selected, select] = useState<Evidence>();
  const opener = useRef<HTMLElement | null>(null);
  const open = (item: Evidence, from: HTMLElement) => {
    if (item.kind === 'file') preview.open(item.ref, from);
    else { opener.current = from; select(item); }
  };
  const evidence = (items: Evidence[]) => <span className="report-evidence">{items.map((item, index) =>
    <button className="report-link" key={index} onClick={event => open(item, event.currentTarget)}>{item.label}</button>)}</span>;
  const markdown = (text: string) => <Markdown inline text={text} workId={workId} files={files} onOpen={preview.open} />;
  const allPassed = report.criteria.length > 0 && report.criteria.every(item => item.status === 'passed')
    && report.exceptions.length === 0;
  const standards = <div className="report-table-wrap" tabIndex={0} role="region" aria-label={t('reportCriteria')}><table>
    <thead><tr><th scope="col">{t('reportCriterion')}</th><th scope="col">{t('reportStatus')}</th><th scope="col">{t('reportEvidence')}</th></tr></thead>
    <tbody>{report.criteria.map((item, index) => <tr key={index}><td>{item.criterion}</td><td>{t(statusLabels[item.status])}</td><td>{evidence(item.evidence)}</td></tr>)}</tbody>
  </table></div>;
  return <div className={`structured-report${compact ? ' compact' : ''}`}>
    <div className="report-overview">
      <section className="report-verdict"><small>{t('reviewReport')}</small><h2>{t(verdictLabels[report.verdict])}</h2>{markdown(report.summary)}</section>
      {!compact && <>
        <section className="report-section"><h3>{t('reportExceptions')}</h3><div className="report-exceptions" tabIndex={0}>
          {(['unmet', 'unverified', 'truncated'] as const).map(kind => {
            const items = report.exceptions.filter(item => item.kind === kind);
            return items.length ? items.map((item, index) => <div className="report-exception" key={`${kind}-${index}`}>
              <strong>{t(kind === 'truncated' ? 'reportTruncated' : statusLabels[kind])}</strong>
              <div><span>{item.what}</span>{markdown(item.why)}</div>{evidence(item.evidence)}
            </div>) : <div className="report-exception" key={kind}><strong>{t(kind === 'truncated' ? 'reportCoverage' : statusLabels[kind])}</strong><span>{t(kind === 'truncated' ? 'reportFullCoverage' : 'reportNone')}</span></div>;
          })}
        </div></section>
        {allPassed ? <details className="report-fold"><summary>{t('reportAllPassed').replace('{count}', String(report.criteria.length))}</summary>{standards}</details>
          : <section className="report-section"><h3>{t('reportCriteria')}</h3>{standards}</section>}
      </>}
    </div>
    {!compact && <>
      <details className="report-fold"><summary>{t('reportCards').replace('{count}', String(report.cards.length))}</summary>
        {report.cards.length === 0 ? <p className="muted">{t('reportNoCards')}</p> : <div className="report-table-wrap" tabIndex={0} role="region" aria-label={t('reportCardTable')}><table>
          <thead><tr><th scope="col">{t('reviewCard')}</th><th scope="col">{t('reportResult')}</th><th scope="col">{t('reportArtifacts')}</th></tr></thead>
          <tbody>{report.cards.map((card, index) => <tr key={index}><td>{card.title}</td><td>{card.result} / {t(statusLabels[card.verification])}</td><td>
            {evidence(card.evidence)}<details><summary>{t('reportRowDetails')}</summary><p className="mono">{card.cardId}</p>
              {card.dispatches.map((dispatch, index) => <p key={index}><span className="mono">{dispatch.agentId}</span> · <button className="report-link mono" onClick={event => open({ label: t('graphDispatchDetail'), kind: 'dispatch', ref: dispatch.dispatchId }, event.currentTarget)}>{dispatch.dispatchId}</button></p>)}
            </details>
          </td></tr>)}</tbody>
        </table></div>}
      </details>
      {report.suggestions.length > 0 && <details className="report-fold"><summary>{t('reportSuggestions')}</summary><ul>{report.suggestions.map((item, index) => <li key={index}>{markdown(item)}</li>)}</ul></details>}
    </>}
    {preview.preview}
    {selected && <ActionDialog title={selected.label} busy={false} returnFocus={opener} onClose={() => select(undefined)} className="report-preview">
      {selected.kind === 'dispatch' ? <DispatchDetails key={selected.ref} workId={workId} dispatchId={selected.ref} /> : <ReadArtifact key={selected.ref} workId={workId} artifactId={selected.ref} />}
    </ActionDialog>}
  </div>;
}
