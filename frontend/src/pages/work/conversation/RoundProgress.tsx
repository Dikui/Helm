import type { ReactNode } from 'react';
import type { PlanEntry } from '../../../../../src/driver.js';
import { PlanSteps } from '../../../shared/PlanSteps.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../../shared/i18n.js';
import { isHousekeeping, stepSummary } from '../../../shared/step-summary.js';
import type { Round, RoundStep } from './types.js';
import './conversation.css';

function visibleSteps(steps: RoundStep[]) {
  return steps.filter(step => step.type !== 'end' && step.type !== 'plan' && !(step.text && isHousekeeping(step.text)));
}
function headline(step: RoundStep, t: (key: MessageKey) => string) {
  const text = step.type === 'plan' ? t('conversationPlan') : step.text ? stepSummary(step.text, t) : step.path ?? t('conversationCompaction');
  return text.trim().split(/\r?\n/, 1)[0] ?? '';
}
function truncate(text: string) { return text.length > 160 ? `${text.slice(0, 160)}…` : text; }

export function Thinking({ round, steps }: { round?: Round; steps: RoundStep[] }) {
  const { t } = useI18n();
  const now = useClock();
  if (round?.status !== 'running') return null;
  const latest = visibleSteps(steps).at(-1);
  const text = latest ? headline(latest, t) : t('conversationWaitingFirstOutput');
  return <div className="conversation-thinking" role="status">
    <b><span className="spin" aria-hidden="true" />{t('conversationThinking')} <time aria-label={t('conversationRoundElapsed')}>{elapsed(round.startedAt, now)}</time></b>
    <small title={text}>{truncate(text)}</small>
  </div>;
}

type RoundStepsProps = { round: Round; steps: RoundStep[]; plan?: PlanEntry[]; action?: ReactNode };

export function RoundSteps({ workId, ...props }: RoundStepsProps & { workId: string }) {
  return props.round.status === 'ended' ? <EndedRoundSteps workId={workId} round={props.round} action={props.action} /> : <RoundStepsContent {...props} />;
}

function EndedRoundSteps({ workId, round, action }: { workId: string; round: Round; action?: ReactNode }) {
  const { t } = useI18n();
  const output = useResource<RoundStep[] | { status: 'deleted' }>('get-round-output', { workId, roundId: round.id });
  return <>
    {output.error && <ErrorNotice error={output.error} retry={output.reload} />}
    {!output.data ? !output.error && <p role="status">{t('loading')}</p> : !Array.isArray(output.data) ? <p>{t('graphDeleted')}</p>
      : <RoundStepsContent round={round} steps={output.data} plan={output.data.findLast(step => step.type === 'plan')?.entries ?? []} action={action} />}
  </>;
}

function RoundStepsContent({ round, steps, plan = [], action }: RoundStepsProps) {
  const { t } = useI18n();
  const now = useClock();
  const active = round.status === 'running';
  const until = active ? now : Date.parse(round.endedAt ?? round.startedAt);
  const meaningful = visibleSteps(steps);
  const latest = meaningful.at(-1);
  const title = t('conversationFoldedSteps').replace('{count}', String(meaningful.length))
    + (active ? '' : ` · ${t('conversationEnded')}`)
    + (latest ? ` · ${t('conversationLatest')}${headline(latest, t)}` : ` · ${t('conversationWaitingFirstOutput')}`);
  const position = Math.min(plan.length, plan.filter(entry => entry.status === 'completed').length + 1);
  const stepList = (list: RoundStep[]) => <ol className="conversation-steps">{list.map((step, index) => {
    const next = list[index + 1];
    const done = Boolean(next) || !active;
    const text = step.type === 'plan' ? JSON.stringify(step, null, 2) : step.text ?? step.path ?? t('conversationCompaction');
    const summary = headline(step, t);
    const gap = step.time ? elapsed(step.time, next?.time ? Date.parse(next.time) : until) : '00:00';
    return <li key={step.step} className={done ? 'done' : 'now'}>
      <span className="conversation-step-icon" aria-hidden="true">{done ? '✓' : <span className="spin" />}</span>
      <details><summary title={summary}>{truncate(summary)}</summary><pre>{text}</pre></details>
      {step.time && gap !== '00:00' && <time dateTime={step.time} title={step.time} aria-label={`${t(next ? 'conversationStepGap' : 'conversationStepSince')} ${step.step}`}>{gap}</time>}
    </li>;
  })}</ol>;
  const hidden = steps.filter(step => step.type !== 'end' && !meaningful.includes(step));
  const rawSteps = <>{stepList(meaningful)}{hidden.length > 0 && <details className="conversation-raw-steps"><summary>{t('conversationHiddenSteps')} · {hidden.length}</summary>{stepList(hidden)}</details>}</>;
  return <details className="conversation-round">
    <summary className="conversation-round-heading">
      <span className={`spark ${active ? 'run busy' : 'ok'}`} aria-hidden="true">✦</span>
      <span className="conversation-round-title" title={title}>{truncate(title)}</span>
      <span className={`pill ${active ? 'run' : 'ok'}`}><time>{elapsed(round.startedAt, until)}</time></span>
      {action}<span className="chev" aria-hidden="true">⌄</span>
    </summary>
    <div className="conversation-round-body">
      <p className="hint">{t('alignmentCoordinator')} · {t('conversationRound')} {round.number} · {round.agentId}</p>
      {plan.length ? <><h3>{t('conversationPlan')} · {t('conversationPlanPosition').replace('{current}', String(position)).replace('{total}', String(plan.length))}</h3>
        <PlanSteps entries={plan} /><details className="conversation-raw-steps"><summary>{t('conversationRawSteps')} · {meaningful.length}</summary>{rawSteps}</details></>
        : <>{!meaningful.length && <p className="muted conversation-waiting">{t('conversationWaitingFirstOutput')}</p>}{rawSteps}</>}
    </div>
  </details>;
}
