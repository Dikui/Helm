import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { ApiClient, type Fetch } from './api.js';
import { readEvents, type Connection } from './events.js';
import type { HelmEvent } from './types.js';

type Listener = (event: HelmEvent) => void;
const DataContext = createContext<{ api: ApiClient; listeners: Set<Listener>; connection: Connection } | null>(null);
export function DataProvider({ children, baseUrl, transport }: { children: ReactNode; baseUrl?: string; transport?: Fetch }) {
  const api = useMemo(() => new ApiClient(baseUrl, transport), [baseUrl, transport]);
  const listeners = useMemo(() => new Set<Listener>(), [api]);
  const [connection, setConnection] = useState<Connection>('connecting');
  useEffect(() => {
    const controller = new AbortController();
    void readEvents(api, controller.signal, async event => {
      // Resources schedule their own reads; a slow panel must not hold up later events.
      for (const listener of listeners) listener(event);
    }, setConnection);
    return () => controller.abort();
  }, [api, listeners]);
  return <DataContext value={{ api, listeners, connection }}>{children}</DataContext>;
}
export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('DataProvider is required');
  return value;
}

export function useResource<T>(operation: string, params: object = {}, affects?: (event: HelmEvent) => boolean) {
  const { api, listeners } = useData();
  const key = JSON.stringify(params);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  const identity = `${operation}:${key}`;
  const [state, setState] = useState<{ identity: string; data?: T; error?: Error }>({ identity });
  useEffect(() => {
    const controller = new AbortController();
    const input = JSON.parse(key);
    let refreshing = false;
    let requested = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    const refresh = async (): Promise<void> => {
      requested = true;
      if (refreshing) return;
      refreshing = true;
      try {
        // Keep one read in flight and collapse notifications into a catch-up read.
        while (requested && !controller.signal.aborted) {
          requested = false;
          try {
            const data = await api.call<T>(operation, input, controller.signal);
            if (controller.signal.aborted) return;
            setState({ identity, data });
            clearTimeout(retry); retry = undefined; retryDelay = 1_000;
          } catch (error) {
            if (controller.signal.aborted) return;
            setState(previous => ({ identity,
              data: previous.identity === identity ? previous.data : undefined, error: error as Error }));
            // Failed reads retry independently; the event stream can keep delivering updates.
            retry ??= setTimeout(() => { retry = undefined; void refresh(); }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 30_000);
          }
        }
      } finally { refreshing = false; }
    };
    const listener: Listener = event => {
      const affected = affects ? affects(event) : !input.workId || event.workId === input.workId;
      if (affected) void refresh();
    };
    listeners.add(listener);
    void refresh().catch(() => {});
    return () => { controller.abort(); clearTimeout(retry); listeners.delete(listener); };
    // params are compared by value; callers keep custom predicates stable.
  }, [api, listeners, operation, key, identity, affects, version]);
  return { ...(state.identity === identity ? state : {}), reload };
}
