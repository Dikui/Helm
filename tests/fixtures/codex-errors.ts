// Fixed diagnostics from Codex/OpenAI, with account-specific details removed.
// Never provoke quota/auth failures live.
// Protocol: codex app-server v2 TurnError / CodexErrorInfo (0.163.0).
// CLI text: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/error_tests.rs
// API quota as rendered by CLI: https://github.com/openai/codex/blob/main/codex-rs/protocol/src/error.rs
// API messages: https://developers.openai.com/api/docs/guides/error-codes
export const codexErrors = [
  { name: 'subscription', quota: true, error: { message: 'You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again later.', codexErrorInfo: 'usageLimitExceeded' } },
  { name: 'API quota rendered by CLI', quota: true, error: { message: 'Quota exceeded. Check your plan and billing details.' } },
  { name: 'API balance', quota: true, error: { message: 'You exceeded your current quota, please check your plan and billing details.', additionalDetails: '{"type":"insufficient_quota","code":"insufficient_quota"}' } },
  { name: 'API key', quota: true, error: { message: 'Incorrect API key provided: REDACTED.', additionalDetails: '{"code":"invalid_api_key"}' } },
  { name: 'expired login', quota: true, error: { message: 'Authentication token has expired', codexErrorInfo: 'unauthorized' } },
  { name: 'HTTP 429', quota: false, error: { message: 'Rate limit reached for requests', codexErrorInfo: 'rateLimitExceeded' } },
  { name: 'network', quota: false, error: { message: 'stream disconnected before completion', codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 503 } } } },
  { name: 'context', quota: false, error: { message: 'Context window exceeded', codexErrorInfo: 'contextWindowExceeded' } },
] as const;
