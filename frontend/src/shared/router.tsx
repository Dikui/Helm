import { createContext, useContext, useEffect, useState, type ComponentType, type MouseEvent, type ReactNode } from 'react';
export interface RouteParams { workId?: string; view?: string; section?: string; agentId?: string }
export interface RouteDefinition {
  pattern: RegExp; params: (match: RegExpMatchArray) => RouteParams; component: ComponentType<{ route: RouteParams }>;
}
const Context = createContext<{ path: string; navigate: (path: string) => void } | null>(null);
export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const navigate = (next: string) => { window.history.pushState(null, '', next); setPath(window.location.pathname); };
  return <Context value={{ path, navigate }}>{children}</Context>;
}
export function useRouter() {
  const value = useContext(Context);
  if (!value) throw new Error('Router is required');
  return value;
}
export function Link({ href, children, ...props }: { href: string; children: ReactNode; className?: string; 'aria-current'?: 'page' | undefined }) {
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
