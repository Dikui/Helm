function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' && value.trim() ? value : undefined; }

// Drivers retain their native messages. Pull visible text/tool names out of known
// shapes while keeping the full raw output available in the step's details.
export function outputSummary(raw: string, fallback: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (typeof parsed === 'string') return parsed;
  const value = object(parsed);
  const message = object(value.message);
  const blocks = Array.isArray(message.content) ? message.content : [];
  const content = blocks.map(block => { const item = object(block); return text(item.text) ?? text(item.name); }).filter(Boolean).join(' · ');
  const params = object(value.params);
  const item = object(params.item);
  const update = object(params.update);
  return content || text(item.text) || text(item.command) || text(item.tool) || text(params.delta)
    || text(object(update.content).text) || text(update.title) || text(value.tool) || text(value.text) || text(value.result)
    || text(object(object(value.event).delta).text) || fallback;
}
