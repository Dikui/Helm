# Olympus 接入面

Type: grilling
Status: resolved
Labels: wayfinder:grilling
Blocked by: 07
Map: [Helm v1 设计](../map.md)

## Question

Helm 对外提供哪些 HTTP 和 MCP 接口，怎样和 Olympus 的统一接入接口、卡片和决策关卡对齐，才能以后迁移时不重写？先读 Olympus 仓库里已有的接口定义。

## Comments

- 2026-10-21 来自 [04](04-tech-stack.md)：Olympus 也只是用户自用。Claude Agent SDK 和 `codex app-server` 能用订阅，前提就是自用；如果以后要给别人用，Codex 要改走 Sign in with ChatGPT 或 API key，Claude 要改走 API key。

- 2026-10-22 来自 [07](07-hard-constraints-and-tools.md)：调度者工具集由 `helmd` 以本机 HTTP MCP 提供，按轮次发令牌、限定在所属工作。对外接口可以复用同一套操作，但调用方身份和权限范围不同，由本单定。

## Answer

2026-10-22 grilling 定稿。Olympus 仓库里没有接口定义，只有一张逻辑架构图；用户认为图里"卡片、派单、决策关卡归平台内核，Helm 只做 Agent 侧编排"的设计有问题，改为 Helm 是一个整体，本单不再对齐 Olympus 的架构和接口。

- **Helm 是一个整体**：任务库、约束、驱动、调度者都在 `helmd` 里，不按 Olympus 的内核/Agent 划分拆开。
- **与 Olympus 的关系**：以后 Olympus 或其他入口以"工作"为单位调用 Helm（发起工作、发消息、回答关卡、接受或退回审核、读状态和事件）；卡片、派单只在 Helm 内部。不修订、不跟踪 Olympus 架构图。
- **唯一的对外接口**：界面用的 HTTP POST + SSE（[04](04-tech-stack.md)、[12](12-monitoring-ui.md)）。不另做对外 API、命令行或 SDK；飞书等仍在地图"待明确"的通知里。
- **一份操作定义**：每个操作只定义一次（名称、参数 schema、哪些调用方能用、是否带 `key`），MCP 工具和 HTTP 路由都由它生成，共用同一套实现和约束检查。不做 Webhook，事件接口只有 SSE。
- **调用方与权限**：不另设计权限模型。调度轮次令牌（[07](07-hard-constraints-and-tools.md)）、派单令牌（[09](09-acceptance.md)）不变。
- **用户接口不认证**：`helmd` 只听 127.0.0.1，浏览器免登录。用户认为"用浏览器令牌约束"太复杂。**已接受的风险**：执行者在沙箱里能连到 `helmd`（09 给 Codex 开了网络、Claude 允许本机连接），可以冒充用户接受审核、取消卡片、回答关卡；v1 不防。

**为以后补认证留的事实**（[local-daemon-auth.md](../../../docs/research/local-daemon-auth.md)，本机实测脚本在未提交的 `.scratch/prototype/helm-drivers/read-deny-probe.mjs`）：
- 不登录就区分不了浏览器和执行者：只封 `helmd` 端口四家都没有这种粒度；按 TCP 对端进程树识别挡不住双 fork、被收养或借浏览器访问；`Origin` 可伪造。同类产品（Jupyter、VS Code Server、Claude Code IDE、Codex app-server）都用"令牌放用户目录文件"。
- 令牌放 `~/.helm/` 时，三家能禁读（2026-10-22 实测）：Claude 要沙箱 `filesystem.denyRead` 加权限拒绝规则 `Read(~/…/**)`（单 `/` 开头的路径锚在 cwd，不生效）；Codex 用权限配置 `[permissions.<id>].filesystem` 设 `deny`（用了权限配置后 `sandbox` 参数失效，网络和临时目录要写进配置）；Grok 在 cwd 写 `.grok/sandbox.toml` 的自定义配置 `deny` 并设 `GROK_SANDBOX`。DeepSeek Harness 做不到：沙箱只限写，没有官方插件；自己写 `ctx.fs` 包装加 `runnerCommand` 脚本可行（几百行），仍漏 MCP 子进程和 `run_code`。外层 `sandbox-exec` 套一层不行，会让 Codex 自己的沙箱起不来。

访谈记录：Q1 Helm 定位（整体）、Q7 与 Olympus 的关系（A：以工作为单位被调用）、Q2 对外调用方（就是界面那套）、Q3 一份定义（同意）、Q4 权限（不必另做设计）、Q5 禁读实测（验证完毕，未采用）、Q6 架构图（不管 Olympus）、Q8 DeepSeek（A 接受风险，随 Q9 失去意义）、Q9 浏览器登录（不做认证）。

已在 [07](07-hard-constraints-and-tools.md) 留评论。

- 2026-10-22 20 张整体复查：用户接口不认证的已接受风险补一条：用户浏览器里打开的任何网页都能向 `127.0.0.1` 上的 helmd 发请求（跨站请求伪造），也能借 DNS 重绑定读到返回内容。可以用检查 `Host`、`Origin` 头的办法防住，用户决定 v1 不做，不考虑这类安全问题。
