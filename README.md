# Helm

个人使用的多 Agent 编排器。当前实现任务单 01–02：登记本机 git 项目、用消息开始工作、调度轮次与脚本假驱动，以及工作说明的起草、确认和工作分支。

需要 Node.js 22.13 或更高版本和 git。使用 TypeScript、`node:sqlite`（WAL）及 Node 自带的测试框架。

```sh
npm ci --cache /private/tmp/helm-npm-cache
npm run build
npm start -- serve
```

`helm serve` 前台运行 `helmd`，只监听 `127.0.0.1:4242`，默认任务库为 `~/.helm/helm.db`。可用 `--port` 和 `--data-dir` 修改；`--port 0` 由系统分配端口。启动时输出一行 JSON，包含实际 URL。Ctrl-C 停止进程。

在另一个终端运行：

```sh
npm start -- register-project --path /absolute/path/to/project
npm start -- set-concurrency --limit 3
npm start -- send-message --projectId <项目id> --body '做一个软件项目' --key start-1
npm start -- get-conversation --workId <工作id>
npm start -- get-work-descriptions --workId <工作id>
npm start -- list-pending
npm start -- decide-gate --workId <工作id> --gateId <关卡id> --descriptionId <工作说明版本id> --decision confirm
npm start -- list-works
npm start -- list-pending
npm start -- get-events --workId <工作id> --actorType runtime
npm start -- --help
```

项目路径会归一到 git 工作树根目录，重复登记返回已有项目。每条消息必须带 `key`；同一工作中重复使用同一个 key 返回已有消息。新建工作的第一条消息使用项目内唯一的 key，重试不会重复新建工作。后续消息使用 `--workId`，可以加 `--gateId` 引用该工作的关卡。

客户端默认连接 `http://127.0.0.1:4242`，可通过 `HELM_URL` 或各子命令的 `--url` 指定。也可用 `node dist/src/cli.js` 直接运行；通过 npm 链接这个包后可使用 `helm` 命令。

Helm 始终使用用户 PATH 上的 Agent CLI。Claude Agent SDK 随 npm 附带的 Claude Code 二进制（约 262MB）由 `package.json` 的 `overrides` 换成空包 `stubs/no-claude-binary-0.0.0.tgz`，不会下载；升级 SDK 时核对平台包名单是否变化。路径写成 `file:../../../stubs/...` 是因为 npm 对嵌套依赖的 `file:` 覆盖按 SDK 目录解析，锁文件里记录的是仓库相对路径。Claude（`claude`）、Codex（`codex`）、Grok（`grok`）、DeepSeek（`dsh`）由用户按需自行安装；Helm 不预先检查或提示安装；用户在新建工作或换调度者时选中模板、在设置页打开模板或切换驱动时，才检查该 CLI 是否在 PATH 上（`check-agent --driver <驱动>`），没有时询问是否下载安装，确认后由 helmd 在本机运行固定的官方安装命令（`install-agent --driver <驱动>`），登录仍在终端完成。执行者由调度者选择，所需模板不可用时调度者提决策关卡，请用户到设置页处理。

在已配置好所需 CLI 和代理的终端中运行 `helm service install`（或 `node dist/src/cli.js service install`），将 `helmd` 安装为用户服务并立即启动。安装是本地命令，不需要先启动 HTTP 服务。请先停止手动运行的 `helm serve`，避免占用同一个端口。

macOS 配置在 `~/Library/LaunchAgents/io.helm.helmd.plist`，随用户登录加载，进程退出后自动重启。Linux 写入 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/helmd.service`，执行 `systemctl --user daemon-reload`、`enable` 和 `restart`；还需运行 `loginctl enable-linger "$USER"`（必要时加 `sudo`），让用户服务在开机时启动、登出后继续运行。**Linux 未实测**，普通测试使用服务管理器替身。

配置保存安装时的 `PATH`、`HOME`、`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及其小写形式，标准输出和错误分别追加到 `~/.helm/logs/helmd.stdout.log`、`helmd.stderr.log`。环境改变后重新运行 install，会覆盖配置并重启服务。服务使用安装时 Node 和编译后 Helm 的绝对路径；请保留安装目录，移动或重新安装 Node/Helm 后也需再次 install。

