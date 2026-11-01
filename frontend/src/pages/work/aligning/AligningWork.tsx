import { useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GatePin } from '../GatePin.js';
import { ActionDialog } from '../ActionDialog.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { GateHistory } from '../conversation/GateHistory.js';
import { useSendMessage } from '../../new-work/useSendMessage.js';
import { AttachmentList, AttachmentPicker, encodeFiles } from '../../../shared/attachments.js';
import { Markdown, useFilePreview } from '../../../shared/files.js';
import type { ConversationItem, WorkDescription } from './types.js';
import { Splitter, useStoredSize } from '../../../shared/Splitter.js';
import { Thinking } from '../conversation/RoundProgress.js';
import { ConversationScroll } from '../conversation/ConversationScroll.js';
import { RoundSteering } from '../conversation/RoundSteering.js';
import type { CardReference, Message, Rounds } from '../conversation/types.js';
import { Inspector } from '../../../shared/Inspector.js';
import './aligning.css';
import '../brief/brief.css';

export function AligningWork({ workId, title, workBranch, showBrief, inspectorTitle }: { title: string; workId: string; projectId: string; workBranch?: string | null; showBrief: boolean; inspectorTitle: string }) {
  const { api } = useData();
  const { t, language } = useI18n();
  const workFiles = useResource<string[]>('list-work-files', { workId });
  const linkedFiles = new Set(workFiles.data ?? []);
  const conversation = useResource<ConversationItem[]>('get-conversation', { workId });
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId });
  const rounds = useResource<Rounds>('list-rounds', { workId });
  const graph = useResource<CardReference[]>('get-card-graph', { workId });
  const running = rounds.data?.rounds.find(round => round.status === 'running');
  const [version, setVersion] = useState<number>();
  const [confirming, setConfirming] = useState(false);
  const confirmationBusy = useRef(false);
  const [confirmError, setConfirmError] = useState<Error>();
  const [amending, setAmending] = useState(false);
  const [amendment, setAmendment] = useState('');
  const amendOpener = useRef<HTMLElement | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const preview = useFilePreview(workId);
  const submission = useSendMessage();
  const [scope, setScope] = useState('work');
  const [steering, setSteering] = useState(false);
  const [steeringError, setSteeringError] = useState<Error>();
  const steeringBusy = useRef(false);
  const cards = graph.data?.filter(node => node.type === 'card') ?? [];
  const gates = conversation.data?.filter(item => item.type === 'gate') ?? [];
  const scopes = [{ value: 'work', label: t('conversationWholeWork') },
    ...cards.map(card => ({ value: `card:${card.id}`, label: `${t('conversationCard')} · ${card.content?.split(/\r?\n/, 1)[0] || card.id}` })),
    ...gates.filter(gate => gate.status === 'pending').map(gate => ({ value: `gate:${gate.id}`, label: `${t('conversationGate')} · ${gate.question}` }))];
  const validScope = scopes.some(item => item.value === scope);
  const locked = submission.pending || submission.uncertain || steering;
  const reference = (message: Message) => message.cardId ? `${t('conversationCard')} · ${cards.find(card => card.id === message.cardId)?.content?.split(/\r?\n/, 1)[0] || message.cardId}`
    : message.gateId ? `${t('conversationGate')} · ${gates.find(gate => gate.id === message.gateId)?.question || message.gateId}` : undefined;
  const steer = async (operation: 'interrupt-round' | 'withdraw-message', messageId?: string) => {
    if (steeringBusy.current || submission.pending || (operation === 'interrupt-round' && (!running || rounds.error))) return;
    steeringBusy.current = true; setSteering(true); setSteeringError(undefined);
    try { await api.call(operation, { workId, ...(messageId ? { messageId } : {}) }); }
    catch (error) { setSteeringError(error as Error); }
    finally { steeringBusy.current = false; setSteering(false); rounds.reload(); conversation.reload(); }
  };
  const versions = descriptions.data ?? [];
  const latest = versions.at(-1);
  const shown = version === undefined ? latest : versions.find(item => item.version === version);
  const previous = versions.find(item => item.version === (shown?.version ?? 0) - 1);
  const gate = conversation.data?.find(item => item.type === 'gate' && item.kind === 'work-confirmation' && item.status === 'pending');
  const canConfirm = Boolean(shown && gate?.type === 'gate' && gate.descriptionId === shown.id && latest?.id === shown.id
    && rounds.data && !rounds.error && !running && !confirming && !conversation.error && !descriptions.error);
  // 确认始终对应说明中正在查看的最新草稿。
  const confirm = async () => {
    if (!canConfirm || !shown || !gate || confirmationBusy.current) return;
    confirmationBusy.current = true; setConfirming(true); setConfirmError(undefined);
    try { await api.call('decide-gate', { workId, gateId: gate.id, descriptionId: shown.id, decision: 'confirm' }); }
    catch (error) { setConfirmError(error as Error); }
    finally { confirmationBusy.current = false; setConfirming(false); }
  };
  const send = async (immediate = false) => {
    if (steeringBusy.current || submission.pending || (immediate && (!running || rounds.error))) return;
    if (body.trim()) {
      if (!validScope && !submission.uncertain) return;
      const target = scope.startsWith('card:') ? { cardId: scope.slice(5) } : scope.startsWith('gate:') ? { gateId: scope.slice(5) } : {};
      if (!await submission.send({ workId, body: body.trim(), attachments: await encodeFiles(files), references, ...target })) return;
      setBody(''); setFiles([]); setReferences([]);
    } else if (!immediate) return;
    if (immediate) await steer('interrupt-round');
  };
  const chat = useRef<HTMLElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const [composerHeight, setComposerHeight] = useStoredSize('helm.aligning-composer-height');
  const copyNotice = <p className="warn"><span>!</span><span>{t(shown && !shown.baseRef ? 'projectWithoutGitHint' : workBranch ? 'alignmentCopyReady' : 'alignmentCopyPending')}</span></p>;
  return <div className="aligning-work">
    <section className="aligning-chat" aria-label={t('chat')} aria-busy={submission.pending || confirming} ref={chat}>
      {gates.some(item => item.status === 'pending' && item.kind !== 'work-confirmation') || gate && rounds.data && !running ? <div className="gate-pins">
        {gates.filter(item => item.status === 'pending' && item.kind !== 'work-confirmation').map(item => <GateDecision key={item.id} gate={item} pinned />)}
        {!gates.some(item => item.status === 'pending' && item.kind !== 'work-confirmation') && gate && rounds.data && !running && <GatePin label={t('alignmentConfirmBrief')} source={t('nowAwaitingConfirmation')} title={t('pinSpec').replace('{version}', String(shown?.version ?? '—'))}
          busy={confirming} reason={<p>{t('alignmentBranchFrom')} <span className="ref">{shown?.baseRef}{shown?.baseCommit ? `@${shown.baseCommit.slice(0, 7)}` : ''}</span> {t(workBranch ? 'alignmentCopyRefresh' : 'alignmentCopyOnDemand')}</p>}>
          <button disabled={!canConfirm} aria-keyshortcuts="1" onClick={() => void confirm()}><kbd aria-hidden="true">1</kbd>{t('pinConfirm')}</button>
          <button aria-keyshortcuts="2" onClick={event => { amendOpener.current = event.currentTarget; setAmending(true); }}><kbd aria-hidden="true">2</kbd>{t('alignmentNeedsChanges')}</button>
          {confirmError && <ErrorNotice error={confirmError} />}
        </GatePin>}
      </div> : null}
      <ConversationScroll key={workId} className="aligning-thread">
        <h2 className="sr">{t('chat')}</h2>
        {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
        {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
        {conversation.data?.map(item => item.type === 'message'
          ? <article key={item.id} className={item.sender === 'user' ? 'aligning-message me' : 'aligning-message'}><div className="aligning-who"><b>{t(item.sender === 'user' ? 'alignmentYou' : 'alignmentCoordinator')}</b>{item.withdrawnAt && <span className="pill">{t('conversationWithdrawn')}</span>}<time className={item.sender === 'user' ? 'sr' : undefined} dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time></div><Markdown text={item.body} workId={workId} files={linkedFiles} onOpen={preview.open} /><AttachmentList attachments={item.attachments} onOpen={preview.open} /></article>
          : item.status !== 'pending' ? <GateHistory key={item.id} gate={item} /> : null)}
        {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
        <Thinking round={running} steps={rounds.data?.currentSteps ?? []} />
      </ConversationScroll>
      <Splitter label={t('resizeComposer')} orientation="horizontal" grow={-1} min={96} onResize={setComposerHeight}
        max={() => (chat.current?.getBoundingClientRect().height ?? 600) * .75} measure={() => composer.current?.getBoundingClientRect().height ?? 160} />
      <form className="aligning-composer" ref={composer} style={composerHeight ? { height: composerHeight } : undefined} noValidate onSubmit={event => { event.preventDefault(); void send(); }}>
        <RoundSteering active={Boolean(running)} queue={rounds.data?.queuedMessages ?? []} reference={reference} pauseReason={null}
          busy={steering || submission.pending || Boolean(rounds.error)} interrupt={() => void steer('interrupt-round')} withdraw={id => void steer('withdraw-message', id)} />
        {steeringError && <ErrorNotice error={steeringError} />}
        {graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}
        <label><span className="sr">{t('alignmentMessage')}</span><textarea className="resize-none" value={body} disabled={locked} placeholder={t('alignmentReply')}
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(event.metaKey || event.ctrlKey); }
          }} /></label>
        <div className="conversation-hints"><span>{t('composerShortcuts')}</span>
          <label><span className="sr">{t('conversationAbout')}</span><select value={scope} disabled={locked} onChange={event => setScope(event.target.value)}>{!validScope && <option value={scope} disabled>{t('conversationScopeUnavailable')}</option>}{scopes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button className="btn primary send" disabled={submission.pending || steering || !body.trim() || (!validScope && !submission.uncertain)}><span className="sr">{t(submission.error ? 'newWorkRetrySend' : 'alignmentSend')}</span><span aria-hidden="true">↑</span></button>
        </div>
        <details className="composer-attachments"><summary>{t('attachFiles')}</summary><AttachmentPicker files={files} onChange={setFiles} disabled={locked} references={references} onReferencesChange={setReferences} workId={workId} /></details>
        {!validScope && <p className="hint">{t('conversationScopeUnavailable')}</p>}
        {submission.error && <ErrorNotice error={submission.error} />}
        {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
      </form>
    </section>
    {showBrief && <Inspector title={inspectorTitle}><aside className="aligning-brief brief-document" aria-label={t('brief')} aria-busy={confirming}>
      <header>{shown && <><span className="muted">{t('brief')} · v{shown.version} · {t(latest?.id !== shown.id ? 'alignmentHistory' : running ? 'alignmentUpdating' : 'alignmentDraftStatus')}</span><label><span className="sr">{t('alignmentVersion')}</span><select value={shown.version} onChange={event => setVersion(Number(event.target.value))}>
        {[...versions].reverse().map(item => <option key={item.id} value={item.version}>v{item.version} · {t(item.id === latest?.id ? 'alignmentDraft' : 'alignmentHistory')}</option>)}
      </select></label></>}</header>
      {shown && <h2>{title}</h2>}
      <div className="aligning-brief-body">
        {descriptions.error && <ErrorNotice error={descriptions.error} retry={descriptions.reload} />}
        {!descriptions.data && !descriptions.error && <p role="status">{t('loading')}</p>}
        {descriptions.data && !shown && <p>{t('noDescription')}</p>}
        {!shown && copyNotice}
        {shown && <>
          {(['requirements', 'boundary', 'criteria'] as const).map(field => {
            const oldLines = previous?.[field].split(/\r?\n/) ?? [];
            return <section key={field}><h3>{t(field)}</h3><ul>{shown[field].split(/\r?\n/).filter(line => line.trim()).map((line, index) =>
              <li key={index} aria-label={previous && !oldLines.includes(line) ? `${line} ${t('alignmentNew')}` : undefined}>{previous && !oldLines.includes(line) ? <mark>{line}<span className="brief-new">{t('alignmentNew')}</span></mark> : line}</li>)}</ul></section>;
          })}
          {shown.baseCommit && <dl className="aligning-base"><dt>{t('newWorkBase')}</dt><dd><span className="ref">{shown.baseRef}</span> <span className="ref" title={shown.baseCommit}>{shown.baseCommit.slice(0, 7)}</span></dd><dt>{t('briefWorkBranch')}</dt><dd><span className="ref">{workBranch || `helm/${workId}`}</span>{!workBranch && <small className="muted"> · {t('alignmentBranchPending')}</small>}</dd></dl>}
          {copyNotice}
          <p className="muted">{t('alignmentNewEntriesHint')}</p>
          {previous && <details><summary>{t('alignmentComparing').replace('{version}', String(previous.version))}</summary>{(['requirements', 'boundary', 'criteria'] as const).map(field => {
            const added = shown[field].split(/\r?\n/).filter(line => line.trim() && !previous[field].split(/\r?\n/).includes(line));
            return added.length > 0 ? <section key={field}><h3>{t(field)}</h3><ul>{added.map((line, index) => <li key={index}>{line}</li>)}</ul></section> : null;
          })}</details>}
          {latest?.id !== shown.id && <p>{t('alignmentHistoricalDraft')}</p>}
        </>}
      </div>
    </aside></Inspector>}
    {amending && <ActionDialog title={t('alignmentNeedsChanges')} busy={submission.pending} returnFocus={amendOpener} onClose={() => setAmending(false)}>
      <form noValidate onSubmit={async event => { event.preventDefault(); if (await submission.send({ workId, body: amendment.trim() })) { setAmending(false); setAmendment(''); } }}>
        <label>{t('alignmentMessage')}<textarea className="resize-none" rows={4} value={amendment} disabled={submission.pending || submission.uncertain} onChange={event => setAmendment(event.target.value)} /></label>
        <button className="btn primary" disabled={!amendment.trim() || submission.pending}>{t(submission.error ? 'newWorkRetrySend' : 'alignmentSend')}</button>
        {submission.error && <ErrorNotice error={submission.error} />}
      </form>
    </ActionDialog>}
    {preview.preview}
  </div>;
}
