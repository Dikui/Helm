# 防止执行者冒充用户调用本机守护进程

调研日期：2026-10-22（Grok，一手来源）。起因：[Olympus 接入面](../../.scratch/helm-v1/issues/13-olympus-interface.md) 的用户接口认证。 13 最终决定 v1 不做用户接口认证，本文留作以后补认证用。

## 结论

v1 用「持有者令牌 + 能禁读的那三家禁读这个文件」。令牌只放在 `~/.helm/`，模式 `0600`，不进命令行，不进执行者环境。Codex 的权限配置和 Grok 的 `deny` 已能在内核拦住读取（本机实测，2026-10-22）。Claude 要两层一起用：沙箱 `filesystem.denyRead` 只包住 Bash；Read 工具靠权限拒绝规则 `Read(~/.helm/**)`。DeepSeek Harness 官方做不到按目录禁读。它不适合和 `helmd` 同一用户、同一网络命名空间、又能看见 `~/.helm` 地跑。

不要改用「只封 `helmd` 这一个本机端口」或「看 TCP 对端是不是执行者的子孙」。四家都没有「放行其他本机端口、只拒绝一个 localhost 端口」的开关。TCP 对端 PID 挡不住脱离进程树的进程。浏览器连不上 Unix socket，对端凭证帮不上浏览器这条路。

## DeepSeek Harness：做不到禁读

官方沙箱只限制文件效果里的写。`SandboxMode` 的注释写明：网络和进程可见性不在这套词汇里。`read-only` 拒绝写，POSIX 上额外允许写 `/dev/null`；`workspace-write` 再允许工作区和临时目录；`danger-full-access` 不调用 `ctx.sandbox`。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox/src/index.ts

macOS Seatbelt 配置是 `(allow default)` 加上 `(deny file-write*)`，再按可写根放行 `file-write*`。默认允许，所以读是开的。当前 master 的 `seatbeltProfileArgs` 就是这几条，没有 `deny file-read*`，也没有按路径禁读的参数。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/src/profiles.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md

Linux bwrap 配置以 `--ro-bind / /` 开头，整棵宿主文件系统只读挂上，再按模式加临时目录和工作区的可写绑定。同一函数里有 `--unshare-pid`，没有 `--unshare-net`。Landlock 的写授权从 `/dev/null` 起，工作区只在 `workspace-write` 时加入。文档把「读不受限」列为 Windows ACL 后端 `partial` 的原因之一。

- 同上 `profiles.ts`、`sandbox-local/README.md`

`dsh-fs-sandbox` 只在 `writeText` / `editText` 上加围栏。包说明写：读、列目录、元数据和只读 watch 与 `fs-local` 相同，围栏不限制观察。npm 页写明 “Reads always pass through — every mode permits reading.” `read` 工具的路径授权「完全属于 `ctx.fs`」。因此换不换 `fs-sandbox`，官方这个后端都不禁读。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-sandbox/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/tool-fs/README.md
- https://www.npmjs.com/package/@deepseek-ai/dsh-fs-sandbox

`grep` 不走 `ctx.fs`。`glob` / `grep` 由 `dsh-tool-fs-search` 经 `ctx.bash` 执行。Bash 的沙箱同样只限写：普通读取不会变成「被拒绝的文件效果」，也就不会升级。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/archived/feature/2026-07-09-bash-backed-grep-glob-discovery.zh.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/shell/tool-bash/README.md

审批不是按路径的读许可。`ctx.approval.request` 只处理「需要审批的操作」。Bash / 写文件进入审批，是因为带了严格更宽的 `sandbox_permissions`。不带这个字段的当前模式调用直接执行。`read` 不走这条缝。ACP 只是把已有的 `approval/request` 转成 `session/request_permission`。`dsh-v0.1.2-alpha.1` 的桥只放 `toolCallId` 和一次允许 / 一次拒绝。Discussion #3481 对 rc.8 的说明相同，并写明这是有意不把工具名和路径放到这条连线上。master 的设计说明仍把展示留在 ACP 之外。所以即使用户接口代答权限，也看不到「这次在读哪条路径」，而普通读和 grep 根本不会发出这个请求。

- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/packages/acp/acp/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/discussions/3481
- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/shell/tool-bash/README.md

配置面没有禁读字段。`dsh-sandbox-local` 的配置只有 `runnerCommand`、`runnerFailureSignatures`、`probeTimeoutMs`。`runnerCommand` 后面接的是 bwrap 风格的 profile 参数，并跳过内置探测；文档要求这个 runner 诚实实现那份 profile。那份 profile 仍是 `--ro-bind / /` 这一类写策略。在它后面再绑一次只读根，会盖住 runner 前面想挡住的路径。自己写一个不诚实的包装脚本，只能影响被 `confine()` 包住的 shell，包不住进程内的 `read`。macOS 内置 runner 是 `sandbox-exec`，不是 bwrap；设了 `runnerCommand` 就不再走 Seatbelt 选择。

