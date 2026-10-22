# 统计 agent CLI 在 Helm 里消耗的订阅额度

2026-10-22，Grok（grok-4.7）联网调研，供 [v1 最小可验证版本切分](../../.scratch/helm-v1/issues/15-v1-slice.md) 使用。

## 结论摘要

四家都能拿到「这一次调用自己花了多少 token」。能换成订阅百分比的，只有账户级剩余额度，而且那一份是 Helm 和 Helm 之外共用的。美元字段是客户端按标价估的，不能当成套餐扣了多少。

要按 Helm 归因，应在每轮结束时记下该驱动报出的 token，并用 Helm 自己的 session id 去对本地日志。账户百分比只能回答「这个订阅还剩多少」，回答不了「其中多少是 Helm 用的」。同一时间还有网页、桌面或其他 CLI 在跑时，用前后百分比相减也会算错。

## 1. 一轮结束时各驱动报告什么

### Claude Agent SDK

`query()` 结束时，流里有一条 `type: "result"` 的 `SDKResultMessage`。成功和几种错误子类型都带这三项：

| 字段 | 位置 | 计什么 |
|---|---|---|
| `usage` | result 消息 | 这一轮主循环的 token。不含子 agent。流式输入会话里按轮计算 |
| `modelUsage` | result 消息 | 按模型拆开。含主循环、子 agent、压缩等走 query 管道的调用。权限分类器和 token 计数请求除外 |
| `total_cost_usd` | result 消息 | 与 `modelUsage` 同一批调用的累计美元估计 |

`modelUsage` 每项是 `ModelUsage`：`inputTokens`、`outputTokens`、`cacheReadInputTokens`、`cacheCreationInputTokens`、`webSearchRequests`、`costUSD`、`contextWindow`、`maxOutputTokens`，以及较新版本才有的 `thinkingTokens`、`canonicalModel`、`provider`、`costBasis`。`usage` 是 Anthropic SDK 的 `BetaUsage`：`input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens` 等。

助手消息上另有逐步用量：`message.message.id` 与 `message.message.usage`。同一轮里多条工具消息会共用一个 id，要按 id 去重。

订阅登录时，这些字段仍然有值。`total_cost_usd` 和 `costUSD` 是客户端用随 SDK 打包的价表、从接口返回的 token 数本地算出来的。`costBasis: "list"` 表示标价。官方写明这是估计，不能当账单，也不要用来向别人收费。Pro、Max 的 `/usage` 里，会话块的美元数同样是本地按标价估算的；订阅用户真正对应套餐的是计划用量条。Anthropic 没有公布五小时或每周限额对应多少 token，所以这些美元和 token 都换算不成「扣了套餐的百分之几」。

计划剩余量不在 result 消息上。两条官方出口：

- 状态行输入里的 `rate_limits`。只对 claude.ai 的 Pro、Max 出现，而且要等这次会话的第一次 API 响应之后。`five_hour` 与 `seven_day` 各有 `used_percentage`（0–100）和 `resets_at`（Unix 秒）。这是账户级的，含网页、桌面和别的 Claude Code。
- 让会话执行 `/usage` 后，送回结果的那条 `SDKAssistantMessage` 上有实验字段 `usage_report`（`SDKUsageReport`，SDK v0.3.273+，形状可能变）。`session` 与 result 上的账本相同；`rate_limits.limits[]` 有 `kind`、`group`、`percent`、`resets_at`；`extra_usage` 是 usage credits。OAuth 没有 `user:profile` 时 `rate_limits` 为 null。

