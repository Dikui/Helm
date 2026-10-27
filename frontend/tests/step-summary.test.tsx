import { expect, test } from 'vitest';
import { isHousekeeping } from '../src/shared/step-summary.js';

test('CLI 的 hook、系统、限额和会话状态事件算流水，工具调用和普通输出不算', () => {
  for (const raw of [{ type: 'system', subtype: 'init' }, { type: 'system', subtype: 'hook_started' }, { type: 'hook_response' },
    { type: 'rate_limit_event' }, { type: 'stream_event' }, { method: 'thread/tokenUsage/updated' }, { method: 'turn/started' }])
    expect(isHousekeeping(JSON.stringify(raw))).toBe(true);
  for (const raw of [JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({ method: 'turn/completed' }), '普通文字输出'])
    expect(isHousekeeping(raw)).toBe(false);
});