`--patch` 按行替换插件配置，后层盖住前层整份 `config`，不会凭空多出一个禁读键。官方没有另一个「禁读某些路径」的 `ctx.fs` 插件可以打进去。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md

社区插件可以在 `tools/pre-execute` 上按工具名拒绝 `read`。这是工具参数检查，不是内核。Bash 里不把路径写在被规则看见的参数上，就绕过。官方讨论 #962 建议给凭据路径加读拦截，下面没有官方「已做 / 将做」的答复。未找到 changelog 或路线图写明 0.2.1-rc.2 或更新版本加入按目录禁读。本次读到的 master 仍是只限写。

- https://github.com/deepseek-ai/deepseek-harness/discussions/174
- https://github.com/deepseek-ai/deepseek-harness/discussions/962

官方对「整个环境都要隔开」的说法是：换容器、microVM 或远端执行器，而不是再调这个同机沙箱。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox/README.md

本机实测（2026-10-22，任务给定）：Seatbelt 默认允许、只拒绝写；`dsh-fs-sandbox` 只限写；读文件、grep 和 shell 都读到了放在 `~/.helm/` 的令牌。和上面的源码一致。

## 替代办法

| 办法 | 可行性 | 剩下的洞 |
| --- | --- | --- |
| a. 只封 `helmd` 的本机端口，其他网络和其他本机端口照旧 | 四家都做不到这种粒度 | 见下 |
| b. TCP 对端 PID，拒绝执行者的后代 | 能认出「还挂在执行者进程树上」的连接。不能当安全边界 | 双 fork、后台命令结束后被收养、`systemd-run --user`、让用户的浏览器代连，都脱离这棵树 |
| c. Unix socket + `SO_PEERCRED` / `LOCAL_PEERPID` | 同机 Unix 流套接字上，内核给出的对端身份可用 | 浏览器的页面脚本连的是 `ws://` / `http://` 的主机和端口，没有 Unix socket。前面再加 TCP 就回到 a 或 b |
| d. 只有浏览器能做、curl 做不到的事 | HTTP 本身没有这种不对称 | `Origin`、CORS、自定义头，curl 都能设。见下 |

### a. 按端口封 `helmd`

Claude Code 的 Bash 沙箱里，网络不直连，走本机代理。`allowedDomains` 可以用 `:端口` 限制这一条放行，不带端口就是该主机的所有端口。这是允许列表，不是「允许 127.0.0.1 的其他端口、单单拒绝 `helmd`」。`localhost` 这一条只作用于走代理的连接。Claude 给沙箱命令设置 `NO_PROXY`，让它们直连 localhost，所以这条允许项改不了直连。macOS 上 `allowLocalBinding: true` 的语义是：可以监听，并且可以连接 localhost 的任意端口，包括机器上其他服务。false 时直连本机服务被 Seatbelt 拒绝，浏览器 MCP 和开发服务一起被拒绝。Linux / WSL2 上沙箱命令的 localhost 是该命令私有的，连不上宿主机，`allowLocalBinding` 无效。要连宿主机服务，只能把命令放进 `excludedCommands`，这一条不再有文件系统和网络限制。`allowedDomains` 也不限制 WebFetch。Read、hook、本地 MCP 在 Bash 沙箱外面。

- https://code.claude.com/docs/en/sandboxing
- https://github.com/anthropics/sandbox-runtime

Codex 权限配置里 `[permissions.<name>.network.domains]` 的值是 `allow` 或 `deny`。主机模式在规范化时会去掉简单端口和括号。拒绝 `127.0.0.1` 就是拒绝这个主机，不是一个端口。`allow_local_binding` 是布尔：false 时，`localhost` 和 `127.0.0.1` 这种字面地址必须整主机放行，解析到本机或私网地址的名字仍被挡住；true 时关掉这道本地/私网守卫。app-server 的 `workspaceWrite.networkAccess` 仍是布尔。未找到「只拒绝一个 localhost 端口」的键。

- https://developers.openai.com/codex/permissions
- https://developers.openai.com/codex/app-server

Grok 的 `restrict_network` 只在 Linux 用 seccomp 切断子进程网络，macOS 上是空操作。它是整网开关，不是按端口。进程内的网页工具和模型 API 不受这道开关控制。`deny` 能禁读文件，但不能代替端口过滤。这一点 [unattended-executors.md](unattended-executors.md) 已记过，这里只用来评价「封端口」这条路。

- https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md
- https://docs.x.ai/build/settings/reference

dsh 的 `SandboxMode` 不管网络。当前 bwrap 参数没有 `--unshare-net`。讨论 #962、#5561、#8887 都报告沙箱内可以访问 `127.0.0.1` 上的 harness 自己的端口。未找到官方的按端口网络配置。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sandbox.md
- https://github.com/deepseek-ai/deepseek-harness/discussions/5561
- https://github.com/deepseek-ai/deepseek-harness/discussions/8887

