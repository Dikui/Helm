import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useData, useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent, Work } from '../../../shared/types.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { useSendMessage } from '../../new-work/useSendMessage.js';
import { RoundSteering } from './RoundSteering.js';
import { Thinking } from './RoundProgress.js';
import { ConversationScroll } from './ConversationScroll.js';
import { eventSummary } from '../card-graph/event-summary.js';
import { GateHistory } from './GateHistory.js';
import { Splitter, useStoredSize } from '../../../shared/Splitter.js';
import { AttachmentList, AttachmentPicker, encodeFiles, withPastedFiles } from '../../../shared/attachments.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import type { GraphNode } from '../card-graph/types.js';
import type { ConversationItem, Message, Rounds } from './types.js';
import type { useWorkReview } from '../brief/useWorkReview.js';
import { ReviewPin } from '../brief/WorkReview.js';
import { GatePin } from '../GatePin.js';
import { useRouter } from '../../../shared/router.js';
import './conversation.css';

// Dispatch steps make up nearly the whole timeline; the conversation only shows these.
const conversationEvents = ['card-completed', 'work-paused', 'work-resumed', 'dispatch-ended', 'gate-decided', 'gate-withdrawn'];

export function ConversationView({ work, report, deliveryPin }: { work: Work; report: ReturnType<typeof useWorkReview>; deliveryPin?: ReactNode }) {
  const { api } = useData();
  const { navigate } = useRouter();
  const { t, language } = useI18n();
  const params = { workId: work.id };
  const conversationAffects = useCallback((event: HelmEvent) => event.workId === work.id
    && (event.action.startsWith('message-') || event.action.startsWith('gate-') || event.action === 'work-description-drafted'), [work.id]);
  const cardsAffects = useCallback((event: HelmEvent) => event.workId === work.id && event.action.startsWith('card-'), [work.id]);
  const conversation = useResource<ConversationItem[]>('get-conversation', params, conversationAffects);
  const eventsAffects = useCallback((event: HelmEvent) => event.workId === work.id && conversationEvents.includes(event.action), [work.id]);
  const events = useResource<HelmEvent[]>('get-events', { ...params, actions: conversationEvents }, eventsAffects);
  const graph = useResource<GraphNode[]>('get-card-graph', params, cardsAffects);
  const rounds = useResource<Rounds>('list-rounds', params);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const workFiles = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  const [scope, setScope] = useState('work');
  const submission = useSendMessage();
  const interruptBusy = useRef(false);
  const [interrupting, setInterrupting] = useState(false);
  const [interruptError, setInterruptError] = useState<Error>();
  const withdrawingRef = useRef(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<Error>();
  const view = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useStoredSize('helm.conversation-dock-height');
  const running = rounds.data?.rounds.find(round => round.status === 'running');
  const cards = graph.data?.filter(node => node.type === 'card') ?? [];
  const gates = conversation.data?.filter(item => item.type === 'gate') ?? [];
  const pendingGates = gates.filter(gate => gate.status === 'pending');
  const scopes = [
    { value: 'work', label: t('conversationWholeWork') },
    ...cards.map(card => ({ value: `card:${card.id}`, label: `${t('conversationCard')} · ${card.content?.split(/\r?\n/, 1)[0] || card.id}` })),
    ...pendingGates.map(gate => ({ value: `gate:${gate.id}`, label: `${t('conversationGate')} · ${gate.question}` })),
  ];
  const validScope = scopes.some(item => item.value === scope);
  const readOnly = ['accepted', 'merge-queued', 'merging', 'completed', 'cancelled'].includes(work.status);
  const locked = readOnly || submission.pending || submission.uncertain || interrupting;
  const reference = (message: Message) => message.cardId
    ? `${t('conversationCard')} · ${cards.find(card => card.id === message.cardId)?.content?.split(/\r?\n/, 1)[0] || message.cardId}`
    : message.gateId ? `${t('conversationGate')} · ${gates.find(gate => gate.id === message.gateId)?.question || message.gateId}` : undefined;
  const interrupt = async () => {
    if (!running || rounds.error || readOnly || interruptBusy.current || withdrawingRef.current || submission.pending) return;
    interruptBusy.current = true; setInterrupting(true); setInterruptError(undefined);
    try { await api.call('interrupt-round', params); }
    catch (error) { setInterruptError(error as Error); }
    finally { interruptBusy.current = false; setInterrupting(false); rounds.reload(); }
  };
  const withdraw = async (messageId: string) => {
    if (withdrawingRef.current || interruptBusy.current || readOnly) return;
    withdrawingRef.current = true; setWithdrawing(true); setWithdrawError(undefined);
    try { await api.call('withdraw-message', { ...params, messageId }); }
    catch (error) { setWithdrawError(error as Error); }
    finally { withdrawingRef.current = false; setWithdrawing(false); rounds.reload(); conversation.reload(); }
  };
  const send = async (immediate = false) => {
    if (readOnly || submission.pending || interruptBusy.current) return;
    if (immediate && (!running || rounds.error)) return;
    if (body.trim()) {
      if (!validScope && !submission.uncertain) return;
      const target = scope.startsWith('card:') ? { cardId: scope.slice(5) } : scope.startsWith('gate:') ? { gateId: scope.slice(5) } : {};
      const result = await submission.send({ workId: work.id, body: body.trim(), attachments: await encodeFiles(files), references, ...target });
      if (!result) return;
      setBody(''); setFiles([]); setReferences([]);
    } else if (!immediate) return;
    if (immediate) await interrupt();
  };
  const milestones = (events.data ?? []).filter(event => event.action === 'card-completed' || event.action === 'work-paused' || event.action === 'work-resumed'
    || event.action === 'dispatch-ended' && (event.details as { conclusion?: string } | null)?.conclusion === 'failed');
  const items = [...(conversation.data ?? []).map(item => ({ time: item.type === 'gate' && item.status !== 'pending' ? events.data?.findLast(event => event.object.id === item.id && ['gate-decided', 'gate-withdrawn'].includes(event.action))?.time ?? item.createdAt : item.createdAt, item, event: undefined as HelmEvent | undefined })),
    ...milestones.map(event => ({ time: event.time, item: undefined, event }))].sort((a, b) => a.time.localeCompare(b.time));
  return <section className="conversation-view" aria-label={t('chat')} ref={view}>
    {(deliveryPin || pendingGates.some(gate => gate.kind !== 'review') && !readOnly || report.conversation.error || report.events.error || report.invalid || report.gate?.status === 'pending' && work.status === 'awaiting-review' || gates.at(-1)?.status === 'withdrawn') && <div className="gate-pins">
      {deliveryPin}
      {!readOnly && pendingGates.filter(gate => gate.kind !== 'review').map(gate => <GateDecision key={gate.id} gate={gate} decisionWorkId={work.id} pinned source={gate.kind === 'git-initialization' ? t('pinProjectShared') : `${t('pinAwaitingDecision')} · ${cards.filter(card => card.dependencies.some(ref => ref.id === gate.id)).map(card => `${t('graphCard')} ${cards.indexOf(card) + 1}`).join(', ') || t('alignmentCoordinator')}`} />)}
      <ReviewPin work={work} report={report} />
      {!pendingGates.length && gates.at(-1)?.status === 'withdrawn' && <GatePin label={t('conversationWithdrawn')} source={t('conversationWithdrawn')} title={gates.at(-1)!.question} tone="neutral"><button aria-keyshortcuts="1" onClick={() => navigate(`/works/${encodeURIComponent(work.id)}?inspect=list`)}><kbd aria-hidden="true">1</kbd>{t('pinSkippedReason')}</button></GatePin>}
    </div>}
    <ConversationScroll key={work.id} className="conversation-thread">
      <h2 className="sr">{t('chat')}</h2>
      {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
      {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
      {items.map(({ item, event, time }) => item?.type === 'gate' && item.status === 'pending' && !readOnly ? null : event ? <div key={`event:${event.id}`} className={`conversation-event ${event.action === 'dispatch-ended' ? 'bad' : event.action === 'card-completed' ? 'ok' : ''}`}>
        <time dateTime={event.time}>{new Date(event.time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time>
        <span title={eventSummary(event, t, cards.findIndex(card => card.id === event.cardId) + 1)}>{eventSummary(event, t, cards.findIndex(card => card.id === event.cardId) + 1)}</span>
      </div> : !item ? null : item.type === 'gate' && (item.status !== 'pending' || readOnly) ? <GateHistory key={item.id} gate={item} decidedAt={time} />
        : item.type === 'message' && item.sender === 'runtime' ? <div className="conversation-event" key={item.id}><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time><span title={item.body}>{item.body}</span></div> : <article key={item.id} className={item.type === 'message' && item.sender === 'user' ? 'conversation-item me' : 'conversation-item'}>
        <div className="conversation-who"><b>{t(item.type === 'message' ? item.sender === 'user' ? 'alignmentYou' : item.sender === 'runtime' ? 'conversationRuntime' : 'alignmentCoordinator' : item.kind === 'git-initialization' ? 'conversationRuntime' : 'alignmentCoordinator')}</b>
          <time className={item.type === 'message' && item.sender === 'user' ? 'sr' : undefined} dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time>
          {item.type === 'message' && item.withdrawnAt && <span className="pill">{t('conversationWithdrawn')}</span>}
          {item.type === 'message' && reference(item) && <small>{reference(item)}</small>}
        </div>
        {item.type === 'message' ? <><Markdown text={item.body} workId={work.id} files={workFiles} onOpen={preview.open} /><AttachmentList attachments={item.attachments} onOpen={preview.open} /></> : item.status === 'pending' && !readOnly
          ? <GateDecision gate={item} decisionWorkId={work.id} />
          : <GateHistory gate={item} />}
      </article>)}
      <Thinking round={running} steps={rounds.data?.currentSteps ?? []} />
    </ConversationScroll>
    {graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}
    {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
    <Splitter label={t('resizeComposer')} orientation="horizontal" grow={-1} min={120} onResize={setDockHeight}
      max={() => (view.current?.getBoundingClientRect().height ?? 600) * .75} measure={() => dock.current?.getBoundingClientRect().height ?? 200} />
    <div className="conversation-dock" ref={dock} style={dockHeight ? { height: dockHeight } : undefined}>
    <RoundSteering active={Boolean(running)} withdraw={messageId => void withdraw(messageId)} queue={rounds.data?.queuedMessages ?? []} reference={reference} pauseReason={work.runtimePauseReason}
      busy={interrupting || withdrawing || submission.pending || readOnly || Boolean(rounds.error)} interrupt={() => void interrupt()} />
    {withdrawError && <ErrorNotice error={withdrawError} />}
    {interruptError && <ErrorNotice error={interruptError} />}
    <form className="conversation-composer" noValidate aria-busy={submission.pending || interrupting} onSubmit={event => { event.preventDefault(); void send(); }}>
      <label><span className="sr">{t('alignmentMessage')}</span><textarea className="resize-none" value={body} disabled={locked} placeholder={t(work.status === 'paused' ? 'conversationPausedPlaceholder' : 'conversationPlaceholder')} onChange={event => setBody(event.target.value)} onPaste={event => { const pasted = [...event.clipboardData.files]; if (pasted.length) setFiles(current => withPastedFiles(current, pasted)); }} onKeyDown={event => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.metaKey || event.ctrlKey) { event.preventDefault(); void send(true); }
        else if (!event.shiftKey) { event.preventDefault(); void send(); }
      }} /></label>
      <div className="conversation-hints"><span>{t('composerShortcuts')}</span>
        <label><span className="sr">{t('conversationAbout')}</span><select value={scope} disabled={locked} onChange={event => setScope(event.target.value)}>
          {!validScope && <option value={scope} disabled>{t('conversationScopeUnavailable')}</option>}
          {scopes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button type="button" className="conversation-now" disabled={!running || interrupting || withdrawing || submission.pending || readOnly || Boolean(rounds.error)} onClick={() => void interrupt()}>{t('conversationInterrupt')}</button>
        <button className="btn primary send" disabled={readOnly || submission.pending || interrupting || !body.trim() || (!validScope && !submission.uncertain)}><span className="sr">{t(submission.error ? 'newWorkRetrySend' : 'alignmentSend')}</span><span aria-hidden="true">↑</span></button>
      </div>
      <details className="composer-attachments" open={files.length > 0 || undefined}><summary>{t('attachFiles')}</summary>
        <AttachmentPicker files={files} onChange={setFiles} disabled={locked} references={references} onReferencesChange={setReferences} workId={work.id} />
      </details>
      {!validScope && <p className="hint">{t('conversationScopeUnavailable')}</p>}
      {submission.error && <ErrorNotice error={submission.error} />}
      {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
    </form>
    </div>
    {preview.preview}
  </section>;
}
