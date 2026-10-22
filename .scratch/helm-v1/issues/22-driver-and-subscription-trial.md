# 驱动与订阅实测

Type: prototype
Status: open
Labels: wayfinder:prototype
Map: [Helm v1 设计](../map.md)

## Question

[04](04-tech-stack.md) 选定的驱动有几个前提还没实测，推翻任何一个都要改 04，所以排在 [06](06-coordinator-lifecycle.md) 之前做。逐项实测并记录结果：

1. **Claude Agent SDK 扣订阅**：`pathToClaudeCodeExecutable` 指向本机 `claude`，清掉 `ANTHROPIC_*`，跑一轮，看计划用量条是否扣减。推翻条件：扣到 API 或 extra usage，就改用 `claude -p --input-format stream-json --output-format stream-json`。
2. **Codex app-server**：只设 `CODEX_SQLITE_HOME` 时 `account/read` 仍是 ChatGPT 登录；用旧对话 id `thread/resume` 能找回；同时起 10 个 Codex 执行者不撞锁。
3. **Grok**：`grok agent stdio` 选 `cached_token`、不设 `XAI_API_KEY` 时扣 SuperGrok；是否支持 `session/cancel`、`session/load` 或 `session/resume`。
4. **DeepSeek**：`dsh --profile acp` 只用 `DEEPSEEK_API_KEY` 能跑通一轮。
5. **无人值守设置按新驱动重新核对**：[02](02-unattended-executors.md) 的结论基于一次性命令。核对 app-server 的 `approvalPolicy`、ACP 权限代答、SDK `permissionMode` 下，执行者不会停下来等人，沙箱设置与 02 的分析是否一致；ACP 选 `allow_always` 是否会把授权写进 agent 自己的配置，影响用户在 Helm 以外的使用（决定 [07](07-hard-constraints-and-tools.md) 候选⑦能否用 `allow_always`）。
6. **Codex 在 worktree 里能否提交**：`workspace-write` 下 `.git` 只读，worktree 的 git 目录在主仓库里（来自 02，影响 [08](08-isolation-and-merge.md) 由谁提交）。

实测步骤见 [subscription-via-acp.md](../../../docs/research/subscription-via-acp.md) 的"实测办法"和 [codex-concurrency.md](../../../docs/research/codex-concurrency.md) 第 6 节。结果写进本单 Answer；推翻了前提的，在 04、07 或 08 留评论。