### b. 认 TCP 对端，再看是不是执行者的后代

Linux 上 TCP 没有可用的对端 PID。`SO_PEERCRED`、`SO_PEERPIDFD` 属于 `AF_UNIX`。`SO_PEERCRED` 返回的是 `connect` / `listen` / `socketpair` 时的身份；`SO_PEERPIDFD`（内核 6.5 起）给的是 pidfd，避免 PID 被复用后认错人。对 TCP 调用 `SO_PEERCRED` 得不到对端进程。本机 TCP 的公开做法是：`/proc/<pid>/fd` 里 `socket:[inode]`，再和 `/proc/net/tcp` 的 inode 对上。这是扫进程，接受连接之后才查，中间进程可以退出，inode 也可以再被用上。

- https://man7.org/linux/man-pages/man7/unix.7.html
- https://lore.kernel.org/netdev/20230523140844.5895d645@kernel.org/T/
- https://docs.openpmix.org/en/latest/how-things-work/authentication/methods.html
- https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html
- https://man7.org/linux/man-pages/man5/proc_net.5.html

macOS 的 `LOCAL_PEERPID`、`LOCAL_PEERTOKEN` 也是 Unix domain socket 的 `getsockopt`（level `SOL_LOCAL`）。`LOCAL_PEERTOKEN` 拿的是 audit token，公开讨论里把它当作比裸 PID 更不容易被复用认错的标识。TCP 连接没有这两项。TCP 对端要靠 libproc：`proc_pidinfo` 列出 fd，再从 socket 信息里看本地和远端地址。`lsof` 走的是这条。同样是连接建立之后的扫描。

- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/un.h
- https://github.com/nix-rust/nix/pull/1967
- https://knight.sc/reverse%20engineering/2020/03/20/audit-tokens-explained.html

进程树挡不住这些：

- `setsid` 和 `nohup` 本身不改父进程。父进程还活着时，子进程仍是后代。
- 双 fork，或 shell 把命令放进后台然后退出：中间父进程退出后，孩子被 init 或 launchd 收养，父进程变成 1。`daemon(3)` 写明父进程退出、子进程继续跑。这时从连接进程往上走，走不到执行者。
- Linux 上 `systemd-run --user` 让 systemd 用户实例拉起进程，父进程不是执行者。
- 执行者调用用户已经打开的浏览器去访问 `http://127.0.0.1:...`。连接来自浏览器，浏览器不是执行者的后代。若允许名单是「浏览器」，这条就放行。

cgroup 也不是同一用户下的边界。cgroup v2 里，对目标 `cgroup.procs` 有写权限的进程可以把任务迁走。`helmd` 和执行者是同一个用户，用户自己的 cgroup 目录通常这个用户就能写。未找到「同一用户、无特权监管进程」时 cgroup 仍能关住对方的官方保证。

环境变量标记可以被 `env -u` 去掉。Linux 上同一用户能读 `/proc/<pid>/environ`。把令牌只放在 `helmd` 的环境里，dsh 的 shell 在「允许默认」的 Seatbelt 或未切断 `/proc` 的沙箱里读得到。macOS 没有和 Linux 对等的、公开且稳定的「TCP + responsible PID」接口说明；`responsibility_*` 在私有头里。未把它写成 v1 可用办法。

- https://man7.org/linux/man-pages/man3/daemon.3.html
- https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
- https://man7.org/linux/man-pages/man5/proc.5.html

### c. Unix socket 对端凭证

Linux `AF_UNIX` 流套接字用 `SO_PEERCRED`（pid、uid、gid）和 6.5+ 的 `SO_PEERPIDFD`。macOS 用 `LOCAL_PEERPID` 和 `LOCAL_PEERTOKEN`。身份由内核填写，对端用户态改不了这份结构。PID 仍是连接或 listen 时刻的号；pidfd 和 audit token 用来避开号被复用。

浏览器页面没有 Unix socket API。WebSocket 的地址是 `ws://` 或 `wss://` 的主机和端口。Helm 的浏览器界面要继续用 HTTP + SSE，就还要一个 TCP 监听。这个 TCP 端口若不再做认证，执行者直接连它。若在 TCP 上再查 PID，洞和 b 相同。Codex 自己的 `unix://` 是给 app-server 客户端的，不是给浏览器页面的。

- https://man7.org/linux/man-pages/man7/unix.7.html
- https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- https://developers.openai.com/codex/app-server

### d. 其他

CORS 和 `Origin` 检查只约束浏览器。规范把 CORS 定义成浏览器决定是否把跨源响应交给页面脚本。curl 可以自己带 `Origin`。DeepSeek 讨论 #5561 就是这个形状：本机网关只查 `Origin`，浏览器会碰到 403，沙箱里的 curl 得到 200，然后代用户建会话。#250 报告沙箱进程还能把本该等人点的审批自己答掉。所以「只听 127.0.0.1」和「查一下像不像浏览器」都不成立。

