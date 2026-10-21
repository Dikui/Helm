# 以非终端方式与 CLI 交互，以及更多同类产品的做法

调研日期：2026-10-21（Grok，一手来源）。

调度者和执行者都可以不进终端，由运行层拉起用户已登录的官方 CLI，再用管道上的协议收发消息。三条路里，只有 Codex 的 `codex app-server` 在同一进程里同时具备多轮、运行中追加（`turn/steer`）、中断（`turn/interrupt`）、按 thread id 续跑和结构化事件。Claude Code 的常驻通道是 `claude -p --input-format stream-json --output-format stream-json`，或由 Agent SDK 拉起同一个 `claude`；进行中的新消息按当前 CLI 说明排到下一轮，打断用 SIGINT 或 SDK 的 `interrupt()`。Grok Build 的 `grok -p` 仍是一次提示后退出；同一进程多轮要走 `grok agent stdio`（ACP）。已发布文档没有与 `turn/steer` 对等的方法。

对 Helm：调度者用常驻协议进程，不要用 PTY 或 tmux。调度者优先 `codex app-server`（stdio）。执行者默认仍是一次性普通 spawn（`codex exec`、`claude -p`、`grok -p`），和已有无人值守结论一致。只有用户要在该派单未结束时发消息，才把这个执行者改成同一条协议进程。Web 界面只对运行层说话；运行层把消息译成 `turn/start`、`turn/steer`、`session/prompt` 或一行 stream-json，把 CLI 事件写入任务库，界面继续用 SSE 看事件。

更大范围里，先前六条建议里有四条仍然站得住：TypeScript/Node 仍是常见实现，但 Go 和 Python 的本地编排器已经存在；一个常驻运行层加多次派单仍然常见；任务库放用户数据目录仍然常见，SQLite 不是唯一形态；卡片状态用 SSE 仍然够。需要改口的是拉起方式：要在界面里持续对话、又要结构化事件时，同类产品里真正对齐的是协议进程（Todos 的 Codex/Claude 驱动、Zed 的 ACP），PTY 和 tmux 是为了把官方 TUI 原样留在屏幕上。自启动仍然不是默认能力。Superset 把终端放进独立 daemon，界面重启后进程还在；多数产品没有仓库自带的 LaunchAgent。

## 建议

