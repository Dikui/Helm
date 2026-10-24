import type { ApiClient } from './api.js';
import type { HelmEvent } from './types.js';

export type Connection = 'connecting' | 'connected' | 'reconnecting';
const pause = (signal: AbortSignal) => new Promise<void>(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, 500);
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});

// Cursor advances only after consumers have refreshed. A failed read is replayed on reconnect.
export async function readEvents(api: ApiClient, signal: AbortSignal,
  receive: (event: HelmEvent) => Promise<void>, connection: (value: Connection) => void) {
  let lastId: string | undefined;
  while (!signal.aborted) {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await api.transport(`${api.baseUrl}/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(lastId ? { 'Last-Event-ID': lastId } : {}) },
        body: '{}', signal,
      });
      if (!response.ok || !response.body) throw new Error('Event stream unavailable');
      connection('connected');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const lines = frame.split(/\r?\n/);
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          const id = lines.find(line => line.startsWith('id:'))?.slice(3).trim();
          if (data) await receive(JSON.parse(data) as HelmEvent);
          if (id) lastId = id;
        }
      }
    } catch {
      if (signal.aborted) return;
    } finally {
      await reader?.cancel().catch(() => {});
    }
    if (!signal.aborted) { connection('reconnecting'); await pause(signal); }
  }
}
