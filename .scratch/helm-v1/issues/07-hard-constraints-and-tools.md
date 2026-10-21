# 运行层硬约束与调度者工具集

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 05, 06
Map: [Helm v1 设计](../map.md)

## Question

运行层强制执行哪些硬约束（依赖、最多 5 个并发、隔离、验收权、凭据、对外动作……），违反时怎么拒绝、怎么告诉调度者？调度者通过哪些工具（建议以 MCP 提供）操作任务库和派单？哪些事交给调度者的提示词，不做成规则？

## Comments

- 2026-10-21 来自 [04](04-tech-stack.md) 与 [21](21-subscription-via-acp-research.md)：待做成运行层硬约束的候选：① 按 Agent 模板管住子进程环境变量，清掉会压过订阅的 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`CODEX_API_KEY`、`OPENAI_API_KEY`、`XAI_API_KEY` 等，只注入模板声明的 base URL 和 key；② Helm 不读取、不保存、不转发任何 OAuth token，登录只走各 CLI 自己的流程；③ 撞上额度就停下或改派到别家，不换同一家的第二个账号；④ 进程重连做退避；⑤ 同一个对话 id 不能被两个进程同时续跑（Codex `thread-writer-locks`）；⑥ 每次派单记下对话 id 和 Codex 的数据库目录（`CODEX_SQLITE_HOME`），续跑时用回同一个；⑦ ACP 权限请求由运行层代答（有 `allow_always` 选它，否则 `allow_once`，只有拒绝项就拒绝并记录）。
