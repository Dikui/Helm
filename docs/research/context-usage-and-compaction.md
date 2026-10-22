# 四种驱动下的上下文占用、自动压缩与续跑

调研日期：2026-10-22（Grok，一手来源）。为 [调度者生命周期](../../.scratch/helm-v1/issues/06-coordinator-lifecycle.md) 查的。06 最终选了任务型调度者，每轮新开会话，本文的"读占用、关压缩"暂未用上；以后若改回长时会话或要在单轮内控制上下文，从这里查。

四个驱动里，只有 Claude Agent SDK 和 DeepSeek `dsh` 能在回合进行中拿到「当前上下文占用 + 窗口大小」。Codex 能拿到最近一次请求用量和窗口，但文档没有把最近一次用量定义成当前占用。Grok 的 `grok agent stdio` 只在自动压缩开始时同时给出这两个数。四家里都没有「按单条会话、且不改用户全局配置、又能把自动压缩完全关掉」的开关；能做的是进程级调阈值。Claude 把阈值顶到模型窗口为止，Codex 的配置值不能超过原始窗口的 90%。

核对的是 2026-10-22 的官方文档和仓库 `main`/`master`。Codex 压缩公式读的是当天的 `main`，不是 `rust-v0.163` 标签。

## 1. Claude Agent SDK

**Q1 能。** 进程还活着时，对 `query()` 返回的对象调用 `getContextUsage()`。返回 `totalTokens`（当前占用）、`maxTokens`（计量窗口）、`percentage`。`maxTokens` 是模型窗口，若另有更低的自动压缩窗口，计量就用那个更低的窗口；控制响应里的 `rawMaxTokens` 与 `maxTokens` 相同。`detail: "summary"` 用上次响应用量加本地估计，不另发 token-counting 请求；默认 `"full"` 会发不计费的计数请求，这些请求不出现在消息流里。`detail` 要 SDK v0.3.257+。这是主动查询，不是每轮结束自动推送。

回合结果 `SDKResultMessage.usage` / `modelUsage` 是计费用量。流式输入会话里 `usage` 按轮计算，不含子 agent，也没有窗口大小。压缩消息里的 `compact_metadata.pre_tokens` 只在压缩发生时给出压缩前 token。

来源：[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)、[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)

**Q2 能关，也能把触发窗口调到模型窗口为止，不能再高。** `settingSources: []` 不加载用户、项目、本地 settings，所以不会带上用户全局的 `autoCompactEnabled`。不写用户配置的做法：

- `options.env` 设 `DISABLE_AUTO_COMPACT=1`：关掉自动压缩和 idle compaction，手动 `/compact` 仍可用。TypeScript 的 `env` 会替换整个子进程环境，要自己展开 `process.env`。
- `DISABLE_COMPACT=1`：自动和手动压缩都关。
- `options.settings` 传 `{ autoCompactEnabled: false }`，这是本次启动的 flag settings，不写 `~/.claude/settings.json`。
- 调窗口：`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 或 settings 里的 `autoCompactWindow`，范围 100000–1000000，再被模型窗口封顶。环境变量优先于 `--autocompact` 和 settings。`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 只能把百分比调低，高于默认的值被忽略。

关了之后上下文满了不截断。`-p` 和 transcript 里是 `Prompt is too long`。交互界面是 `Context limit reached · /compact or /clear to continue`；`DISABLE_COMPACT` 时只提示 `/clear`。自动压缩失败时会变成 `Prompt is too long · automatic compaction failed: …`。