HTTP 操作统一为 `POST /api/<操作名称>`，参数为 JSON。成功返回 `{ "ok": true, "result": ... }`；约束失败返回 `{ "ok": false, "error": { "code": ..., "reason": ..., "allowedOperations": [...] } }`，并记录 `operation-rejected` 事件。执行者派单的全局并发上限默认为 10，满了按创建顺序排队，调度轮次不占名额。`get-settings` 返回 `concurrencyLimit`、`runningDispatches` 和 `queuedDispatches`；调低上限不打断已启动的派单，调高立即补位。

每次派单通过 `HELM_PORT_START`、`HELM_PORT_END` 得到 20 个连续本机端口（两端包含），从 20000 起分配，清理结束后回收。`set-dispatch-watchdog --wallTimeoutMs 1800000 --idleTimeoutMs 600000` 设置后续派单的墙钟与无输出阈值，默认分别为 30 分钟和 10 分钟；超时记 `timed-out`。进程驱动须用独立进程组，并在启动时通过 `SessionOptions.onProcess` 上报 `pid`、`pgid` 和 `startedAt`；派单详情和 `process-started` 事件保留进程记录。

派单结束先清理工作目录位于卡片副本内的进程及进程组：`SIGTERM` 后最多等 5 秒，仍存活则 `SIGKILL`，确认退出后再清理 git 并提交。macOS 用系统 `lsof`，Linux 用 `/proc` 查工作目录。请在工作分支查看代码；卡片副本内自行开启的终端也会被清理。副本外切换目录或另建会话的进程可能无法按目录找到。开始前发现未忽略的脏文件会记录 `dispatch-copy-reset` 并重置；收尾移除 `index.lock`，中止半截 git 操作并记录 `dispatch-git-aborted`，保留其余执行进度。

通过 `POST /events` 订阅 SSE，参数与 `get-events` 相同：`after`、`workId`、`cardId`、`dispatchId`、`actorType`、`actorId`。筛选条件取交集，按事件 id 递增返回历史并继续推送新事件。支持 `Last-Event-ID` 断线续读；同时提供 `after` 时取两者的较大值。

```sh
curl -N http://127.0.0.1:4242/events \
  -H 'Content-Type: application/json' \
  -d '{"after":0}'
```

SSE 的 `event` 为动作名，`id` 为事件 id，`data` 是完整结构化事件。新建工作会生成等待决定的“确认工作说明”固定关卡，并推送 `needs-user-attention`。调度者经 MCP 起草工作说明（`requirements`、`boundary`、`criteria`），关卡展示草稿、基准 ref、固定的基准提交和当前未提交改动。用户通过 `decide-gate` 确认所查看的版本后，运行层从该提交开出 `helm/<工作id>`，检出到数据目录的 `worktrees/<工作id>/_work`，工作从 `aligning` 进入 `executing`。再次起草会生成新的确认关卡，旧版继续生效，直到用户确认新版。

`POST /mcp` 提供标准 Streamable HTTP MCP，工具、HTTP 路由和 CLI 子命令都从 `src/operations.ts` 的操作定义生成，共用 schema、调用方检查和事务实现。调度轮次使用运行层注入的 `Authorization: Bearer <令牌>`，只能操作所属工作，轮次结束后令牌立即失效；不带令牌的接口作为用户调用方。`draft-work-description` 和 `send-message` 带工作内的 `key` 去重；调度笔记用 `write-coordinator-notes` 整份改写，每个版本保留事件，可通过 `get-coordinator-notes` 读取。

