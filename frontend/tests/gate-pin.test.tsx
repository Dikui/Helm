import { useState } from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataProvider, useResource } from '../src/shared/data.js';
import { I18nProvider } from '../src/shared/i18n.js';
import { GatePin } from '../src/pages/work/GatePin.js';

afterEach(() => { cleanup(); localStorage.clear(); });

function LoadedPin() {
  const { data } = useResource<boolean>('get-work', { workId: 'work' });
  const [activated, setActivated] = useState(false);
  return data ? <GatePin label="待决定" source="关卡" title="选择方向">
    <button aria-keyshortcuts="1" onClick={() => setActivated(true)}>采用新方向</button>
    {activated && <output>已采用新方向</output>}
  </GatePin> : null;
}

// regression, small — #21：HTTP 异步刷新后，钉栏首次显示就必须可以用数字键操作。
// 传输替身控制资源到达；MutationObserver 在真实 DOM 出现时发出按键。
test('异步刷新的钉栏首次显示时数字键已经可用', async () => {
  let respond!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.close(), { once: true }); },
    }));
    return response;
  };
  const observer = new MutationObserver(() => {
    if (!screen.queryByRole('group', { name: '待决定' })) return;
    observer.disconnect();
    fireEvent.keyDown(window, { key: '1' });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    render(<DataProvider transport={transport}><I18nProvider><LoadedPin /></I18nProvider></DataProvider>);
    respond(Response.json({ ok: true, result: true }));
    await waitFor(() => expect(screen.getByText('已采用新方向')).toBeTruthy());
  } finally { observer.disconnect(); }
});
