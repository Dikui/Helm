# Claude 调度者不加载用户的全局配置

[ADR 0005](0005-subscription-templates-use-default-cli-homes.md) 让用户的全局配置（设置、`CLAUDE.md`、hooks、插件、MCP、skills、claude.ai 连接器）正常进入 Helm 拉起的会话。实测订阅调度者每轮新建约 7 万 token 的提示缓存、读取 30–75 万输入 token，其中约一半是这些配置：插件的 skills 列表和 SessionStart hook 输出、给 Claude Code 主会话写的 `~/.claude/CLAUDE.md`（里面还有派单给其他 CLI 的规则）、claude.ai 连接器的工具定义。调度者只用 helm MCP 和只读工具，这些都用不上，而且轮次之间不续跑，每轮都要重新付这份开销。用户 2026-10-29 决定：订阅（shared）的 Claude 调度者用 `settingSources: []`、`strictMcpConfig: true`、`disableClaudeAiConnectors: true`，只拿 Helm 传入的 MCP 和 Agent 自带或引用的 skill；登录仍走本机钥匙串。执行者不变，仍按 ADR 0005 加载全局配置。API（dedicated）调度者照旧读专用主目录的用户设置，因为接口和 key 写在里面。

## Considered Options

- **执行者也关掉**：执行者写代码时可能用得上用户的 skills 和 MCP，ADR 0005 的理由对它仍成立。
- **保持现状，只精简 Helm 自己的工具返回**：能省 `list-agents`、`list-dispatches` 那部分，但每轮固定的那一半开销还在。
