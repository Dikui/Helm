import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ActionDialog } from '../pages/work/ActionDialog.js';
import { useData, useResource } from './data.js';
import { ErrorNotice } from './feedback.js';
import { useI18n } from './i18n.js';
import type { HelmEvent } from './types.js';

const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
type Open = (path: string, opener: HTMLElement) => void;
// useResource re-reads whenever its predicate changes identity, so predicates must stay stable.
const never = () => false;

function resolvePath(base: string, href: string) {
  if (/^[a-z][a-z0-9+.-]*:|^[/#?]/i.test(href)) return null;
  try { return decodeURIComponent(new URL(href, `file:///${base}`).pathname.slice(1)); }
  catch { return null; }
}

// Paths in code spans, links and images that exist on the work branch become file links.
export function renderMarkdown(text: string, files: ReadonlySet<string>, base = '') {
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false }), { RETURN_DOM_FRAGMENT: true });
  const find = (target: string) => [resolvePath(base, target), resolvePath('', target)].find(path => path && files.has(path));
  for (const link of fragment.querySelectorAll('a[href]')) {
    const path = find(link.getAttribute('href')!);
    if (path) { link.setAttribute('href', '#'); link.setAttribute('data-file', path); }
    else { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
  }
  for (const code of fragment.querySelectorAll('code')) {
    const path = !code.closest('pre, a') && find(code.textContent!.trim());
    if (!path) continue;
    const link = document.createElement('a');
    link.setAttribute('href', '#');
    link.setAttribute('data-file', path);
    code.replaceWith(link);
    link.append(code);
  }
  for (const image of fragment.querySelectorAll('img')) {
    const path = find(image.getAttribute('src') ?? '');
    // Helm does not serve work files by URL, and remote images would load from agent-chosen hosts.
    image.removeAttribute('src');
    if (path) image.setAttribute('data-file', path);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

export function Markdown({ text, workId, files, base = '', onOpen }: { text: string; workId: string; files: ReadonlySet<string>; base?: string; onOpen: Open }) {
  const { api } = useData();
  const container = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(text, files, base), [text, files, base]);
  useEffect(() => {
    let live = true;
    for (const image of container.current!.querySelectorAll<HTMLImageElement>('img[data-file]')) {
      const path = image.dataset.file!;
      api.call<{ content: string }>('read-work-file', { workId, path, encoding: 'base64' })
        .then(file => { if (live) image.src = `data:${imageTypes[extension(path)] ?? 'application/octet-stream'};base64,${file.content}`; }, () => {});
    }
    return () => { live = false; };
  }, [html, api, workId]);
  return <div ref={container} className="markdown" dangerouslySetInnerHTML={{ __html: html }} onClick={event => {
    const link = (event.target as Element).closest<HTMLElement>('a[data-file]');
    if (!link) return;
    event.preventDefault();
    onOpen(link.dataset.file!, link);
  }} />;
}

// The branch only changes before the coordinator reports it, so a new message is the refresh point.
export function useWorkFiles(workId: string) {
  const affects = useCallback((event: HelmEvent) => event.workId === workId && event.action === 'message-sent', [workId]);
  const files = useResource<string[]>('list-work-files', { workId }, affects);
  return useMemo(() => new Set(files.data ?? []), [files.data]);
}

function FilePreview({ workId, path, onOpen, onClose, returnFocus }: { workId: string; path: string; onOpen: Open; onClose: () => void; returnFocus: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const files = useWorkFiles(workId);
  const kind = extension(path);
  const image = imageTypes[kind];
  const file = useResource<{ content: string }>('read-work-file', { workId, path, encoding: image ? 'base64' : 'utf8' }, never);
  const content = file.data?.content;
  return <ActionDialog title={path} busy={false} onClose={onClose} returnFocus={returnFocus} className="file-preview">
    {file.error && <ErrorNotice error={file.error} retry={file.reload} />}
    {content === undefined ? !file.error && <p role="status">{t('loading')}</p>
      : image ? <img src={`data:${image};base64,${content}`} alt={path} />
      : kind === 'md' || kind === 'markdown' ? <Markdown text={content} workId={workId} files={files} base={path.slice(0, path.lastIndexOf('/') + 1)} onOpen={onOpen} />
      // No allow-same-origin: scripts run, but cannot reach Helm's page or API.
      : kind === 'html' || kind === 'htm' ? <iframe title={path} sandbox="allow-scripts" srcDoc={content} />
      : content.includes('\0') ? <p>{t('filePreviewBinary')}</p> : <pre>{content}</pre>}
  </ActionDialog>;
}

export function useFilePreview(workId: string) {
  const [path, setPath] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback<Open>((next, from) => { opener.current = from; setPath(next); }, []);
  const preview = path === null ? null
    : <FilePreview workId={workId} path={path} onOpen={next => setPath(next)} onClose={() => setPath(null)} returnFocus={opener} />;
  return { open, preview };
}
