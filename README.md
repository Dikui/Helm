# Helm

个人使用的多 Agent 编排器。用户提出需求，调度者 Agent 和用户对齐工作说明，再拆成卡片派给执行者 Agent 并行完成、验收，最后交用户审核和合入。v1 只做软件项目。

Helm 不自带模型，也不保管凭据：它驱动用户本机已安装、已登录的 Agent CLI——Claude（`claude`）、Codex（`codex`）、Grok（`grok`）、DeepSeek（`dsh`）。

术语见 [GLOSSARY.md](GLOSSARY.md)，架构决策见 [docs/adr/](docs/adr/)。

## 一项工作怎么走

1. **新建工作**：选项目、基准分支（默认是当前检出的分支）和调度者 Agent，发出第一条消息。Helm 当即从基准开出工作分支 `helm/<工作id>` 和只读的工作副本（[ADR 0012](docs/adr/0012-work-copy-at-creation.md)）。
2. **对齐**：调度者起草工作说明（需求、边界、标准），用户在“确认工作说明”关卡确认。确认后才进入执行。
3. **执行**：调度者建卡片图、派单。每张卡片在自己的卡片副本里由执行者完成，完成后合进工作分支（[ADR 0003](docs/adr/0003-own-sandboxes-and-work-branch.md)）。验收派单在固定提交的一次性副本里检查（[ADR 0009](docs/adr/0009-verification-copies.md)）。需要用户决定的事，调度者提决策关卡。
4. **审核**：调度者提交汇总报告，用户接受或退回。
5. **交付**：接受只记录决定；合入成功或基准已包含工作分支时工作即完成，立即删除工作副本和工作分支并压缩输出。完成后可选推送基准分支，界面先列出该分支全部待推送提交（包括其他本地提交）；推送失败或超过两分钟可重试，重启不自动推送。合入冲突时可以交给调度者派冲突卡片，也可以自己处理后重新检测。接受后、尚未合入时也可确认“结束（不合入）”，保留工作分支并完成工作（[ADR 0011](docs/adr/0011-accept-then-merge-separately.md)）。

取消工作时删除副本；卡片分支若还有工作分支之外的提交则保留，没有新提交的删除。删除整项工作时，工作分支及保留的卡片分支统一按工作的基准分支检查：已被基准包含的删除，其余保留，并列出分支和原因；不受项目目录当前检出分支影响。

调度者不是常驻会话：每次有新消息或事件，运行层新开一个调度轮次，处理完就退出，轮次之间靠任务库和调度笔记接续（[ADR 0002](docs/adr/0002-task-based-coordinator.md)）。

## 安装与启动

需要 Node.js 22.13 或更高版本和 git。

```sh
npm ci --cache /private/tmp/helm-npm-cache
npm run build
npm start -- serve
```

`helm serve` 在前台运行后台进程 `helmd`，只监听 `127.0.0.1:4242`，数据目录默认 `~/.helm/`。`--port` 改端口（`0` 由系统分配），`--data-dir` 改数据目录。启动时输出一行带实际 URL 的 JSON，在浏览器打开即是界面。

`npm link` 后可直接用 `helm` 命令，否则用 `npm start --` 或 `node dist/src/cli.js`。

Agent SDK 附带的 Claude Code 二进制（约 262MB）被 `package.json` 的 `overrides` 换成空包 `stubs/no-claude-binary-0.0.0.tgz`，不会下载，Helm 始终用 PATH 上的 CLI。升级 SDK 时核对平台包名单是否变化。

### 装成用户服务

先停掉手动运行的 `helm serve`，然后在已配置好 CLI 和代理的终端里运行：

```sh
helm service install
```

它把 `helmd` 装成用户服务并立即启动，保存安装时的 `PATH`、`HOME` 和代理变量，以及 Node 与 Helm 的绝对路径。环境变了、Node 或 Helm 移动或重装后，重新运行一次即可覆盖配置并重启。日志写到 `~/.helm/logs/helmd.stdout.log` 和 `helmd.stderr.log`。

- macOS：`~/Library/LaunchAgents/io.helm.helmd.plist`，登录时加载，退出后自动重启。
- Linux：`${XDG_CONFIG_HOME:-~/.config}/systemd/user/helmd.service`；还需 `loginctl enable-linger "$USER"`，开机即启动、登出后不停。**Linux 未实测。**