Cookie 若落在用户能读的浏览器配置目录里，能读家目录的执行者就能读。只存在内存里的会话 cookie，本次没有找到「同一用户的进程一定读不到」的保证。令牌出现在启动浏览器的命令行里时，同一用户的 `ps` 看得到；VS Code 和 Jupyter 都是为了躲开这一点，才把令牌放进文件而不是 argv。那仍是防其他用户，不是防同一用户。

- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- https://github.com/deepseek-ai/deepseek-harness/discussions/5561
- https://github.com/deepseek-ai/deepseek-harness/discussions/250

## 同类产品

威胁模型大多是「别的操作系统用户」和「不要把端口露到网上」。同一用户、又会跑 agent 时，它们要么把 agent 放进容器，要么让 agent 拥有用户的全部权限，要么根本不设本机令牌。

| 产品 | 机制 | 令牌在哪 | agent 能不能读到 |
| --- | --- | --- | --- |
| Jupyter Server | 默认令牌。可放在 `Authorization: token`、`?token=`，或登录框。空字符串会关掉认证 | 终端日志、`jupyter server list`、runtime 目录里的 `jpserver-*-open.html`。也可用 `JUPYTER_TOKEN` 或 `JUPYTER_TOKEN_FILE`。重定向文件是为了不让其他用户从 `ps` 看见启动浏览器的 URL | 同一用户能读 runtime 目录和终端回滚就能读到。文档防的是多用户机器上的其他人 |
| VS Code Server | 每个请求带 connection token。默认每次启动生成。`--connection-token-file` 从文件读。`--without-connection-token` 关掉 | 命令行，或文件（建议放在 `0700` 目录）。不设文件时写在 user-data-dir 的 `token`。源码注释写：多用户机器上用文件，是为了别的用户不能用 `ps` 看见 | 同一用户能读该文件就能读到。防的是其他用户的 `ps` |
| code-server | 默认密码，写在配置里；限速。内层 VS Code 用 `--without-connection-token`，认证在 code-server 自己 | `~/.config/code-server/config.yaml` 的 `password`。维护者写过会从子进程环境里去掉 `PASSWORD`，避免扩展读到环境变量 | 配置文件仍在用户目录。能读这个文件的 agent 读得到密码 |
| Claude Code IDE | 扩展在 `127.0.0.1` 随机端口开 MCP。CLI 用头 `X-Claude-Code-Ide-Authorization` | `~/.claude/ide/<port>.lock`，文件 `0600`，目录 `0700`。设了 `CLAUDE_CONFIG_DIR` 则在其下的 `ide/`。每次激活换新令牌 | 官方写明：回环上能抓流量的进程也能从锁文件读令牌，所以不再上 TLS。同一用户的 agent 读得到 |
| Codex app-server | 本机 `ws://127.0.0.1` 可以不认证。非回环必须先配认证，握手用 `Authorization: Bearer`，在 `initialize` 之前检查。带 `Origin` 的请求直接 403 | `--ws-token-file` 或共享密钥文件。文档要求不要把原始令牌放在命令行。也可用 `unix://`，那是给自己的客户端 | 令牌文件在用户可读的路径上时，能读文件的 agent 读得到。本机回环监听默认可不认证 |
| Orca | 本机桌面：agent 和 UI 在同一台机器。远程配对是一次性配对码，之后是设备令牌。SSH 主机上的 `orca` 只能碰该主机的终端和编排消息 | 配对码在桌面配对界面上。未找到本地 agent 与桌面控制面之间的另一份令牌 | SSH 上的 agent 文档写明够不到其他主机、桌面控制、账号和设置。未找到「本地 agent 读不到本机控制面令牌」的说明 |
| Conductor | 未找到本机 HTTP 令牌。agent 使用机器上已有的 CLI 登录 | 各家 CLI 自己的凭据，或设置里的 API key | 文档写 agent 与用户同一权限，直接跑在系统上，没有沙箱，能读用户能读的任何东西 |
| Vibe Kanban | 本地项目不登录。云和自建用 GitHub/Google OAuth 或一份本地邮箱密码，会话是 JWT。远程访问用配对码 | 云端 OAuth。自建密钥在 `.env.remote`（`VIBEKANBAN_REMOTE_JWT_SECRET` 等）。本地桌面打开 `http://localhost:...` | 未找到本地界面对抗本机其他进程的令牌。本地数据不登录即可用 |
| OpenHands | 默认 Docker，agent 在容器里。本机进程模式文档写明没有隔离。agent server 可用 `OH_SESSION_API_KEYS_0`，请求头 `X-Session-API-Key`；不设则本机回环可不认证 | 环境变量。云沙箱另发 `session_api_key` | 进程模式下 agent 能读该用户能读的文件。Docker 模式下宿主文件默认不在容器里，除非挂载进去 |
| Cline | 账号令牌在登录时生成。本机 hub 监听 `127.0.0.1:25463`。Kanban 默认 `127.0.0.1:3484` | 提供方密钥在 `~/.cline/data/settings/providers.json`。未找到 hub 的连接令牌 | 能读 `~/.cline` 的 agent 读得到提供方密钥。Kanban 文档只在绑到非本机时提醒「信任网上的设备和人」，没有写本机其他进程的令牌 |
| Roo | 未找到 | 未找到一份写明本机用户接口令牌放在哪的官方页 | 未找到 |

