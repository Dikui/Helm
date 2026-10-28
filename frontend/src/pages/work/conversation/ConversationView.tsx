import { useCallback, useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent, Work } from '../../../shared/types.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { useSendMessage } from '../../new-work/useSendMessage.js';
import { RoundSteering } from './RoundSteering.js';
import { Thinking } from './RoundProgress.js';
import { ConversationScroll } from './ConversationScroll.js';
import { Splitter, useStoredSize } from '../../../shared/Splitter.js';
import { AttachmentList, AttachmentPicker, encodeFiles } from '../../../shared/attachments.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import type { CardReference, ConversationItem, Message, Rounds } from './types.js';
import './conversation.css';

export function ConversationView({ work }: { work: Work }) {
  const { api } = useData();
  const { t, language } = useI18n();
  const params = { workId: work.id };
  const conversationAffects = useCallback((event: HelmEvent) => event.workId === work.id
    && (event.action.startsWith('message-') || event.action.startsWith('gate-') || event.action === 'work-description-drafted'), [work.id]);
  const cardsAffects = useCallback((event: HelmEvent) => event.workId === work.id && event.action.startsWith('card-'), [work.id]);
  const conversation = useResource<ConversationItem[]>('get-conversation', params, conversationAffects);
  const graph = useResource<CardReference[]>('get-card-graph', params, cardsAffects);
  const rounds = useResource<Rounds>('list-rounds', params);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
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
  const ended = work.status === 'completed' || work.status === 'cancelled';
  const locked = ended || submission.pending || submission.uncertain || interrupting;
  const reference = (message: Message) => message.cardId
    ? `${t('conversationCard')} · ${cards.find(card => card.id === message.cardId)?.content?.split(/\r?\n/, 1)[0] || message.cardId}`
    : message.gateId ? `${t('conversationGate')} · ${gates.find(gate => gate.id === message.gateId)?.question || message.gateId}` : undefined;
  const interrupt = async () => {
    if (!running || rounds.error || ended || interruptBusy.current || withdrawingRef.current || submission.pending) return;
    interruptBusy.current = true; setInterrupting(true); setInterruptError(undefined);
    try { await api.call('interrupt-round', params); }
    catch (error) { setInterruptError(error as Error); }
    finally { interruptBusy.current = false; setInterrupting(false); rounds.reload(); }
  };
  const withdraw = async (messageId: string) => {
    if (withdrawingRef.current || interruptBusy.current || ended) return;
    withdrawingRef.current = true; setWithdrawing(true); setWithdrawError(undefined);
    try { await api.call('withdraw-message', { ...params, messageId }); }
    catch (error) { setWithdrawError(error as Error); }
    finally { withdrawingRef.current = false; setWithdrawing(false); rounds.reload(); conversation.reload(); }
  };
  const send = async (immediate = false) => {
    if (ended || submission.pending || interruptBusy.current) return;
    if (immediate && (!running || rounds.error)) return;
    if (body.trim()) {
      if (!validScope && !submission.uncertain) return;
      const target = scope.startsWith('card:') ? { cardId: scope.slice(5) } : scope.startsWith('gate:') ? { gateId: scope.slice(5) } : {};
      const result = await submission.send({ workId: work.id, body: body.trim(), attachments: await encodeFiles(files), ...target });
      if (!result) return;
      setBody(''); setFiles([]);
    } else if (!immediate) return;
    if (immediate) await interrupt();
  };
  return <section className="conversation-view" aria-label={t('chat')} ref={view}>
    <ConversationScroll key={work.id} className="conversation-thread">
      <h2 className="sr">{t('chat')}</h2>
      {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
      {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
      {conversation.data?.map(item => <article key={item.id} className={item.type === 'message' && item.sender === 'user' ? 'conversation-item me' : 'conversation-item'}>
        <div className="conversation-who"><b>{t(item.type === 'message' ? item.sender === 'user' ? 'alignmentYou' : item.sender === 'runtime' ? 'conversationRuntime' : 'alignmentCoordinator' : 'alignmentCoordinator')}</b>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time>
          {item.type === 'message' && item.withdrawnAt && <span className="pill">{t('conversationWithdrawn')}</span>}
          {item.type === 'message' && reference(item) && <small>{reference(item)}</small>}
        </div>
        {item.type === 'message' ? <><Markdown text={item.body} workId={work.id} files={workFiles} onOpen={preview.open} /><AttachmentList attachments={item.attachments} onOpen={preview.open} /></> : item.status === 'pending' && !ended
          ? <GateDecision gate={item} />
          : <div className="conversation-gate-history"><strong>{item.question}</strong><span className="pill">{t(item.status === 'decided' ? 'conversationDecided' : item.status === 'withdrawn' ? 'conversationWithdrawn' : 'conversationClosed')}</span>
            {item.body && <p>{item.body}</p>}{item.decision && <p>{item.kind === 'work-confirmation' && item.decision === 'confirm' ? t('confirm') : item.decision}</p>}{item.withdrawalReason && <p>{item.withdrawalReason}</p>}</div>}
      </article>)}
      <Thinking round={running} steps={rounds.data?.currentSteps ?? []} />
    </ConversationScroll>
    {graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}
    {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
    <Splitter label={t('resizeComposer')} orientation="horizontal" grow={-1} min={120} onResize={setDockHeight}
      max={() => (view.current?.getBoundingClientRect().height ?? 600) * .75} measure={() => dock.current?.getBoundingClientRect().height ?? 200} />
    <div className="conversation-dock" ref={dock} style={dockHeight ? { height: dockHeight } : undefined}>
    <RoundSteering workId={work.id} round={running ?? rounds.data?.rounds.at(-1)} steps={rounds.data?.currentSteps ?? []}
      plan={rounds.data?.currentPlan ?? []} withdraw={messageId => void withdraw(messageId)} queue={rounds.data?.queuedMessages ?? []} reference={reference} pauseReason={work.runtimePauseReason}
      busy={interrupting || withdrawing || submission.pending || ended || Boolean(rounds.error)} interrupt={() => void interrupt()} />
    {withdrawError && <ErrorNotice error={withdrawError} />}
    {interruptError && <ErrorNotice error={interruptError} />}
    <form className="conversation-composer" noValidate aria-busy={submission.pending || interrupting} onSubmit={event => { event.preventDefault(); void send(); }}>
      <label><span className="sr">{t('alignmentMessage')}</span><textarea className="resize-none" value={body} disabled={locked} placeholder={t('conversationPlaceholder')} onChange={event => setBody(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.metaKey || event.ctrlKey) { event.preventDefault(); void send(true); }
        else if (!event.shiftKey) { event.preventDefault(); void send(); }
      }} /></label>
      <button className="btn primary send" disabled={ended || submission.pending || interrupting || !body.trim() || (!validScope && !submission.uncertain)}><span className="sr">{t(submission.error ? 'newWorkRetrySend' : 'alignmentSend')}</span><span aria-hidden="true">↑</span></button>
      <AttachmentPicker files={files} onChange={setFiles} disabled={locked} />
      <div className="conversation-hints"><span><kbd>⏎</kbd> {running ? t('conversationQueue') : t('alignmentSend')} · <kbd>⇧⏎</kbd> {t('conversationNewline')}</span>
        <span><kbd>⌘⏎ / Ctrl+Enter</kbd> {t('conversationInterrupt')}</span>
        <label>{t('conversationAbout')}<select value={scope} disabled={locked} onChange={event => setScope(event.target.value)}>
          {!validScope && <option value={scope} disabled>{t('conversationScopeUnavailable')}</option>}
          {scopes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      </div>
      {!validScope && <p className="hint">{t('conversationScopeUnavailable')}</p>}
      {submission.error && <ErrorNotice error={submission.error} />}
      {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
    </form>
    </div>
    {preview.preview}
  </section>;
}