## 准备 Agent

界面的「设置」分为 Agent 集群、库、环境、项目、提示词、运行六页。

**环境**：检测四个 CLI 和浏览器检查用的 Playwright Chromium，显示是否安装、版本和登录命令。缺的可以点按钮，由 `helmd` 运行固定的官方安装命令；登录仍要在终端里完成。

**Agent 集群**：Helm 不带模板，Agent 由用户创建，存在 `~/.helm/agents/<id>/`（`config.json`，可选 `prompt.md`、`skills/`），更新 Helm 不会动它（[ADR 0006](docs/adr/0006-user-agents-replace-templates.md)）。主要字段：

| 字段 | 含义 |
|---|---|
| `role` | `coordinator`（调度者）或 `executor`（执行者） |
| `driver` | `claude-sdk` / `codex` / `grok` / `deepseek` |
| `model`、`reasoningEffort` | CLI 自己的取值，原样传入；`null` 用 CLI 默认，Grok 和 DeepSeek 必须指定 |
| `fast` | 默认 `false`；Claude 开启会因 extra usage 标为不可用 |
| `home` | `shared`：订阅，用 CLI 默认主目录和已有登录；`dedicated`：API，用 `~/.helm/agent-homes/<id>/` |
| `description` | 职责说明，调度者派单时参考 |
| `skills`、`mcp` | 引用的库条目名字 |

订阅 Agent 会加载用户自己的全局配置、规则、hooks、插件、skills 和 MCP，Helm 只按会话覆盖模型、强度、fast 和角色权限（[ADR 0005](docs/adr/0005-subscription-templates-use-default-cli-homes.md)）。API Agent 的接口和 key 由用户按 CLI 格式写在专用主目录里，Helm 不读（[ADR 0004](docs/adr/0004-agent-homes-and-cli-owned-credentials.md)）。

**提示词**：调度者和执行者的规则及运行约束存在 `~/.helm/prompts/`，可在设置页修改。仓库的 [prompts/](prompts/) 只是初始默认，`helm serve` 启动时只补缺失的文件，从不覆盖；想要新默认请自己合并，或删掉文件后重启（[ADR 0008](docs/adr/0008-editable-role-prompts.md)）。

Agent、提示词和库的改动从下一次派单或调度轮次起生效，已经启动的运行不受影响。

## 库

共享的 skill 和 MCP 装进数据目录的 `library/`，Agent 按名字引用，每次运行启动时复制一份（[ADR 0007](docs/adr/0007-helm-library.md)）。名字为 1–64 位小写字母、数字或连字符。

```sh
helm install-skill --path /absolute/path/to/skill --name shared-skill [--replace true]
helm register-mcp --name remote-tools --config '{"type":"http","url":"https://example.com/mcp","headers":{"Authorization":"Bearer …"}}'
helm register-mcp --name local-tools --config '{"type":"stdio","command":"node","args":["/absolute/path/server.js"]}'
helm list-library
helm delete-library-entry --type skill --name shared-skill
```

- skill 目录必须含 `SKILL.md`，不能有符号链接；仍被 Agent 引用的条目不能删除。
- MCP 配置存为 0600 的 JSON；列表和事件只显示请求头和环境变量的键名，不显示值。
- ACP 驱动（Grok、DeepSeek）不支持 stdio MCP，引用了就标为不可用。
- 订阅 Agent 选中的库 skill 与 CLI 全局 skill 目录重名时，`list-agents` 返回警告，不影响使用。

## 命令行与接口

所有操作都在 `src/operations.ts` 里定义一次，同时生成 HTTP 路由、MCP 工具和 CLI 子命令，共用 schema 和权限检查。`helm --help` 列出全部子命令。CLI 默认连接 `http://127.0.0.1:4242`，可用 `HELM_URL` 或 `--url` 修改。

```sh
helm register-project --path /absolute/path/to/project
helm send-message --projectId <项目id> --body '做一个软件项目' --key start-1 [--attach <文件>]
helm list-pending
helm decide-gate --workId <工作id> --gateId <关卡id> --descriptionId <版本id> --decision confirm
helm get-events --workId <工作id>
```