来源：

- https://jupyter-server.readthedocs.io/en/stable/operators/security.html
- https://jupyter-server.readthedocs.io/en/stable/other/full-config.html
- https://github.com/microsoft/vscode/blob/main/src/vs/server/node/serverEnvironmentService.ts
- https://coder.com/docs/code-server/guide
- https://github.com/coder/code-server/blob/main/src/node/routes/vscode.ts
- https://code.claude.com/docs/en/vs-code
- https://developers.openai.com/codex/app-server
- https://developers.openai.com/codex/cli/features
- https://www.onorca.dev/docs/ways-to-run
- https://www.onorca.dev/docs/ssh
- https://www.onorca.dev/docs/mobile
- https://www.conductor.build/docs/faq
- https://vibekanban.com/docs/cloud/getting-started
- https://vibekanban.com/docs/remote-access
- https://docs.openhands.dev/openhands/usage/sandboxes/process
- https://docs.openhands.dev/sdk/guides/agent-server/local-server
- https://docs.cline.bot/getting-started/config
- https://docs.cline.bot/sdk/architecture/hub-spoke
- https://docs.cline.bot/kanban/remote-access

## 推荐方案

`helmd` 继续只听 `127.0.0.1`，每个用户操作要求持有者令牌。令牌只写在 `~/.helm/` 下的一个文件，模式 `0600`。启动浏览器时用重定向文件或用户已打开的页面去拿令牌，不要把令牌放进 argv，也不要放进执行者的环境变量。

四家的具体做法：

1. Codex。使用权限配置，把该路径设为 `deny`（或 `none`，以这份 profile 的取值表为准）。本机实测内核会拦住。app-server 线程不要改成 `danger-full-access`，也不要给一个能读家目录的文件系统 MCP。MCP 在 shell 沙箱外，这点已写在 [browser-in-agent-sandbox.md](browser-in-agent-sandbox.md)。
2. Grok。在生效的 sandbox profile 里 `deny` 这个路径。文档写明非空 `deny` 由内核执行读和写/改名；Linux 上读拒绝还要 bubblewrap。本机实测 shell 和自带读文件工具都被拦住。macOS 上不要靠 `restrict_network`，它是空操作。
3. Claude。Bash 沙箱开着，`filesystem.denyRead` 写上 `~/.helm`。另外加权限拒绝规则 `Read(~/.helm/**)`。文档写：拒绝规则在 `bypassPermissions` 下仍然生效；`filesystem.denyRead` 不阻止 Read 工具。`disallowedTools` 里以单个 `/` 开头的路径锚在会话工作目录，绝对路径要用 `//`，家目录用 `~/`。本机实测 `disallowedTools: ['Read(<path>/**)']` 不生效，和「单斜杠锚在工作目录」一致，但是否当时就是这个写法，本次没有复测。`canUseTool` 可以再拒绝 Read 和 Grep 的这个路径。不要用会让 `canUseTool` 不生效的 `bypassPermissions` 来代替拒绝规则。不要把读这个目录的命令放进 `excludedCommands`。不要挂一个能读家目录的 MCP。hook 在沙箱外。
4. DeepSeek。不要在这台机器上把 dsh 当成执行者，除非接受它能读令牌并调用用户接口。官方沙箱没有禁读，也没有按端口断网。若仍要用它，按官方的「整个环境隔离」：容器或 microVM，不挂载 `~/.helm`，不给到宿主机 `helmd` 端口的路由。社区的 `tools/pre-execute` 插件可以当日志，不能当边界。

剩余漏洞：

- 三家禁读都依赖「Helm 真的把对应开关传进去，且执行者没有第二条全权限通道」。Codex 的沙箱外 MCP、Claude 的 hook 和未进拒绝规则的工具、Grok 在沙箱 `off` 时，都会回到用户权限。
- Claude 的 Read 拒绝规则不覆盖「命令里不写出路径」的读取，例如在该目录里 `grep -r`，或 Python 自己 `open`。这些要靠 Bash 沙箱的 `denyRead`。沙箱外的 Read 工具要靠拒绝规则。两边少一边就漏。
- 令牌一旦出现在页面、终端回滚或模型上下文里，禁读文件就不再有意义。
- dsh 同机运行时，上面三家的做法盖不住它。
- 任何同一用户的进程，只要不在四家沙箱里，仍可读 `0600` 文件。令牌防的是「拿不到文件内容的进程」和网上的机器，不是所有本机进程。这和 Jupyter、VS Code、Claude IDE 的公开威胁模型相同。