用户消息和关卡决定持久入队，同一工作同时最多一个调度轮次。每轮都是新会话，启动简报包括工作说明（草稿标“未确认”）、卡片图摘要（任务单 03 接入前为空）、未决关卡、调度笔记、新事件和最近 20 条对话。当前轮次运行时收到的消息留到下一轮；只有正常结束才标记这批事件已处理。轮次输出逐步写入数据目录的 `rounds/<轮次id>.jsonl`，`round-started` 事件提供路径，`round-ended` 提供结束方式和 token 用量。

`startHelmd({ drivers: { 'claude-sdk': new FakeDriver(scripts) }, ... })` 按驱动名注入脚本，派单和调度轮次按 Agent 的 `driver` 选择驱动；可用 `agentDir` 指定 Agent 目录，测试用的 Agent 在 `tests/fixtures/agents/`。脚本支持真实 MCP 工具调用、按沙箱限制写文件、步骤输出、压缩通知、指定结束方式、挂住和崩溃。驱动接口同时接受 Agent 快照、cwd、环境变量、沙箱、MCP 服务与可选续跑会话 id；调度轮次始终新开。确认前调度者只读项目目录，确认后只读 `_work`。`helm serve` 默认登记真实 `claude-sdk` 驱动（拉起本机已登录的 `claude`）；设环境变量 `HELM_FAKE_COORDINATOR=1` 时调度者改用空脚本假驱动，供子进程测试使用。可运行的对齐脚本见 `tests/alignment.test.ts`。

Helm 不带模板。Agent 由用户在设置页「Agent 集群」创建，存在 `~/.helm/agents/<Agent id>/`，更新或重装 Helm 不会动它。每个目录包含 `config.json`、可选的附加提示词 `prompt.md` 和可选的 `skills/`。`role` 为 `coordinator` / `executor`，`driver` 为 `claude-sdk` / `codex` / `grok` / `deepseek`，`model` 和 `reasoningEffort` 可为 `null`；推理强度支持 `low` / `medium` / `high` / `max`。`fast` 默认 `false`，Claude 开启 fast 会标为不可用，并说明 extra usage 原因。`home` 为 `shared`（订阅）或 `dedicated`（API），`description` 是供调度者派单时参考的职责说明。调度者和执行者的工作规则内置在 `src/prompts.ts`，`prompt.md` 只写这个 Agent 的额外要求。已有任务库首次启动时，若 `~/.helm/agents/` 不存在，会按原来的 6 个内置模板生成同名 Agent；全新安装不生成。详见 [ADR 0006](docs/adr/0006-user-agents-replace-templates.md)。

