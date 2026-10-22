# 技术栈与进程结构

Type: grilling
Status: resolved
Labels: wayfinder:grilling
Blocked by: 02, 18, 19, 20, 21
Map: [Helm v1 设计](../map.md)

## Question

Helm 用什么语言和框架实现？进程怎么组成（一个后台守护进程，加 Web 界面，加调度者和执行者子进程）？在本机和服务器上分别怎么运行和自启动？

## Answer

2026-10-21 grilling 定稿。依据见 [reference-runtime-stack.md](../../../docs/research/reference-runtime-stack.md)（18）、[interactive-drive-and-landscape.md](../../../docs/research/interactive-drive-and-landscape.md)（19）、[acp-coverage.md](../../../docs/research/acp-coverage.md)（20）、[subscription-via-acp.md](../../../docs/research/subscription-via-acp.md) 与 [subscription-ban-risk.md](../../../docs/research/subscription-ban-risk.md)（21）、[codex-concurrency.md](../../../docs/research/codex-concurrency.md)。

- **语言**：TypeScript，Node 22 或更高。
- **进程组成**：每台机器一个后台进程 `helmd`（即运行层），只监听 `127.0.0.1`，管理所有项目。它负责任务库、依赖检查、并发上限、看门狗、HTTP/MCP 接口和各家驱动，并托管界面页面。调度者每项工作一个长时会话；执行者每次派单一个会话，派单结束即关闭。两者用同一套驱动，都是 `helmd` 通过管道拉起的厂商官方程序，不用 PTY 或 tmux。`helmd` 重启后按 session id 续跑（细节交 11）。
- **驱动**（同 Todos）：Claude Code 用 Claude Agent SDK，`pathToClaudeCodeExecutable` 指向本机 `claude`；Codex 用 `codex app-server`（不用 `codex-acp`，也不用 Codex SDK）；Grok（`grok agent stdio`）、DeepSeek Harness（`dsh --profile acp`）及以后的 agent 走通用 ACP，客户端用官方 `@agentclientprotocol/sdk`，锁定确切版本、用 v1 入口；没有协议模式的 agent 用一次性命令兜底，只能当执行者。各家差异写在 Agent 模板里（驱动方式、命令、参数、环境变量、认证方式），接一家原生支持 ACP 的 agent 只需登记模板。
- **结束判定**：派单结束看执行者程序发出的结束消息（ACP 的 `session/prompt` 响应、app-server 的 `turn/completed`、SDK 的 `result`），不看模型文字；进程崩溃看退出码，挂死由看门狗（墙钟、无输出）杀进程组。正常完成后 `helmd` 关闭管道收尾，几秒不退出再强杀。
- **多个 Codex 并行**：每个执行者一个独立 app-server 进程，各用 `CODEX_SQLITE_HOME` 指定自己的数据库目录（只设在 Helm 拉起的进程上），登录和对话记录共用 `~/.codex`，不复制登录。
- **存储**：`~/.helm/helm.db`（SQLite，`node:sqlite`，WAL，只有 `helmd` 写）加普通文件；表结构交 05。
- **界面**：React + Vite 静态页面，由 `helmd` 托管；实时状态用 SSE，操作用 HTTP POST；视觉以后自行设计（12）。
- **后台运行**：用户级服务。`helm service install` 在 macOS 写 LaunchAgent，在 Linux 写 systemd user unit（需开 lingering）；另有前台 `helm serve`。不做系统级服务，不以 Docker 为默认。
- **安装**：clone 后 `npm install && npm run build && npm link`。
- **范围**：v1 支持 macOS 和 Linux，不做远程访问（在服务器上用自己的 SSH 端口转发看界面）。v1 实测 Claude Code、Codex、Grok、DeepSeek；zcode 暂不测；pi 只配 API key。只供用户自用（Olympus 也是自用），这是能用订阅的前提。
- **订阅与封号**：订阅能否用取决于直接拉起厂商未修改的程序、环境里没有压过订阅的 key，与是否 ACP 无关。封号风险低；撞上限额要停下或改派到别家，不能换同一家第二个账号。
- **修订与交接**：03 的"不嵌 SDK"和"调度者首选 `codex exec`"被本单推翻（见 03 评论）；GLOSSARY 的运行层、Agent 模板、派单结果、派单输出已更新；隔离与登录的冲突交 08；环境变量与凭证约束交 07；调度者的驱动选择交 06；续跑方式交 11；实测清单交 14；Olympus 自用前提记在 13。
- 不建 ADR：选型都容易替换，理由已记在本单和调研文档中。

## Comments