推翻条件：dsh 官方加入内核执行的按路径禁读，并且 `read`、经 bash 的 `grep` 和 shell 都走它，网络仍能访问其他本机端口。或者 Claude 上复测 `Read(~/.helm/**)` 仍然挡不住 Read 工具。那时 Claude 只剩 `canUseTool`，而 `bypassPermissions` 会让这个回调不运行。

## 没能确认的事项

- 未找到 0.2.1-rc.2 这个标签的单独 diff。结论依据是 master 源码、包 README 和配置目录。未找到「rc.2 有过禁读、后来删了」的记录。
- Claude 的 `Read(...)` 拒绝规则是否覆盖名为 Grep 的工具。打开的文档写的是内置文件工具，以及 Bash 里能认出的 `cat` / `head` / `sed`，并写明不覆盖不点名文件的 `grep -r` 和自己打开文件的脚本。
- 未复测 `Read(~/.helm/**)` 和 `Read(//…/.helm/**)`。只核对了文档的锚定规则和任务里已有的实测。
- Codex 在 `network.enabled = false` 时，沙箱内直连 `127.0.0.1` 是否仍放行。权限页写的是启用网络之后的主机规则和本地守卫，没有单独写「网络关闭时的回环」。
- Grok 自定义 `deny` 在 Linux 上没有 bubblewrap 时，读拒绝是否降级。文档写 Linux 读拒绝需要 bubblewrap。本次没有在 Linux 上对照。
- macOS TCP 没有公开的 `LOCAL_PEERTOKEN`。未找到公开文档把 responsible PID 定为同一用户服务可用的认证接口。
- Orca 本地 agent、Conductor、Vibe Kanban 本地界面、Cline hub、Roo：未找到「本机令牌放在 agent 读不到的地方」的官方说明。Vibe Kanban 本地项目写的是不登录。
- dsh 讨论 #5561、#8887、#250、#962 是用户报告并贴了源码位置。未找到官方回复写明这些本机控制面问题已修复。

## 追问：DeepSeek Harness 的插件

调研日期：2026-10-22（Grok，一手来源）。接上一节「做不到靠官方配置禁读」。

### 现成插件

`dsh-plugin-market` 只读用户配置的索引 URL。仓库提交说明写：没有官方市场，所以不能内置默认源。索引要 `http:` 或 `https:`，无凭据、无片段；相对图标不能用 `file:`。格式由 `@deepseek-ai/dsh-plugin-market-index` 校验。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-market/README.md
- https://github.com/deepseek-ai/deepseek-harness/commit/3de3a977e0cca074b17744f7372644bc57ee63bd
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/plugin-market-index/README.md

社区拿来填这个槽的索引（不是官方源）：

- https://dsh.works/awesome-dsh-plugins/market/index.json
- https://dshopen.org/index.json
- https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json

未对这三份 JSON 做全文逐条检索。下面是按仓库、npm 和官方讨论能对上「禁读 / 执行前拦截」的插件。官方 `@deepseek-ai/dsh-fs-sandbox` 明确不限制读。

