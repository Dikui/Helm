import { useState } from 'react';
import { useI18n } from '../../../shared/i18n.js';
import type { ReviewData } from './types.js';
import './brief.css';

// Bound the rendered text even when the diff contains a single very long line.
const DIFF_PAGE_SIZE = 20_000;
function ReviewDiff({ diff }: { diff: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(diff.length / DIFF_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return <div className="review-diff">
    <button className="btn sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('reviewViewDiff')}</button>
    {expanded && (diff ? <>
      <div className="row" role="group" aria-label={t('reviewDiffPaging')}>
        <button className="btn sm" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('reviewPrevious')}</button>
        <span role="status">{t('reviewSegment')} {current + 1} / {pages}</span>
        <button className="btn sm" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>{t('reviewNext')}</button>
      </div>
      <pre tabIndex={0} aria-label={t('reviewDiffContent')}><code>{diff.slice(current * DIFF_PAGE_SIZE, (current + 1) * DIFF_PAGE_SIZE)}</code></pre>
    </> : <p>{t('reviewNoDiff')}</p>)}
  </div>;
}

export function ReviewDetails({ review, detailed = false }: { review: ReviewData; detailed?: boolean }) {
  const { t } = useI18n();
  return <div className="review-details">
    <dl className="review-counts">
      <dt>{t('reviewRejected')}</dt><dd aria-label={t('reviewRejected')}>{review.rejectedOperationCount}</dd>
      <dt>{t('reviewUndeclared')}</dt><dd aria-label={t('reviewUndeclared')}>{review.undeclaredDispatchCount}</dd>
    </dl>
    {detailed && <>
      <section><h3>{t('reviewVerification')}</h3>
        {review.overallVerification.length === 0 ? <p className="muted">{t('reviewNoVerification')}</p> : <ul className="review-verifications">
          {review.overallVerification.map(item => <li key={item.cardId}>
            <span className={`pill ${item.conclusion === 'passed' ? 'ok' : item.conclusion === 'failed' ? 'bad' : ''}`}>{t(item.conclusion === 'passed' ? 'reviewPassed' : item.conclusion === 'failed' ? 'reviewFailed' : 'reviewNotDeclared')}</span>
            <span className="mono">{t('reviewCard')} {item.cardId}</span>
            {item.dispatchId && <span className="mono">{t('reviewDispatch')} {item.dispatchId}</span>}
            {item.reason && <p className="agent-text">{item.reason}</p>}
          </li>)}
        </ul>}
      </section>
      <section><h3>{t('reviewDiff')}</h3>
        <dl className="brief-base"><dt>{t('newWorkBase')}</dt><dd className="mono">{review.baseRef} · {review.baseCommit}</dd>
          <dt>{t('briefWorkBranch')}</dt><dd className="mono">{review.workBranch} · {review.workCommit}</dd></dl>
        <ReviewDiff key={review.workCommit} diff={review.diff} />
      </section>
    </>}
  </div>;
}
