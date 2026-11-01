import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ComponentType, type MouseEvent, type ReactNode } from 'react';
export interface RouteParams { workId?: string; view?: string; section?: string; agentId?: string }
export interface RouteDefinition {
  pattern: RegExp; params: (match: RegExpMatchArray) => RouteParams; component: ComponentType<{ route: RouteParams }>;
}
const Context = createContext<{ path: string; search: string; navigate: (path: string, replace?: boolean) => void } | null>(null);
export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({ path: window.location.pathname, search: window.location.search }));
  useEffect(() => {
    const pop = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const navigate = (next: string, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
    setLocation({ path: window.location.pathname, search: window.location.search });
  };
  return <Context value={{ ...location, navigate }}>{children}</Context>;
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
