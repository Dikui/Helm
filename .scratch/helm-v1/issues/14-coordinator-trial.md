# 调度者实测：按任务库推进与重启接续

Type: prototype
Status: open
Labels: wayfinder:prototype
Blocked by: 02, 06, 07, 22
Map: [Helm v1 设计](../map.md)

## Question

用一个真实的小型软件需求实测：调度者能否只凭任务库和工具集稳定地拆单、派单、处理返工（A1）？中途杀掉调度者，再开一个新会话读任务库，能否接着干（A2）？记录观察到的问题，以及哪些必须挪进运行层的硬约束。

## Comments

- 来自 01（2026-10-21）：调度者采用长时对话。实测时要验证：上下文满或崩溃后，新的调度者会话能否凭任务库正确接上之前的约定（A2），并记录一项工作的 token 增长情况。

- 2026-10-21 来自 [04](04-tech-stack.md)：并入以下实测（步骤见 [subscription-via-acp.md](../../../docs/research/subscription-via-acp.md) 的"实测办法"和 [codex-concurrency.md](../../../docs/research/codex-concurrency.md) 第 6 节）：① Claude Agent SDK 指向本机 `claude`、不设 key 时扣的是计划额度；② `codex app-server` 只设 `CODEX_SQLITE_HOME` 时 `account/read` 仍是 ChatGPT 登录，用旧对话 id `thread/resume` 能找回；同时起 5 个 Codex 执行者不撞锁；③ Grok `grok agent stdio` 选 `cached_token` 扣 SuperGrok，是否支持 `session/cancel`；④ DeepSeek `dsh --profile acp` 只用 `DEEPSEEK_API_KEY`；⑤ 调度者正在一轮里时，用户消息排队或取消重发的体验能否接受（不能接受且调度者是 Codex 时，用 `turn/steer`）。

- 2026-10-22 冲突复核：上面 04 那条评论里的①–④（Claude SDK 扣订阅、Codex app-server 登录与并发、Grok、DeepSeek）拆到 [22](22-driver-and-subscription-trial.md)，排在 06 之前做，并发实测按新上限改为同时 10 个 Codex 执行者。本单只测 A1、A2 和⑤（调度者在一轮中时用户消息的排队体验）。

- 2026-10-22 来自 [06](06-coordinator-lifecycle.md)：调度者改为任务型，上面 01 那条（上下文满后接续、token 增长）作废。改为验证：任务型调度者跨轮次不失忆（不重复派单、不忘与用户商定的结论、调度笔记够用），对齐阶段一问一答的体验可接受，每轮简报的 token 量；⑤ 改为验证"排队 + 打断"的体验。推翻时退到混合形态（对齐阶段续跑 CLI 会话）。
