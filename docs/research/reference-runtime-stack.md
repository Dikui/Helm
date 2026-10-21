# 参考产品的技术栈与运行层结构

调研日期：2026-10-21（Grok，一手来源）。

这 10 个产品里，真正自带运行层的只有少数。Orca 与 JAgents 是 TypeScript/JavaScript 的 Electron 应用，另有一个可脱离界面的 PTY 进程。vibe-kanban 是 Rust 本地服务加 TypeScript 网页，任务库用 SQLite，看板更新用 SSE。orka、devteam skill、codex plugin-cc、grok plugin-cc 没有自己的守护进程：编排发生在已经打开的 Agent 会话里，执行者是普通子进程。open-grokbot 是 TypeScript 的多 Agent 框架，用 `child_process.fork` 和 SSE，不拉官方 CLI。dsh 是 DeepSeek Harness 的插件，沙箱是 Docker。Factory Missions 闭源，文档只确认它是 Droid 会话里的编排模式。

运行层常见三种。第一种是「界面进程 + 可重连的终端进程」：Orca 的 PTY daemon、JAgents 的 pty daemon，界面重启后终端还能接上；接不上时用 session id 再拉起 CLI。第二种是「一个本地 HTTP 进程 + 短命子进程」：vibe-kanban 的 Axum 服务拉起执行进程，状态在 SQLite。第三种是「没有运行层」：技能或插件由调度者会话自己 `spawn` 官方 CLI，状态是项目目录或插件数据目录里的文件。

对 Helm 的建议如下。

- **语言用 TypeScript，跑在 Node 上。** 依据：要拉起官方 CLI、同时支持 macOS 和 Linux、并提供 HTTP 的产品，Orca、JAgents、两个 plugin-cc 都是 Node。vibe-kanban 用 Rust，是为了打出单一服务二进制。推翻条件：v1 必须不依赖本机 Node、收成一个静态二进制时，再按 vibe-kanban 的 server + SQLite 做，不照搬它的 relay。
- **进程组成：一个常驻运行层，每次派单一个普通子进程。** 依据：Helm 的执行者是 `codex exec`、`grok -p`、`claude -p`，和 orka、grok plugin 一样是无头命令。Orca 和 JAgents 的 PTY 是为了交互式终端。调度者会话若要长时对话，可以单独常驻，不要和执行者挤在同一个进程里。推翻条件：调度者必须是可重连的 TUI 时，再拆一个能脱离界面的 PTY 进程，做法见 Orca 的 warm reattach 和 JAgents 的 pty daemon。
- **子进程用普通 spawn，加上进程组和超时，退出码写入派单结果。** 依据：orka 用 `timeout --kill-after`，信号打到整个进程组；grok plugin 记下 `agentPid`，停止时杀进程树。没有产品把 tmux 当作执行者的运行方式。Docker 在 dsh 里是沙箱，不是编排器默认形态。推翻条件：官方 CLI 在没有 TTY 时拒绝运行或停在提示上，再改 PTY。
- **任务库用 SQLite，放在用户数据目录，不放进项目工作副本。** 依据：Orca 的 profile 权威状态在 `profile-state.db`；vibe-kanban 是 `db.v2.sqlite`；JAgents 是 `jagents.db`。JSON/JSONL 只够插件的几十个 job，或 orka 这种项目内账本。推翻条件：任务库必须能随项目 diff、由 git 带着走，再改成 orka 的 `.orka/` 文件。
- **界面对运行层用 SSE 收事件。** 依据：vibe-kanban 的看板是 `GET /events` 的 SSE；open-grokbot 的浏览器控制面也是 HTTP + SSE。WebSocket 出现在要双向字节流的地方，例如 vibe-kanban 的 SSH 会话。Helm 的界面看卡片状态和事件，单向就够。推翻条件：界面要嵌执行者的实时 TUI，再改 WebSocket 或 PTY 转发。
- **后台用用户级服务：macOS LaunchAgent，Linux systemd user unit。** 依据：`orca serve service install` 写的就是这两种，并写明 Linux 登出后要开 lingering 服务才会留下。Helm 不要求关机后继续，所以不要做成系统级服务，也不要把 Docker 当默认启动方式。推翻条件：只想手动开一个前台进程时，保留等价于 `orca serve` 的前台命令即可。