来源：[Environment variables](https://code.claude.com/docs/en/env-vars)、[Settings](https://code.claude.com/docs/en/settings-reference)、[Model configuration](https://code.claude.com/docs/en/model-config)、[Errors](https://code.claude.com/docs/en/errors)、[SDK configuration](https://code.claude.com/docs/en/agent-sdk/configuration)

**Q3 能。** 流里出现 `SDKCompactBoundaryMessage`：`type: "system"`，`subtype: "compact_boundary"`，`compact_metadata.trigger` 为 `"manual"` 或 `"auto"`，`pre_tokens` 为压缩前 token。没有可压缩内容时不发这条，回合仍以 success 结束。

来源：[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

**Q4 支持。** `options.resume` 传 session id。id 在 init 的 `SystemMessage.session_id` 和每条 `SDKResultMessage.session_id` 上。默认 `persistSession: true`；设成 `false` 后不能续。

会话文件在 `~/.claude/projects/<encoded-cwd>/*.jsonl`。设了 `CLAUDE_CONFIG_DIR` 则在 `$CLAUDE_CONFIG_DIR/projects/`。目录名是绝对路径里每个非字母数字换成 `-`；转换后超过 200 字符会截断并加 hash。

cwd：Claude Code v2.1.223 起按 id 跨项目目录查找，可以从别的工作目录续。更早的 CLI 只在当前项目目录及其 git worktree 里找。文件必须在本机。跨机器要用 `sessionStore`。实际行为跟 `pathToClaudeCodeExecutable` 指向的那份 `claude` 走，不跟 SDK 自带二进制走。

来源：[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

## 2. Codex app-server

**Q1 能读到窗口和最近一次请求用量，文档没有把后者定义成「当前占用」。** 通知 `thread/tokenUsage/updated`，回合进行中就会推，不只在回合结束。v2 字段（[PR #7268](https://github.com/openai/codex/pull/7268)）：

- `tokenUsage.modelContextWindow`：窗口，可为 null
- `tokenUsage.last`：最近一次，`inputTokens`、`outputTokens`、`cachedInputTokens`、`reasoningOutputTokens`、`totalTokens`
- `tokenUsage.total`：线程累计，不是当前窗口占用

官方 App Server 页只写「usage updates for the active thread」，没有把 `last.inputTokens` 定义成当前上下文占用。

来源：[App Server](https://developers.openai.com/codex/app-server)、[PR #7268](https://github.com/openai/codex/pull/7268)

**Q2 不能关，也不能把阈值调到原始窗口的 90% 以上。** 2026-06-24 合入的 [PR #29815](https://github.com/openai/codex/pull/29815) 删掉了 `--disable auto_compaction`。0.163 晚于这次。未找到 thread 级 RPC 能改这个阈值。

进程级、不改 `~/.codex/config.toml`：启动参数 `-c model_auto_compact_token_limit=<N>`。当前 `main` 的 `auto_compact_token_limit()` 取 `min(配置值, context_window * 9 / 10)`，所以只能调低或维持默认，不能调高。`model_post_turn_compact_threshold_percent = 0` 只关掉回合结束后的那一次压缩，不关掉回合前的自动压缩。未找到按 thread 覆盖这些键的方法。

窗口仍可能被单轮工具输出冲破。错误码是 `codexErrorInfo: ContextWindowExceeded`，不是静默截断。之后可以发 `thread/compact/start` 手动压。Issue #9142 记录的用户可见句是 “Codex ran out of room in the model's context window…”。

来源：[config reference](https://developers.openai.com/codex/config-reference)、[config advanced（`-c`）](https://developers.openai.com/codex/config-advanced)、[openai_models.rs](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs)、[config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)、[PR #29815](https://github.com/openai/codex/pull/29815)、[App Server](https://developers.openai.com/codex/app-server)、[Issue #9142](https://github.com/openai/codex/issues/9142)

**Q3 能。** 压缩时同一 `threadId` 上走 item 生命周期：`item/started` 然后 `item/completed`，item 类型 `contextCompaction`（字段 `{id}`）。旧通知 `thread/compacted` 已废弃。`thread/compact/start` 立即返回 `{}`，进度同样走这些通知。

来源：[App Server](https://developers.openai.com/codex/app-server)

**Q4** 不适用。

## 3. Grok `grok agent stdio`

**Q1 每轮结束后的标准占用通知未找到。** 已读的 ACP 路径没有发送规范里的 `usage_update`（`used` / `size`）。

`session/prompt` 返回值的 `_meta` 有 `totalTokens`，以及可选 `usage`（`PromptUsage`：`inputTokens` 含 cache read 的完整输入）。源码注释写明：并列的 token 字段是最近一次模型调用；`usage` 是这一次 prompt 的计费合计，headless 文档还写明合计包含已结束的子 agent。这里没有窗口大小。

两个数同时出现，是在自动压缩开始的私有通知里：`tokens_used`、`context_window`、`percentage`。TUI 的 `/context` 和 status line 的 `context_window.used_percentage` 不走这条 stdio。

来源：[headless / ACP](https://docs.x.ai/build/cli/headless-scripting)、[notification.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/notification.rs)、[mvp_agent/mod.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/mvp_agent/mod.rs)、[headless 用量说明](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)、[status line](https://docs.x.ai/build/features/status-line)

**Q2 不能按会话关，也不能用 `GROK_CONFIG` 改。** 阈值是上下文窗口的百分比，默认 85。进程级、不写 `~/.grok/config.toml` 的做法是环境变量 `GROK_AUTO_COMPACT_THRESHOLD_PERCENT`，合法范围 0–100，越界则忽略。优先级高于 `[model.<id>].auto_compact_threshold_percent` 和 `[session].auto_compact_threshold_percent`。

`GROK_CONFIG` 覆盖层的 allowlist 只有 `models`、`features`、收窄后的 `toolset` 和 `shell_environment_policy`，`[session]` 会被丢掉。`session/new` 的 `_meta` 只有 rules、system prompt、agent profile、权限模式，没有压缩阈值。未找到关闭开关。设 `100` 是把触发点抬到窗口的 100%，设 `0` 会在 0% 就触发。

窗口被工具输出冲过时，源码会做 preflight，打出 `CONTEXT_OVERFLOW_PREFLIGHT` 并尝试先压缩。溢出错误类型常量是 `context_length`。未找到「关掉之后截断历史」的说明，也未找到关不掉时的完整用户可见错误句。

来源：[compaction.rs 解析](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/util/config/resolve/compaction.rs)、[配置指南](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md)、[Settings reference](https://docs.x.ai/build/settings/reference)、[session compaction.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/compaction.rs)、[notification.rs 的 `CONTEXT_LENGTH_ERROR_TYPE`](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/notification.rs)

**Q3 不是规范里的 `compaction_update`。** 源码有与 ACP `SessionNotification` 平行的 xAI 通知，判别字段 `sessionUpdate`：`auto_compact_started`（`tokens_used`、`context_window`、`percentage`、`reason`）、`auto_compact_completed`（可选 `tokens_before`）。已打开的文件没有写出这条通知的 JSON-RPC 方法名。

来源：[notification.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/notification.rs)。规范形态见 [session compaction RFD](https://agentclientprotocol.com/rfds/session-compaction)，Grok 未按该形态发送。

**Q4** 不适用。

## 4. DeepSeek Harness `dsh`（ACP）

**Q1 能，但是每条已提交的 assistant 消息，而且三个条件都要有。** `packages/acp/acp/src/updates.ts` 的 `usageUpdate()` 在 `assistant/message` 且 `event.data.usage` 存在、`session.requestContext().contextWindow` 有值、`ctx.tokenMeter` 存在时，发 `session/update`：

- `sessionUpdate: "usage_update"`
- `used`：`tokenMeter.measure(session).totalTokens`
- `size`：`contextWindow`

缺任一项就不发。没有费用字段。这不是等 `session/prompt` 返回才发的一条。

来源：[updates.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/updates.ts)、[session.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/session.ts)、[ACP README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)

**Q2 不能按 ACP 会话改。** 压缩策略在插件配置，不在 `session/new`。`session/set_config_option` 只改 `model` 和 `reasoning_effort`。不改用户默认 profile 的做法是另起 profile / `DSH_HOME`，那是进程级组合，不是单会话。

`@deepseek-ai/dsh-compaction-basic`：

- `auto: false`：关掉自动压缩，也关掉溢出后的压缩重试。手动 `/compact` 仍要挂 `dsh-command-compact`。
- `thresholdRatio` 默认 `0.8`。触发点是 `floor(min(W × thresholdRatio, W − O − headroomTokens))`，`headroomTokens` 默认 65536。把比例调高可以推迟，但仍受 `W − O − headroom` 卡住。

`auto: true` 时，供应商确认 `CONTEXT_WINDOW_EXCEEDED` 会绕过阈值再压一次并重试；`maxOverflowRetries: 0` 只关这次恢复。`auto: false` 时这条恢复也不做。未找到静默截断。压不掉的单条巨大工具调用保持原样。

来源：[compaction-basic README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md)、[ACP README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)、[子系统说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)

**Q3 不能。** `onSessionEvent` 只把 `assistant/message`、`tool/call`、`tool/result` 投影到 ACP。`compaction/start`、`compaction/summary`、`compaction/end` 是 log-only，不进 `compaction_update`。客户端即使在 `initialize` 里广告 compaction 能力，这条桥也不发。

来源：[session.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/src/session.ts)、[compaction.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)。规范要求客户端先广告 `ClientSessionCapabilities.compaction` 才会收到 `compaction_update`：[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)。

**Q4** 不适用。

## 汇总

| 驱动 | Q1 占用与窗口 | Q2 关或调高自动压缩 | Q3 压缩通知 | Q4 新进程 resume |
|---|---|---|---|---|
| Claude Agent SDK | 能。`getContextUsage()` 的 `totalTokens` / `maxTokens`。结果消息的 `usage` 是计费 | 能关：`DISABLE_AUTO_COMPACT` 或 `autoCompactEnabled: false`。窗口可调到模型上限，百分比不能调高。满了报 `Prompt is too long` | 能。`compact_boundary` | 能。`resume`。文件在 `~/.claude/projects/<encoded-cwd>/`。CLI ≥ 2.1.223 可跨目录 |
| Codex app-server | 窗口和最近一次用量能。`thread/tokenUsage/updated` 的 `modelContextWindow` 与 `last`。`total` 是累计 | 不能关，也不能调过原始窗口的 90%。`-c model_auto_compact_token_limit` 只能调低。满了 `ContextWindowExceeded` | 能。item `contextCompaction` | 不适用 |
| Grok stdio | 每轮的标准 `usage_update` 未找到。压缩开始才同时有 `tokens_used` 和 `context_window` | 不能按会话关。`GROK_AUTO_COMPACT_THRESHOLD_PERCENT` 可设 0–100。`GROK_CONFIG` 改不到 `[session]` | 私有 `auto_compact_started`，不是 `compaction_update`。方法名未找到 | 不适用 |
| dsh ACP | 能。每条带 usage 的 assistant 消息发 `usage_update`：`used`、`size` | 不能按会话。profile 里 `auto: false` 或调 `thresholdRatio`。溢出错误是 `CONTEXT_WINDOW_EXCEEDED` | 不能。压缩事件只进日志 | 不适用 |
