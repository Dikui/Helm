import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DataProvider, useResource } from '../src/shared/data.js';
import type { HelmEvent } from '../src/shared/types.js';

afterEach(cleanup);

function Resource({ workId = 'work' }: { workId?: string }) {
  const { data } = useResource<number>('get-work', { workId });
  return <output aria-label="工作进展">{data}</output>;
}

// regression, small — #21。HTTP / SSE 传输替身模拟连续事件和一份尚未完成的旧响应。
test('资源读取期间的连续事件合并为一次补读，最终显示最新状态', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let value = 0;
  let reads = 0;
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
      },
    }));
    reads++;
    active++;
    maxActive = Math.max(maxActive, active);
    const snapshot = value;
    if (reads === 2) await hold;
    active--;
    return Response.json({ ok: true, result: snapshot });
  };
  const emit = (id: number) => {
    value = id;
    const event: HelmEvent = { id, time: '2026-11-04T00:00:00.000Z', workId: 'work', cardId: null, dispatchId: null,
      object: { type: 'work', id: 'work' }, action: 'message-sent', details: {} };
    stream.enqueue(new TextEncoder().encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
  };
  render(<DataProvider transport={transport}><Resource /></DataProvider>);
  await waitFor(() => expect(screen.getByLabelText('工作进展').textContent).toBe('0'));
  emit(1);
  await waitFor(() => expect(reads).toBe(2));
  for (let id = 2; id <= 30; id++) emit(id);
  // Let the stream consume the burst while its resource read is still held.
  await new Promise(resolve => setTimeout(resolve, 0));
  release();
  await waitFor(() => expect(screen.getByLabelText('工作进展').textContent).toBe('30'));
  expect(maxActive).toBe(1);
  expect(reads).toBe(3); // Initial read, held read, one catch-up read: bounded HTTP traffic.
});

// spec, small — #21 的刷新隔离边界；传输替身故意允许取消后的旧响应到达。
test('切换工作会取消旧读取，迟到的旧响应不会覆盖当前工作', async () => {
  let oldSignal: AbortSignal | null | undefined;
  let release!: () => void;
  let delivered = false;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.close(), { once: true }); },
    }));
    const params = JSON.parse(String(init?.body));
    if (params.workId === 'old') {
      oldSignal = init?.signal;
      await hold;
      delivered = true;
      return Response.json({ ok: true, result: 1 });
    }
    return Response.json({ ok: true, result: 2 });
  };
  const view = render(<DataProvider transport={transport}><Resource workId="old" /></DataProvider>);
  await waitFor(() => expect(oldSignal).toBeTruthy());
  view.rerender(<DataProvider transport={transport}><Resource workId="current" /></DataProvider>);
  await waitFor(() => expect(screen.getByLabelText('工作进展').textContent).toBe('2'));
  expect(oldSignal!.aborted).toBe(true);
  release();
  await waitFor(() => expect(delivered).toBe(true));
  expect(screen.getByLabelText('工作进展').textContent).toBe('2');
});