1. **调度者用 `codex app-server`，每个调度者会话一个进程，stdio 上走 JSON-RPC。** 依据：同一连接上可以 `thread/start` 或 `thread/resume`，再多次 `turn/start`；运行中追加是 `turn/steer`；中断是 `turn/interrupt`，结束后 `turn.status` 为 `interrupted`；事件是 `item/*`、`turn/*` 通知。审批是服务器发给客户端的 JSON-RPC 请求，用 `approvalPolicy: "never"` 或不问就立刻 `decline`，避免挂住。[App Server](https://learn.chatgpt.com/docs/app-server)。订阅登录：`codex-acp` 把 ChatGPT 订阅列为认证方式之一，且写明不经过适配器运营方的服务器（[README](https://github.com/zed-industries/codex-acp/blob/main/README.md)）。app-server 页把认证列为该接口的用途，本次没有读到「stdio 拒绝 ChatGPT 登录」。推翻条件：实测这个 `codex app-server` 在没有 `CODEX_API_KEY` 时不读 `~/.codex/auth.json`，或审批策略 `never` 仍发出必须人工回答的请求。

2. **Claude 作调度者时，直接 spawn `claude`，不要把 Agent SDK 嵌进运行层。** 命令是 `claude -p --input-format stream-json --output-format stream-json --verbose`，不要加 `--bare`（bare 不读订阅登录，见既有 subscription-billing.md）。CLI reference 仍列出 `--input-format` 的 `text` 与 `stream-json`（[CLI reference](https://code.claude.com/docs/en/cli-reference)）。进行中再写入的用户消息，按该参考里 `--max-turns` 的说明，排成自己的下一轮，不是 Codex 那种塞进当前轮。要停掉当前轮，用 SIGINT；Agent SDK 在流式输入上提供 `interrupt()`（[Headless](https://code.claude.com/docs/en/headless)、[Python SDK](https://code.claude.com/docs/en/agent-sdk/python)）。SDK 本身也是拉起 `claude` 子进程（[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting)），能力更全，但和「不嵌入 SDK」冲突。推翻条件：当前版本的 `claude -p` 在 stream-json 输入下进程在第一条结果后退出，无法连续收消息。那时再改用 SDK 的流式输入，并保持环境里没有 `ANTHROPIC_API_KEY`。

3. **Grok 作调度者时用 `grok agent stdio`，不要用 `grok -p` 模拟多轮。** 官方示例是 spawn 后走 JSON-RPC：`initialize`、`authenticate`（`cached_token` 或 `xai.api_key`）、`session/new`、`session/prompt`；正文在 `session/update` 的 `agent_message_chunk` 里（[Headless](https://docs.x.ai/build/cli/headless-scripting)）。`cached_token` 对应本机已登录。`grok -p` 加 `-r` 是新进程续会话，不是接上还活着的进程。运行中追加：已发布文档没有对等 API；ACP 规范是一轮 `session/prompt` 结束后再发下一轮，取消用 `session/cancel` 通知（[Prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)）。Grok 是否实现 `session/cancel`，docs.x.ai 的示例没写。推翻条件：`grok agent stdio` 在只有缓存登录、没有 `XAI_API_KEY` 时拒绝 `authenticate`。

4. **执行者保持一次性 spawn；只有这张卡片要在派单未结束时收消息，才升级成协议进程。** 依据：派单结果的定义就是进程退出后的记录。一次性 `codex exec --json`、`claude -p --output-format stream-json`、`grok -p --output-format streaming-json` 已经能给出事件和 session id，续跑用各自的 resume（见 unattended-executors.md）。Todos 的静态分析也是按轮驱动外部 CLI，而不是为每张卡片开一个 TUI（`.scratch/tasks/19-research/todos-research.txt` 对 CLI 0.1.67 的核读）。推翻条件：某一家 CLI 在没有 TTY 的管道里停在权限提示上，而且协议进程的自动应答也消不掉这个提示。

5. **不要用 PTY 或 tmux 当调度者或执行者的驱动方式。** 依据：要结构化事件和审批的自动应答，协议通道已经存在。PTY/tmux 产品（Superset、Claude Squad、CAO、Orca）是为了把官方 TUI 留在屏幕上，状态往往靠钩子或读屏幕，不靠事件流。推翻条件：协议进程在 macOS 或 Linux 上无 TTY 时拒绝启动，而 PTY 能启动。

6. **语言、进程、存储、SSE、自启动。** TypeScript/Node 仍适合 Helm：要 spawn、要 JSON-RPC、要 HTTP。更大范围里 Go（Claude Squad、Catnip）和 Python（CAO）同样在拉官方 CLI，所以「必须用 Node」不成立，「Node 够用」仍成立。进程仍是一个常驻运行层；不要为执行者再拆 PTY daemon。任务库仍放用户数据目录。Superset 用 `~/.superset/host/<organizationId>/host.db`（[Host Server](https://docs.superset.sh/cli/host-server)），Todos 的任务控制在 Todos 服务端，本机执行根在文档所述的工作区目录。界面看卡片用 SSE 仍够；Superset 的终端字节流和 CAO 文档指向的 PTY WebSocket 是另一类需求。自启动不要做成系统服务。若运行层要在用户登出后仍在，再做 LaunchAgent 或 systemd user unit，并保证停服务时不误杀仍应留下的 CLI。Superset 的示例把 `KillMode=process` 写明，就是为了停 host 时不带走终端 daemon（[Host Server](https://docs.superset.sh/cli/host-server)）。

## 三 CLI × 交互通道

图例：能 / 不能 / 部分 / 未找到。部分表示文档只覆盖其中一半。

| 通道 | 多轮，同一进程 | 运行中追加 | 中断当前轮 | 按 id 续跑 | 结构化事件 | 订阅登录 | 无 TTY |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Codex `app-server` | 能。多次 `turn/start` | 能。`turn/steer` 加 `expectedTurnId` | 能。`turn/interrupt` | 能。`thread/resume` | 能。`item/*`、`turn/*` | 部分。适配器写明支持 ChatGPT 订阅；app-server 页未写 stdio 拒绝订阅 | 能。默认 stdio JSONL |
| Codex `exec` / `exec resume` | 不能。一轮后退出 | 不能 | 部分。杀进程 | 能。`exec resume <thread_id>` | 能。`--json` JSONL | 能。复用本机登录（既有结论） | 能。为无头设计 |
| Codex SDK `@openai/codex-sdk` | 部分。同一 thread 再 `run()` | 未找到与 `turn/steer` 对等的 SDK 方法 | 未找到 | 能。`resumeThread` | 部分。文档把逐项事件指到 app-server | 不确定。SDK 页未写无 key 时是否读 `auth.json`（既有结论） | 能。库内拉起 |
| Claude `claude -p` stream-json 输入 | 部分。flag 在；当前 headless 页未再写「进程不退出」的专节 | 部分。进行中的消息排成下一轮 | 部分。SIGINT | 能。`--resume` | 能。一行一个 JSON，含 `session_id` | 能。不加 `--bare`、无 API key | 能。`-p` 为无头 |
| Claude Agent SDK | 能。流式输入，长驻进程 | 部分。排队，可 `interrupt()` | 能。仅流式输入 | 能。`resume` | 能。消息迭代 | 部分。帮助中心允许订阅者自用；概览要求第三方用 API key（既有结论） | 能。stdio 子进程 |
| Claude ACP 适配器 | 能。ACP 多轮 `session/prompt` | 未找到塞进当前轮 | 部分。规范有 `session/cancel` | 部分。规范有 `session/load`；适配器细节本次未逐文件核对 | 能。`session/update` | 部分。Zed 文档写可用 Claude 登录 | 能。适配器进程的 stdio |
| Grok `grok -p` | 不能。一条提示后退出 | 不能 | 部分。杀进程 | 能。`-r` 新进程 | 部分。`streaming-json` 有，无事件表 | 能。无 `XAI_API_KEY` 时走本机登录（既有结论） | 能。headless |
| Grok `grok agent stdio` | 能。同一进程再发 `session/prompt` | 未找到 | 未找到 Grok 专页；ACP 规范有 `session/cancel` | 部分。仓库用户指南写 `session/load`；docs.x.ai 示例只有 `session/new` | 能。`agent_message_chunk`、`tool_call` 等 | 能。`cached_token` | 能。stdin/stdout |
| Grok `grok agent serve` | 未找到于当前 CLI reference | 未找到 | 未找到 | 未找到 | 未找到于 docs.x.ai | 不确定 | 不适用 stdio |

## 四种拉起方式

| 方式 | 交互 | 结构化事件 | 崩溃后续跑 | 运行层重启后子进程 | 权限与卡死 | 复杂度 | macOS/Linux | 产品例子 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ① 普通 spawn，一次 `-p`/`exec` | 本轮不能再送消息。下一轮要新进程加 resume | 能，若打开 JSON/JSONL | 会话在，进程不在。用 id 新开 | 父进程死时通常带走子进程，除非 detached | 靠启动参数关掉提问。无输出靠外部超时 | 低 | 两者皆可 | orka 的 `codex exec`；grok plugin-cc 的 `grok -p`（见 reference-runtime-stack.md） |
| ② 常驻协议进程 | 能。多轮、部分通道可追加或中断 | 能 | 进程死了用 session id 新开协议进程 | 协议进程一般随运行层退出。不自动接管旧进程 | 审批走协议应答或启动时永不询问。不答就停在请求上 | 中 | 两者皆可。无 TTY 要求 | codex plugin-cc 的 `codex app-server`；Todos CLI 0.1.67 的 Codex/Claude 驱动；Zed 的 ACP |
| ③ PTY | 能。用户像在终端里打字 | 弱。字节流不是事件。Superset 另靠钩子上报开始、结束、等待输入 | 终端 daemon 还在就重连；不在则按 session id 冷启动 | 可以留下，若 PTY 在独立 daemon | 权限提示画在屏幕上。无人看就会卡住。可用 CLI 的跳过权限参数 | 高 | 两者皆可。node-pty 两端都有 | Orca、JAgents 的 PTY daemon；Superset 的终端 daemon（文档写明 PTY 与独立 daemon） |
| ④ tmux | 能。attach 进会话打字 | 弱。同上，除非再读 CLI 自己的 transcript | tmux 会话还在就 attach。会话没了要新开 | tmux 服务器独立于启动它的程序，会话可以留下 | 同 PTY。Claude Squad 用 `-y` 自动接受 Claude/Aider 提示 | 中。依赖本机 tmux | 两者皆可。Windows 无原生 tmux | Claude Squad；CAO；Claude Code Agent Teams 的分屏模式 |

## 新增产品总表

已调研的 Orca、orka、devteam、两个 plugin-cc、JAgents、dsh、open-grokbot、Factory、vibe-kanban 不重复列入。

| 产品 | 语言与界面 | 进程 | 怎样驱动 CLI | 用户怎样对正在跑的 agent 说话 | 状态 | 实时 | 主程序重启 | 后台与自启动 | 安装 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Todos | 执行端 Node ≥22.19 的 `tds`。看板在浏览器或应用 | 本机 daemon 领任务；控制面在 Todos 服务端 | Claude Agent SDK；Codex `app-server`；另有多个 ACP 适配器。依据是 CLI 0.1.67 静态分析，不是新的官方协议页 | 任务页输入框。Codex 样本在运行中收到追加 | 任务在服务端。本机会话与 worktree 在执行端 | 机器流为 SSE `/api/machine/stream`（静态分析行号） | daemon 崩溃由自身监督拉起。原进程不接管，按会话恢复 | `tds start` 默认后台。可用外部 systemd 管 `--foreground` | `npm install -g @todos-dev/cli` |
| Conductor | 闭源 macOS 应用。实现语言未找到 | 桌面应用。云工作区另有 microVM | 拉起本机已登录的 Claude Code、Codex、Cursor、OpenCode。spawn 或 PTY 未找到源码 | 应用内对话。文档未写协议名 | 未找到数据目录 | 未找到 SSE/WebSocket | 未找到 | 未找到 LaunchAgent。安装页写明尚无 Linux | 下载 macOS 应用 |
| Claude Squad | Go TUI | 一个 `cs` 进程加多个 tmux 会话 | tmux 里执行 `claude` 或 `-p` 指定的命令 | `↵` attach，在那个终端里继续打字 | `~/.claude-squad/config.json`。实例列表的存储文件名未在 README 写出 | TUI 预览，不是 Web 推送 | 退出 TUI 不写明是否杀掉 tmux。`c` 会暂停会话，`r` 恢复 | 未找到服务安装 | Homebrew 或 `install.sh`。依赖 tmux、gh |
| Sculptor | 桌面应用。README 未写语言。2025-09 维护者在 HN 称 Electron + TS/React 前端、Python 后端 | 应用加每 agent 一个容器 | 终端型 agent，官方材料强调容器内的 Claude Code。当前 README 写任何终端 agent。协议或 PTY 未找到 | 应用内聊天面板 | 未找到路径 | 未找到传输名 | 未找到是否接回容器内进程 | 未找到。macOS 与 Linux 有下载 | 下载安装包。容器后端要 Docker |
| Emdash | 桌面应用，仓库含 TypeScript 提供者注册表 | 桌面应用；文档写本地或 SSH，并用 tmux 保住会话 | 检测本机 CLI 再 spawn。注册表字段含初始提示 flag，也含按键注入 | 任务里看终端，并可继续迭代 | 官方博文写本地 SQLite，不把代码或聊天发到 Emdash 服务器 | 文档写实时终端。传输未找到 | 文档写 tmux 使本地或远程会话在重连后仍在 | 未找到 LaunchAgent。有 macOS、Windows、Linux 安装包 | `brew install --cask emdash` 等 |
| Superset | 桌面应用加 CLI。文档未写主语言。开发材料出现 Bun | 桌面或 CLI、host server、独立终端 daemon | 在工作区终端里启动 CLI。文档写 PTY 存在即会话还在 | 在该终端里打字，或用 CLI 再发 prompt | `~/.superset/worktrees/`、`~/.superset/sessions/`、`~/.superset/host/<id>/host.db` | 钩子上报工作中、等待输入、结束。终端字节流另走 daemon | 终端 daemon 比界面活得久，进程与回滚还在 | `superset start --daemon`。文档给了 systemd 例子，并警告不要用会杀掉终端 daemon 的 KillMode | 桌面应用、CLI。许可证 Elastic 2.0 |
| Nimbalyst（Crystal 的后继） | Electron 桌面应用，MIT。Crystal 仓库于 2026-02 标明弃用 | 桌面应用。移动端用于查看 | 跑本机的 Claude Code、Codex，以及 alpha 的 OpenCode、Copilot。驱动方式未找到 | 会话界面里继续对话。看板管理多个会话 | 未找到目录 | 未找到 | 产品页写可 resume 会话。是否接回原进程未找到 | 未找到。macOS、Windows、Linux | 从 nimbalyst.com 下载 |
| CAO | Python 3.10+ | `cao-server` 加 tmux 里的各 CLI | tmux 中启动已登录的官方 CLI，含 Grok Build | attach 到 tmux，或打开 `http://localhost:9889` | README 未写数据库路径 | Web UI。README 指向 HTTP API 与 PTY WebSocket 文档，本次未逐段打开 | 未找到服务器重启后是否仍 attach 原 tmux | 未找到 user unit。服务器要人另开一个终端跑着 | `uv tool install` 或 PyPI。依赖 tmux ≥3.3 |
| Catnip | Go 二进制，内嵌 Vite 的 React | 一个监听 6369 的服务；代理跑在容器里 | 容器里的终端，材料以 Claude Code 为主 | Web 或手机上的终端界面 | 本地 volume `~/.catnip/volume`（DeepWiki 对仓库的结构说明；README 写容器与 worktree） | README 侧的结构说明写 SSE | 未找到进程崩溃后的接管 | 未找到 launchd。本地是 `catnip run` | `install.catnip.sh` |
| Agent Teams | Claude Code 自身的功能，不是独立程序 | 主会话为 lead。队友是独立 Claude Code 会话，进程内或 tmux/iTerm2 分屏 | lead 在交互会话里生成队友。`-p` 与 Agent SDK 不生成队友 | 在面板里选中队友打字，或点进它的窗格。Esc 打断该队友当前轮 | `~/.claude/teams/{name}/config.json` 随会话结束删除。任务在 `~/.claude/tasks/{name}/` | 终端 UI | `/resume` 不恢复进程内队友。tmux 会话可能变成孤儿 | 未找到。要求交互会话 | 随 Claude Code。`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Codex 桌面应用 | 官方桌面应用。实现未公开 | 一个应用里多个 thread | 未找到它内部是否调用 `app-server`。文档只把 app-server 的例子写成 VS Code 扩展 | 应用里对 thread 发消息 | 与 CLI 共用的 Codex home。Windows 页写 `%USERPROFILE%\.codex` | 应用内。传输未找到 | 未找到线程进程是否独立于窗口 | 未找到。macOS 与 Windows 可装。Linux 为等候通知 | 下载或 `winget install Codex -s msstore` |

## Codex

### `codex app-server`

`codex app-server` 是 Codex 用来驱动富客户端的接口，用途包括认证、会话历史、审批和事件流。实现在 [openai/codex 的 app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server)。默认传输是 stdio 上的换行 JSON。另有实验性的 WebSocket，以及本机 Unix socket。非本机 WebSocket 在推出期间默认可无认证连入，文档要求先配认证，并写明该传输不受生产支持（[App Server](https://learn.chatgpt.com/docs/app-server)）。

一条连接先 `initialize`，再发 `initialized`。之后 `thread/start`、`thread/resume` 或 `thread/fork`，再 `turn/start`。同一线程可以再开下一轮。`turn/steer` 把用户输入追加进当前进行中的轮次，必须带对得上的 `expectedTurnId`，没有进行中的轮次就失败，也不发出新的 `turn/started`。`turn/interrupt` 成功返回空对象，该轮以 `interrupted` 结束。事件包括 `item/started`、`item/completed`、`item/agentMessage/delta`、`turn/completed`（[App Server](https://learn.chatgpt.com/docs/app-server)）。

续跑用先前的 `thread.id` 调 `thread/resume`。可以 `excludeTurns: true` 只取元数据。resume 本身不更新 `updatedAt`。标成 required 的 MCP 初始化失败时，start 和 resume 都失败（[App Server](https://learn.chatgpt.com/docs/app-server)）。

审批是服务器主动发来的请求。命令执行可以 `accept`、`acceptForSession`、`decline`、`cancel`，或带 execpolicy 修正的接受。文件变更是前四个决策。客户端回答后才有 `serverRequest/resolved` 和 `item/completed`（[App Server](https://learn.chatgpt.com/docs/app-server)）。文档没有写请求超时。不回答，这一轮就停在请求上。无人值守用 `approvalPolicy: "never"`，或对每种请求立刻拒绝。

用量相关方法有 `account/rateLimits/read` 与 `account/usage/read`。后者的说明写明 ChatGPT、外部 ChatGPT token、agent identity 和个人访问 token 可以调用，仅 API key 与 Bedrock 不行（[App Server](https://learn.chatgpt.com/docs/app-server)）。这是该端点的认证范围，不是整份 stdio 协议的登录说明。

`codex --remote ws://127.0.0.1:4500` 可以把官方 TUI 接到已在监听的 app-server 上（[App Server](https://learn.chatgpt.com/docs/app-server)）。这仍是终端界面，Helm 不需要。

已知问题不重复 unattended-executors.md 里的 `codex exec` 挂起表。和这条通道直接相关的是：共享 `~/.codex` 的 SQLite 锁会让下一个 app-server 在启动时超时（issue #32160、#26454，见该文）。优雅关闭时，新工作会收到 JSON-RPC `-32600`，`reason` 为 `serverShuttingDown`（[app-server README](https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md)）。

### `codex exec` 与 `codex exec resume`

这是一次性无头通道，不是持续对话通道。细节、`--json` 事件和 `thread_id` 续跑已写在 unattended-executors.md。这里只记：一轮结束进程退出；运行中不能再送一条用户消息；续跑是新进程。

### Codex SDK

文档把自动化和 CI 指到 SDK，把嵌进产品、要审批和事件流的集成指到 app-server（[App Server](https://learn.chatgpt.com/docs/app-server)）。SDK 的多轮是同一线程上再次 `run()`，一次 `run()` 阻塞到该轮结束。本次没有在 SDK 页读到 `turn/steer`。订阅登录是否在无 API key 时成立，仍是 subscription-billing.md 里的不确定项。Helm 不应嵌这个包。

### ACP 适配器

Zed 的 `codex-acp` 说明开发已迁到 `@agentclientprotocol/codex-acp`，新适配器建在 Codex App Server 上。旧 README 写明的认证有 ChatGPT 订阅、`CODEX_API_KEY`、`OPENAI_API_KEY`，并写订阅路径不适用于远程项目（[README](https://github.com/zed-industries/codex-acp/blob/main/README.md)）。Zed 的文章写：经 ACP 使用 Codex 时，账单在用户与 OpenAI 之间，提示和代码不经过 Zed 的服务器（[Codex is Live in Zed](https://zed.dev/blog/codex-is-live-in-zed)）。适配器是多一层进程，Helm 可以直接对 `codex app-server` 说话。

## Claude Code

### `claude -p` 与 stream-json

`-p` 是无头运行。输出格式 `text`、`json`、`stream-json` 已在 unattended-executors.md。`json` 带 `session_id` 和 `total_cost_usd`。`stream-json` 再加 `--verbose` 与 `--include-partial-messages` 才有 token 增量。慢消费者未读完时，进程会等输出排空，上限 30 秒（[Headless](https://code.claude.com/docs/en/headless)）。

输入侧：CLI reference 列出 `--input-format`，取值为 `text` 或 `stream-json`，示例是 `claude -p --output-format json --input-format stream-json`（[CLI reference](https://code.claude.com/docs/en/cli-reference)）。同一参考里，`--max-turns` 的说明写：在 stream-json 输入下，Claude 正在工作时发来的消息会排队，当前轮因上限结束之后，作为自己的一轮再跑。这是排队，不是 `turn/steer`。

当前 [Headless](https://code.claude.com/docs/en/headless) 页本次检索到的正文，没有再单列「Streaming JSON Input」专节。较早的公开页曾写：stdin 上每行一个用户消息，从而不必重开二进制，并且可以在处理过程中给指导（检索摘录，页为 `https://docs.claude.com/en/docs/claude-code/headless`）。两页不一致。接入时以当前 CLI 的「排队成下一轮」为准，不要假设能塞进当前轮。

打断：headless 页写，要结束这一轮而不是只杀进程树，先送 SIGINT，或调用 Agent SDK 的 `interrupt()`，再停进程。SIGTERM 的退出码是 143，当前轮不记结果（[Headless](https://code.claude.com/docs/en/headless)）。

续跑：`claude -p --resume <session_id>`。按 id 不限当前目录。也可以把会话 `.jsonl` 的绝对路径传给 `--resume`（[Headless](https://code.claude.com/docs/en/headless)）。

权限：`--permission-prompts none`（v2.1.259 起）会拿掉需要人回答的工具，例如 AskUserQuestion；拒绝出现在 stream-json 的 `permission_denied` 里（[Headless](https://code.claude.com/docs/en/headless)）。`dontAsk`、`auto`、`bypassPermissions` 的无人值守语义见 unattended-executors.md。无 TTY 下并行子代理曾有长时间无输出的报告（issue #56540，该文已录，关闭原因是不活跃而不是写明已修复）。

`--bare` 不读 OAuth。调度者和执行者都不要加。

### Agent SDK

SDK 在 `query()` 时 spawn 一个 `claude` 子进程，经 stdio 对话。子进程拥有 shell、工作目录和磁盘上的 JSONL。一个会话对应一个子进程（[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting)）。概览表写：要在自己的进程里嵌 Claude Code 的 agent，用 Agent SDK；要在其他语言里驱动同一循环，就用 CLI 的 `-p`（[Agent SDK](https://code.claude.com/docs/en/agent-sdk)）。

流式输入是长驻会话：可以排队多条消息、打断、处理权限、保持上下文。单条消息模式没有动态排队、实时打断和自然多轮（[Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)）。Python 里只有 `ClaudeSDKClient` 支持 `interrupt()`，`query()` 不支持（[Python SDK](https://code.claude.com/docs/en/agent-sdk/python)）。TypeScript 的 `Query.interrupt()` 也只在流式输入可用（[TypeScript SDK](https://code.claude.com/docs/en/agent-sdk/typescript)）。

`canUseTool` 不返回，执行就一直停着。人不会马上答时，文档要求用 PreToolUse hook 返回 `defer`，让进程退出，以后从已保存的会话续上（[User input](https://code.claude.com/docs/en/agent-sdk/user-input)）。`dontAsk` 跳过回调并拒绝。

订阅与第三方限制见 subscription-billing.md。Helm 若只 spawn 官方二进制，就不需要这个库。

### ACP

Claude Code 本身不是 ACP agent。Zed 通过适配器跑它。当前注册名是 `@agentclientprotocol/claude-agent-acp`（检索到的注册表说明，页为 `https://agentrq.com/blog/which-coding-agents-support-acp-agent-client-protocol`；Zed 文档写首次创建线程时安装 `@zed-industries/claude-code-acp`，[External Agents](https://zed.dev/docs/ai/external-agents)）。Zed 文档写认证可以是 API key，或登录 Claude Code 以使用订阅。适配器细节本次没有逐文件打开。ACP 规范本身：一轮是一次 `session/prompt`；结束后可以再发；`session/cancel` 是通知，agent 应以 `cancelled` 结束该轮，而不是把取消报成错误（[Prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)）。

### Agent Teams

这是 Claude Code 里的实验功能，不是另一个可编排的 CLI。设置 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 后，主会话是 lead，队友是各自有上下文的 Claude Code 会话。默认显示是进程内；`teammateMode` 可为 `auto`、`tmux` 或 `iterm2`。分屏需要 tmux 或 iTerm2。`-p` 与 Agent SDK 会话不会生成队友（[Agent teams](https://code.claude.com/docs/en/agent-teams)）。

用户在进程内用方向键选中队友再打字，或在分屏里点进窗格。Esc 打断正在查看的那位队友的当前轮。团队配置在 `~/.claude/teams/{team-name}/config.json`，会话结束就删，里面有 session id 和 tmux pane id，不要手改。任务列表在 `~/.claude/tasks/{team-name}/`，会话结束后还在（[Agent teams](https://code.claude.com/docs/en/agent-teams)）。

限制：`/resume` 和 `/rewind` 不恢复进程内队友；一个会话只有一个团队；队友不能再生成队友；lead 固定。tmux 会话可能在主会话结束后变成孤儿，要用 tmux 自己清掉（[Agent teams](https://code.claude.com/docs/en/agent-teams)）。

这和 Helm 的模型不同：编排发生在 Claude 会话内部，任务列表不在 Helm 的任务库里，而且无头派单不会形成团队。不适合当作运行层。

## Grok Build

### `grok -p`

无头、审批、沙箱、`-r` 与 `-s` 的矛盾，已写在 unattended-executors.md。这里只补交互：一条 `-p` 是一个进程、一条提示。`--output-format` 只有 `plain`、`json`、`streaming-json`。没有 `--input-format`。`streaming-json` 是到达就输出的换行 JSON，已发布页没有事件类型表（[Headless](https://docs.x.ai/build/cli/headless-scripting)）。续跑是新进程的 `-r`。TUI 里有 `/queue`，列出排在当前轮后面的提示（[Modes and Commands](https://docs.x.ai/build/modes-and-commands)）。那是终端命令，不是无头通道。

### `grok agent stdio`

CLI reference 的子命令表有 `grok agent stdio`，说明是 ACP、JSON-RPC、stdin/stdout（[CLI reference](https://docs.x.ai/build/cli/reference)）。Headless 页的示例 spawn `grok agent stdio`，先 `initialize`，再按返回的 `authMethods` 选 `xai.api_key` 或 `cached_token`，然后 `session/new` 与一次 `session/prompt`。没有缓存登录也没有 API key 时，错误文本要求先 `grok login` 或设置 key。助手正文来自 `session/update`，`sessionUpdate` 为 `agent_message_chunk`。`session/prompt` 的返回里有 `stopReason`。示例在打完一句后杀掉进程（[Headless](https://docs.x.ai/build/cli/headless-scripting)）。

ACP 规范允许该轮结束后再发 `session/prompt`，所以同一进程多轮是协议能力。官方示例没有演示第二轮。规范的取消是 `session/cancel`。docs.x.ai 示例没有这个调用，因此 Grok 是否实现，记为未找到。

脚本和无头都应加 `--no-auto-update`，否则 ACP 也会做后台更新检查（[Headless](https://docs.x.ai/build/cli/headless-scripting)）。`--always-approve` 自动批准工具，deny 与 hook 仍然有效（既有结论）。

### 仓库用户指南里的 serve / load

[xai-org/grok-build 的 15-agent-mode.md](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md) 写了更宽的入口：`grok agent --always-approve stdio`、`grok agent serve --bind 127.0.0.1:2419 --secret <token>`、以及 `--grok-ws-url` 的 relay。它写 ACP 覆盖创建、加载、恢复会话，权限提示，以及 `session/update` 的 `agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`plan`。`session/new` 的 `_meta.yoloMode` 可对该会话打开 always-approve。这篇指南里的模型例子是 `grok-4.6`，而当前 API 文档的旗舰是 `grok-4.7`。当前 [CLI reference](https://docs.x.ai/build/cli/reference) 的子命令表只有 `grok agent stdio`，没有 `serve`。Helm 不要依赖 `serve`，直到 docs.x.ai 把它列进参考。

用量字段：streaming-json 与 ACP 示例都没有读到 token 或额度对象。TUI 的 `/context` 与 status line 不是程序接口。

无 TTY：ACP 走管道，不需要终端。`-p` 可用 `--no-alt-screen` 避免占用备用屏幕（[Headless](https://docs.x.ai/build/cli/headless-scripting)）。计划模式在无 TUI 时会不会挂起，仍是 unattended-executors.md 的未决项。

## 新增产品

### Todos

官方文档把控制面和执行面分开。看板、对话和审核在浏览器或应用里。本机只安装 `tds`。`tds start` 默认脱离终端，在后台跑，崩溃后由自己的监督再拉起。无界面机器用 `--api-key` 与 `--team`。已有 systemd、pm2 或容器时用 `--foreground`。日志在 `~/.tds/daemon.log`（[CLI](https://todos.dev/docs/cli)、[Install](https://todos.dev/docs/install)）。

执行发生在自有机器或 Pro 的平台机器上。平台机器是 Cloudflare Sandboxes 容器，只有内置 runtime，不提供本机外部 CLI（[Platform machines](https://todos.dev/docs/platform-machines)）。外部 runtime 用机器上已经登录的 CLI，文档列出的 18 个里有 Claude Code、Codex 和 Grok Build，不需要再配模型 API key（[Install](https://todos.dev/docs/install)）。官网问答写可以连接 ChatGPT/Codex、GitHub Copilot 或 xAI 订阅（[todos.dev](https://todos.dev/)）。

驱动方式不在上述产品页里。本仓库对 `@todos-dev/cli@0.1.67` 的静态分析写：Claude 经 Agent SDK 调本机可执行文件，续跑用 `resume`，回退用下次 `query` 的 `resumeSessionAt`；Codex 启动 `codex app-server --listen stdio://`，追加是 `turn/steer` 加 `expectedTurnId`，恢复是 `thread/resume`，回退是 `thread/revert`。停止时 Claude 走 `q.close`，Codex 走 `turn/interrupt`。两者都按无人审批运行：Claude `bypassPermissions`，Codex `approvalPolicy: "never"` 且 `sandbox: "danger-full-access"`。机器用 HTTP 领取 turn，SSE 在 `/api/machine/stream`，失效后改长轮询（`.scratch/tasks/19-research/todos-research.txt`）。这些是该版本发布包的函数，不是服务端源码。

2026-10-18 的产品样本只覆盖 Codex：运行中的消息被当轮接收；停止对话框默认丢弃本轮修改。进程重启后的产品行为，该摘录写明未证实。

和 Helm 的差别：任务库的权威副本在 Todos 服务端，不是单机。v1 不做远程访问，不能照搬「浏览器在云、执行在本机」这一拆分。值得拿来的是驱动方式：调度式的长对话走协议，而不是终端。

### Conductor

[安装页](https://www.conductor.build/docs/installation) 写 Conductor 是 macOS 应用，尚无 Windows 或 Linux。它检查本机的 `gh`、Claude Code 登录和 Codex 登录。Cursor 要另加 API key。[FAQ](https://www.conductor.build/docs/faq) 写：默认使用机器上已经保存的登录；Claude Pro 或 Max、以及 API key 登录，都会沿用。应用自带一份 Claude Code 和 Codex，路径在 `~/Library/Application Support/com.conductor.app/bin`。Agent 与用户账号同一权限，文档写它们直接跑在系统上，没有沙箱。每个工作区是一个 git worktree。首页同时提供云 microVM（[conductor.build](https://www.conductor.build/)）。

用户在应用里看谁在干活、审 diff、发消息。文档没有写 PTY、app-server 或 stream-json。状态目录、界面推送、退出应用后 CLI 是否还在、有没有 LaunchAgent，本次未找到。

### Claude Squad

[README](https://github.com/smtg-ai/claude-squad/blob/main/README.md) 写：一个终端程序管理多个 Claude Code、Codex、Gemini 和 Aider。实现三块是 tmux 会话、git worktree、TUI。默认程序是 `claude`。`cs -p "codex"` 改启动命令。配置在 `~/.claude-squad/config.json`，`cs debug` 打印实际路径。`-y` 是实验开关，让实例自动接受 Claude Code 和 Aider 的提示。Codex 一节写的是设置 `OPENAI_API_KEY`，没有写 ChatGPT 登录。这是 README 的句子，不把它升级成「Codex 只能用 API key」。

用户按回车 attach，在该终端里继续输入，`ctrl-q` 脱离。`c` 提交并暂停，`r` 恢复暂停的会话。没有 Web，也没有结构化事件流。退出 `cs` 之后 tmux 是否留下，README 没写。安装是 Homebrew 或 `install.sh`，依赖 tmux 和 gh。许可证 AGPL-3.0。未找到 LaunchAgent 或 systemd。

### Sculptor

[README](https://github.com/imbue-ai/sculptor/blob/main/README.md) 写这是跑并行 coding agent 的桌面应用，实验性质，MIT。下载有 Mac Apple Silicon 与 Linux。使用方式是连接仓库、建隔离工作区、对 agent 发提示、审完再合回。它也写可以管理任何终端型 agent。[界面文档](https://github.com/imbue-ai/sculptor/blob/main/docs/interface.md) 写聊天面板显示回复、工具调用和进度，另有工作区终端。

[产品页](https://imbue.com/product/sculptor) 写应用跑在用户自己的电脑上，不需要 Imbue 订阅，模型费用在模型提供方。2025-09 的公告写每个 agent 一个容器，并用 Pairing Mode 把容器里的文件同步到本地（[公告](https://imbue.com/sculptor-announce/)）。容器启动加速的文章写仓库被克隆进按 devcontainer 构建的容器（[containers](https://imbue.com/product/containers/)）。

实现语言：README 未写。2025-09 的 Hacker News 上，回复者 thejash 说当时是 Electron，前端 TypeScript/React，后端 Python（[Show HN](https://news.ycombinator.com/item?id=45427697)）。这是论坛回复，不是仓库文件。状态目录、事件传输、应用重启后容器内进程是否还在、自启动，本次未找到。

### Emdash

[仓库 README](https://github.com/generalaction/emdash) 写：桌面应用，多个 coding agent 并行，每个任务一个 git worktree，支持本地与 SSH。检测已安装的 CLI，包括 Claude Code 与 Codex。[概览](https://www.emdash.sh/docs) 写 macOS、Windows、Linux，并写 tmux 会话让长时间的本地或远程 agent 在重连后仍在。[提供者页](https://emdash.com/docs/providers) 列出检测命令，Claude Code 是 `claude`，Codex 是 `codex`，并写自动批准文件操作的能力依提供者而异。添加提供者的指南给出 TypeScript 注册表，字段包括 `initialPromptFlag`、`resumeFlag`、`autoApproveFlag` 和 `useKeystrokeInjection`（[指南](https://www.mintlify.com/generalaction/emdash/guides/adding-providers)）。因此有的 CLI 用参数送出首条提示，有的靠向终端注入按键。

[官方博文](https://emdash.com/blog/what-is-emdash) 写本地 SQLite，不把代码或聊天发到 Emdash 服务器，许可证 Apache-2.0。界面实时看终端。传输协议、桌面进程重启时 tmux 是否一定还在、自启动单元，本次未找到。安装包括 `brew install --cask emdash`。

### Superset

[概览](https://docs.superset.sh/overview) 写：每个任务一个 workspace，即独立 git worktree。桌面、iPhone/iPad、CLI 和 MCP。许可证 Elastic License 2.0。模型调用不经过 Superset，走用户自己的账号（[模型说明](https://docs.superset.sh/superset-model)）。

终端由后台 daemon 持有。关掉应用或 host server，终端和里面的进程还在。`superset stop --terminals` 才会再停 daemon。文档给的 systemd 单元使用 `KillMode=process`，并写其他 KillMode 会在服务停止时杀掉全部终端和 agent（[Host Server](https://docs.superset.sh/cli/host-server)、[FAQ](https://docs.superset.sh/faq)）。CLI 的 panes 列表说明：出现在列表里表示 PTY 还在，不表示里面的 agent 正在工作（[CLI reference](https://docs.superset.sh/cli/cli-reference)）。

状态检测靠装进各 CLI 配置的钩子和 `~/.superset/bin` 里的包装命令，报告开始、结束、等待输入。不是解析 TUI（[Agent status](https://docs.superset.sh/agent-status)）。Claude、Codex、Grok 在支持表里都是：有状态、重启后可按 session id 恢复、有用量历史、有额度表（[Supported agents](https://docs.superset.sh/supported-agents)）。预设里 Claude 的启动命令是 `claude --dangerously-skip-permissions`，Codex 是 `codex --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust`（[Presets](https://docs.superset.sh/terminal-presets)）。

磁盘：worktree 在 `~/.superset/worktrees/`，会话在 `~/.superset/sessions/`（[FAQ](https://docs.superset.sh/faq)）。host 的 SQLite 是 `~/.superset/host/<organizationId>/host.db`（[Host Server](https://docs.superset.sh/cli/host-server)）。用户在终端里继续打字。实现语言和界面用的推送协议，本次打开的文档页没写。

### Nimbalyst（Crystal 已弃用）

[stravu/crystal 的 README](https://github.com/stravu/crystal) 写 Crystal 已于 2026 年 2 月弃用，后继是 Nimbalyst，仓库为 [nimbalyst/nimbalyst](https://github.com/nimbalyst/nimbalyst)。Crystal 的能力是并行 Claude Code 与 Codex、每会话一个 worktree。Nimbalyst 的 README 写 Electron、MIT，macOS、Windows、Linux，以及 iOS/Android 伴侣应用。并行会话各在一个 worktree，会话有看板。Claude Code 与 Codex 是一等提供者，OpenCode 与 GitHub Copilot 为 alpha。

[产品页](https://nimbalyst.com/product/) 写：它运行厂商自己的 agent 程序，而不是重写一个 agent，所以行为与终端里一致，外面再套文件树、编辑器、会话历史和 diff。驱动是 PTY、ACP 还是 SDK，该页没写。状态目录、推送方式、桌面退出后进程是否留下、自启动，本次未找到。

### CLI Agent Orchestrator（CAO）

[README](https://github.com/awslabs/cli-agent-orchestrator/blob/main/README.md) 写：本地 `cao-server` 在隔离的终端会话里启动提供者 CLI，supervisor 再把工作分给它们。CLI 保持各自的登录和能力。支持名单里有 Claude Code、Codex 和 Grok Build。依赖 Python 3.10+、tmux 3.3+。安装是 uv 从 git 装，或 PyPI 的 `cli-agent-orchestrator`。许可证 Apache-2.0。

使用是两个终端：一个跑 `cao-server`，一个在项目目录 `cao launch`。Web UI 在 `http://localhost:9889`，也可以按 tmux 指南 attach。`cao shutdown --session` 停命名会话。README 把 HTTP API 和 PTY WebSocket 指到 `docs/api.md`，本次没有打开该页，所以不写帧格式。状态文件位置、服务器进程死后 tmux 是否还在、launchd 或 systemd，README 未写。Kubernetes 例子是另一条部署，不是单机默认。

### Catnip

[README](https://github.com/wandb/catnip/blob/main/README.md) 写：用容器跑 Claude Code，自动建 git worktree，从而并行多个 agent。Web、CLI 和 SSH 都能打开终端，另有原生手机界面。沙箱是 Docker 或 Apple Container SDK，因此可以使用 `--dangerously-skip-permissions`。本地是 `catnip run`，打开 `http://localhost:6369`。`catnip` 是带内嵌 Vite SPA 的 Go 二进制。

DeepWiki 对同一仓库的结构说明写：Go 服务管容器、git 和终端，React 在前端，状态用 SSE 广播，本地持久 volume 为 `~/.catnip/volume`（[DeepWiki](https://deepwiki.com/wandb/catnip)）。这是第三方对源码的整理，目录名以它为准时要再对仓库确认；本次没有打开 `container/main.go`。自启动和「服务重启后接回容器内 Claude」未在 README 写明。

### Claude Code Agent Teams

见上一节。它是官方 CLI 里的多会话，不是独立编排器。Helm 的调度者若是 `claude -p`，这条能力不可用。

### Codex 桌面应用

[Codex app](https://developers.openai.com/codex/app) 写：macOS 与 Windows 的桌面程序，并行处理多个 thread，带 worktree、自动化和 Git。用 ChatGPT 账号或 API key 登录。选 Local 时在本机项目上工作。[功能页](https://developers.openai.com/codex/app/features) 写一个窗口跨项目，线程可选 Local 或 Worktree。Windows 页写应用与原生 Codex 共用 `%USERPROFILE%\.codex`，并有 Windows 沙箱或 WSL2（[Windows](https://developers.openai.com/codex/app/windows)）。Linux 在下载步骤里是「等候通知」，不是已提供的构建。

文档没有写桌面应用内部通过 `app-server` 说话。app-server 页的富客户端例子是 VS Code 扩展。因此不能把桌面应用当成 app-server 的参考实现来抄。它说明官方自己也用「多 thread + worktree + 本机登录」做并行，而不是为每个任务开一个终端窗口。

## 没能确认的事项

- Claude 当前 headless 页是否仍保证 `--input-format stream-json` 在一条结果之后保持进程，继续读下一条用户消息。flag 还在；专节本次没在该页找到。较早公开页与现行 `--max-turns` 说明对「处理中的新消息」一个说指导、一个说排队。
- `codex app-server` 在不设置 `CODEX_API_KEY` 时，是否一定读取 CLI 的 ChatGPT 登录。适配器 README 支持订阅。app-server 页没有一句「stdio 默认走 auth.json」。
- Codex SDK 有没有 `steer` 或 `interrupt`。本次只确认文档把细粒度控制指到 app-server。
- Grok 的 `grok agent stdio` 是否实现 `session/cancel` 和 `session/load`。仓库用户指南写了 load 与 `serve`；现行 CLI reference 子命令表没有 `serve`。
- Grok `streaming-json` 的事件字段，以及 ACP `session/update` 里有没有用量。
- Codex 桌面应用是否内部使用 app-server。
- Conductor 是 PTY、按键注入还是协议。状态目录、退出后进程、自启动。
- Claude Squad 退出 TUI 后 tmux 会话是否留下。实例列表存在哪个文件。
- Sculptor 当前版本的语言、驱动方式、状态目录、重启语义。
- Emdash 桌面到终端的传输，以及 tmux 在应用退出后的精确行为。
- Superset 桌面应用的实现语言，以及界面刷新是轮询、SSE 还是别的。
- Nimbalyst 拉起 Claude Code / Codex 的具体方式。
- CAO 的 `docs/api.md` 帧格式、状态目录、`cao-server` 退出后的 tmux。
- Catnip 服务进程退出后，容器内会话是否还在。`~/.catnip/volume` 来自 DeepWiki，未对源码复核。
- Todos 官方文档没有公开 Codex `turn/steer` 与 Claude SDK 的方法名。那些句子只属于 CLI 0.1.67 的静态分析，不能当成现行 `tds` 的保证。
- Happy：没有定位到一个本地、拉起官方 CLI、多任务并行的产品页。
- OpenHands、Cline 看板：本次没有打开到「本地编排多个官方 CLI」的架构页。Cline 只作为 Emdash 和 Todos 的一种外部 CLI 出现。
- Terragon 与 Coder 的 Mux/Xum 未列入总表。Terragon 文档写 agent 在云沙箱。Mux 仓库已改名为 Xum，公开介绍是自有的多模型 agent，不是拉起 Codex、Claude Code、Grok Build 三个官方 CLI。Omnara 的公开介绍是托管 agent API。
