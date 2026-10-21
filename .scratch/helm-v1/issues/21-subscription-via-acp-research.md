# 经 ACP 或其他非原生方式接入时，订阅套餐是否仍然有效

Type: research
Status: resolved
Labels: wayfinder:research
Blocked by: 20
Map: [Helm v1 设计](../map.md)

## Question

用户确定要用的是 Claude Code、Codex、Grok、DeepSeek、zcode（智谱 GLM）、pi（pi 用的是其他家的额度，不单独考虑）。[03](03-subscription-billing.md) 只确认了"用户自己登录、拉起未修改的官方 CLI"可以用订阅。改用 ACP 适配器（`claude-agent-acp`、`codex-acp`）、原生 ACP 模式（`grok agent stdio`）或各家 CLI 的协议模式时，还算不算在订阅范围内，条款是否允许？zcode 没有 CLI，GLM Coding Plan 能通过哪些官方允许的 CLI 使用？DeepSeek 没有订阅，按量计费怎样接入？结论交给 [技术栈与进程结构](04-tech-stack.md)。

## Answer

调研结论见 [subscription-via-acp.md](../../../docs/research/subscription-via-acp.md)（Grok，2026-10-21，一手来源，含实测办法）。

- **订阅不看"是不是 ACP"，看两点**：进程环境里没有会压过订阅的 API key；请求由厂商发布的未修改程序发出，Helm 不拿用户的登录自己打接口。
- **Claude**：直接拉起本机 `claude -p --input-format stream-json --output-format stream-json`（不加 `--bare`、清掉 `ANTHROPIC_*`）是条款明确允许的。`claude-agent-acp` 经 Claude Agent SDK 拉起 SDK 自带的另一份 `claude`，源码会按订阅计费，但 SDK 条款禁止第三方产品提供 claude.ai 登录，属灰色，不作主通道。
- **Codex**：直接拉起 `codex app-server`（清掉 `CODEX_API_KEY`、`OPENAI_API_KEY`）走 ChatGPT 订阅，本地或开源应用可用，商业或托管服务不允许。`codex-acp` 只是再 spawn 同一个 app-server，多一层没有好处。
- **Grok**：`grok agent stdio` 是官方 CLI 自己的 ACP 模式，`authenticate` 显式选 `cached_token`、不设 `XAI_API_KEY` 即走本机登录。
- **智谱 GLM**：Coding Plan 只能在名单内工具里用（名单含 ZCode、Claude Code、Codex、OpenCode、Pi、Qoder、Cline、Goose 等），名单外的自建应用不行。最稳的接法是未修改的 Claude Code 加 `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic` 和套餐 key，可沿用 Claude 驱动。**更正 20**：官方仓库 zai-org/ZCode 有终端版 `zcode --prompt … --json`，可作为一次性执行者，但没有常驻协议，不能当调度者。`glm-acp-agent` 不在名单内，不用。
- **DeepSeek**：没有订阅，按量计费，用 `DEEPSEEK_API_KEY`。可以用 `dsh --profile acp` 或 `--profile headless`，也可以用 Claude Code 加 `https://api.deepseek.com/anthropic`（官方文档写明）。
- **pi**：`/login` 用 Claude 订阅属于明确禁止，用 ChatGPT 订阅情况不确定。只给 API key。
- **对 Helm 的影响**：Agent 模板除了 CLI 和参数，还必须管住环境变量（清掉会压过订阅的 key，注入 base URL 和 key），交给 [硬约束与工具](07-hard-constraints-and-tools.md)。是否真的扣在订阅上，按文档里的实测清单验证，并入 [调度者实测](14-coordinator-trial.md)。

## Comments
- 2026-10-21 用户追问：Claude 用 `claude -p` stream-json 无人值守、并行运行，会不会被封号。补充调研见 `docs/research/subscription-ban-risk.md`。
- 补充调研结论见 [subscription-ban-risk.md](../../../docs/research/subscription-ban-risk.md)：**封号风险低**。Consumer Terms 禁止自动化访问，但留了"API key 或另行明确允许"的口子，`claude -p`、stream-json、harness 驱动未修改的 `claude` 都写在官方文档里；已公开的封号针对第三方程序拿订阅 OAuth 伪装 Claude Code（OpenCode，2026-01）、转售或共享账号；24/7 运行的处置是每周限额。剩余风险：常驻加并行会更快撞上限额；Anthropic 以后可能把编排器改记到 usage credits；分类器会误封。缓解（交 07）：只拉未修改的官方二进制，不改请求头，不读取 OAuth token；撞到限额就停或改用 API key，不切第二个账号绕过；重连做退避。Codex、Grok 也未找到同类封号事件。
