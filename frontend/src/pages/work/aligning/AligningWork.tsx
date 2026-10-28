import { useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { useSendMessage } from '../../new-work/useSendMessage.js';
import { AttachmentList, AttachmentPicker, encodeFiles } from '../../../shared/attachments.js';
import { Markdown, useFilePreview } from '../../../shared/files.js';
import type { ConversationItem, WorkDescription } from './types.js';
import { Splitter, useStoredSize } from '../../../shared/Splitter.js';
import './aligning.css';

export function AligningWork({ workId, workBranch }: { workId: string; projectId: string; workBranch?: string | null }) {
  const { api } = useData();
  const { t, language } = useI18n();
  const workFiles = useResource<string[]>('list-work-files', { workId });
  const linkedFiles = new Set(workFiles.data ?? []);
  const conversation = useResource<ConversationItem[]>('get-conversation', { workId });
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId });
  const [version, setVersion] = useState<number>();
  const [confirming, setConfirming] = useState(false);
  const confirmationBusy = useRef(false);
  const [confirmError, setConfirmError] = useState<Error>();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const preview = useFilePreview(workId);
  const input = useRef<HTMLTextAreaElement>(null);
  const submission = useSendMessage();
  const versions = descriptions.data ?? [];
  const latest = versions.at(-1);
  const shown = version === undefined ? latest : versions.find(item => item.version === version);
  const previous = versions.find(item => item.version === (shown?.version ?? 0) - 1);
  const gate = conversation.data?.find(item => item.type === 'gate' && item.kind === 'work-confirmation' && item.status === 'pending');
  const canConfirm = Boolean(shown && gate?.type === 'gate' && gate.descriptionId === shown.id && latest?.id === shown.id
    && !confirming && !conversation.error && !descriptions.error);
  // Both visible entry points decide exactly the version currently shown in the brief panel.
  const confirm = async () => {
    if (!canConfirm || !shown || !gate || confirmationBusy.current) return;
    confirmationBusy.current = true; setConfirming(true); setConfirmError(undefined);
    try { await api.call('decide-gate', { workId, gateId: gate.id, descriptionId: shown.id, decision: 'confirm' }); }
    catch (error) { setConfirmError(error as Error); }
    finally { confirmationBusy.current = false; setConfirming(false); }
  };
  const send = async () => {
    if (!body.trim()) return;
    if (await submission.send({ workId, body: body.trim(), attachments: await encodeFiles(files) })) { setBody(''); setFiles([]); }
  };
  const confirmButton = <button className="btn primary" disabled={!canConfirm} onClick={() => void confirm()}>{t('confirm')}</button>;
  const chat = useRef<HTMLElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const [composerHeight, setComposerHeight] = useStoredSize('helm.aligning-composer-height');
  const copyNotice = workBranch && <p className="warn"><span>!</span><span>{t('alignmentCopyReady')}</span></p>;
  return <div className="aligning-work">
    <section className="aligning-chat" aria-label={t('chat')} aria-busy={submission.pending || confirming} ref={chat}>
      <div className="aligning-thread">
        <h2 className="sr">{t('chat')}</h2>
        {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
        {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
        {conversation.data?.map(item => item.type === 'message'
          ? <article key={item.id} className={item.sender === 'user' ? 'aligning-message me' : 'aligning-message'}><div className="aligning-who"><b>{t(item.sender === 'user' ? 'alignmentYou' : 'alignmentCoordinator')}</b>{item.withdrawnAt && <span className="pill">{t('conversationWithdrawn')}</span>}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time></div><Markdown text={item.body} workId={workId} files={linkedFiles} onOpen={preview.open} /><AttachmentList attachments={item.attachments} onOpen={preview.open} /></article>
          : item.kind === 'work-confirmation'
            ? item.status === 'pending' && <div className="aligning-gate gate-actions" key={item.id} role="group" aria-label={t('alignmentConfirmBrief')} onKeyDown={event => {
              if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
              if (event.key === '1') { event.preventDefault(); void confirm(); }
              if (event.key === '2') { event.preventDefault(); input.current?.focus(); }
            }}>
              <span className="pill att">{t('alignmentConfirmBrief')}{shown ? ` · v${shown.version}` : ''}</span><p>{shown ? t('alignmentConfirmBriefHint') : t('noDescription')}</p>
              <div className="opts"><button className="btn" disabled={!canConfirm} aria-keyshortcuts="1" onClick={() => void confirm()}>{t('confirm')}<kbd aria-hidden="true">1</kbd></button><button className="btn" aria-keyshortcuts="2" onClick={() => input.current?.focus()}>{t('alignmentNeedsChanges')}<kbd aria-hidden="true">2</kbd></button></div>
              {shown && <p className="hint">{t('alignmentBranchFrom')} <span className="ref">{shown.baseRef}@{shown.baseCommit.slice(0, 7)}</span> {t('alignmentCopyRefresh')}</p>}
            </div>
            : item.status === 'pending' && <GateDecision key={item.id} gate={item} />)}
        {confirmError && <ErrorNotice error={confirmError} />}
      </div>
      <Splitter label={t('resizeComposer')} orientation="horizontal" grow={-1} min={96} onResize={setComposerHeight}
        max={() => (chat.current?.getBoundingClientRect().height ?? 600) * .75} measure={() => composer.current?.getBoundingClientRect().height ?? 160} />
      <form className="aligning-composer" ref={composer} style={composerHeight ? { height: composerHeight } : undefined} noValidate onSubmit={event => { event.preventDefault(); void send(); }}>
        <label><span className="sr">{t('alignmentMessage')}</span><textarea className="resize-none" ref={input} value={body} disabled={submission.pending || submission.uncertain} placeholder={t('alignmentReply')}
          onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void send(); }
          }} /></label>
        <button className="btn primary send" disabled={submission.pending || !body.trim()}><span className="sr">{t(submission.error ? 'newWorkRetrySend' : 'alignmentSend')}</span><span aria-hidden="true">↑</span></button>
        <AttachmentPicker files={files} onChange={setFiles} disabled={submission.pending || submission.uncertain} />
        {submission.error && <ErrorNotice error={submission.error} />}
        {submission.uncertain && <p className="hint">{t('newWorkRetrySameMessage')}</p>}
      </form>
    </section>
    <aside className="aligning-brief" aria-label={t('brief')} aria-busy={confirming}>
      <header><h2>{t('brief')}</h2>{shown && <><span className="pill att">{t('alignmentUnconfirmed')}</span><label><span className="sr">{t('alignmentVersion')}</span><select value={shown.version} onChange={event => setVersion(Number(event.target.value))}>
        {[...versions].reverse().map(item => <option key={item.id} value={item.version}>v{item.version}</option>)}
      </select></label></>}</header>
      <div className="aligning-brief-body">
        {descriptions.error && <ErrorNotice error={descriptions.error} retry={descriptions.reload} />}
        {!descriptions.data && !descriptions.error && <p role="status">{t('loading')}</p>}
        {descriptions.data && !shown && <p>{t('noDescription')}</p>}
        {!shown && copyNotice}
        {shown && <>
          {(['requirements', 'boundary', 'criteria'] as const).map(field => {
            const oldLines = previous?.[field].split(/\r?\n/) ?? [];
            return <section key={field}><h3>{t(field)}</h3><ul>{shown[field].split(/\r?\n/).filter(line => line.trim()).map((line, index) =>
              <li key={index}>{previous && !oldLines.includes(line) ? <mark>{line}</mark> : line}</li>)}</ul></section>;
          })}
          <dl className="aligning-base"><dt>{t('newWorkBase')}</dt><dd><span className="ref">{shown.baseRef}</span> <span className="ref" title={shown.baseCommit}>{shown.baseCommit.slice(0, 7)}</span></dd><dt>{t('briefWorkBranch')}</dt><dd><span className="ref">{workBranch || `helm/${workId}`}</span>{!workBranch && <small className="muted"> · {t('alignmentBranchPending')}</small>}</dd></dl>
          {copyNotice}
          <p className="muted">{t('alignmentNewEntriesHint')}</p>
          {latest?.id !== shown.id && <p>{t('alignmentHistoricalDraft')}</p>}
        </>}
      </div>
      <footer>{confirmButton}</footer>
    </aside>
    {preview.preview}
  </div>;
}
