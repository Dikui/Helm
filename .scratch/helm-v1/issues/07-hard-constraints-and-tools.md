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

- 来自 [05](05-task-store-model.md)（2026-10-21）：由任务库模型推出的硬约束候选：① 卡片"等待前置"、工作"对齐中"或"已暂停"、卡片"已暂停"时拒绝派单；② 需要验收的卡片，最近一次验收派单不是"通过"就拒绝标记完成；③ 固定关卡（开头的确认工作说明、审核）不能撤回；④ 审核关卡未被接受，工作不能完成；⑤ 完成、已取消是终态，不能改回；⑥ 卡片暂停只能由用户设置。05 暂定并发满时派单排队而不是拒绝，本单可推翻。待定：从未派过单的卡片能否直接标记完成。

- 2026-10-22 冲突复核，以下定为硬约束（细节仍由本单定）：① 调度者不能暂停卡片，暂停只属于用户。修改冲突太大时，调度者撤销受影响的派单，再给卡片加一条依赖指向新提出的决策关卡；关卡未决定前，运行层拒绝给这张卡片派单。卡片状态推导与加依赖规则见 [05](05-task-store-model.md) 的 2026-10-22 评论。② 验收派单永远开新对话，不续跑已有对话；"需要验收"由调度者设置，修改记成事件，汇总报告列出未经验收的卡片；从没正常完成过执行派单的卡片不能标记完成，只能取消（回答本单原来的待定项）。"整项工作必须有整体验收"不做硬约束，写进调度者提示词。③ 并发只计执行者派单（执行和验收都算），调度者会话不计；全局一个上限，默认 10，用户可调；满了排队，不拒绝。④ 候选⑦改为只选 `allow_once`：`allow_always` 是否会把授权写进 agent 自己的配置、影响用户在 Helm 外的使用，由 [22](22-driver-and-subscription-trial.md) 验证后再定。

- 2026-10-22 来自 [22](22-driver-and-subscription-trial.md)：候选⑦ 的验证结果。Grok 的 `allow_always` 会落盘到 `~/.grok/sessions/<cwd>/permission.toml`，按目录生效，不改全局配置；执行者 cwd 是一次性 worktree 时影响不到用户，cwd 是用户真实项目目录时会留下授权。另外 Grok ACP 没有按会话设置权限模式的参数，用户全局 `permission_mode = "always-approve"` 时根本不会发权限请求，运行层代答拦不住任何命令。Claude SDK 的 `canUseTool` 能代答每次工具调用（`default` 模式），`dontAsk` 只放行 `allowedTools`。Codex `approvalPolicy: never` 不发审批，靠沙箱。DeepSeek（dsh ACP）从不发权限请求：沙箱挡住后由模型在回答里用文字反问再 `end_turn`，运行层代答接不住，只能当作执行者"缺信息"交给调度者。

- 2026-10-22 来自 [06](06-coordinator-lifecycle.md)：调度者改为任务型，一轮失败后会开新一轮重投同一批事件，所以调度者的工具都要能安全重复执行（派单带幂等键、建卡和改依赖前查状态）。工具集需包含：读启动简报之外的详情（派单最终回答、成果、更早的对话）、整份改写调度笔记。同一工作同时最多一个调度轮次，由运行层强制。
