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

`startHelmd({ driver: new FakeDriver(scripts), ... })` 可注入按轮次排列的脚本；脚本支持真实 MCP 工具调用、按沙箱限制写文件、步骤输出、压缩通知、指定结束方式、挂住和崩溃。驱动接口同时接受 cwd、环境变量、沙箱、MCP 服务与可选续跑会话 id；调度轮次始终新开。确认前调度者只读项目目录，确认后只读 `_work`。`helm serve` 默认使用真实 Claude 调度者和执行者驱动（拉起本机已登录的 `claude`）；设环境变量 `HELM_FAKE_COORDINATOR=1` 时调度者改用空脚本假驱动，供子进程测试使用。可运行的对齐脚本见 `tests/alignment.test.ts`。

调度轮次失败会新开会话重投未处理事件，连续失败三次或调度者额度用完时暂停工作。`list-pending`、`list-works` 和 SSE `needs-user-attention` 展示运行层暂停原因，用户以 `helm resume-work --workId <工作id>` 手动恢复。每轮默认总时长 30 分钟、无输出 10 分钟；`helm set-round-watchdog --totalTimeoutMs 1800000 --idleTimeoutMs 600000` 调整后从下一轮生效，`get-settings` 可读取设置。轮次与派单共用进程清理：按工作目录查找 `_work` 内的残留进程并清理进程组，macOS 需安装 `lsof`，Linux 使用 `/proc`。`get-card`、`get-card-graph` 的 `usage` 汇总卡片全部派单，`get-work`、`list-works` 的 `usage` 另加全部调度轮次；输入和输出 token 分别累计，异常结束同样计入。

代码分为任务库与事务（`store.ts`）、操作定义（`operations.ts`）、工作说明与 git 确认（`alignment.ts`）、调度轮次（`rounds.ts`）、驱动接口与假驱动（`driver.ts`）、HTTP/SSE（`server.ts`）、MCP 适配（`mcp.ts`）和 CLI 薄客户端（`cli.ts`）。新增业务操作时在操作表中登记，无需分别增加 HTTP 路由、MCP 工具和 CLI 分支。任务库通过 `PRAGMA user_version` 标识 schema 版本，当前为版本 8，支持已有版本 1–7 顺序升级。

```sh
npm run check
npm test
```

测试启动真实 `helmd`（含 CLI 子进程），使用临时任务库和 git 项目，经 HTTP、SSE、真实 MCP、CLI 和文件系统验证行为，不读取内部数据表；另有假驱动公共接口的契约测试。

改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，必须在沙箱外运行完整真实冒烟：

```sh
npm run test:real --cache /private/tmp/helm-npm-cache
```

入口按顺序运行浏览器、Claude 执行者、Claude 调度者三套测试，任一失败就停止。需要本机已登录的 `claude`、已安装的有界面 Chromium；Linux 还需显示服务。入口固定在仓库根目录启动各套测试，子进程环境从空对象按白名单构造，仅保留运行必需变量，额外保留 `DISPLAY`、`XAUTHORITY`、`WAYLAND_DISPLAY`、`XDG_RUNTIME_DIR` 供 Linux 浏览器连接显示服务。不会传入调用方的 Claude 桌面会话、任意变量、Node 注入参数或 Helm 假驱动开关。测试输出的截图须在沙箱外打开核对。沙箱内运行普通测试，浏览器使用工具替身。

调度者和执行者的环境白名单及逐项用途见 [`src/environment.ts`](src/environment.ts)：PATH 查找 CLI 和开发工具，HOME 供 CLI 自行读取本地登录，USER/LOGNAME 提供用户身份，SHELL 选择命令解释器，LANG/LANGUAGE 和列出的 LC 类别保留语言与编码，TMPDIR/TMP/TEMP 指定临时目录，大小写代理变量维持网络访问。其余父环境不传入；运行层随后注入端口段、禁推送的 git 配置和无效 GH_TOKEN，并为本机 MCP 合并大小写 NO_PROXY。Helm 不读取登录凭据。Claude 会话固定设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 和 `autoMemoryEnabled: false`，禁用自动记忆（[官方说明](https://code.claude.com/docs/en/memory#enable-or-disable-auto-memory)）。

Claude 调度者的内置工具为 Bash/Read/Grep/Glob；执行者再加 Write/Edit/NotebookEdit/WebFetch/WebSearch/TodoWrite，避免随 CLI 默认工具集合变化。真实冒烟核对初始化记录：不含 `messaging_socket_path`，工具只来自该角色的内置白名单和当前带令牌端点实际提供的 Helm 工具。

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
