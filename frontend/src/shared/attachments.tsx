import { useRef } from 'react';
import { useI18n } from './i18n.js';

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

export function AttachmentPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  // A button rather than a label, so composer label styles never apply to it.
  return <div className="attachments">
    <button type="button" className="btn sm" disabled={disabled} onClick={() => input.current?.click()}>{t('attachFiles')}</button>
    <input ref={input} type="file" multiple hidden onChange={event => {
      // A same-name file replaces the earlier pick, matching the server's one-name-per-message rule.
      const added = [...event.target.files ?? []];
      onChange([...files.filter(file => !added.some(item => item.name === file.name)), ...added]);
      event.target.value = '';
    }} />
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
