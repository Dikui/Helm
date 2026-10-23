# 编排类工具如何沿用 agent CLI 登录、处理会话记录

调研日期：2026-10-23（Grok，一手来源）。各条结论附来源链接，调度者未逐条打开复核；软链接部分已在本机实测，见 [p2 任务单 01](../../.scratch/helm-v1-p2/issues/01-agent-home-isolation.md)。

主流做法是沿用用户默认的家目录登录，会话记录就写进用户自己的历史。把 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`GROK_HOME`、`DSH_HOME` 指到空目录，官方设计就是另一套登录，所以会变成未登录。复制凭据不可靠：刷新令牌轮换后，两份中必有一份失效。

> 2026-10-23 本机实测补充：软链接与复制不同。在专用目录里把 Codex 的 `auth.json`、Grok 的 `auth.json`、dsh 的 `.credentials.yaml` 软链接到用户原文件，三家都能跑一轮并按会话 id 续跑，链接保持不变。Helm 只建链接、不打开文件，不违反"不读、不存、不转发"。Claude 登录在钥匙串里，软链接不适用。下文"复制或软链接"并提处，以此为准。

Helm 若要按会话 id 续跑，应继续用默认家目录，接受记录混进用户历史。若必须隔离开，让用户对专用目录各登录一次，由官方二进制自己写凭据。不要用「关掉落盘」来隔离：官方写明关掉之后不能按 id 续跑。

## 1. 同类工具

