# 订阅模板用 agent CLI 默认主目录，全局配置正常进入

[ADR 0004](0004-agent-homes-and-cli-owned-credentials.md) 让订阅模板改用 `~/.helm/agent-homes/<cli>/` 专用主目录，只为一件事：Helm 拉起的会话记录不混进用户自己的历史。做下来发现专用目录只隔离各家 CLI 放在配置目录里的东西，CLI 还会顺着真实 `HOME` 和工作目录去读别的位置（Codex 读 `~/.agents/skills`，Claude 读 `~/.claude/skills`，Grok 读 `~/.claude` 的规则），每接一家就要逐个来源补漏；Claude 在 macOS 上还得在专用目录另登录一次，因为钥匙串条目按配置目录区分。用户 2026-10-23 决定第一版彻底开放，和 Orca、Conductor、vibe-kanban 等编排器一样：订阅模板不设 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`，用本机默认位置和已有登录；用户的全局配置（设置、`CLAUDE.md` / `AGENTS.md`、hooks、插件、MCP、skills）正常进入 Helm 拉起的会话；会话记录混进用户历史可以接受。这推翻了第一版"执行者也不读全局配置"的决定。

模板在全局配置之上按职责叠加：提示词、skills（只叠加，不藏用户和 CLI 自带的）、模型、推理强度。工具按角色走运行层（调度者用 Helm 调度工具、对代码只读；执行者只有"提交结论"，需要时加浏览器工具），用户的 MCP 两种角色都能用。

运行层仍按会话显式传、压过全局配置的只有这些：硬约束（执行者只写卡片副本、调度者对代码只读、不推送、Helm MCP 带令牌，权限检查和沙箱）、fast 按模板（Claude 用 SDK `settings.fastMode`，Codex 用 `serviceTier`）、关掉 Claude 自动记忆（不往用户记忆目录写卡片副本的内容）。用户全局规则里的调度指令开发期间保留，Helm 不另加限制，以后由用户删掉。

"执行者只写卡片副本"对项目设置和本地设置成立：仓库带进来的放行规则和沙箱例外都拦得住。用户级设置里的沙箱例外（Claude `sandbox.filesystem.allowWrite`、`sandbox.excludedCommands`）是例外：CLI 总会把它们合并进来，会话设置清不掉，因此作为用户自己的全局配置照常生效，执行者的 Bash 可以写到其中列出的位置。agent 自己改不了用户级设置，所以这不算 agent 能绕过的约束；Helm 不解析 Bash 命令，也不读用户的设置文件。

API 模板不变：每个模板一个 `~/.helm/agent-homes/<模板 id>/`，接口和 key 由用户按 CLI 自己的格式写在里面，Helm 不读。Helm 仍然不打开、不复制、不转发凭据。

## Considered Options

- **保留专用目录，逐个来源补漏**（ADR 0004）：会话记录分开，但每家 CLI 顺着 `HOME` 读的东西都要单独处理，Claude 要另登录一次，后面接 Grok、dsh 问题只会更多。
- **Claude 默认目录加 SDK 隔离模式，Codex 用 Helm 空目录加软链接登录**：两家都可控、模板即全部定义，但 `~/.agents/skills` 这类来源照样漏，以后仍要决定补不补；用户选择第一版先彻底开放。
- **给 agent 进程换一个假 `HOME`**：能一刀切隔离，但执行者要用用户的 git 配置、ssh key、`gh` 登录和各种包缓存，换掉 `HOME` 这些都会失效。