- **HTTP**：`POST /api/<操作名>`，参数为 JSON；成功返回 `{ ok: true, result }`，被拒返回 `{ ok: false, error: { code, reason, allowedOperations } }`。
- **SSE**：`POST /events`，筛选参数同 `get-events`，支持 `Last-Event-ID` 续读。
- **MCP**：`POST /mcp`（Streamable HTTP）。调度轮次和派单带运行层注入的令牌，只能操作自己所属的工作，结束即失效；不带令牌的调用按用户处理。

消息必须带 `key` 去重。附件每条最多 10 个、合计 20 MiB，存在 `<dataDir>/attachments/`，Agent 按绝对路径读取。

## 运行与安全

- **并发**：执行派单的全局上限默认 10，满了排队，调度轮次不占名额（`set-concurrency`）。
- **超时**：派单默认墙钟 30 分钟、无输出 10 分钟（`set-dispatch-watchdog`）；调度轮次同样默认 30 / 10 分钟（`set-round-watchdog`）。调度轮次连续失败三次或额度用完时暂停工作，用 `resume-work` 恢复。
- **端口**：每次派单分到 20 个连续本机端口（`HELM_PORT_START`、`HELM_PORT_END`），从 20000 起。
- **进程清理**：派单和轮次结束时，按工作目录找出残留进程，整组 `SIGTERM`，5 秒后 `SIGKILL`（macOS 用 `lsof`，Linux 用 `/proc`）；切到副本外目录的进程可能找不到。
- **环境**：Agent 子进程的环境变量按白名单构造，逐项说明见 [src/environment.ts](src/environment.ts)；运行层再注入禁止推送的 git 配置和无效的 `GH_TOKEN`。Claude 会话关闭自动记忆。
- **沙箱**：执行者只能写自己的卡片副本，调度者只读工作副本，Bash 禁止退出沙箱。**已知缺口**：`~/.claude/settings.json` 里的 `sandbox.filesystem.allowWrite`、`sandbox.excludedCommands` 和 `Edit(...)` 放行路径会话里覆盖不掉，对 Helm 的 Agent 同样生效（[官方说明](https://code.claude.com/docs/en/sandboxing#repository-settings-under-an-admin-required-sandbox)）。
- **浏览器检查**：调度者派单时加 `needsBrowser: true`，运行层在执行者沙箱外为这次派单启动有界面、隔离的 Playwright MCP（固定 `@playwright/mcp@0.0.83` 自带的 Chromium），只转发白名单里的工具。用 `npm run browser:install` 安装浏览器。

## 开发

```sh
npm run check   # 类型检查
npm test        # 构建后运行后端测试和界面测试
npm run dev:ui  # 界面开发服务器
```

`npm ci` 会通过 `prepare` 把 `core.hooksPath` 设为 `.githooks`，提交前自动运行 `npm run check`。

测试启动真实的 `helmd` 和 CLI 子进程，使用临时任务库和 git 项目，Agent 用脚本假驱动（`tests/fixtures/agents/`），浏览器用工具替身，只通过 HTTP、SSE、MCP、CLI 和文件系统验证行为。

**真实冒烟**：改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，须在沙箱外运行：

```sh
npm run test:real --cache /private/tmp/helm-npm-cache
```

它依次跑浏览器、各驱动的调度者与执行者和界面几组测试，某组失败也会跑完其余组，最后汇总失败组。需要本机已登录的 CLI 和有界面的 Chromium（Linux 还需显示服务），不用无头模式和系统 Chrome。输出的截图要打开核对。`test:browser`、`test:claude-executor` 等可单独跑其中一组。

**代码结构**：`src/` 是后端，主要有任务库与事务（`store.ts`）、操作表（`operations.ts`）、对齐（`alignment.ts`）、调度轮次（`rounds.ts`）、派单（`dispatch.ts`）、验收（`verification.ts`）、审核与合入（`review.ts`、`delivery.ts`）、驱动（`driver.ts` 及各 `*-driver.ts`）、HTTP/SSE（`server.ts`）、MCP（`mcp.ts`）和 CLI（`cli.ts`）。`frontend/` 是 React 界面，构建到 `dist/ui/` 由 `helmd` 直接提供。新增业务操作只需在操作表里登记。

**任务库迁移**：schema 版本记在 `PRAGMA user_version`，按 `src/migrations.ts` 列表顺序升级。新迁移只能追加到末尾，不改动或重排已发布的迁移；遇到比代码更新的任务库会拒绝启动。
