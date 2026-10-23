# agent CLI 用 Helm 专用主目录，凭据由 CLI 自己保管

Helm 拉起的会话记录混进了用户自己的 `~/.claude/projects/` 等目录，而且以后要让订阅模板和走第三方接口的 API 模板同时存在。我们让每个 agent CLI 都用 `~/.helm/agent-homes/` 下的专用主目录：订阅模板共用 `<cli>/`，沿用用户的登录（Codex、Grok、dsh 软链接到原来的凭据文件，Claude 在该目录登录一次）；API 模板各用 `<模板 id>/`，接口和 key 由用户按 CLI 自己的格式写在里面。Helm 只指定目录和建链接，从不打开、复制或转发凭据，所以"Helm 不碰凭据"这条规则在两种计费方式下都不用放宽；代价是 Claude 要多登录一次，API 模板的配置 Helm 校验不了、填错只在派单时报错，Codex 的 `experimental_bearer_token` 升级后可能失效。实测见 [第二阶段待办 01](../../.scratch/helm-v1-p2/issues/01-agent-home-isolation.md)、[02](../../.scratch/helm-v1-p2/issues/02-templates-skills-and-api-homes.md)。

## Considered Options

- **沿用用户默认主目录**：不用另登录，但会话记录混进用户历史，这正是要解决的问题。
- **把凭据复制到专用目录**：Codex 刷新令牌会轮换，两份副本必有一份失效（Orca、Paperclip 都踩过）。
- **API key 放在 Helm 自己的 `~/.helm/keys.toml`，由 helmd 读出后注入环境变量**：Helm 能校验和统一格式，但要读凭据，规则就得改成"只读 API key"；两家 CLI 本来就能从自己主目录的配置里读 key，没必要由 Helm 经手。
- **API key 存进钥匙串**：同样要 Helm 读取，Linux 还要另接 secret-tool。
- **关掉会话落盘**（`persistSession: false`、`--ephemeral` 等）：按会话 id 续跑会失效。
