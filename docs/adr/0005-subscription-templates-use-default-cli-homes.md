# 订阅模板直接用 agent CLI 的默认主目录

[ADR 0004](0004-agent-homes-and-cli-owned-credentials.md) 让订阅模板改用 `~/.helm/agent-homes/<cli>/` 专用主目录，只为一件事：Helm 拉起的会话记录不混进用户自己的历史。做下来发现专用目录只隔离各家 CLI 放在配置目录里的东西，CLI 还会顺着真实 `HOME` 和工作目录去读别的位置（Codex 读 `~/.agents/skills`，Claude 读 `~/.claude/skills`，Grok 读 `~/.claude` 的规则），每接一家就要逐家补漏；Claude 在 macOS 上还得在专用目录另登录一次，因为钥匙串条目按配置目录区分。用户 2026-10-23 决定化繁为简，和 Orca、Conductor、vibe-kanban 等编排器一样：订阅模板不设 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`，直接用用户本机默认位置和已有登录，会话记录混进用户历史可以接受。

角色、模型、推理强度、提示词、skills、沙箱、MCP 仍由 Helm 按会话传给 CLI，和主目录无关，调度者和执行者照样区分。Claude 继续用 `settingSources: []` 不读用户设置、用 `skills` 过滤只给模板自己的 skills、用 `strictMcpConfig` 不加载用户的 MCP。Codex 没有按会话忽略用户配置的开关，接受它读用户的 `~/.codex/config.toml`、`~/.codex/AGENTS.md`、个人 skills 和插件，Helm 按会话传的参数覆盖同名项。

API 模板不变：每个模板一个 `~/.helm/agent-homes/<模板 id>/`，接口和 key 由用户按 CLI 自己的格式写在里面，Helm 不读。这和 Orca 给第二个账号另开目录是同一种做法。Helm 仍然不打开、不复制、不转发凭据，订阅模板连软链接也不用建了。

## Considered Options

- **保留专用目录，逐家补漏**（ADR 0004）：会话记录分开，但每家 CLI 顺着 `HOME` 读的东西都要单独处理，Claude 要另登录一次，后面接 Grok、dsh 问题只会更多。
- **给 agent 进程换一个假 `HOME`**：能一刀切隔离，但执行者要用用户的 git 配置、ssh key、`gh` 登录和各种包缓存，换掉 `HOME` 这些都会失效。
- **Claude 用默认目录、Codex 保留专用目录加软链接**：Codex 的隔离已做好并验证过，但两家做法不一致，`~/.agents/skills` 这类顺着 `HOME` 的来源照样挡不住。
