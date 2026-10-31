import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { ApiClient, type Fetch } from './api.js';
import { readEvents, type Connection } from './events.js';
import type { HelmEvent } from './types.js';

type Listener = (event: HelmEvent) => Promise<void>;
const DataContext = createContext<{ api: ApiClient; listeners: Set<Listener>; connection: Connection } | null>(null);
export function DataProvider({ children, baseUrl, transport }: { children: ReactNode; baseUrl?: string; transport?: Fetch }) {
  const api = useMemo(() => new ApiClient(baseUrl, transport), [baseUrl, transport]);
  const listeners = useMemo(() => new Set<Listener>(), [api]);
  const [connection, setConnection] = useState<Connection>('connecting');
  useEffect(() => {
    const controller = new AbortController();
    void readEvents(api, controller.signal, async event => {
      await Promise.all([...listeners].map(listener => listener(event)));
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
    let queued = Promise.resolve();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1_000;
    const refresh = (): Promise<void> => {
      // Serialize refreshes so an earlier response cannot overwrite a newer read.
      queued = queued.catch(() => {}).then(async () => {
        if (controller.signal.aborted) return;
        try {
          const data = await api.call<T>(operation, input, controller.signal);
          if (controller.signal.aborted) return;
          setState({ identity, data });
          clearTimeout(retry); retry = undefined; retryDelay = 1_000;
        } catch (error) {
          if (controller.signal.aborted) return;
          setState(previous => ({ identity,
            data: previous.identity === identity ? previous.data : undefined, error: error as Error }));
          // A failed read retries on its own with backoff so no update is lost. Failing the event
          // stream instead would show "connection lost" and replay in a loop while the read keeps failing.
          retry ??= setTimeout(() => { retry = undefined; void refresh(); }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      });
      return queued;
    };
    const listener: Listener = event => {
      const affected = affects ? affects(event) : !input.workId || event.workId === input.workId;
      return affected ? refresh() : Promise.resolve();
    };
    listeners.add(listener);
    void refresh().catch(() => {});
    return () => { controller.abort(); clearTimeout(retry); listeners.delete(listener); };
    // params are compared by value; callers keep custom predicates stable.
  }, [api, listeners, operation, key, identity, affects, version]);
  return { ...(state.identity === identity ? state : {}), reload };
}
