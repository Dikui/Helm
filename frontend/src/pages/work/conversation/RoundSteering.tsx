import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n, type MessageKey } from '../../../shared/i18n.js';
import type { Message, Round, RoundStep } from './types.js';
import { outputSummary } from '../../../../../src/output-summary.js';

function stepSummary(raw: string, t: (key: MessageKey) => string): string {
  const summary = outputSummary(raw);
  if (summary) return summary;
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  let value: Record<string, unknown>;
  try { value = object(JSON.parse(raw)); } catch { return t('conversationOutput'); }
  if (value.type === 'user') {
    const content = object(value.message).content;
    const results = Array.isArray(content) ? content.map(object).filter(item => item.type === 'tool_result') : [];
    if (results.length) {
      const result = results.map(item => typeof item.content === 'string' ? item.content : Array.isArray(item.content)
        ? item.content.map(object).filter(block => block.type === 'text').map(block => block.text).filter(text => typeof text === 'string').join('\n') : '')
        .join('\n').split(/\r?\n/).find(line => line.trim());
      return `${t('conversationToolResult')}${result ? ` · ${result.trim()}` : ''}`;
    }
  }
  if (value.type === 'system') {
    if (value.subtype === 'init') return t('conversationSessionInit');
    if (typeof value.subtype === 'string' && value.subtype.startsWith('hook_')) return `${t('conversationHook')} · ${value.subtype}`;
    return `${t('conversationSystem')}${typeof value.subtype === 'string' ? ` · ${value.subtype}` : ''}`;
  }
  if (typeof value.type === 'string' && value.type.startsWith('hook_')) return `${t('conversationHook')} · ${value.type}`;
  if (value.type === 'rate_limit_event') return t('conversationRateLimit');
  if (value.type === 'stream_event') return t('conversationStream');
  if (value.type === 'result') return t('conversationRoundEnded');
  const notifications: Record<string, MessageKey> = {
    'thread/tokenUsage/updated': 'conversationTokenUsage', 'account/rateLimits/updated': 'conversationRateLimit',
    'thread/status/changed': 'conversationThreadStatus', 'thread/started': 'conversationSessionInit',
    'turn/started': 'conversationTurnStarted', 'turn/completed': 'conversationRoundEnded',
  };
  const key = typeof value.method === 'string' ? notifications[value.method] : undefined;
  if (key) return t(key);
  return t('conversationOutput');
}

export function RoundSteering({ round, steps, queue, interrupt, busy, reference, pauseReason }: {
  round?: Round; steps: RoundStep[]; queue: Message[]; interrupt: () => void; busy: boolean;
  reference: (message: Message) => string | undefined; pauseReason: string | null;
}) {
  const { t } = useI18n();
  const now = useClock();
  return <div className="conversation-steering">
    <div className="conversation-round-heading">
      <span className={`spark ${round ? 'run' : ''}`} aria-hidden="true">✦</span>
      <h3>{t('alignmentCoordinator')}{round ? ` · ${t('conversationRound')} ${round.number}` : ` · ${t('conversationIdle')}`}</h3>
      {round && <><span className="muted">{round.agentId}</span><span className="pill run"><span className="spin" aria-hidden="true" /><time aria-label={t('conversationRoundElapsed')}>{elapsed(round.startedAt, now)}</time></span></>}
      <button type="button" className="btn sm" disabled={!round || busy} onClick={interrupt} title="⌘⏎ / Ctrl+Enter">{t('conversationInterrupt')}</button>
    </div>
    {pauseReason && <p className="pause-reason">{pauseReason}</p>}
    {round && <details className="conversation-round" open>
      <summary>{t('conversationSteps')} <span className="count">{steps.length}</span></summary>
      {steps.length ? <ol>{steps.map((step, index) => {
        const text = step.text ?? step.path ?? t('conversationCompaction');
        const summary = step.text ? stepSummary(step.text, t) : text;
        const next = steps[index + 1];
        return <li key={step.step} className={next ? 'done' : 'now'}>
          <span className="conversation-step-number">{step.step}</span>
          <details><summary>{summary.split(/\r?\n/, 1)[0]?.slice(0, 160)}</summary><pre>{text}</pre></details>
          {step.time && <time dateTime={step.time} title={step.time} aria-label={`${t(next ? 'conversationStepGap' : 'conversationStepSince')} ${step.step}`}>{elapsed(step.time, next?.time ? Date.parse(next.time) : now)}</time>}
        </li>;
      })}</ol> : <p className="muted">{t('conversationWaitingOutput')}</p>}
    </details>}
    {queue.length > 0 && <section className="conversation-queue" aria-label={t('conversationQueue')}>
      <h3>{t('conversationQueue')} <span className="count">{queue.length}</span></h3>
      <ul>{queue.map(message => <li key={message.id}>{reference(message) && <small className="muted">{reference(message)}</small>}<p>{message.body}</p></li>)}</ul>
    </section>}
  </div>;
}
