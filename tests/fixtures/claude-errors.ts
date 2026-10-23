import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import type { EndReason } from '../../src/driver.js';

// Collected from first-hand reports in the official Claude Code issue tracker,
// 2026-10-23. Text is an excerpt of the reported diagnostic, not a full SDK
// transcript; tests supply the SDK envelope separately. No credentials included.
// On a real quota failure, retain the raw assistant/result/rate_limit_event
// messages from the dispatch/round output, redact credentials and personal data,
// and add a new fixture plus regression case here before changing recognition.
// Record the CLI version and the output/evidence reference alongside its source.
export const claudeErrors = [
  {
    name: 'subscription limit',
    source: 'https://github.com/anthropics/claude-code/issues/40485',
    text: "You've hit your limit · resets 12pm (America/Chicago)",
    error: 'rate_limit', reason: 'quota-exhausted',
  },
  {
    name: 'subscription session limit',
    source: 'https://github.com/anthropics/claude-code/issues/64328',
    text: "You've hit your session limit · resets 10:10pm (Europe/Kiev)",
    error: 'rate_limit', reason: 'quota-exhausted',
  },
  {
    name: 'subscription extra usage exhausted',
    source: 'https://github.com/anthropics/claude-code/issues/39198',
    text: "You're out of extra usage · resets 3am (America/Los_Angeles)",
    error: 'rate_limit', reason: 'quota-exhausted',
  },
  {
    name: 'API credit balance',
    source: 'https://github.com/anthropics/claude-code/issues/34522',
    text: 'Your credit balance is too low to access the Anthropic API.',
    error: 'billing_error', reason: 'quota-exhausted',
  },
  {
    name: 'API credit balance rendered by CLI',
    source: 'https://github.com/anthropics/claude-code/issues/34522',
    text: 'Credit balance too low · Add funds:',
    error: 'billing_error', reason: 'quota-exhausted',
  },
  {
    name: 'invalid external API key',
    source: 'https://github.com/anthropics/claude-code/issues/9694',
    text: 'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    error: 'authentication_failed', reason: 'quota-exhausted',
  },
  {
    name: 'invalid API key rendered by CLI',
    source: 'https://github.com/anthropics/claude-code/issues/9694',
    text: 'Invalid API key · Fix external API key',
    error: 'authentication_failed', reason: 'quota-exhausted',
  },
  {
    name: 'invalid API bearer token',
    source: 'https://github.com/anthropics/claude-code/issues/12204',
    text: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}',
    error: 'authentication_failed', reason: 'quota-exhausted',
  },
  {
    name: 'transient 429',
    source: 'https://github.com/anthropics/claude-code/issues/64030',
    text: 'Server is temporarily limiting requests (not your usage limit) · Rate limited',
    error: 'rate_limit', reason: 'error',
  },
] as const satisfies readonly {
  name: string; source: string; text: string; error: SDKAssistantMessageError; reason: EndReason;
}[];