订阅 Agent 使用 CLI 默认主目录，沿用终端里的登录：Claude 用 `claude auth login`，Codex 用 `codex login`。驱动不设 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`，不创建订阅专用目录或凭据软链接，会话记录写入用户自己的历史；父环境的这两个变量也不会传给 CLI。Claude 通过 `settingSources: ['user', 'project', 'local']` 加载用户、项目和本地设置，用户的规则、hooks、插件、MCP 和 skills 正常进入；Agent 的 `skills/` 以本地插件叠加，`skills: 'all'` 保留用户和 CLI 自带技能。Codex 同样读取个人配置、`AGENTS.md`、hooks、skills 和插件。两种角色都能使用用户 MCP。Helm 按会话覆盖模型、推理强度、fast 和角色权限，不修改个人配置。注意：`~/.claude/settings.json` 里的 `sandbox.filesystem.allowWrite`、`sandbox.excludedCommands` 会话里覆盖不掉，对执行者同样生效，执行者的 Bash 能写到其中列出的位置；项目设置和本地设置里的同类例外会被拦住。详见 [ADR 0005](docs/adr/0005-subscription-templates-use-default-cli-homes.md)。

API Agent 仍各用 `~/.helm/agent-homes/<Agent id>/`，Claude 设置 `CLAUDE_CONFIG_DIR` 并用 `settingSources: ['user']`，Codex 设置 `CODEX_HOME`。用户按 CLI 格式配置 `settings.json` 或 `config.toml`；Helm 只检查目录和文件存在，不打开凭据或配置。订阅可用性分别由默认环境的 `claude auth status --json`、`codex login status` 检查；Codex 只看退出码，支持由 CLI 管理的文件或钥匙串登录。`CODEX_SQLITE_HOME` 仍放在每次派单或调度轮次的数据目录。

修改文件后下一次派单或调度轮次即生效，排队派单在实际启动时重读；已有运行不受影响。`list-agents` 显示配置、计费方式 `billing`（`subscription` / `api`）、是否可用及原因。坏 Agent 独立报错，使用时返回 `AGENT_UNAVAILABLE`；创建工作时就校验调度者 Agent，不存在或不可用直接拒绝。派单详情的 `agent` 和 `round-agent-loaded` 事件中的 `agent` 保留当次解析快照（包含附加提示词），用户及调度者均可读取。内置角色规则在前，附加提示词其次，端口段、提交结论、清理、截图路径、不推送及验收说明快照等运行约定由代码追加在最后。

调度轮次失败会新开会话重投未处理事件，连续失败三次或调度者额度用完时暂停工作。`list-pending`、`list-works` 和 SSE `needs-user-attention` 展示运行层暂停原因，用户以 `helm resume-work --workId <工作id>` 手动恢复。每轮默认总时长 30 分钟、无输出 10 分钟；`helm set-round-watchdog --totalTimeoutMs 1800000 --idleTimeoutMs 600000` 调整后从下一轮生效，`get-settings` 可读取设置。轮次与派单共用进程清理：按工作目录查找 `_work` 内的残留进程并清理进程组，macOS 需安装 `lsof`，Linux 使用 `/proc`。`get-card`、`get-card-graph` 的 `usage` 汇总卡片全部派单，`get-work`、`list-works` 的 `usage` 另加全部调度轮次；输入和输出 token 分别累计，异常结束同样计入。

代码分为任务库与事务（`store.ts`）、操作定义（`operations.ts`）、工作说明与 git 确认（`alignment.ts`）、调度轮次（`rounds.ts`）、驱动接口与假驱动（`driver.ts`）、HTTP/SSE（`server.ts`）、MCP 适配（`mcp.ts`）和 CLI 薄客户端（`cli.ts`）。新增业务操作时在操作表中登记，无需分别增加 HTTP 路由、MCP 工具和 CLI 分支。任务库通过 `PRAGMA user_version` 标识 schema 版本，按 `src/migrations.ts` 的列表位置顺序升级；新增迁移只追加到末尾，不修改或重排已发布的迁移。支持已有版本 1–10，遇到比当前迁移列表更新的任务库时拒绝启动。

```sh
npm run check
npm test
```

`npm install` 和 `npm ci` 会通过 `prepare` 自动将 `core.hooksPath` 设为 `.githooks`，每次提交前运行 `npm run check`。GitHub Actions 在 push 和 PR 时使用 Node 22.13.0 运行依赖安装、类型检查和普通测试，不运行真实冒烟。

测试启动真实 `helmd`（含 CLI 子进程），使用临时任务库和 git 项目，经 HTTP、SSE、真实 MCP、CLI 和文件系统验证行为，不读取内部数据表；另有假驱动公共接口的契约测试。

改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，必须在沙箱外运行完整真实冒烟：

```sh
npm run test:real --cache /private/tmp/helm-npm-cache
```

入口按顺序运行浏览器、Claude 执行者、Claude 调度者、Claude skills、Codex 执行者、Codex 调度者，任一失败就停止。Claude 冒烟用本机默认主目录和已有登录（ADR 0005）；副本外沙箱拒绝检查在主目录下建一个临时目录，测试结束删除。需要已安装的有界面 Chromium；Linux 还需显示服务。入口固定在仓库根目录启动各套测试，子进程环境从空对象按白名单构造，仅保留运行必需变量，额外保留 `DISPLAY`、`XAUTHORITY`、`WAYLAND_DISPLAY`、`XDG_RUNTIME_DIR` 供 Linux 浏览器连接显示服务。不会传入调用方的 Claude 桌面会话、任意变量、Node 注入参数或 Helm 假驱动开关。测试输出的截图须在沙箱外打开核对。沙箱内运行普通测试，浏览器使用工具替身。

调度者和执行者的环境白名单及逐项用途见 [`src/environment.ts`](src/environment.ts)：PATH 查找 CLI 和开发工具，HOME 供 CLI 自行读取本地登录，USER/LOGNAME 提供用户身份，SHELL 选择命令解释器，LANG/LANGUAGE 和列出的 LC 类别保留语言与编码，TMPDIR/TMP/TEMP 指定临时目录，大小写代理变量维持网络访问。其余父环境不传入；运行层随后注入端口段、禁推送的 git 配置和无效 GH_TOKEN，并为本机 MCP 合并大小写 NO_PROXY。Helm 不读取登录凭据。Claude 会话固定设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 和 `autoMemoryEnabled: false`，禁用自动记忆（[官方说明](https://code.claude.com/docs/en/memory#enable-or-disable-auto-memory)）。

Claude 调度者的内置工具为 Bash/Read/Grep/Glob/Skill；执行者再加 Write/Edit/NotebookEdit/WebFetch/WebSearch/TodoWrite，避免随 CLI 默认工具集合变化。权限检查允许任意 Skill 和用户 MCP；执行者的写工具仍检查目标必须在卡片副本内（含真实路径），Bash 禁止请求退出沙箱。会话显式传 `permissionMode: default`、`settings.fastMode: false`，Codex 每次新开或续跑会话显式传 `serviceTier`（关闭 fast 时为 `default`）。真实冒烟核对角色内置工具、实际注入的 Helm 工具及用户 MCP。

Claude 会话对写工具和 Bash 设置 `permissions.ask`，优先于加载的 allow 规则进入现有权限回调；沙箱显式开启、不可用即失败、禁止无沙箱重试，并保持文件系统隔离。严格沙箱会忽略项目设置中扩大访问范围的例外，但用户级 `excludedCommands`、`filesystem.allowWrite` 及 `Edit(...)` 放行路径仍按 CLI 规则合并，会话空数组无法清除；目前不能保证带这些用户级例外的 Bash 只写卡片副本或调度者只读，参见 [官方沙箱说明](https://code.claude.com/docs/en/sandboxing#repository-settings-under-an-admin-required-sandbox)。

调度者调用 `create-dispatch` 时可加 `needsBrowser: true`。运行层为这次派单在执行者沙箱外启动独立的 Playwright HTTP MCP，执行者通过同一个派单 MCP 端点使用导航、快照、点击、输入、截图等检查工具和 `submit-conclusion`。浏览器工具使用明确的白名单，包含执行代码的工具不会转发；未标记派单、用户和调度轮次都拿不到浏览器工具。运行层记录浏览器的 pgid 和启动时间；派单结束、撤销或服务停止时，先 TERM 整组，5 秒后仍存活则 KILL，再处理副本。

浏览器固定为 `@playwright/mcp@0.0.83` 对应的 Playwright 自带 Chromium（Chrome for Testing），有界面、`--isolated`，HTTP 只绑定 `127.0.0.1` 并设置 `--allowed-hosts 127.0.0.1`。按锁定的依赖版本安装浏览器：

```sh
npm run browser:install
```

普通 `npm test` 只运行浏览器工具替身，不启动浏览器。真实浏览器测试须在沙箱外、有显示服务的环境单独运行，不使用无头模式或系统 Chrome：

```sh
npm run test:browser
```

该测试用假执行者在卡片副本中启动静态页，经派单端点导航并截图，将 PNG 保存在系统临时目录并输出路径。验收时须打开截图，核对页面标题 `Helm browser dispatch`。`startHelmd` 的 `browserCommand` 仅供边界替身测试替换外部 MCP 进程；浏览器生命周期不依赖派单用途，验收派单由任务单 07 接入。端口段分配由任务单 05 实现，当前测试用系统分配的本机空闲端口运行静态服务。
