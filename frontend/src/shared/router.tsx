import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ComponentType, type MouseEvent, type ReactNode } from 'react';
export interface RouteParams { workId?: string; view?: string; section?: string; agentId?: string }
export interface RouteDefinition {
  pattern: RegExp; params: (match: RegExpMatchArray) => RouteParams; component: ComponentType<{ route: RouteParams }>;
}
interface Location { path: string; search: string }
const isNewWork = (path: string) => /^\/new\/?$/.test(path);
const Context = createContext<{ path: string; search: string; newWorkOpen: boolean; closeNewWork: () => void; navigate: (path: string, replace?: boolean) => void } | null>(null);
export function Router({ children }: { children: ReactNode }) {
  const readLocation = () => ({ path: window.location.pathname, search: window.location.search,
    background: window.history.state?.newWorkBackground as Location | undefined });
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const pop = () => setLocation(readLocation());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const newWorkOpen = isNewWork(location.path);
  const page = newWorkOpen ? location.background ?? { path: '/', search: '' } : location;
  const changeLocation = (next: string, replace: boolean, state: object | null = null) => {
    window.history[replace ? 'replaceState' : 'pushState'](state, '', next);
    setLocation(readLocation());
  };
  const navigate = (next: string, replace = false) => {
    const destination = new URL(next, window.location.origin);
    // SSE can change the background work's default inspector while a draft is open.
    if (newWorkOpen && replace && destination.pathname === page.path) {
      changeLocation(`${location.path}${location.search}`, true, { newWorkBackground: { path: destination.pathname, search: destination.search } });
    } else changeLocation(next, replace, isNewWork(destination.pathname) ? { newWorkBackground: { path: page.path, search: page.search } } : null);
  };
  return <Context value={{ path: page.path, search: page.search, newWorkOpen, navigate,
    closeNewWork: () => changeLocation(`${page.path}${page.search}`, true) }}>{children}</Context>;
}
export function useRouter() {
  const value = useContext(Context);
  if (!value) throw new Error('Router is required');
  return value;
}
export function Link({ href, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & { href: string; children: ReactNode }) {
  const { navigate } = useRouter();
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(href);
  };
  return <a {...props} href={href} onClick={click}>{children}</a>;
}
export function RouteOutlet({ routes }: { routes: RouteDefinition[] }) {
  const { path } = useRouter();
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) { const Page = route.component; return <Page route={route.params(match)} />; }
  }
  const Page = routes[0]!.component;
  return <Page route={{}} />;
}