`https://github.com/VirtusLab/orca` 对应的是 [orca.virtuslab.com](https://orca.virtuslab.com)，不是 onorca.dev。它是 Scala 3 的流程脚本，用 scala-cli 跑，语言统计为 Scala 3,394,347 字节、Shell 3,006、TypeScript 1,054（[languages API](https://api.github.com/repos/VirtusLab/orca/languages)）。与本次 Orca 无关，下面略过。

## 总表

| 产品 | 语言与主要依赖 | 进程与如何拉起执行者 | 状态放哪 | 界面如何拿实时状态 | 主程序重启时执行者怎么办 | macOS / Linux 后台与自启动 | 安装 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orca（stablyai） | TypeScript 约 95%；Electron、React、node-pty、ws | 桌面进程 + orcad + 独立 PTY daemon；Agent 跑在 PTY 里 | Electron userData 的 `orca-data.json` 与 `profile-state.db`；另有 `~/.orca` | 桌面 xterm.js；远程连服务器。依赖含 `ws`。未找到 SSE 文档 | PTY daemon 还在则重连；daemon 也没了则用 session id 冷启动 `--resume` | `orca serve` 前台；`orca serve service install` 写 LaunchAgent 或 systemd user unit | 桌面安装包、GitHub dmg、仓库内 Homebrew cask |
| orka | 纯 Shell；运行时 bash、git、jq、timeout | 没有守护进程。调度者会话执行 bash，worker 是普通子进程 | 项目内 `.orka/`：JSON、Markdown、jsonl | 调度者自己的终端；`orka status` 打表 | runner 收到 TERM/INT/HUP 会杀掉 worker 进程组。没有按 session id 接管原进程 | 未找到服务安装 | `install.sh`、Claude 插件、`npx skills add` |
| devteam skill | languages API 只有 Shell；正文是 Markdown | 没有守护进程。用户自己开多个 Claude Code 会话 | 项目里的 `context.md`、`change-log.md`、`AGENTS.md` | Claude Code 自己的会话界面 | 未找到接管逻辑。一个会话停了，其他会话还在 | 未找到 | clone 后拷到 `~/.claude/skills/` |
| codex plugin-cc | JavaScript；Node 标准库。开发依赖 TypeScript | 跑在 Claude Code 里。`spawn("codex", ["app-server"])`，stdio 管道 | `$CLAUDE_PLUGIN_DATA/state/<仓库>-<hash>/`，否则临时目录 `codex-companion` | Claude Code 命令输出；status 在脚本里轮询 job | job 文件还在。app-server 这一处 spawn 没有 `detached`。可用 `codex resume <session-id>` 另开 | 未找到 | Claude Code 插件市场 |
| grok plugin-cc | 仓库语言 JavaScript；Node 标准库 | 跑在 Claude Code 里。`spawn(grok)`，非 Windows 默认 `detached: true` | `$CLAUDE_PLUGIN_DATA` 下的 state，否则 `$TMPDIR/grok-cc-runs` | Claude Code 命令输出 | stop 按 PID 杀进程树。续跑用 `grok -r <id>`，不是重新挂上原进程 | 未找到 | Claude Code 插件市场，或本地 clone |
| JAgents | JavaScript；Electron、node-pty、`node:sqlite`、xterm | Electron 主进程 + pty daemon（命名管道）+ ACP/MCP | `appData/JAgents/jagents.db`；hub 在 `~/.jagents` | Electron IPC；终端用 xterm | 应用重启时 pty daemon 留着终端；真正退出或 10 分钟没人连则关掉。聊天靠 session/load | 未找到 LaunchAgent / systemd | clone 后 `npm start`；Windows 有安装包 |
| dsh（layerfs 插件） | 插件是 Node；LayerFS daemon 来自 Rust 构建 | 不改 dsh。Agent 在 dsh 会话里跑 bash。沙箱是 Docker | `DSH_HOME` 下的 profile；`stateDir` 默认 `<profile>/dsh-layerfs` | dsh web 的 Work / History。推送方式未找到 | Store 容器 `--restart unless-stopped`。dsh 里的 Agent 进程重启行为未找到 | 靠 dsh web 与 Docker。未找到本插件的 LaunchAgent | clone 后按 README 构建，`dsh plugin add` |
| open-grokbot | TypeScript 332,407 字节，JavaScript 17,139 | 协调进程可用 `child_process.fork`。不拉官方 CLI | 每 Agent 目录一份 JSONL / JSON | HTTP + SSE | README 写账本能在重启后保留；协调进程按退出码退避重启 host | 未找到 | clone 后 `npm install && npm run demo` |
| Factory Missions | 闭源。文档未写实现语言 | 文档：Droid 会话进入 Mission Control，下面有 worker。拉起方式未找到 | 未找到 | CLI 的 Mission Control，或 Factory App。传输未找到 | `droid exec --session-id` 可续会话。正在跑的 worker 进程是否随父进程退出，未找到 | 未找到 | Droid CLI：文档列了安装脚本、Homebrew、npm |
| vibe-kanban | Rust 约 50%，TypeScript 约 46%。Axum、sqlx/SQLite、Tokio | 一个本地 server 进程。执行者在 `executors` crate。本次未打开具体 spawn 调用 | `ProjectDirs("ai","bloop","vibe-kanban")` 的 `db.v2.sqlite` | 看板 `GET /events` 为 SSE；`/ssh-session` 为 WebSocket | 未找到「服务重启后重新接管子进程」的源码 | README 提到远程可用 systemd 或 Docker。未找到随仓库安装的 user unit | `npx vibe-kanban`；另有 Dockerfile、`crates/tauri-app` |

## Orca（onorca.dev）

对应仓库是 [stablyai/orca](https://github.com/stablyai/orca)。首页写明下载页是 onorca.dev，文档站是 www.onorca.dev。

1. **语言与依赖。** GitHub 语言统计里 TypeScript 209,594,964 字节，约占全部 220,484,660 字节的 95%，其余主要是 JavaScript（[languages](https://api.github.com/repos/stablyai/orca/languages)）。`package.json` 版本 1.4.214，`engines.node` 为 24，包管理器 pnpm。运行依赖包括 `electron` 43.7.8、`node-pty`、`ws`、`ssh2`、`@orca/process-host`、`@anthropic-ai/claude-agent-sdk`。界面侧在 devDependencies：React 19、Vite、xterm、Zustand、Tailwind、Radix（[package.json](https://github.com/stablyai/orca/blob/main/package.json)）。
2. **进程。** 本地默认是桌面应用：Agent、终端和浏览器与界面在同一台机器（[Ways to run](https://www.onorca.dev/docs/ways-to-run)）。无窗口时用 `orca serve`，默认跑 Orca 自己的 Node 服务器 orcad；orcad 起不来就退回桌面应用里的服务器（[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)）。Agent 跑在终端里。终端由独立 PTY daemon 用 node-pty 创建；daemon 还能应答时，已有会话继续走 daemon，新终端可以改走进程内 PTY（[PR #6830](https://github.com/stablyai/orca/pull/6830)）。本地 spawn 会按 session id 尝试 `reattachLocalPty`（[local-pty-spawn.ts](https://github.com/stablyai/orca/blob/main/src/main/providers/local-pty-spawn.ts)）。另外还有 SSH 目标，以及按配方起的 Cloud VM / Docker（[Ways to run](https://www.onorca.dev/docs/ways-to-run)）。
3. **状态。** `initDataPath()` 把 `orca-data.json` 放在 Electron `userData`（[user-data-path.ts](https://github.com/stablyai/orca/blob/main/src/main/persistence/loading-store/user-data-path.ts)）。profile 的权威状态是每个 profile 一个 `profile-state.db`，由后台 worker 写 SQLite；JSON 仍用于导入、导出和旧运行时（[PR #22612](https://github.com/stablyai/orca/pull/22612)）。macOS cask 的 zap 列出 `~/Library/Application Support/Orca`，并注释 `~/.orca` 存放 worktree 与 agent state（[Casks/orca.rb](https://github.com/stablyai/orca/blob/main/Casks/orca.rb)）。Linux 上 userData 的绝对路径未在该 cask 写出。
4. **实时状态。** 终端界面是 xterm.js（[Terminal](https://www.onorca.dev/docs/terminal)）。`orca` CLI 对正在运行的运行时发命令，例如 `orca status --json`、`orca terminal read`（[CLI reference](https://www.onorca.dev/docs/cli/reference)）。远程时服务器持有终端和 Agent，客户端只是界面（[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)）。运行依赖有 `ws`。未找到文档把界面更新写成 SSE。
5. **重启。** 客户端笔记本睡眠或断开时，Agent 继续在服务器上跑（[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)）。PTY daemon 还活着时做 warm reattach，不另开一个 Agent；daemon 随应用一起退出、PTY 接不上时走冷恢复，Claude/Codex 用 `--resume <session-id>` 再拉起（[issue #8962](https://github.com/stablyai/orca/issues/8962)）。文档还写：`orca serve` 重启后，手机仍保留它的终端（[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)）。这次没有打开「手机侧终端是重连旧 PTY，还是冷恢复」的源码。
6. **后台与自启动。** `orca serve` 默认前台，Ctrl-C 停止。`orca serve service install` 写 macOS LaunchAgent 或 Linux systemd user unit，跑 `orca serve --supervise --no-pairing`。Linux 上登出即停，除非开启 lingering。Windows 还没有这些服务命令（[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)、[CLI reference](https://www.onorca.dev/docs/cli/reference)）。桌面应用当作服务器时，生命周期是应用开着的时候。
7. **安装。** 文档和 README 指向 [onorca.dev/download](https://onorca.dev/download)。cask 从 GitHub Releases 下 `orca-macos-<arch>.dmg`，并链出应用内的 `orca` CLI（[Casks/orca.rb](https://github.com/stablyai/orca/blob/main/Casks/orca.rb)）。该 cask 写的版本是 1.3.24，低于当前 `package.json` 的 1.4.214。`package.json` 有 `build:mac`、`build:linux`、`build:win`，用 electron-builder。

## orka

仓库 [ugorur/orka](https://github.com/ugorur/orka)。语言统计只有 Shell，60,717 字节（[languages](https://api.github.com/repos/ugorur/orka/languages)）。README 写运行时是 bash、git、jq、timeout，没有应用框架，也没有数据库。

1. 编排没有单独进程。加载了技能的 Agent 会话就是调度者，它执行 `.orka/bin/orka`。worker 适配器是 shell，例如 Codex 走 `codex exec ...`，标准输入来自提示文件，不是 PTY，也不是 tmux（[workers/codex.sh](https://github.com/ugorur/orka/blob/master/skills/orka/scripts/workers/codex.sh)）。`run.sh` 用 `timeout --kill-after=60` 包住适配器，并放到后台进程组；TERM/INT/HUP 会转给整组（[run.sh](https://github.com/ugorur/orka/blob/master/skills/orka/scripts/run.sh)）。`queue.sh` 再按 `parallel` 后台启动多个 `run.sh` 并 `wait`（[queue.sh](https://github.com/ugorur/orka/blob/master/skills/orka/scripts/queue.sh)）。README 写 worktree 不是沙箱，重要机器上由用户自己用容器或 VM。
2. 状态在项目里的 `.orka/`，且被 git 排除：`orka.json`、`backlog.md`、`tasks/`、`ledger.jsonl`、`runs/<card>/attempt-N/` 下的 `prompt.md`、`report.txt`、`meta.json`（[README](https://github.com/ugorur/orka/blob/master/README.md)）。
3. 没有 Web 界面。用户看调度者会话的输出，或运行 `orka status` 打出卡片表。
4. runner 被信号停下时，worker 进程组会被杀掉，并仍写 `meta.json`。锁的主人若被 `-9` 杀掉，锁不会自动接管，编排者要自己删锁（[run.sh](https://github.com/ugorur/orka/blob/master/skills/orka/scripts/run.sh)）。未找到按 session id 重新挂上同一个 worker 进程的代码。中断后的做法是再跑卡片。
5. 未找到 LaunchAgent、systemd unit 或 Docker 启动文件。进程寿命等于调度者会话和它拉起的 bash。
6. 安装是 `curl …/install.sh | bash`，装到 `~/.agents/skills/orka`；或 Claude Code 插件；或 `npx skills add ugorur/orka`；或手工拷贝 `skills/orka`（[README](https://github.com/ugorur/orka/blob/master/README.md)）。

## devteam skill

仓库 [Antoniaiaiaiaia/devteam-multi-session-development-skill](https://github.com/Antoniaiaiaiaia/devteam-multi-session-development-skill)。languages API 只有 Shell 10,558 字节（[languages](https://api.github.com/repos/Antoniaiaiaiaia/devteam-multi-session-development-skill/languages)）。技能正文、手册和模板是 Markdown，钩子是 bash（[README 文件树](https://github.com/Antoniaiaiaiaia/devteam-multi-session-development-skill/blob/main/README.md)）。

1. 没有运行层进程。用户在多个 Claude Code 会话里分别跑 `/devteam root` 和 `/devteam <模块>`。模块会话可以开 git worktree。会话之间用 Claude Code 的 `SendMessage`；不能互发消息时，由用户把报告抄给根会话（[README](https://github.com/Antoniaiaiaia/devteam-multi-session-development-skill/blob/main/README.md)）。未找到 PTY、tmux 或容器。
2. 状态是仓库里的文件：`AGENTS.md`、`context.md`、`change-log.md`，加上 git 钩子。没有 SQLite。
3. 实时状态就是这些 Claude Code 会话的界面。`/devteam status` 更新进度板再口头汇报。未找到 SSE、WebSocket 或独立 Web UI。
4. 未找到守护进程重启后接管子进程的逻辑。README 写根会话可以在着急时直接停掉对方进程，再发说明。一个会话结束，其他会话仍在。
5. 钩子支持 macOS / Linux。未找到自启动。
6. 安装是 clone 后把 `skills/devteam` 拷到 `~/.claude/skills/`。

## codex plugin-cc

仓库 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)。languages API 只有 JavaScript，297,071 字节（[languages](https://api.github.com/repos/openai/codex-plugin-cc/languages)）。`package.json` 无运行时依赖，开发依赖 `@types/node` 和 TypeScript，测试用 Node 自带 test runner（[package.json](https://github.com/openai/codex-plugin-cc/blob/main/package.json)）。要求 Node.js 18.18+，以及本机 `codex`。

1. 插件跑在 Claude Code 进程里。它拉起的是 `codex app-server`：`spawn("codex", ["app-server"], { stdio: ["pipe","pipe","pipe"] })`，用 JSONL 做 JSON-RPC（[app-server.mjs](https://github.com/openai/codex-plugin-cc/blob/main/plugins/codex/scripts/lib/app-server.mjs)）。README 写它包的是 Codex app server，用的是本机全局 `codex`（[README](https://github.com/openai/codex-plugin-cc/blob/main/README.md)）。这一处 spawn 没有 `detached`，也没有 PTY。
2. 状态在 `CLAUDE_PLUGIN_DATA/state/<仓库名>-<sha256 前 16 位>/` 的 `state.json` 和 `jobs/`。环境变量没有时，根目录是系统临时目录下的 `codex-companion`（[state.mjs](https://github.com/openai/codex-plugin-cc/blob/main/plugins/codex/scripts/lib/state.mjs)）。
3. 界面是 Claude Code。`/codex:status` 读 job；等待完成时脚本按间隔轮询 snapshot（[codex-companion.mjs](https://github.com/openai/codex-plugin-cc/blob/main/plugins/codex/scripts/codex-companion.mjs)）。未找到自己的 WebSocket 或 SSE。
4. job 记录在磁盘上，所以 Claude 重启后仍能读到已写入的结果。未找到「app-server 进程脱离后被新 Claude 重新接管」的代码。续跑方式是 `codex resume <session-id>`，session id 来自 `/codex:result` 或 `/codex:status`（[README](https://github.com/openai/codex-plugin-cc/blob/main/README.md)）。
5. 未找到 LaunchAgent、systemd 或 Docker。
6. 安装是 Claude Code 里 `/plugin marketplace add openai/codex-plugin-cc`，再安装 `codex@openai-codex`。Codex 本身可以是 `npm install -g @openai/codex`。

## grok plugin-cc

仓库 [xai-org/grok-build-plugin-cc](https://github.com/xai-org/grok-build-plugin-cc)。仓库语言字段是 JavaScript。`package.json` 0.2.1 没有 dependencies，测试用 Node 自带 test runner（[package.json](https://github.com/xai-org/grok-build-plugin-cc/blob/main/package.json)）。README 写运行时代码只用 Node 标准库，并明确「没有 app-server broker」（[README](https://github.com/xai-org/grok-build-plugin-cc/blob/main/README.md)）。

1. 插件在 Claude Code 里。审查命令实际执行 `grok -p <prompt> --agent explore --permission-mode plan --sandbox read-only`。`spawn` 的 stdio 是 `ignore/pipe/pipe`，非 Windows 默认 `detached: true`（[grok.mjs](https://github.com/xai-org/grok-build-plugin-cc/blob/main/plugins/grok-build/scripts/lib/grok.mjs)）。后台运行会同时记下 Node worker 的 `bridgePid` 和 grok 的 `agentPid`。未找到 PTY 或 tmux。
2. 状态目录由 `CLAUDE_PLUGIN_DATA` 决定；未设置时是 `$TMPDIR/grok-cc-runs`。里面是 `state.json` 和 `jobs/`（[state.mjs](https://github.com/xai-org/grok-build-plugin-cc/blob/main/plugins/grok-build/scripts/lib/state.mjs)、[README](https://github.com/xai-org/grok-build-plugin-cc/blob/main/README.md)）。
3. 界面是 Claude Code 的斜杠命令。未找到 Web 推送。
4. `/grok-build:stop` 按记录的 PID 杀进程树。续跑是 `grok -r <id>`，id 来自上次运行或 `grok import`（[README](https://github.com/xai-org/grok-build-plugin-cc/blob/main/README.md)）。spawn 处看到 `detached`，没有看到 `unref`。Claude 退出后 grok 子进程是否继续活着，未在这次打开的片段里写死。
5. 未找到自启动单元。
6. 安装是 `/plugin marketplace add xai-org/grok-build-plugin-cc`，或把 clone 的绝对路径加成本地市场。

## JAgents

仓库 [Josephivgi/JAgents](https://github.com/Josephivgi/JAgents)。语言统计 JavaScript 555,472 字节，另有 CSS、NSIS、HTML（[languages](https://api.github.com/repos/Josephivgi/JAgents/languages)）。依赖是 Electron 44、`node-pty`、`@xterm/xterm`、`@anthropic-ai/claude-agent-sdk`（[package.json](https://github.com/Josephivgi/JAgents/blob/main/package.json)）。要求 Node.js 22.5+，因为用 `node:sqlite`。

1. Electron 主进程拉起 pty daemon：`ELECTRON_RUN_AS_NODE=1 <electron> pty-daemon.cjs <pipe> <log>`。daemon 用命名管道收换行 JSON，真正的终端进程在 daemon 里，经 node-pty（[pty-daemon.cjs](https://github.com/Josephivgi/JAgents/blob/main/electron/pty-daemon.cjs)、[workspace.cjs 文件头](https://github.com/Josephivgi/JAgents/blob/main/electron/workspace.cjs)）。聊天走 ACP host。另有 MCP 服务 `mcp/jagents-mcp.cjs`。未找到容器。
2. 数据根是 `JAGENTS_DATA_ROOT`，否则 `app.getPath("appData")/JAgents`（[main.cjs](https://github.com/Josephivgi/JAgents/blob/main/electron/main.cjs)）。SQLite 文件是该目录下的 `jagents.db`，WAL 模式，只由主进程打开（[lib/db.js](https://github.com/Josephivgi/JAgents/blob/main/lib/db.js)）。hub 文件在 `~/.jagents`（[README](https://github.com/Josephivgi/JAgents/blob/main/README.md)）。README 把 Windows 数据目录写成 `%APPDATA%\JAgents`。
3. 渲染进程通过 Electron IPC 调主进程，例如 `pty-write`、`pty-resize`（[main.cjs](https://github.com/Josephivgi/JAgents/blob/main/electron/main.cjs)）。终端绘制用 xterm。未找到 SSE。
4. 应用重启时，pty daemon 保持终端；新连接拿到每个终端的屏幕快照。应用真正退出，或 `ORPHAN_MS`（10 分钟）内没有应用连上，daemon 关掉全部终端并退出（[pty-daemon.cjs](https://github.com/Josephivgi/JAgents/blob/main/electron/pty-daemon.cjs)）。聊天在 Agent 支持时用 session/load 恢复（[workspace.cjs](https://github.com/Josephivgi/JAgents/blob/main/electron/workspace.cjs)）。
5. README 写支持 Windows、macOS、Linux。未找到 LaunchAgent 或 systemd unit。
6. 开发运行是 `npm install && npm start`。Windows 发布 `JAgents-Setup.exe`，装到 `%LOCALAPPDATA%\Programs\JAgents`。未找到 macOS / Linux 安装包说明。

## dsh

位置是 [Ephemeral-AI-Lab/layerfs 的 dsh/](https://github.com/Ephemeral-AI-Lab/layerfs/tree/main/dsh)。`dsh/package.json` 是私有 pnpm workspace，Node `>=22.19`，没有自己的依赖清单；构建调用 DeepSeek Harness 里的 tsdown（[dsh/package.json](https://github.com/Ephemeral-AI-Lab/layerfs/blob/main/dsh/package.json)）。LayerFS 本体仓库语言是 Rust（[layerfs repo](https://api.github.com/repos/Ephemeral-AI-Lab/layerfs)）。

1. 这份目录是 dsh 的插件包，不改 dsh 源码。Agent 仍是 dsh 会话里的 Agent，通过 bash 调 Node 脚本和 LayerFS JS SDK。Live 模式的沙箱是 Docker 容器；macOS 上 Host 再起一个长期的 Store 容器跑 `layerfs-daemon` 和 native addon（[dsh/README.md](https://github.com/Ephemeral-AI-Lab/layerfs/blob/main/dsh/README.md)）。未找到本插件 spawn `codex` / `claude` / `grok` 的代码。
2. 配置在 `DSH_HOME/profiles/web/cordis.patch.yml`。`stateDir` 默认 `<profile>/dsh-layerfs`（绑定、Agent 名、journal）。`home` 和 `traceDir` 默认在系统临时目录的 `dsh-layerfs/`。README 建议 `DSH_HOME` 不要用 `~/.dsh`。
3. 界面是 dsh web。会话在 Chat、Trajectory 之外有 Work 和 History。另有 `GET /layerfs/status`。未找到这段 UI 是 SSE、WebSocket 还是轮询。
4. Store 容器使用 Docker `--restart unless-stopped`，Docker 自己重启后会再拉起。Host 发现容器停了会 `docker start` 一次。未找到 dsh 里正在跑的 Agent 进程在 dsh 重启后如何接管。
5. 文档只支持 dsh web。macOS 依赖 Docker Desktop。未找到本插件自己的 LaunchAgent 或 systemd user unit。
6. 没有发布包。clone layerfs 与 deepseek-harness，在 Docker 里编译 daemon，再 `dsh plugin --profile web add`。

## open-grokbot

仓库 [LING71671/open-grokbot](https://github.com/LING71671/open-grokbot)。语言统计 TypeScript 332,407 字节、JavaScript 17,139（[languages](https://api.github.com/repos/LING71671/open-grokbot/languages)）。根 `package.json` 是 npm workspaces，Node `>=22.18`，开发依赖 TypeScript 和 esbuild，许可证 GPL-3.0-only。README 声明这是对 Grok Bot 一类架构的净室重写，不含原产品源码，也没有 Electron。

1. 进程拓扑写在文档里：演示时 shell 是 CLI；协调进程在纯 Node 下用 `child_process.fork`，生产形态的对照物是 `utilityProcess.fork` 加三个 MessagePort。host 与 local-exec 之间是 HTTP。模型通过 OpenAI 兼容或 Anthropic 的 HTTP API，不是官方 CLI 子进程（[docs/architecture.md](https://github.com/LING71671/open-grokbot/blob/main/docs/architecture.md)、[README](https://github.com/LING71671/open-grokbot/blob/main/README.md)）。
2. 状态是每个 Agent 一个目录：`transcript.jsonl`、`memory.json`、`automations.json`、`profile.json`、`settings.json`、`group.json`，外加 nonce 账本。未找到默认数据目录的绝对路径。
3. 浏览器控制面是 HTTP API + `GET /events` 一类 SSE。CLI demo 把事件打到终端（[README](https://github.com/LING71671/open-grokbot/blob/main/README.md)）。
4. README 的测试范围写了账本在重启后仍能去重。架构图写 host 监督按退出码 0/1/2 做退避重启。未找到「官方 CLI 子进程脱离后按 session id 续跑」，因为这里没有官方 CLI。
5. 未找到 LaunchAgent、systemd 或 Docker 运行说明。
6. 安装是 clone 后 `npm install`、`npm run build`、`npm test`、`npm run demo`，或 `npm run start -w @open-grokbot/console`。

## Factory Missions

文档站实际打开的是 [docs.factory.com/missions/overview](https://docs.factory.com/missions/overview)（用户给的 docs.factory.ai 入口转到了这里）。产品闭源，下面只写文档里能确认的句子。

1. 未找到实现语言、框架或数据库。
2. Missions 在 Droid 会话里用 `/missions` 进入。计划批准后进入 Mission Control，由编排层管理执行，文档写它会协调 worker、做校验（[overview](https://docs.factory.com/missions/overview)）。`droid exec --mission` 是无头的一次性命令，并可指定 `--worker-model` 与 `--validator-model`（[Droid Exec](https://docs.factory.com/droid-exec/overview)）。worker 是 PTY、普通子进程还是远端进程，未找到。
3. 状态存放位置未找到。`droid exec --session-id <id>` 可以续一个已有会话，JSON 输出里带 `session_id`。
4. CLI 里用 Mission Control 看进度；Factory App 提供更丰富的同一视图（[running-cli](https://docs.factory.com/missions/running-cli)）。未找到 SSE、WebSocket 或轮询间隔。
5. 文档说编排者是一个 Agent，用户可以暂停它并让它恢复。未找到「Droid 进程重启后，正在跑的 worker 随之退出还是被重新接管」。
6. 未找到 Missions 或 Droid 的 LaunchAgent / systemd 说明。`droid exec` 被描述成 CI 里的一次性命令。
7. Droid CLI 的安装页列出 macOS/Linux 安装脚本、Homebrew、Windows、npm。具体命令在文档的安装步骤里，本次摘到的是 `curl -fsSL https://app.factory.ai/cli | sh` 这一例（[Droid Exec 安装](https://docs.factory.com/droid-exec/overview)）。

## vibe-kanban

仓库 [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)。语言统计 Rust 3,707,736 字节（约 50%）、TypeScript 3,395,912（约 46%），其余是 JavaScript、CSS、HTML、PLpgSQL、Shell、Dockerfile（[languages](https://api.github.com/repos/BloopAI/vibe-kanban/languages)）。工作区依赖 Tokio、带 `ws` feature 的 Axum 0.8、tower-http、sqlx 风格的 SQLite 在 server crate 里单独声明（[Cargo.toml](https://github.com/BloopAI/vibe-kanban/blob/main/Cargo.toml)、[crates/server/Cargo.toml](https://github.com/BloopAI/vibe-kanban/blob/main/crates/server/Cargo.toml)）。前端目录是 `packages/local-web`。这次抓 `packages/local-web/package.json` 失败，所以 UI 框架名称未写入。README 说开发需要 Rust、Node `>=20`、pnpm，以及 `sqlx-cli`。

1. 生产形态是一个 server 进程：默认绑 `127.0.0.1`，端口来自 `PORT`，然后打开浏览器（[crates/server/src/main.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/server/src/main.rs)）。执行者代码在 `crates/executors`。本次没有打开具体的 `Command` spawn，因此不能写死是 PTY 还是普通子进程。路由里另有 `terminal` 和容器相关文件。工作区用 git worktree，README 写每个 workspace 有分支、终端和 dev server。
2. 数据库文件是 `asset_dir()/db.v2.sqlite`（[crates/db/src/lib.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/db/src/lib.rs)）。`asset_dir()` 在发布构建用 `ProjectDirs::from("ai", "bloop", "vibe-kanban").data_dir()`，注释写明 macOS 为 `~/Library/Application Support/...`，Linux 为 `~/.local/share/...`（尊重 `XDG_DATA_HOME`）（[assets.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/utils/src/assets.rs)）。issue 里用户把 macOS 路径写成 `~/Library/Application Support/ai.bloop.vibe-kanban`，Linux 写成 `~/.local/share/ai.bloop.vibe-kanban`（[issue #2972](https://github.com/BloopAI/vibe-kanban/issues/2972)）。同目录还有 `config.json`、`profiles.json`。
3. 看板事件是 Axum SSE：`GET /events`（[routes/events.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/server/src/routes/events.rs)）。`/ssh-session` 是 WebSocket（[routes/mod.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/server/src/routes/mod.rs)）。
4. 未找到「server 重启后把仍在跑的执行进程重新接管」的源码。SQLite 里的 workspace、session 记录会留下。
5. README 的远程部署提到 systemctl、Docker 或云主机，由用户自己配，并建议用 SSH 从编辑器连回去（[README](https://github.com/BloopAI/vibe-kanban/blob/main/README.md)）。仓库根有 `Dockerfile`。未找到随仓库执行的 LaunchAgent 或 systemd user unit 安装命令。
6. 用户安装是 `npx vibe-kanban`。`npx-cli/package.json` 的 bin 是 `vibe-kanban`，描述为二进制的 npm 包装（[npx-cli/package.json](https://github.com/BloopAI/vibe-kanban/blob/main/npx-cli/package.json)）。工作区还有 `crates/tauri-app`。README 另有 Docker 自建说明的链接。项目页写明正在 sunset（[README](https://github.com/BloopAI/vibe-kanban/blob/main/README.md)）。

## 没能确认的事项

- Orca：Linux 上 Electron userData 的绝对路径；`orca serve` 重启后，手机上的终端是重连旧 PTY，还是冷恢复新进程；桌面 renderer 到 PTY 的字节流是 IPC、WebSocket，还是两者都有。
- orka：调度者进程被 `-9` 或 SIGHUP 打死时，已经 `wait` 之外的 worker 是否变成孤儿。源码只写了 runner 自己收到 TERM/INT/HUP 时会杀进程组。
- devteam：Claude Code 会话崩溃后，根会话能否只靠仓库文件接着派单。README 没有这一条。
- codex plugin-cc：后台 job 的 Node 进程是否 `detached`。已读的 `app-server` spawn 不是 detached；companion 的后台路径这次没有逐行打开。
- grok plugin-cc：`detached: true` 且未看到 `unref` 时，Claude 退出后 grok 子进程是否继续。语言字节数未再请求 languages API，只确认仓库语言字段为 JavaScript。
- JAgents：Linux 上 `appData` 解析出的具体路径；是否有人用 launchd 包过它。源码和 README 都没写。
- dsh：Work / History 的刷新是推送还是轮询；dsh 进程重启后，会话里的 Agent 进程是否还在。
- open-grokbot：默认数据目录的绝对路径。
- Factory Missions：语言、进程数、worker 拉起方式、状态目录、界面传输、重启语义、自启动。文档都没写。
- vibe-kanban：`crates/executors` 里执行者是 `std::process`、PTY 还是容器；server 重启后这些子进程的命运；`packages/local-web` 的 UI 框架名称（package.json 这次没抓到）。
