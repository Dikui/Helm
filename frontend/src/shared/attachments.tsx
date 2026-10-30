import { useRef } from 'react';
import { useResource } from './data.js';
import { useI18n } from './i18n.js';
import type { WorkSummary } from './types.js';

export interface Attachment { name: string; path: string; size: number }
export interface AttachmentUpload { name: string; content: string }

export function encodeFiles(files: File[]): Promise<AttachmentUpload[]> {
  return Promise.all(files.map(file => new Promise<AttachmentUpload>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, content: String(reader.result).slice(String(reader.result).indexOf(',') + 1) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));
}

export function AttachmentPicker({ files, onChange, disabled, references, onReferencesChange, workId }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean;
  references: string[]; onReferencesChange: (ids: string[]) => void; workId?: string }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const works = useResource<WorkSummary[]>('list-works');
  const title = (id: string) => works.data?.find(work => work.id === id)?.title || id.slice(0, 8);
  const choices = works.data?.filter(work => work.id !== workId && !references.includes(work.id)) ?? [];
  // A button rather than a label, so composer label styles never apply to it.
  return <div className="attachments">
    <button type="button" className="btn sm" disabled={disabled} onClick={() => input.current?.click()}>{t('attachFiles')}</button>
    <input ref={input} type="file" multiple hidden onChange={event => {
      // A same-name file replaces the earlier pick, matching the server's one-name-per-message rule.
      const added = [...event.target.files ?? []];
      onChange([...files.filter(file => !added.some(item => item.name === file.name)), ...added]);
      event.target.value = '';
    }} />
    {/* The server turns each referenced work into a snapshot attachment the agents read on demand. */}
    <select className="btn sm" aria-label={t('referenceWork')} value="" disabled={disabled || !choices.length}
      onChange={event => onReferencesChange([...references, event.target.value])}>
      <option value="" disabled>{t('referenceWork')}</option>
      {choices.map(work => <option key={work.id} value={work.id}>{work.title || work.id.slice(0, 8)}</option>)}
    </select>
    {references.map(id => <span key={id} className="pill attachment"><span>{t('referenceWorkPrefix')}{title(id)}</span>
      <button type="button" disabled={disabled} aria-label={`${t('removeAttachment')} ${title(id)}`}
        onClick={() => onReferencesChange(references.filter(item => item !== id))}>×</button></span>)}
    {files.map(file => <span key={file.name} className="pill attachment"><span>{file.name}</span>
      <button type="button" disabled={disabled} aria-label={`${t('removeAttachment')} ${file.name}`}
        onClick={() => onChange(files.filter(item => item !== file))}>×</button></span>)}
  </div>;
}

export function AttachmentList({ attachments, onOpen }: { attachments?: Attachment[]; onOpen: (path: string, opener: HTMLElement) => void }) {
  const { t } = useI18n();
  if (!attachments?.length) return null;
  return <ul className="attachments" aria-label={t('attachments')}>
    {attachments.map(item => <li key={item.path} className="pill attachment" id={`attachment-${encodeURIComponent(item.path)}`} title={item.path}>
      <a href={`#attachment-${encodeURIComponent(item.path)}`} onClick={event => { event.preventDefault(); onOpen(item.path, event.currentTarget); }}>{item.name}</a></li>)}
  </ul>;
}
