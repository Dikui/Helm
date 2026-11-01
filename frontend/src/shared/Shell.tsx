import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Inbox } from '../pages/inbox/Inbox.js';
import { OutputWarning } from '../pages/work/OutputWarning.js';
import { routes } from '../routes.js';
import { useI18n } from './i18n.js';
import { RouteOutlet, useRouter } from './router.js';
import { Splitter, useStoredSize } from './Splitter.js';
import { InspectorContext } from './Inspector.js';
import { NewWorkDialog } from '../pages/new-work/NewWorkDialog.js';

function useStoredFold(key: string) {
  const [folded, setFolded] = useState(() => {
    try { return localStorage.getItem(key) === 'true'; } catch { return false; }
  });
  return [folded, (value: boolean) => {
    setFolded(value);
    try { localStorage.setItem(key, String(value)); } catch { /* 只影响记忆 */ }
  }] as const;
}

function useViewportWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return width;
}

export function Shell() {
  const { t } = useI18n();
  const { path, newWorkOpen, closeNewWork } = useRouter();
  const newWorkShown = useRef(false);
  if (newWorkOpen) newWorkShown.current = true;
  const width = useViewportWidth();
  const narrow = width <= 680;
  const stacked = width <= 980;
  const [leftFolded, setLeftFolded] = useStoredFold('helm.inbox-folded');
  const [rightFolded, setRightFolded] = useStoredFold('helm.inspector-folded');
  const [sidebar, setSidebar] = useStoredSize('helm.sidebar-width');
  const [inspectorWidth, setInspectorWidth] = useStoredSize('helm.inspector-width');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileRightFolded, setMobileRightFolded] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const shell = useRef<HTMLDivElement>(null);
  const inbox = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const [inspectorContent, setInspectorContent] = useState<HTMLDivElement | null>(null);
  const [inspectorHeading, setInspectorHeading] = useState<HTMLElement | null>(null);
  const [inspectorRail, setInspectorRail] = useState<HTMLElement | null>(null);
  const [workHeader, setWorkHeader] = useState<HTMLDivElement | null>(null);
  const hasInspector = /^\/works\/[^/]+/.test(path);
  const folded = narrow ? !drawerOpen : leftFolded;
  const inspectFolded = stacked ? mobileRightFolded : rightFolded;
  const toggleInbox = () => narrow ? setDrawerOpen(!drawerOpen) : setLeftFolded(!leftFolded);
  const toggleInspector = () => stacked ? setMobileRightFolded(!mobileRightFolded) : setRightFolded(!rightFolded);
  const search = () => { if (narrow) setDrawerOpen(true); else setLeftFolded(false); setSearchRequest(value => value + 1); };
  useEffect(() => { setDrawerOpen(false); }, [path, narrow]);
  useEffect(() => { if (!stacked) setMobileRightFolded(false); }, [stacked]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || shell.current?.inert) return;
      const modal = document.querySelector('[aria-modal="true"]');
      if (modal && modal !== inbox.current) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (event.key.toLowerCase() === 'k') { event.preventDefault(); search(); }
        // 走同一个链接，设置页既有的未保存保护也能拦住快捷键。
        if (event.key.toLowerCase() === 'n') {
          event.preventDefault();
          const trigger = inbox.current?.querySelector<HTMLAnchorElement>('a[href="/new"]');
          trigger?.focus(); trigger?.click();
        }
        return;
      }
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (event.key === '[') { event.preventDefault(); toggleInbox(); }
      if (event.key === '\\' && hasInspector) { event.preventDefault(); toggleInspector(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    inbox.current?.querySelector('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); setDrawerOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = [...inbox.current!.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      // 抽屉关闭后竖条重新挂载，再把焦点交还展开按钮。
      queueMicrotask(() => inbox.current?.querySelector<HTMLButtonElement>('[aria-controls="inbox-content"]')?.focus());
    };
  }, [narrow, drawerOpen]);
  const sidebarMax = () => Math.min(560, width - (hasInspector && !stacked ? 630 : 480));
  const sidebarSize = Math.max(220, Math.min(sidebar ?? (width <= 1200 ? 230 : 272), sidebarMax()));
  const workspaceWidth = width - (folded ? 52 : sidebarSize);
  const inspectorMax = () => Math.max(330, workspaceWidth - 300);
  const inspectorSize = Math.max(330, Math.min(inspectorWidth ?? workspaceWidth * .487, inspectorMax()));
  const measuredInspector = () => inspector.current?.getBoundingClientRect().width || inspectorSize;
  const wide = !stacked && inspectorWidth !== undefined && inspectorWidth >= inspectorMax() - 1;
  const inspectorWide = hasInspector && wide && !inspectFolded;
  const style = {
    ...(sidebar ? { '--sidebar-w': `${sidebarSize}px` } : {}),
    ...(!stacked && inspectorWidth ? { '--inspector-w': `${inspectorSize}px` } : {}),
  } as CSSProperties;
  return <><div className={`shell${folded ? ' inbox-folded' : ''}${narrow && drawerOpen ? ' drawer-open' : ''}`} ref={shell} style={style}>
    {narrow && drawerOpen && <button className="inbox-backdrop" aria-label={t('shellCloseBackdrop')} onClick={() => setDrawerOpen(false)} tabIndex={-1} />}
    <div id="inbox-content" className="inbox-pane" ref={inbox} role={narrow && drawerOpen ? 'dialog' : undefined} aria-modal={narrow && drawerOpen ? true : undefined} aria-label={narrow && drawerOpen ? t('shellInbox') : undefined}
      onClick={event => { if (narrow && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (event.target as Element).closest('a[href]')) setDrawerOpen(false); }}>
      <Inbox folded={folded} drawer={narrow && drawerOpen} onToggle={toggleInbox} searchRequest={searchRequest} />
    </div>
    {!folded && !narrow && <Splitter label={t('resizeSidebar')} orientation="vertical" min={220} max={sidebarMax} onResize={setSidebar} value={sidebarSize}
      measure={() => inbox.current?.getBoundingClientRect().width || sidebarSize} />}
    <InspectorContext value={{ content: inspectorContent, heading: inspectorHeading, rail: inspectorRail, header: workHeader, wide, width: inspectorWidth,
      reveal: () => stacked ? setMobileRightFolded(false) : setRightFolded(false),
      focusConversation: () => { if (narrow) setDrawerOpen(false); else setLeftFolded(true); if (stacked) setMobileRightFolded(true); else setRightFolded(true); } }}>
    <div className={`workspace${hasInspector ? ' with-inspector' : ''}${inspectFolded ? ' inspector-folded' : inspectorWide ? ' inspector-wide' : ''}`} inert={narrow && drawerOpen ? true : undefined}>
      {hasInspector && <div className="workspace-header" ref={setWorkHeader} />}
      <main className="inset" aria-hidden={inspectorWide ? true : undefined} inert={inspectorWide ? true : undefined}><OutputWarning /><RouteOutlet routes={routes} /></main>
      {hasInspector && <>
        {!inspectFolded && !stacked && <Splitter label={t('shellResizeInspector')} orientation="vertical" grow={-1} min={330} max={inspectorMax} measure={measuredInspector} onResize={setInspectorWidth} value={inspectorSize} />}
        <aside className="shell-inspector" ref={inspector} aria-label={t('shellInspector')}>
          {inspectFolded && <button type="button" className="inspector-rail" aria-label={t('shellExpandInspector')} title={`${t('shellExpandInspector')} (\\)`} onClick={toggleInspector}><span ref={setInspectorRail} /></button>}
          <div hidden={inspectFolded}>
            <div className="inspector-heading"><b ref={setInspectorHeading} />
              {!stacked && <button type="button" className="shell-fold" aria-label={t(wide ? 'shellNarrowInspector' : 'shellWidenInspector')} onClick={() => setInspectorWidth(wide ? undefined : inspectorMax())}>{wide ? '⇥' : '⇤'} {t(wide ? 'shellNarrow' : 'shellWiden')}</button>}
              <button type="button" className="shell-fold" aria-label={t('shellCollapseInspector')} title={`${t('shellCollapseInspector')} (\\)`} onClick={toggleInspector}>{t('shellCollapse')} ⇥</button>
            </div><div className="inspector-content" ref={setInspectorContent} /></div>
        </aside>
      </>}
    </div>
    </InspectorContext>
  </div>{newWorkShown.current && <NewWorkDialog open={newWorkOpen} onClose={closeNewWork} />}</>;
}