来源：[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)、[Costs](https://code.claude.com/docs/en/costs)、[Status line](https://code.claude.com/docs/en/statusline)

### Codex app-server

回合进行中就会推 `thread/tokenUsage/updated`，不只在回合结束。v2 参数：

- `threadId`、`turnId`
- `tokenUsage.last`：最近一次请求的 `inputTokens`、`outputTokens`、`cachedInputTokens`、`reasoningOutputTokens`、`totalTokens`
- `tokenUsage.total`：这个线程的累计，不是当前上下文占用
- `tokenUsage.modelContextWindow`：窗口，可为 null

v2 这条通知里没有费率限额。旧的 `codex/event/token_count` 曾把 `rate_limits` 放在同一条事件里，v2 拆走了。限额另走通知 `account/rateLimits/updated`。

`account/rateLimits/read` 返回账户级快照，不是这一线程的账单：

- `rateLimits.primary` / `secondary`：`RateLimitWindow`，字段 `usedPercent`、`windowDurationMins`、`resetsAt`（Unix 秒）
- `rateLimitsByLimitId`：按 `limitId` 分桶，例如 `codex`
- `planType`、`rateLimitReachedType`、`credits`、`individualLimit`（月度支出控制，可空）、`rateLimitResetCredits`、`ordinaryUsageAllowed`、`accountId`

`windowDurationMins` 为 300 是五小时窗，10080 是每周窗。Pro 账号上，后端可以只返回每周桶，把原来的 primary 五小时桶拿掉，`secondary` 变为 null。文档示例里的 15 分钟窗口只是字段说明，不是 Plus/Pro 的固定窗口。

`account/usage/read` 不带参数时返回的是 ChatGPT 资料里的 token 活动：`lifetimeTokens`、`peakDailyTokens`、`dailyUsageBuckets` 等，不是剩余百分比。带 `threadId` 时，响应里可有 `threadUsage`：该线程的估计 credits、可选美元，以及按模型、推理、速度拆的用量。旧服务器没有这个字段；账单路线不可用时为 null。把它写进 `/status` 的改动说明，取数对象是符合条件的 Business 与 Enterprise。本次没有读到 Plus、Pro 一定返回 `threadUsage` 的句子。

来源：[App Server](https://developers.openai.com/codex/app-server)、[PR #7268](https://github.com/openai/codex/pull/7268)、[RateLimitWindow.ts](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/RateLimitWindow.ts)、[GetAccountRateLimitsResponse.ts](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/GetAccountRateLimitsResponse.ts)、[PR #25344](https://github.com/openai/codex/pull/25344)、[PR #38281](https://github.com/openai/codex/pull/38281)、[Issue #32707](https://github.com/openai/codex/issues/32707)

### ACP，以及 Grok、DeepSeek 是否发送

`usage_update` 已在 2026-06-05 进入稳定协议。它是 `session/update` 通知，`sessionUpdate` 为 `"usage_update"`：

- `used`、`size`：必填，当前上下文里的 token，以及窗口大小。这是窗口占用，不是本轮计费 token
- `cost.amount`、`cost.currency`：可选，会话累计费用

RFD 写明速率限制和套餐配额不在这次范围内，留到以后的 RFD。回合结束时的 token 明细仍是 Draft（2026-09-30 的页面仍标 Draft）：草案里的 `usage` 放在 v1 的 `session/prompt` 结果，或 v2 结束时的 idle `state_update` 上，字段是 `totalTokens`、`inputTokens`、`outputTokens`、`thoughtTokens`、`cachedReadTokens`、`cachedWriteTokens`。规范写明这个形状还不能当稳定接口。

**Grok `grok agent stdio` 不发 `usage_update`。** 当前 `main` 的 `notification.rs`（3022 行）里没有这个字符串。一轮的计费用量在 `session/prompt` 的返回值 `_meta` 上，由 `build_prompt_response_meta` 写入：

- 并列字段 `totalTokens`、`modelId`，以及来自最近一次模型调用的 `inputTokens`、`outputTokens`、`cachedReadTokens`、`reasoningTokens`。源码注释写明这些并列 token 字段只是最近一次调用
- 可选 `usage`：`PromptUsage`。`inputTokens` 是含 cache read 的整段 prompt 合计；`modelUsage` 按模型；`numTurns` 是主循环轮数；费用是 `costUsdTicks`（10¹⁰ tick = 1 美元）。`usageIsIncomplete` 或费用不完整时，费用会被抹掉；没有费用表示未知，不是 0

无头 `grok -p` 的 JSON 结果是另一套投影：`usage`、`modelUsage`、`total_cost_usd`、`total_cost_usd_ticks`。那里的 `input_tokens` 是未缓存部分。文档写明 ACP 的 `_meta.usage.inputTokens` 仍是完整合计，做花费统计应优先用无头字段。这套数字是 token 和标价估计。每周池的百分比不在这条结果里。

会话目录 `~/.grok/sessions/<编码后的 cwd>/<session-id>/` 里，`grok usage <session-id> [turn]` 打出已落盘的逐轮 token 和 `costUsdTicks`。交互界面的套餐额度在 TUI 的 `/usage`。

**DeepSeek `dsh` 的 ACP 会发 `usage_update`，而且没有费用。** `packages/acp/acp/src/updates.ts` 的 `usageUpdate()` 只在三条都成立时，跟在已提交的 `assistant/message` 后面发一条：

- `sessionUpdate: "usage_update"`
- `used`：`tokenMeter.measure(session).totalTokens`
- `size`：`session.requestContext().contextWindow`

`event.data.usage` 只当作「有没有用量」的门闩，明细不放进通知。缺窗口或缺 token meter 就不发。这是当前上下文占用，不是本轮账单，也不是套餐剩余。

来源：[稳定公告](https://agentclientprotocol.com/announcements/session-usage-stabilized)、[session-usage RFD](https://agentclientprotocol.com/rfds/session-usage)、[end-turn-token-usage RFD](https://agentclientprotocol.com/rfds/end-turn-token-usage)、[notification.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/notification.rs)、[mvp_agent/mod.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/mvp_agent/mod.rs)、[无头用量说明](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)、[会话与 grok usage](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)、[updates.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/updates.ts)

## 2. 社区工具读什么、能否按目录或会话分开

**ccusage**（当前文档日期 2026-10-22）读各家已经写在本机的日志，估算 token 和按价表折算的美元。它不读订阅剩余百分比。Codex 已收进子命令 `ccusage codex`，不再是文档里的独立入口。默认会把扫到的来源合在一张表里。

| 来源 | 命令 | 读哪里 | 按什么拆 |
|---|---|---|---|
| Claude Code | `ccusage claude daily\|session`，以及 `blocks` | `~/.claude/projects/` 与 `~/.config/claude/projects/`。设了 `CLAUDE_CONFIG_DIR` 就只读那里 | 项目目录是路径编码后的文件夹名。`daily --instances` 按项目分组，`--project` 过滤。`session --id` 对到 jsonl 文件名（不含扩展名） |
| Codex | `ccusage codex daily\|session` | `${CODEX_HOME:-~/.codex}` 下的 `sessions/` 与 `archived_sessions/`，含 `.jsonl.zst` | 会话 id 是一等公民，可用完整 id、文件名或 `codex://threads/<uuid>`。本次打开的 Codex 专页没有写「`--project` 等于线程 cwd」 |
| Grok | `ccusage grok daily\|session` | `${GROK_HOME:-~/.grok}/sessions/<url 编码的 cwd>/<session-uuid>/updates.jsonl` | 目录名就是工作目录。只计 `sessionUpdate == "turn_completed"` 且带 usage 的行。费用优先用日志里的 `costUsdTicks`。杀掉的半轮没有记录 |

Claude 的 `ccusage blocks` 用本地消息时间，从第一条消息起切 5 小时块。`--token-limit` 由用户自己填，或用历史最高块。它不是服务器上的 `used_percentage`。v18 已去掉 `blocks --live`。

同一订阅在网页、桌面或其他机器上的用量不会出现在这些文件里。同一 `CLAUDE_CONFIG_DIR`、`CODEX_HOME` 或 `GROK_HOME` 下，Helm 和人手开的 CLI 写进同一棵目录，ccusage 分不开。能分开的办法是：Helm 记下自己的 session id 再 `session --id`，或给 Helm 单独的配置目录。默认日志保留约 30 天（Claude 的 `cleanupPeriodDays`）。

同类、同样只读本地日志的还有 [tok](https://github.com/652036/tok)：按工具、模型、项目、会话汇总 token，有日志内费用就用日志的，否则用公开标价。它同样看不到订阅剩余，也看不到没落盘的网页用量。

来源：[ccusage 介绍](https://ccusage.com/guide/)、[Claude 数据源](https://ccusage.com/guide/claude/)、[Codex 数据源](https://ccusage.com/guide/codex/)、[Grok 数据源](https://ccusage.com/guide/grok/)、[会话报告](https://ccusage.com/guide/session-reports)、[命令行选项](https://ccusage.com/guide/cli-options)、[5 小时块](https://ccusage.com/guide/blocks-reports)、[数据源问答](https://ccusage.com/guide/source-support-qa)

## 3. 剩余额度能否用程序读

能读到的都是账户整体，不含「Helm 这一份」。

**Claude。** 官方、且跟订阅窗口对应的出口，是状态行的 `rate_limits.five_hour` / `seven_day`，以及实验性的 `SDKUsageReport.rate_limits`。两者都是已用百分比加重置时间，没有剩余 token 定额。Console 的 Rate Limits API 和响应头 `anthropic-ratelimit-*` 是 API key 的每分钟吞吐，不是 Pro/Max 的五小时和每周窗。

社区工具 [ccu](https://github.com/sammcj/ccu)、[cclimits](https://github.com/acrdlph/cclimits) 会请求 `GET https://api.anthropic.com/api/oauth/usage`，用 Claude Code 的 OAuth token。公开的 Claude API 文档里没有这个端点。ccu 写明 `CLAUDE_CODE_OAUTH_TOKEN` 这条路打不开该接口，要退回状态行。Helm 若去调它，就是在用未文档化的客户端接口。

**Codex。** 官方出口就是正在跑的 `codex app-server` 上的 `account/rateLimits/read`（以及通知 `account/rateLimits/updated`）。`usedPercent` 配 `windowDurationMins` 和 `resetsAt`。这是 ChatGPT 账号的限额，桌面、CLI、IDE 共用。没有「只算这个 thread」的剩余百分比。`account/usage/read` 的无参形式是历史 token 活动。

**Grok。** 官方 CLI 把账单做成 ACP 扩展方法 `x.ai/billing`（线上名字是 `_x.ai/billing`）。`billing.rs` 的配置里，当前字段是 `creditUsagePercent` 和 `currentPeriod`（`type` 可为 `USAGE_PERIOD_TYPE_WEEKLY`，带起止时间）；旧字段 `monthlyLimit`、`used` 已标为弃用。这是账户的 included 用量百分比，不是某一个 session。TUI `/usage` 打开的也是这份账户额度，再另附当前会话的上下文和 token。用户可见的网页在 [grok.com 的 Usage](https://docs.x.ai/x-subscription/manage)。社区监控器还会直接请求 `https://cli-chat-proxy.grok.com/v1/billing?format=credits` 并自己读 `~/.grok/auth.json`。那不是文档里的公开 API，扩展方法也没有稳定性承诺。

**DeepSeek。** 已打开的价格页按百万 token 计费，没有月费或包含额度。剩余的是预付余额：`GET https://api.deepseek.com/user/balance`，字段 `is_available`、`balance_infos[].total_balance`、`granted_balance`、`topped_up_balance`，货币 `CNY` 或 `USD`。按 key 的用量要在网页 Usage 里导出 CSV，本次没有找到按会话查询的官方 API。并发限制是账号级 429，不是套餐窗口。

来源：[Status line](https://code.claude.com/docs/en/statusline)、[SDKUsageReport](https://code.claude.com/docs/en/agent-sdk/typescript)、[Rate Limits API](https://platform.claude.com/docs/en/build-with-claude/rate-limits-api)、[App Server 的 rate limits 与 usage](https://developers.openai.com/codex/app-server)、[billing.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs)、[Grok `/usage`](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/04-slash-commands.md)、[The X Subscription 用量查看](https://docs.x.ai/x-subscription/manage)、[DeepSeek 价格](https://api-docs.deepseek.com/quick_start/pricing)、[DeepSeek 余额](https://api-docs.deepseek.com/api/get-user-balance/)

## 对 Helm 可执行的读法

1. Claude：累加每次 result 的 `modelUsage`（不要把流式会话里的 `total_cost_usd` 加总，它已经是累计）。用 `session_id` 对 `~/.claude/projects/`。套餐条只从状态行或 `/usage` 的 `usage_report` 读，当作账户剩余。
2. Codex：用 `thread/tokenUsage/updated` 的 `total` 做这个线程的 token。剩余窗口用 `account/rateLimits/read` 的 `usedPercent`。不要把 `usedPercent` 的变化记到这个线程上，除非当时没有别的客户端。
3. Grok：读 `session/prompt` 结果 `_meta.usage`，或事后 `grok usage <session-id>`。每周百分比用扩展方法 `x.ai/billing` 的 `creditUsagePercent`。标准 `usage_update` 等不到。
4. DeepSeek：ACP 只给上下文占用。花费看平台余额下降；没有订阅窗口可查。

## 补充：DeepSeek Harness 本机日志里有逐步用量（2026-10-22 本机核对）

上文"DeepSeek 的 ACP 只给上下文占用"只说的是 ACP 通知。本机装的 `@deepseek-ai/dsh` 自带两个插件：
- `dsh-token-meter`：为会话提供 `tokenUsage` 投影，`totals` 字段包含 `uncachedInputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`，缓存在 `~/.dsh/storages/session_projcache/sessions/<session-id>.json`。
- `dsh-session-stats`：提供 `sessionStats` 投影，含轮次数、步骤数、`decodeTokens`（提供方报告的输出 token）和耗时。

会话日志 `~/.dsh/sessions/<编码后的 cwd>/<session-id>/session.v4.jsonl.zstd` 每一步都记录了提供方报告的用量，例如 `"usage":{"inputTokens":645,"outputTokens":86,"cacheReadTokens":5376,"cacheWriteTokens":0,"totalTokens":6107}`。所以派单结束后，按 session id 解压这个日志并累加 `usage`，就能得到 Helm 这次派单的准确用量。注意：这个日志格式是内部格式（文件名里的 `v4` 是格式版本号），升级后可能变化。