- 2026-10-21 访谈第 1 轮：Q3 每台机器一个守护进程，管理所有项目，数据放 `~/.helm/`（用户同意）。Q4 v1 不考虑远程访问，支持 macOS 和 Linux。Q1 语言、Q2 进程组成由用户要求先调研参考产品，见 [18](18-reference-runtime-stack-research.md)。
- 2026-10-21 访谈第 2 轮：Q1 TypeScript + Node 22+（同意）；Q6 SQLite `~/.helm/helm.db` + 普通文件，`node:sqlite`，WAL，单写者（同意）；Q7 SSE + HTTP POST（同意）。用户补充：有交互需求，但不通过终端；对 Q2、Q5、Q8 及上述同意项都不确定，要求主动检索更多产品（含 Todos），见 [19](19-interactive-drive-and-landscape-research.md)。
- 2026-10-21 访谈第 3 轮：Q8 用户级服务（LaunchAgent / systemd user unit）；Q9 React + Vite，界面以后自行设计；Q10 clone + `npm link`；Q11 维持 TS/Node、SQLite `~/.helm/`、SSE + HTTP POST。用户补充：以后要接入市面上大多数 agent（pi、DeepSeek Harness、Qoder、zcode……），不只三家，见 [20](20-acp-coverage-research.md)。
- 2026-10-21 访谈第 4 轮：Q9 再次确认。用户：不用 SDK（不通用）；问 ACP 下能否和调度者交互；确定要用 Claude Code、Codex、Grok、DeepSeek、zcode、pi（pi 用其他家额度，不单独考虑），担心不经官方 CLI 启动就用不了订阅，见 [21](21-subscription-via-acp-research.md)。
- 2026-10-21 访谈第 5 轮：Q12 v1 实测 Claude Code、Codex、Grok、DeepSeek，zcode 暂不测，pi 只配 API key。用户：ACP 一定要有。用户追问 Claude 走 stream-json 会不会被封号，补充调研结论为低风险（见 21）。
- 2026-10-21 Q5：用户可以接受部分驱动不通用。Claude Code 直接嵌入 Claude Agent SDK（`pathToClaudeCodeExecutable` 指向本机 `claude`），其他 agent 走 ACP，没有协议的走一次性命令兜底。
- 2026-10-21 Q14：和 Todos 一样，Codex 走原生 `codex app-server`（可在一轮中追加消息、读额度），不走 `codex-acp`，也不用 Codex SDK。驱动定为：Claude Agent SDK、Codex app-server、通用 ACP（Grok、DeepSeek Harness 及以后的 agent）、一次性命令兜底。ACP 读不到任何一家的套餐额度。
- 2026-10-21 Q15（多个 Codex 并行时的状态库争用）调研见 [codex-concurrency.md](../../../docs/research/codex-concurrency.md)：`state_5.sqlite` 是线程索引，`logs_2.sqlite` 是诊断日志，对话正文在 `CODEX_HOME/sessions/*.jsonl`，`thread/resume` 靠 rollout 文件；`CODEX_SQLITE_HOME` / `-c sqlite_home=` 只挪数据库，登录仍从 `CODEX_HOME` 读；#32160、#26454 仍未修复；vibe-kanban 每次执行起一个 app-server、共用 `~/.codex`（即方案 A），VS Code 扩展和桌面应用一个 app-server 承载多个会话，没有产品复制登录。
- 2026-10-21 Q15：选 D。每个 Codex 执行者一个独立的 `codex app-server` 进程，各用 `CODEX_SQLITE_HOME` 指定自己的数据库目录（只设在 Helm 拉起的进程上，不写进用户的 `config.toml`）；登录和对话记录共用 `~/.codex`，不复制登录。

- 2026-10-22 冲突复核（Claude 驱动）：保留 Claude Agent SDK，补理由。21 和封号调研把"直接拉起 `claude`"当作稳妥的前提；SDK 设 `pathToClaudeCodeExecutable` 后拉起的就是用户本机那份未修改的 `claude`，登录由 `claude` 自己完成，Helm 不读取、不转发凭证；SDK 概览禁止的是"第三方在自己的产品里提供 claude.ai 登录"，Helm 只供用户自用，不提供登录；帮助中心写明订阅登录下 SDK 用量从计划额度扣。这是假设，由 [22](22-driver-and-subscription-trial.md) 实测；扣到 API 或 extra usage 就改用 `claude -p` stream-json。

- 2026-10-22 冲突复核：本单依赖的驱动与订阅前提（原并入 14 的①–④）拆到 [22](22-driver-and-subscription-trial.md)，排在 06 之前实测。

- 2026-10-22 冲突复核：本单定的是架构；交付顺序由 [15](15-v1-slice.md) 定，第一个可运行版本先打通一种驱动。

- 2026-10-22 来自 [22](22-driver-and-subscription-trial.md)：驱动前提实测，没有推翻 04 的选择。Claude Agent SDK 指向本机 `claude` 时 `apiKeySource: none`（未看用量条）；Codex 只设 `CODEX_SQLITE_HOME` 仍是 ChatGPT 登录，新 sqlite 目录能续跑旧 thread，一个 app-server 10 个 thread 真并行、10 个进程也不撞锁；Grok ACP 支持 cancel、load、resume。DeepSeek（dsh ACP）跑通，但默认路线要 API key，用 `dsh web` 登录的账号要在会话里选 `deepseek-account` 路线；它不支持 `session/load`，续跑只能用 `session/resume`。Grok ACP 没有按会话的权限参数，权限跟随用户全局配置，见 07 的评论。
