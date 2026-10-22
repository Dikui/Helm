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

HTTP 操作统一为 `POST /api/<操作名称>`，参数为 JSON。成功返回 `{ "ok": true, "result": ... }`；约束失败返回 `{ "ok": false, "error": { "code": ..., "reason": ..., "allowedOperations": [...] } }`，并记录 `operation-rejected` 事件。全局并发上限默认为 10，目前保存设置，实际派单与排队由后续任务实现。

通过 `POST /events` 订阅 SSE，参数与 `get-events` 相同：`after`、`workId`、`cardId`、`dispatchId`、`actorType`、`actorId`。筛选条件取交集，按事件 id 递增返回历史并继续推送新事件。支持 `Last-Event-ID` 断线续读；同时提供 `after` 时取两者的较大值。

```sh
curl -N http://127.0.0.1:4242/events \
  -H 'Content-Type: application/json' \
  -d '{"after":0}'
```

SSE 的 `event` 为动作名，`id` 为事件 id，`data` 是完整结构化事件。新建工作会生成等待决定的“确认工作说明”固定关卡，并推送 `needs-user-attention`。调度者经 MCP 起草工作说明（`requirements`、`boundary`、`criteria`），关卡展示草稿、基准 ref、固定的基准提交和当前未提交改动。用户通过 `decide-gate` 确认所查看的版本后，运行层从该提交开出 `helm/<工作id>`，检出到数据目录的 `worktrees/<工作id>/_work`，工作从 `aligning` 进入 `executing`。再次起草会生成新的确认关卡，旧版继续生效，直到用户确认新版。

`POST /mcp` 提供标准 Streamable HTTP MCP，工具、HTTP 路由和 CLI 子命令都从 `src/operations.ts` 的操作定义生成，共用 schema、调用方检查和事务实现。调度轮次使用运行层注入的 `Authorization: Bearer <令牌>`，只能操作所属工作，轮次结束后令牌立即失效；不带令牌的接口作为用户调用方。`draft-work-description` 和 `send-message` 带工作内的 `key` 去重；调度笔记用 `write-coordinator-notes` 整份改写，每个版本保留事件，可通过 `get-coordinator-notes` 读取。

用户消息和关卡决定持久入队，同一工作同时最多一个调度轮次。每轮都是新会话，启动简报包括工作说明（草稿标“未确认”）、卡片图摘要（任务单 03 接入前为空）、未决关卡、调度笔记、新事件和最近 20 条对话。当前轮次运行时收到的消息留到下一轮；只有正常结束才标记这批事件已处理。轮次输出逐步写入数据目录的 `rounds/<轮次id>.jsonl`，`round-started` 事件提供路径，`round-ended` 提供结束方式和 token 用量。

`startHelmd({ driver: new FakeDriver(scripts), ... })` 可注入按轮次排列的脚本；脚本支持真实 MCP 工具调用、按沙箱限制写文件、步骤输出、压缩通知、指定结束方式、挂住和崩溃。驱动接口同时接受 cwd、环境变量、沙箱、MCP 服务与可选续跑会话 id；调度轮次始终新开。确认前调度者只读项目目录，确认后只读 `_work`。`helm serve` 默认使用空脚本假驱动，正常退出而不生成模型回答；可运行的对齐脚本见 `tests/alignment.test.ts`。Claude 驱动和启动对账由后续任务实现。

调度轮次失败会新开会话重投未处理事件，连续失败三次或调度者额度用完时暂停工作。`list-pending`、`list-works` 和 SSE `needs-user-attention` 展示运行层暂停原因，用户以 `helm resume-work --workId <工作id>` 手动恢复。每轮默认总时长 30 分钟、无输出 10 分钟；`helm set-round-watchdog --totalTimeoutMs 1800000 --idleTimeoutMs 600000` 调整后从下一轮生效，`get-settings` 可读取设置。轮次结束用本机 `lsof` 查找 `_work` 内的残留进程并清理进程组，需安装 `lsof`。`get-card`、`get-card-graph` 的 `usage` 汇总卡片全部派单，`get-work`、`list-works` 的 `usage` 另加全部调度轮次；输入和输出 token 分别累计，异常结束同样计入。

代码分为任务库与事务（`store.ts`）、操作定义（`operations.ts`）、工作说明与 git 确认（`alignment.ts`）、调度轮次（`rounds.ts`）、驱动接口与假驱动（`driver.ts`）、HTTP/SSE（`server.ts`）、MCP 适配（`mcp.ts`）和 CLI 薄客户端（`cli.ts`）。新增业务操作时在操作表中登记，无需分别增加 HTTP 路由、MCP 工具和 CLI 分支。任务库通过 `PRAGMA user_version` 标识 schema 版本，并保留任务单 01 数据升级到版本 2。

```sh
npm run check
npm test
```

测试启动真实 `helmd`（含 CLI 子进程），使用临时任务库和 git 项目，经 HTTP、SSE、真实 MCP、CLI 和文件系统验证行为，不读取内部数据表；另有假驱动公共接口的契约测试。
