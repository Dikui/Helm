# 怎样以非终端方式与 CLI 交互，以及更多同类产品的做法

Type: research
Status: resolved
Labels: wayfinder:research
Blocked by: 18
Map: [Helm v1 设计](../map.md)

## Question

用户需要与调度者（必要时也与执行者）持续对话，但不通过终端交互。官方 CLI 有哪些非终端的交互通道（如 `codex app-server`、`claude -p --input-format stream-json`、ACP 适配器、Grok 的对应方式），各自能否中途追加指令、中断、续跑，是否仍走订阅登录？普通 spawn、PTY、tmux、常驻协议进程各有什么优缺点？在 [18](18-reference-runtime-stack-research.md) 的产品清单之外，主动检索更多同类产品（含 Todos），看它们的语言、进程组成、存储、实时推送和自启动方式。结论交给 [技术栈与进程结构](04-tech-stack.md)。

## Answer

调研结论见 [interactive-drive-and-landscape.md](../../../docs/research/interactive-drive-and-landscape.md)（Grok，2026-10-21，一手来源；新增 Todos、Conductor、Claude Squad、Sculptor、Emdash、Superset、Nimbalyst、CAO、Catnip、Agent Teams、Codex 桌面应用）。

- **非终端交互通道**：Codex `codex app-server`（stdio JSON-RPC）同一进程多轮，能 `turn/steer` 追加、`turn/interrupt` 中断、`thread/resume` 续跑，审批可设 `approvalPolicy: "never"`；Claude `claude -p --input-format stream-json --output-format stream-json`，进行中的消息排到下一轮，SIGINT 中断，不加 `--bare`；Grok `grok agent stdio`（ACP）同一进程多轮，`cached_token` 走本机登录，未找到运行中追加。Todos 的执行端正是用 app-server 和 Claude Agent SDK 驱动。
- **拉起方式**：PTY 和 tmux（Orca、Superset、Claude Squad、CAO、Emdash）是为了把官方 TUI 留给人看，状态靠钩子或读屏幕；要结构化事件和界面内对话，对齐的是常驻协议进程（Todos、Zed ACP、codex plugin-cc）。
- **建议**：调度者用常驻协议进程；执行者默认一次性 spawn（`codex exec`、`claude -p`、`grok -p`），只有派单期间需要收消息才升级为协议进程；不用 PTY/tmux。TS/Node、单个常驻运行层、用户数据目录存状态、SSE 在更大范围内仍成立；Go（Claude Squad、Catnip）和 Python（CAO）也有，"Node 够用"成立、"必须 Node"不成立。自启动多数产品不做，Todos `tds start` 自带后台监督，Superset 给 systemd 例子。
- **待实测**：`codex app-server` 无 API key 时是否读 ChatGPT 登录；`claude -p` stream-json 输入下进程是否在第一条结果后继续收消息；`grok agent stdio` 是否支持 `session/cancel`、`session/load`。

## Comments