| 插件 | 链接 | 拦在哪 | 是否盖住 shell |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-fs-sandbox` | https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs-sandbox/README.md | 只围写。读、列目录、元数据与 `fs-local` 相同 | 否。读全放行 |
| `dsh-tool-policy`（讨论 #174） | https://github.com/Drifter-yh/dsh-tool-policy ，讨论 https://github.com/deepseek-ai/deepseek-harness/discussions/174 | `tools/pre-execute`，按工具名 allow/ask/deny。参数级 | 能对名为 bash 的调用发问或拒绝。作者写明有限模式盖不住等价写法 |
| `dsh-permission-rules` | https://github.com/PerryLink/dsh-permission-rules | 同上，外加路径 glob 和 shell 的 HTTP 代理 | 工具参数级。代理管的是出站网络，不是按目录禁读 |
| `dsh-safeguard` | https://github.com/ZhijiangTang/dsh-safeguard | bash 命令正则，以及参数里的密钥样式 | 作者写明是启发式，不是沙箱 |
| `dsh-guardian` | https://github.com/lonelymoon87/dsh-guardian | 危险 shell、SQL、写文件参数；结果里打码 | 不禁读某个目录。作者写明不是进程沙箱 |
| `dsh-egress-guard` | https://github.com/tancheng33/dsh-egress-guard | 出站主机名单；结果打码。默认 `allowLoopback: true` | 不阻止把文件读进工具结果，只改写看起来像密钥的文本 |
| `dsh-perm-guard` | https://github.com/a903067276-rgb/dsh-perm-guard | 审批拦截加命令分类。README 写 2026-10-01 起停止维护 | 只读类查询在其表里是自动放行。未找到对 `~/.helm` 的内核禁读 |
| `dsh-allow` | https://github.com/DWJZ/dsh-allow | macOS Seatbelt：`file-read-data` 按路径拒绝，规则同时用于 `tools/pre-execute` 和随后的 `sandbox-exec`。`python -c open(...)` 由内核拒绝 | 文档的对象是 shell 调用。未找到它包住 `ctx.fs` 的 `read` 工具。元数据仍允许解析。未找到 Linux bwrap 实现 |
| 讨论 #962 里的 `pi-approval-guardian` | https://github.com/deepseek-ai/deepseek-harness/discussions/962 | 回复者描述：独立模型审 bash，以及已知私密路径上的 read/grep/find/ls | 审的是工具调用，不是内核。未打开该插件仓库核对实现 |

未找到官方插件，也未找到一份同时用内核拦住 shell、`read`、grep/glob 的现成插件。

### 自己写是否可行

#### a. 包住 `ctx.fs`，或用事件 / 瀑布

`read` 和 `read_image` 的路径授权在 `ctx.fs`。读的顺序是 `stat`，然后 `readText` / `streamText` / `readBytes`，之后才 `emit fs/observed`。写和改才有 `fs/write-intent`、`fs/edit-intent` 这种可以否决的槽。未找到 `fs/read-intent`。挂在 `fs/observed` 上已经晚了，内容已经读出。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/tool-fs/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/fs/README.md

因此要用一个自己的 `ctx.fs`：先把目标规范成真实路径，凡落在 `~/.helm`（及其 realpath）下的 `stat`、读、列目录、只读 watch 一律拒绝，其余委托给原来的 `fs-sandbox` 或 `fs-local`。cordis 补丁关掉官方那一行，再插入这一行。路径判断和委托大约一两百行，外加注册。接口以当前 `ctx.fs` 为准，本次没有逐方法对过源码，方法若漏一个，那个工具会在运行时缺能力。

这只盖住走 `ctx.fs` 的工具。grep/glob 不走它，它们走 `ctx.bash`。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/archived/feature/2026-07-09-bash-backed-grep-glob-discovery.zh.md

`tools/pre-execute` 可以按 `read` 的 `file_path` 或 grep 的 `path` 拒绝。这是参数级。模型改用 bash，把路径拼出来或绕个符号链接，这条就看不见。未找到名为 `tools/execute` 的官方瀑布。执行前门在已打开的社区说明里叫 `tools/pre-execute`。

符号链接要按官方写路径的做法，在检查时重新解析。只做字符串前缀会漏。

#### b. `runnerCommand` 自己的脚本

`runnerCommand` 非空时：跳过内置探测，断言完全执行，并把 bwrap 风格的 profile 参数追加在这条 argv 后面。它不负责发出 Seatbelt 的 `-p` 配置。macOS 内置链只有 Seatbelt；设了 `runnerCommand` 就不再走那条链。脚本收到的是 bwrap 参数，不是现成的 SBPL。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.md

当前 master 的 bwrap 参数以 `--ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent` 开头。`workspace-write` 再加 `--tmpfs /tmp` 和 `--bind <workspaceRoot> <workspaceRoot>`。可写根就在这对 `--bind` 里，源和目标相同。`read-only` 没有这个 `--bind`，参数里看不到工作区。文档写包裹后的 argv 是 runner、profile、分隔符、再是用户命令。分隔符的字面量，本次打开的 `profiles.ts` 片段里没有；bwrap 自己的用法是 `--`。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/src/profiles.ts
- https://github.com/containers/bubblewrap/blob/main/bwrap.xml

`runnerFailureSignatures` 在使用 `runnerCommand` 时必填、非空。每一项是一行、大小写不敏感的 stderr 子串，用来认出「runner 在执行用户命令之前就拒绝了这份 profile」。配一条脚本自己打印的固定句子即可，例如 `helm-runner: profile rejected`。进程以非零退出，且 stderr 含这句话。

脚本若是 shell，解释器在脚本套上沙箱之前就已经启动。README 把这写成操作者自己承担的断言。脚本应立刻 `exec` 到 `sandbox-exec` 或 `bwrap`，并且不要读 `~/.helm`。

macOS：脚本解析追加来的参数，自己执行 `sandbox-exec`。profile 沿用官方形状 `(allow default)`、`(deny file-write*)`、按可写根放行写，再加 `(deny file-read* (subpath "<realpath>"))`。官方写拒绝能压过前面的 `(allow default)`，因为他们的写拒绝就是加在 `(allow default)` 后面。路径必须用 realpath，Seatbelt 比的是解析后的路径（`/tmp` 即 `/private/tmp`）。`dsh-allow` 的实测另说：通配拒绝会输给更具体的允许，所以不要在这条拒绝之后再放一条更宽的读允许。

Linux：bwrap 后写的挂载盖住先写的。脚本在官方 `--ro-bind / /` 之后再加 `--tmpfs` 或空目录 `--bind` 到 `~/.helm` 的 realpath。工作区若在这个目录里面，会话会坏，Helm 不应把 cwd 放在这里。

这只包住 `ctx.sandbox.confine` 的进程，也就是 bash/pwsh 及其子进程，因此 grep/glob 在仍走 bash-sandbox 时被盖住。`danger-full-access` 不调用 `confine`。进程内的 `read` 工具也不调用它。

#### c. 不经过 `ctx.fs` 和 `ctx.bash` 的读

| 通道 | 是否还要拦 |
| --- | --- |
| `dsh-web-fetch-http` | 不用靠禁读文件。只接受无凭据的 `http:` / `https:`，主机名解析到非公网单播地址就拒绝。`file://` 和回环不在这条里。https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/README.md |
| MCP stdio | 要另拦，否则不要挂文件系统类服务器。讨论 #3904 写 `dsh-mcp-client` 不调用 `ctx.approval`。未找到官方写明 MCP 子进程进入 `confine`。https://github.com/deepseek-ai/deepseek-harness/discussions/3904 |
| `read_mcp_resource` | 要看服务器。工具按 URI 向已配置的 MCP 读，不经 `ctx.fs`。https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md |
| subagent | 子进程用自己的工具和 profile。同一 `DSH_HOME`、同一套补丁才带得上禁读。外部 ACP 子 agent 不继承这套 `ctx.fs`。https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-acp/README.md |
| `run_code` / `dsh-code-runtime-worker-thread` | 若 profile 挂了它，必须卸掉或单独包住。讨论 #3245 写 worker 用 `new AsyncFunction`，不经 `confine`，可以 `import('node:fs')` 和 `child_process`。空环境挡的是环境变量，不是文件。https://github.com/deepseek-ai/deepseek-harness/discussions/3245 |
| `read_image` 和官方附件 | 走 `ctx.fs.readBytes`，a 的包装能拦。用户先把文件复制进工作区再读，复制本身不在这条里 |
| 社区附件插件（把绝对路径写进提示） | 之后仍靠 `read` 或 bash。未逐个核对。代表：https://github.com/Hyp6666/dsh-open-file |

