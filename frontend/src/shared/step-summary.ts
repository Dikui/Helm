import { outputSummary } from '../../../src/output-summary.js';
import type { MessageKey } from './i18n.js';

export function stepSummary(raw: string, t: (key: MessageKey) => string): string {
  const summary = outputSummary(raw);
  if (summary) return summary;
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  let value: Record<string, unknown>;
  try { value = object(JSON.parse(raw)); } catch { return t('conversationOutput'); }
  if (value.type === 'user') {
    const content = object(value.message).content;
    const results = Array.isArray(content) ? content.map(object).filter(item => item.type === 'tool_result') : [];
    if (results.length) {
      const result = results.map(item => typeof item.content === 'string' ? item.content : Array.isArray(item.content)
        ? item.content.map(object).filter(block => block.type === 'text').map(block => block.text).filter(text => typeof text === 'string').join('\n') : '')
        .join('\n').split(/\r?\n/).find(line => line.trim());
      return `${t('conversationToolResult')}${result ? ` · ${result.trim()}` : ''}`;
    }
  }
  if (value.type === 'system') {
    if (value.subtype === 'init') return t('conversationSessionInit');
    if (typeof value.subtype === 'string' && value.subtype.startsWith('hook_')) return `${t('conversationHook')} · ${value.subtype}`;
    return `${t('conversationSystem')}${typeof value.subtype === 'string' ? ` · ${value.subtype}` : ''}`;
  }
  if (typeof value.type === 'string' && value.type.startsWith('hook_')) return `${t('conversationHook')} · ${value.type}`;
  if (value.type === 'rate_limit_event') return t('conversationRateLimit');
  if (value.type === 'stream_event') return t('conversationStream');
  if (value.type === 'result') return t('conversationRoundEnded');
  const notifications: Record<string, MessageKey> = {
    'thread/tokenUsage/updated': 'conversationTokenUsage', 'account/rateLimits/updated': 'conversationRateLimit',
    'thread/status/changed': 'conversationThreadStatus', 'thread/started': 'conversationSessionInit',
    'turn/started': 'conversationTurnStarted', 'turn/completed': 'conversationRoundEnded',
  };
  const key = typeof value.method === 'string' ? notifications[value.method] : undefined;
  if (key) return t(key);
  return t('conversationOutput');
}

