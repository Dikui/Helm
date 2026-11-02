function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value : undefined; }

// Streamed assistant text arrives one fragment per native message; whitespace fragments are kept.
function chunkText(value: Record<string, unknown>): string | undefined {
  const params = object(value.params);
  const update = object(params.update);
  const raw = value.type === 'stream_event' && object(value.event).type === 'content_block_delta' && object(object(value.event).delta).type === 'text_delta'
    ? object(object(value.event).delta).text
    : value.method === 'item/agentMessage/delta' ? params.delta
    : value.method === 'session/update' && update.sessionUpdate === 'agent_message_chunk' ? object(update.content).text : undefined;
  return typeof raw === 'string' ? raw : undefined;
}
export function outputChunk(raw: string): string | undefined {
  try { return chunkText(object(JSON.parse(raw))); } catch { return undefined; }
}

// Drivers retain their native messages; only assistant text and tool activity
// belong in a readable summary. The caller keeps raw output for inspection.
export function outputSummary(raw: string, fallback = ''): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return text(raw) ?? fallback; }
  if (typeof parsed === 'string') return text(parsed) ?? fallback;
  const value = object(parsed);
  const chunk = chunkText(value);
  if (chunk !== undefined) return text(chunk) ?? fallback;
  if (value.type === 'plan') {
    const entries = Array.isArray(value.entries) ? value.entries.map(object) : [];
    return entries.filter(entry => entry.status === 'in_progress').map(entry => text(entry.content)).filter(Boolean).join(' · ')
      || entries.map(entry => text(entry.content)).filter(Boolean).join(' · ') || fallback;
  }
  if (value.type === 'assistant') {
    const message = object(value.message);
    const blocks = Array.isArray(message.content) ? message.content : [];
    const content = blocks.map(block => {
      const item = object(block);
      if (item.type === 'text') return text(item.text);
      if (item.type === 'tool_use') return [text(item.name), text(object(item.input).command)].filter(Boolean).join(' · ');
      return undefined;
    }).filter(Boolean).join(' · ');
    return content || fallback;
  }
  if (value.type === 'result') return text(value.result) ?? fallback;
  // SDK system, hook, rate-limit and tool-result envelopes are never summaries.
  if (value.type) return fallback;
  const params = object(value.params);
  if (value.method === 'item/started' || value.method === 'item/completed') {
    const item = object(params.item);
    if (item.type === 'agentMessage') return text(item.text) ?? fallback;
    if (item.type === 'commandExecution') return text(item.command) ?? fallback;
    if (item.type === 'mcpToolCall') return text(item.tool) ?? fallback;
  }
  if (value.method === 'session/update') {
    const update = object(params.update);
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      return text(update.title) ?? text(object(update.rawInput).command) ?? fallback;
    }
  }
  // The fake driver records tool calls at the same public output boundary.
  return text(value.tool) ?? fallback;
}
