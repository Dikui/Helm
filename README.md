# Helm

个人使用的多 Agent 编排器。当前实现任务单 01：登记本机 git 项目、设置全局并发上限、用消息开始工作，以及读取对话、事件和待处理关卡。

需要 Node.js 22.13 或更高版本和 git。使用 TypeScript、`node:sqlite`（WAL）及 Node 自带的测试框架。

```sh
npm ci
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

SSE 的 `event` 为动作名，`id` 为事件 id，`data` 是完整结构化事件。新建工作会生成等待决定的“确认工作说明”固定关卡，并推送 `needs-user-attention`。本阶段工作保持 `aligning`；固定关卡没有撤回入口。工作说明起草、用户确认、调度轮次和驱动在后续任务实现。

`POST /mcp` 提供标准 Streamable HTTP MCP，工具、HTTP 路由和 CLI 子命令都从 `src/operations.ts` 的操作定义生成，共用 schema、调用方检查和事务实现。本阶段只提供用户调用方；调度轮次与派单令牌随相应任务加入。

代码分为任务库与事务（`store.ts`）、操作定义与业务约束（`operations.ts`）、HTTP/SSE（`server.ts`）、MCP 适配（`mcp.ts`）和 CLI 薄客户端（`cli.ts`）。新增业务操作时在操作表中登记，无需分别增加 HTTP 路由、MCP 工具和 CLI 分支。任务库通过 `PRAGMA user_version` 标识 schema 版本。

```sh
npm run check
npm test
```

测试启动真实 `helmd` 子进程，使用临时任务库和 git 项目，经 HTTP、SSE、MCP 和 CLI 验证行为，不读取内部数据表。