acp-app 的 README 没有列出默认工具表，只说工具在 base profile。未确认出厂的 `dsh --profile acp` 是否挂着 `run_code`。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/acp-app/README.md

#### d. 只作用于 Helm 拉起的 dsh

profile 在 `$DSH_HOME/profiles/<name>/`。层顺序是 bundle 补丁、该 profile 的 `cordis.patch.yml`、`$DSH_HOME/cordis.patch.yml`、然后每次启动的 `--patch`。后层整份替换该行的 `config`，不是按键深合并。`dsh plugin --profile acp add` 把包装进这个 profile 的 `node_modules`。

- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md

Helm 给这次进程设单独的 `DSH_HOME`（例如 Helm 自己的目录），再在那里初始化 acp profile 并装插件。用户原来的 `~/.dsh` 不会被这次 `plugin add` 写到。未在本次打开的 CLI README 片段里看到「未设置 `DSH_HOME` 时的默认目录」；讨论和插件把这个默认写成 `~/.dsh`。要隔离就显式设置，不要靠默认。

`--patch` 只作用于这一次启动，适合改 `runnerCommand` 这种配置。插件代码仍须能从该 profile 解析到。acp-app 关掉了 HMR，改配置要新进程，这和 Helm 一次派单一个进程一致。插件不能往 stdout 写非协议字节，否则 ACP 帧被弄脏。

### 结论

没有现成插件可以拿来就用。最接近的 `dsh-allow` 只在 macOS 上用内核对 shell 禁读，文档没有盖住 `read` 工具，也没有 Linux。

自己写的推荐组合是两块一起上，大约一个小插件再加一个 runner 脚本（路径包装一两百行，脚本几十到一百多行，另加一份 YAML 补丁）：

1. 替换 `ctx.fs`，拒绝 `~/.helm` 的 realpath 上的读、列目录和元数据。
2. `runnerCommand` 指向自己的程序：macOS 用 Seatbelt 加 `deny file-read*`，Linux 在 bwrap 的 `--ro-bind / /` 之后盖住同一路径。`runnerFailureSignatures` 用脚本自己的一行失败文本。
3. Helm 的 ACP 客户端拒绝升到 `danger-full-access`。这个模式不调用 `confine`。
4. 不挂 `run_code`，不挂能读家目录的 MCP。`DSH_HOME` 指向 Helm 的目录。

剩余漏洞：参数级规则挡不住绕过字符串的 bash；worker 和 MCP 子进程不进这两层；Seatbelt 若只拒绝 `file-read-data`，元数据仍在；路径不用 realpath 会漏；脚本在 `exec` 之前是裸的。

推翻条件：官方出现一个内核执行的禁读，并且 `read`、grep/glob 和 shell 都走它，同时 `run_code` 与 MCP 子进程也在同一策略里。或者出厂 acp profile 根本没有 bash-sandbox，那时 `runnerCommand` 不会被调用。