| 工具 | 登录 | 会话记录 | 证据 |
| --- | --- | --- | --- |
| Orca | 默认读 `~/.claude`。多账号会把凭据材料化进默认目录，或换用用户自己登录过的第二家目录 | 默认与用户历史混在一起。第二家目录自带另一份历史 | 见下 |
| Conductor | 用本机已经保存的 Claude / Codex 登录；也可改成 API key | 迁移说明要求连 `~/.claude`、`~/.codex` 一起拷走。未查到它改配置目录或事后删除这些记录 | [FAQ](https://www.conductor.build/docs/faq) |
| Claude Squad | 未查到改登录方式。tmux 里启动用户的 `claude` / `codex` | 自己的状态在 `~/.claude-squad/`。未查到改 CLI 会话目录或清理记录 | [README](https://github.com/smtg-ai/claude-squad/blob/main/README.md) |
| vibe-kanban | README 要求先在本机 agent 里登录。Codex 跟随已有的 `CODEX_HOME`，否则 `~/.codex` | 续跑去扫该家目录的 `sessions/`。未查到设置 `CLAUDE_CONFIG_DIR`，也未查到清理记录 | [README](https://github.com/BloopAI/vibe-kanban/blob/main/README.md)、[#1648](https://github.com/BloopAI/vibe-kanban/issues/1648)、[session.rs @ 4ffd7c92](https://github.com/BloopAI/vibe-kanban/blob/4ffd7c92b97ddc183d8ce5b7eaaab9f1fbc52634/crates/executors/src/executors/codex/session.rs) |
| Crystal / Nimbalyst | Crystal 公开说明要求 Claude 已登录或另给 API key，Codex 用 ChatGPT 账号或 API key。未查到专用配置目录 | 未查到把 CLI 记录移出用户家目录或事后删除 | [Crystal](https://github.com/stravu/crystal)、[Nimbalyst 文档](https://docs.nimbalyst.com/developer-features/coding-with-claude-code-and-nimbalyst) |
| Sculptor，以及 Imbue 的 mngr | Sculptor 工作区在 `~/.sculptor/workspaces/`。未查到本地版改 `CLAUDE_CONFIG_DIR`。mngr 默认给每个 Claude agent 单独配置目录，并从 `~/.claude` 复制或软链接；macOS 订阅用户被要求关掉隔离 | mngr 隔离打开时，记录在 agent 自己的目录。关掉隔离则与用户共用 `~/.claude`，会话也在那里 | [workspaces.md](https://github.com/imbue-ai/sculptor/blob/main/docs/workspaces.md)、[mngr README](https://github.com/imbue-ai/mngr/blob/main/libs/mngr_claude/README.md) |
| Superset | 用用户自己的订阅或 API key，不代发模型请求。默认账号走用户家目录。额外账号用 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` | 额外账号把技能、设置和 `projects/` 历史软链接回默认家目录，凭据留在各自目录。他们否决了把 token 换进同一个目录 | [Supported Agents](https://docs.superset.sh/supported-agents)、[PR #6645](https://github.com/superset-sh/superset/pull/6645) |

Orca 的默认路径写在 [claude-code.mdx](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/agents/claude-code.mdx)：在终端登录一次，Orca 自动使用 `~/.claude`。[#14254](https://github.com/stablyai/orca/issues/14254) 描述它把 `.credentials.json` 换进解析到的默认配置目录。[#12002](https://github.com/stablyai/orca/issues/12002) 写 Orca 保存的那份会失效，因为刷新令牌单次使用并轮换，提议改用 `claude setup-token` 和 `CLAUDE_CODE_OAUTH_TOKEN`，从而不再复制凭据。[#18674](https://github.com/stablyai/orca/pull/18674) 的第二家目录是 `CODEX_HOME=~/.codex-2`、`CLAUDE_CONFIG_DIR=~/.claude-2`，由用户自己在那个目录登录，并跳过凭据材料化。[#22892](https://github.com/stablyai/orca/issues/22892) 还记录它会写用户的 `~/.claude/settings.json` 和 Codex 配置。

mngr 的原话是：macOS 上 Claude Code 把 `CLAUDE_CONFIG_DIR` 哈希进钥匙串条目标签，隔离目录拿到的是另一份凭据，订阅 token 刷新后会过期。共用配置目录才能用到和用户自己的 `claude` 相同的钥匙串条目。这是 Imbue 对二进制行为的描述，不是 Anthropic 公布的条目名规范。

另外两家编排器说明了同一条边界：

- [cmux #4255](https://github.com/manaflow-ai/cmux/issues/4255)：把 `CLAUDE_CONFIG_DIR` 显式设成 `$HOME/.claude`（和默认路径相同）会走进「自定义配置目录」分支，钥匙串对不上，要求重新登录。变量「未设置」和「设成默认路径」不是一回事。
- [Paperclip #5028](https://github.com/paperclipai/paperclip/issues/5028)：把 `auth.json` 复制进托管的 `CODEX_HOME` 后，用户原来的家目录刷新过令牌，托管副本报 `refresh_token_reused`。后续修复改成软链接；软链接建不成时才退回复制。

## 2. 技术事实

### Claude Code

设了 `CLAUDE_CONFIG_DIR` 之后，这个目录有自己的设置、会话历史和 claude.ai 登录。macOS 上登录在钥匙串里；钥匙串拒绝写入时，才把 `0600` 的 `.credentials.json` 写进该目录。官方写明：钥匙串条目也绑定到这个目录，不同的 `CLAUDE_CONFIG_DIR` 读不同的条目。官方没有公布条目名算法，也没有「多个配置目录共用一条登录」的开关。多账号文档的做法是每个目录各自走一遍登录。来源：[Authentication](https://code.claude.com/docs/en/authentication)（2026-10-22）。

社区对 Claude Code 2.1.220 的反编译把服务名写成：默认目录是 `Claude Code-credentials`；非默认目录后缀为 `sha256(NFC(配置目录绝对路径))` 的前 8 位十六进制。来源：[claude-code-router #1601](https://github.com/musistudio/claude-code-router/issues/1601)。2026-06-25 的 [#70697](https://github.com/anthropics/claude-code/issues/70697) 曾报告所有目录共用一条 `Claude Code-credentials`。这与现行官方「按目录绑定」不一致。以现行官方文档和你在 2.1.300 上的实测为准：专用目录是未登录。

`claude setup-token` 生成长期 OAuth token，经 `CLAUDE_CODE_OAUTH_TOKEN` 使用，优先级高于 `/login`。每个新会话都会再读这个环境变量。这是另一份凭据，不是把钥匙串条目分享给第二个目录。来源同上认证页。

会话文件默认在 `~/.claude/projects/<编码后的工作目录>/<session-id>.jsonl`。能改的是整棵配置目录，不能只改会话目录：

| 手段 | 作用 | 按 id 续跑 |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | 设置、历史、登录一起换地方 | 只能续该目录里的记录 |
| `CLAUDE_CODE_PROJECT_DIR_NAME` | 自定 `projects/` 下的目录名。必须同时设置 `CLAUDE_CONFIG_DIR`，否则被忽略 | 该配置目录里仍可按 id 找到 |
| `cleanupPeriodDays` | 超过天数后删除记录。默认 30，最小 1，设 0 校验失败 | 文件还在就能续 |
| `CLAUDE_CODE_SKIP_PROMPT_HISTORY` | 任何模式都不写记录和提示历史 | 不能 |
| `claude -p --no-session-persistence` | 这一次不落盘 | 官方写明不能续 |
| TypeScript Agent SDK `persistSession: false` | 只在这一次调用的内存里存在。默认 `true` | 官方写明以后不能续。Python SDK 没有这个字段，用上面的环境变量 |

来源：[Manage sessions](https://code.claude.com/docs/en/sessions)、[CLI reference](https://code.claude.com/docs/en/cli-reference)、[.claude directory](https://code.claude.com/docs/en/claude-directory)、[Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[TypeScript SDK](https://code.claude.com/docs/en/agent-sdk/typescript)。

Agent SDK 的 `SessionStore` 在从外部存储恢复时，会把记录写进临时配置目录，并把子进程的 `CLAUDE_CONFIG_DIR` 指到那里，结束再删。那次运行因此不在用户的默认登录目录里。来源：[Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)。

### Codex

`CODEX_HOME` 是另一份独立家目录，含独立登录。维护者在 [#15410](https://github.com/openai/codex/issues/15410) 说这是设计，不计划改成共享登录；要用同一登录就在每个家目录分别登录。该 issue 于 2026-03-21 以 not planned 关闭。

ChatGPT 登录会在使用中自动刷新，并把新 token 写回 `auth.json`。CI 文档要求保存刷新后的文件；每次用最初那份种子覆盖，会丢掉已经刷新的 token。来源：[Authentication](https://developers.openai.com/codex/auth)、[CI/CD auth](https://developers.openai.com/codex/auth/ci-cd-auth)。

刷新令牌会轮换。[#15357](https://github.com/openai/codex/pull/15357) 的 OpenAI 作者写：进程 A 把 refresh token 从 R0 换成 R1 并写入磁盘后，还拿着 R0 的进程再去刷新就会失败。同一维护者在 [#10332](https://github.com/openai/codex/issues/10332) 说，服务器允许同一枚 refresh token 在大约一小时的窗口内多次使用，之后才永久失效。所以「复制一份 `auth.json`」在窗口内可能还能用，窗口过后另一份刷新会失败。Paperclip 看到的错误码是 `refresh_token_reused`。

`cli_auth_credentials_store` 的取值是 `file`、`keyring`、`auto`、`ephemeral`。`file` 写 `CODEX_HOME/auth.json`。`keyring` 用系统凭证库。`auto` 优先钥匙串，不可用时退回文件。`ephemeral` 只把凭据留在当前进程内存。来源：[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。[developers.openai.com 的认证页](https://developers.openai.com/codex/auth) 只列出前三个，两页不一致。

当前 `main` 的 [storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs) 里，`FileAuthStorage::save` 对 `auth.json` 使用 `OpenOptions` 的 `create + write + truncate`，Unix 上模式 `0o600`。这段没有临时文件、没有 `rename`、没有 `O_NOFOLLOW`。按这段代码，已经指向有效文件的软链接会被跟随，写入落在目标上，目录项仍是软链接。悬空软链接的结果本次没有在测试里看到。钥匙串服务名是常量 `Codex Auth`，账号键是 `cli|` 加上家目录路径 SHA-256 的前 16 位十六进制。因此另一个 `CODEX_HOME` 对不上用户原来的钥匙串条目。这和专用目录报 `requiresOpenaiAuth` 一致。

没有「只换 sessions 目录」的配置。`CODEX_HOME` 同时搬走配置、登录、日志、会话和 skills。[环境变量](https://developers.openai.com/codex/environment-variables) 里 `CODEX_SQLITE_HOME` 只搬 SQLite。`history.persistence = none` 只停止 `history.jsonl`，配置参考的原文是 session transcripts to `history.jsonl`，不是 `sessions/` 下的 rollout。`codex exec --ephemeral` 不把 rollout 写到磁盘，来源：[Non-interactive mode](https://developers.openai.com/codex/noninteractive)。没有 rollout 文件时，按 thread id 续跑没有记录可读；本次没有打开一句专门写「ephemeral 之后 resume 的错误文案」。

### Grok

`GROK_HOME` 默认 `~/.grok`，同时放配置、`auth.json`、会话、skills 和日志。会话在 `$GROK_HOME/sessions/<编码后的 cwd>/<session-id>/`，续跑读其中的 `summary.json` 和 `updates.jsonl`。设置参考的 `[session]` 只有压缩阈值和 `.envrc`，没有单独的会话目录，也没有关闭落盘的开关。把家目录只读挂载时，文档写会话持久化会静默失败，变成一次性会话，`--resume` 因此没有本地记录。来源：[Settings reference](https://docs.x.ai/build/settings/reference)、[Sessions](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)、[Headless](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)。

认证文档写 access token 会在后台刷新，没有服务器给的过期时间时按 30 天。shell README 另写 token 7 天后过期。两处都没有写 refresh token 是否轮换。来源：[Authentication](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md)。

[xai-grok-login/src/storage.rs](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-login/src/storage.rs) 的测试 `atomic_write_writes_through_symlink_and_keeps_owner_only` 断言：原子写入（临时文件再 rename）穿过软链接，`auth.json` 仍是软链接，新凭据写在目标上，目标保持 `0600`。磁盘满时退回原地截断重写。

### dsh

凭据默认在 `$DSH_HOME/.credentials.yaml`（未设置则为 `~/.dsh`）。查找顺序是该文件、启动环境里的 `DEEPSEEK_API_KEY`、项目 `.env`、`$DSH_HOME/.env`。插件配置 `path` 可以把凭据文件指到别处，与家目录分开。来源：[credentials-local README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/credentials/credentials-local/README.md)。

会话根目录可以用 profile 补丁改 `session-persistence-jsonl.root`。[#1485](https://github.com/deepseek-ai/deepseek-harness/discussions/1485) 写两个 profile 可以因此使用不同的 session 根，但 `$DSH_HOME/storages/workspace.json` 仍在家目录一级共享。未查到「关闭会话记录」的开关，也未核对 `.credentials.yaml` 的写入是否原子、是否会把软链接换成普通文件。DeepSeek 这条凭据在已打开的文档里是 API key，不是会轮换的 OAuth。

## 3. 归纳和对 Helm 的建议

业界默认是继承用户家目录。Conductor、vibe-kanban、Claude Squad、Orca 和 Superset 的普通账号都这样做。代价是编排器的会话出现在用户的 `claude --resume`、Codex 线程和 `~/.grok/sessions` 里，记录里会有工具读到的文件内容。好处是登录、刷新都由 CLI 自己完成，编排器不接触凭据。

第二套做法是专用家目录，并且让用户在那个目录里用官方命令登录一次。Orca 的 launch profile 和 Claude 官方多账号别名是这条。代价是每家 CLI 多一次登录；Claude 在 macOS 上是另一条钥匙串记录，刷新只更新那一条。会话不再混进默认历史。

第三套是复制或软链接凭据。Orca 的托管副本、Paperclip 的复制、mngr 对 macOS 的警告、Superset 否决 token 互换，都卡在刷新轮换上。这套还要求编排器读或保存凭据，和 Helm 的规矩冲突。

关掉落盘（`persistSession: false`、`--no-session-persistence`、`CLAUDE_CODE_SKIP_PROMPT_HISTORY`、`codex exec --ephemeral`、把 Grok 家目录设成只读）能让记录不出现，官方同时写明不能按 id 续跑。`cleanupPeriodDays` 最小是 1，只能缩短保留，不能让记录不出现。

建议 Helm 保持现在的默认家目录：子进程有 `HOME`，不设置那四个家目录变量，也不要把 `CLAUDE_CONFIG_DIR` 显式设成 `~/.claude`。登录继续由各 CLI 读自己的钥匙串或 `auth.json`，Helm 不读。需要跨进程按 id 续跑时，记录留在用户目录里，直到各 CLI 自己的保留期删掉它们。

若产品上不能接受混进用户历史，再为 Helm 建专用目录，并让用户执行一次 `CLAUDE_CONFIG_DIR=<helm> claude auth login`、`CODEX_HOME=<helm> codex login`、`GROK_HOME=<helm> grok login`，以及在对应 `DSH_HOME` 里准备 dsh 凭据。专用目录必须是用户登录出来的，不能从默认目录复制。Codex 若用户用的是 `file` 存储，软链接 `auth.json` 在当前源码里不会被换成普通文件，但两个进程会刷新同一枚令牌；钥匙串模式下账号键含家目录哈希，软链接文件根本不会被读到。Claude 在 macOS 上软链接文件也解决不了钥匙串按目录分条目。
