# Helm 可用的现成底座

调研日期：2026-10-20。只使用当时能打开的官方文档、官方仓库页面和官方 API 文档。GitHub raw 与 `api.github.com` 在本环境被拦截（解析到内网地址），本机 `grok` 二进制也无法执行。读不到的结论单独标出，不补猜。

## 需求对照

| 编号 | 要求 |
| --- | --- |
| R1 | 用户提出需求、边界和测试 |
| R2 | 调度方把需求拆成任务，拆法自由，但必须遵守用户给出的前后依赖 |
| R3 | Codex、Grok、Claude Code 等执行者在隔离环境里跑，最多同时 5 个 |
| R4 | 汇总后交给用户审核验收 |
| R5 | 用户只在提需求和审核时出场，中途不盯终端 |
| R6 | 有界面能看到每张任务单的状态、执行者和当前步骤 |
| R7 | 用户能在中途修改计划和任务单 |
| R8 | 每个问题能追溯到具体 agent 和步骤 |
| R9 | 用户离开后，有后台进程继续跑；可以在本机或服务器；不要求关机后继续 |
| R10 | 先独立运行，并留出以后用 MCP 或 HTTP API 接入 Olympus 的接口 |

反目标：用户仍要盯终端；出问题说不清是谁、在哪一步；为了通用，哪个场景都不如现在好用。

## 1. Orca（stablyai/orca）

一句话：Orca 是带 git worktree 的 agent IDE，编排层用 Run、Task、Dispatch 和决策关卡跟踪多个已有订阅的 CLI agent。

来源：[What is Orca?](https://www.onorca.dev/docs)、[仓库页摘录](https://github.com/stablyai/orca)（README 写 MIT，页面显示约 76.9k stars；未用 API 复核精确数字）、[Changelog](https://www.onorca.dev/changelog) 最新可见版本是 2026-10-17 的 1.4.229。

能覆盖：

- R3 的隔离：每个任务一个 git worktree，并行 agent 不共享同一份工作副本。[Worktrees](https://www.onorca.dev/docs/model/worktrees)
- R3 的多执行者：文档写明可跑 Claude Code、Codex、Cursor CLI，以及 “any other agent CLI”；编排的 `worker-start --agent` 示例包含 codex、claude、antigravity、opencode。Grok 在产品介绍里被列为可用 agent。[What is Orca?](https://www.onorca.dev/docs)、[Orchestration](https://www.onorca.dev/docs/cli/orchestration)、[首页](https://www.onorca.dev/)
- R6 的一部分：worktree 卡片有 comment 和 `todo` / `in-progress` / `in-review` / `completed`；Task 状态是 pending、ready、dispatched、completed、failed、blocked；终端里的 task id 可点回对应 dispatch。实验功能 Agent Dashboard 是跨 worktree 的 agent 看板。[Worktree checkpoints](https://www.onorca.dev/docs/cli/worktree-checkpoints)、[Orchestration](https://www.onorca.dev/docs/cli/orchestration)、[Agents & sessions](https://www.onorca.dev/docs/model/agents-sessions)
- R7 的一部分：`task-update` 可改状态和 result；`gate-resolve` 可记录决策；worktree comment 可改。[Orchestration](https://www.onorca.dev/docs/cli/orchestration)
- R8 的一部分：完成权在 dispatch。`worker_done` 要带 taskId、dispatchId、outcome；`worker-read` 能回读输出。[Orchestration](https://www.onorca.dev/docs/cli/orchestration)
- R9：`orca serve` 不打开桌面窗口；`orca serve service install` 在 macOS 写 LaunchAgent，在 Linux 写 systemd user unit。Remote Orca Server 上，客户端笔记本睡眠后 agent 继续在服务器上跑。Linux 用户服务在登出后会停，除非打开 lingering；Windows 还没有这些 service 命令。[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)、[Ways to run](https://www.onorca.dev/docs/ways-to-run)
- R4 的评审面：diff、行内注释、把注释送回 agent、在应用里提交和开 PR。[What is Orca?](https://www.onorca.dev/docs)、[first session](https://www.onorca.dev/docs/first-session)
- R10 的弱形式：对脚本暴露的是 `orca ... --json` CLI，前提是已经有一个 Orca runtime。文档里的 MCP 是把外部 MCP 配进 agent，不是 Orca 把编排做成对外 MCP。[CLI overview](https://www.onorca.dev/docs/cli/overview)、[Skills & MCP](https://www.onorca.dev/docs/cli/skills)

缺口：

- R2：Task 模型写了 dependencies，状态里有 pending 和 ready，决策关卡可以挡住一个 task。线上编排文档没有给出声明依赖的 flag。调度本身不是 runtime 做的：Run “Never schedules or places workers”。谁在何时派工，靠一个遵守 skill 的协调 agent。依赖是否被遵守，取决于这个 agent，不是硬约束。[Orchestration](https://www.onorca.dev/docs/cli/orchestration)
- R5：默认用法是人在 IDE 里看终端和 diff。协调循环是 `check --wait` 加上 worker 在自己的 pane 里回报。2026-07-22 的 [issue #9951](https://github.com/stablyai/orca/issues/9951) 提出 `--headless`，理由是协调器假定 worker 是可见终端里的 TUI。本次没能打开该 issue 确认是否已合并。2026-10-14 的 changelog 只写到 worker 可以以 native chat 启动，不是无界面子进程。[Changelog 1.4.225](https://www.onorca.dev/changelog)
- R6：Agent Dashboard 在 Settings → Experimental。编排状态的对外查看方式是 CLI JSON，不是一份独立的任务单界面。[Agents & sessions](https://www.onorca.dev/docs/model/agents-sessions)
- R9 的边界：服务活着才继续。文档明确服务器必须醒着、连着网络。不承诺关机后继续。[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)
- R10：没有找到面向第三方的稳定 HTTP 编排 API。`orca serve` 的配对 URL 是给 Orca 客户端用的，文档要求不要把端口直接暴露到公网。[Remote Orca Servers](https://www.onorca.dev/docs/remote-servers)、[CLI reference](https://www.onorca.dev/docs/cli/reference)
- 状态是 runtime 全局的：`reset` 影响整个 runtime 的编排状态，另一个协调器还在时不能随便清。[Orchestration](https://www.onorca.dev/docs/cli/orchestration)
- “同时 5 个”只是营销例句（把一个 prompt 发给五个 agent），文档没有把它写成并发上限。[首页](https://www.onorca.dev/)
- 仓库源码片段曾要求先在 Settings → Experimental 打开编排；2026-10-20 打开的线上编排页没有这句话。两边是否一致，本次没能读仓库文件确认。

接入代价：高，如果把整套 Orca 当 Helm。要装桌面或 `orca serve`，维护配对、账号和仍在变动的实验面（Chat UI、Cloud VM、Agent Dashboard），调度语义还在一个 LLM 协调器上。只借用它的 worktree 和 CLI，代价降到中，但 Helm 仍要自己做依赖、并发上限和审核流。

授权与成本：MIT，软件本身不卖模型。agent 用用户已有订阅。Orca 不提供托管 VPS；远程机器和云账号是用户自己的。Cloud VM 在 Experimental 下，按用户自己的供应商计费。[仓库页](https://github.com/stablyai/orca)、[Ways to run](https://www.onorca.dev/docs/ways-to-run)

成熟度：公开仓库，页面约 76.9k stars。官网 changelog 到 1.4.229（2026-10-17）。最近一次 git commit 时间未能从 API 读取。

## 2. Claude Agent SDK 与 Managed Agents

### Agent SDK

一句话：把 Claude Code 的 agent loop 嵌进你自己的 Python 或 TypeScript 进程，由你负责把这个进程跑起来。

来源：[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)。当前 SDK 版本号 overview 页没有写。包名是 `@anthropic-ai/claude-agent-sdk` 和 `claude-agent-sdk`。[Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)

能覆盖：

- R3 的一个执行者：内置 Read、Write、Edit、Bash 等工具，进程的工作目录就是它能动的代码。[Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- R8 的会话级追溯：消息流里有工具调用；session id 可 resume 或 fork。子代理记录独立于主会话压缩。[Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)、[Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)
- R7 的弱形式：对同一次会话再发 prompt，或 resume 后追加指令。这是对话续写，不是改一张任务图。[Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- R9 的弱形式：会话可以在进程重启后续上，但 SDK 不会自己变成后台服务。宿主进程得由 Helm 拉起。[Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- R10：MCP 是 agent 去连外部工具，不是 SDK 对外提供 Helm API。[Overview](https://code.claude.com/docs/en/agent-sdk/overview)

缺口：

- 只跑 Claude。不能作为 Codex 或 Grok 的执行器。
- 子代理是 Claude 子代理，由主 agent 决定何时派，不是用户依赖图的执行器。文档里的 resume 写法，和 Claude Code 后来改成 `SendMessage` 的行为，曾在 [anthropics/claude-code#35141](https://github.com/anthropics/claude-code/issues/35141) 被指为过时。本次打开的 [platform 子代理页](https://platform.claude.com/docs/en/agent-sdk/subagents) 仍在教 `resume: sessionId`。接入时要以当时的 SDK 类型为准。
- 没有任务单、并发上限、审核界面。
- 工具副作用没有工作流级的“已完成步骤不重跑”。进程死在一次工具调用中途，resume 恢复的是对话，不是恰好一次的步骤账本。
- 第三方产品不能把 claude.ai 登录和额度转售给自己的用户。Quickstart 要求 `ANTHROPIC_API_KEY`，或 Bedrock、Vertex、Foundry、Claude Platform on AWS。[Overview](https://code.claude.com/docs/en/agent-sdk/overview)、[Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)

接入代价：中。库直接调用，但要自己包进程生命周期、worktree、权限回调和计费。权限模式包括 `bypassPermissions`；子代理会继承该模式且不能单独覆盖，官方提醒这等于把完整系统权限交给约束更弱的子代理。[Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)

授权与成本：使用受 [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms) 约束，不是一个可随意再分发的运行时许可证。按 API 或所选云厂商计费，不复用 Claude 订阅额度（第三方产品被明确禁止提供 claude.ai 登录）。

成熟度：Anthropic 正式文档和 GitHub changelog。star 数本次未读 SDK 仓库页。

### Managed Agents

一句话：Anthropic 托管的 Claude agent harness。会话跑在 Anthropic 云沙箱或你自己机器上的 self-hosted sandbox 里，用 API 事件驱动。

来源：[Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview)。Beta header：`managed-agents-2026-04-01`。API 账号默认可用。

能覆盖：

- R5、R9 的单 agent 形态：为长时间、异步任务设计。事件历史存在服务端，SSE 流出；可以中途再发 user event，或发 `user.interrupt`。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)、[Reference](https://platform.claude.com/docs/en/managed-agents/reference)
- R8：事件类型按 `{domain}.{action}` 持久化，可整段拉回。[Reference](https://platform.claude.com/docs/en/managed-agents/reference)
- R3 的隔离：云沙箱，或 self-hosted sandbox。self-hosted 时，`agent_toolset` 的结果要由你的集成回填，SDK 和 CLI 会代做。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)、[Reference](https://platform.claude.com/docs/en/managed-agents/reference)
- R10：REST、语言 SDK、`ant` CLI、远程 MCP（HTTP 或 MCP tunnel）。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)、[Reference](https://platform.claude.com/docs/en/managed-agents/reference)
- 人工确认有 `user.tool_confirmation`，但这是工具权限，不是 Helm 的验收关卡。[Reference](https://platform.claude.com/docs/en/managed-agents/reference)

缺口：

- 只有 Claude。不能调度 Codex 或 Grok。
- 没有用户依赖图、最多 5 路、任务单看板。这些都要 Helm 自己在 session 外面做。
- 有状态，因此目前不能进 Zero Data Retention，也不在 HIPAA BAA 范围内。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)
- 组织级限速：创建类 300 次/分钟，读取类 1200 次/分钟，另外还受账户消费层级限制。[Reference](https://platform.claude.com/docs/en/managed-agents/reference)
- MCP tunnel 和 dreaming 仍是更窄的 research preview，要另外申请。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)
- 关机后是否继续，取决于 Anthropic 云沙箱仍在跑，或你的 self-hosted worker 仍在跑。文档把“服务器关机”排除在承诺之外的原文，本次没有读到；能确认的是会话设计为可暂停后续跑。[Overview](https://platform.claude.com/docs/en/managed-agents/overview)

接入代价：中。协议完整，但执行环境、计费和数据保留都绑在 Anthropic API 上，而且替代不了多 CLI。

授权与成本：Claude API key，按 API 计费。没有“复用 Claude 订阅”的写法。

成熟度：公开 beta，无 star。文档在 2026 年仍以 beta header 为必填项。

## 3. Codex app-server 与 Codex SDK

一句话：在本机编程启动、观察和恢复 Codex 线程的接口。SDK 适合脚本和 CI；app-server 适合要自己处理审批和事件流的客户端。

来源：[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App Server](https://learn.chatgpt.com/docs/app-server)。Python SDK `openai-codex` 文档标为 stable，并自带固定版本的 Codex CLI。TypeScript 包是 `@openai/codex-sdk`，要求 Node.js 18+。`openai/codex` 的 star 数本次未读。

能覆盖：

- R3 的 Codex 执行者：`thread/start` 或 `startThread`，`turn/start` 或 `run()`。可指定 cwd、sandbox、approvalPolicy。Python 侧沙箱预设有 read_only、workspace_write、full_access。[SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App Server](https://learn.chatgpt.com/docs/app-server)
- R8：turn 期间有 `item/started`、`item/completed`、命令、文件变更和 `turn/completed`。客户端要自己把这些事件记到任务单上。[App Server](https://learn.chatgpt.com/docs/app-server)
- R7 的弱形式：同一线程再 `run()`，或 `turn/steer` 往进行中的 turn 追加输入；`thread/resume`、`thread/fork` 恢复或分叉。[SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App Server](https://learn.chatgpt.com/docs/app-server)
- R9 的弱形式：线程存在本机，进程重启后可以 resume。监听和收事件的进程必须还在。远程 TUI 可以 `codex app-server --listen ws://...` 再 `codex --remote`，但文档写明 WebSocket 传输是实验性的，不支持生产；非本机地址默认还不强制认证，暴露前要自己配 token。[App Server](https://learn.chatgpt.com/docs/app-server)
- R10：stdio JSON-RPC 是稳定接入面。旧的 `codex mcp-server` 和独立二进制已经删除，文档要求改走 app-server。[SDK](https://learn.chatgpt.com/docs/codex-sdk)

缺口：

- 不是调度器，没有任务图、依赖、并发上限、审核界面、worktree 管理。
- resume 不构成“步骤恰好一次”。已完成的线程历史会接上，崩溃时没记完的工具副作用要靠 Codex 自己的会话，不靠一份工作流账本。
- app-server 的 WebSocket 不能当 Helm 的对外 API。
- 模型是否可用取决于登录账号。文档示例用的 `gpt-6.1-sol` 必须账号有权限，否则要省略 model 或先 `model/list`。[SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App Server](https://learn.chatgpt.com/docs/app-server)

接入代价：低到中。低是只包一层 `thread.run` 和记 thread id。中是自己消费 app-server 事件、做审批和 worktree。

授权与成本：CLI 开源。两种登录：ChatGPT 订阅（Plus、Pro、Business、Edu、Enterprise 含 Codex），或 API key 按 [API 价格](https://developers.openai.com/codex/auth) 计费。API key 不走套餐内额度，部分依赖 ChatGPT workspace 的功能不可用。自动化更推荐 API key。ChatGPT Business / Enterprise 另有 Codex access token，用 `CODEX_ACCESS_TOKEN`。[Authentication](https://developers.openai.com/codex/auth)、[CLI](https://developers.openai.com/codex/cli)、[Access tokens](https://developers.openai.com/codex/enterprise/access-tokens)

成熟度：官方当前接口。app-server 实现在 [openai/codex 的 app-server 目录](https://github.com/openai/codex/tree/main/codex-rs/app-server)。具体 release 号本次未读。

## 4. Grok CLI 无头模式与会话恢复

一句话：Grok Build 的本机执行器。无头时用一次 prompt 跑完，会话落在磁盘上，可以按 id 续跑；它不是多 agent 任务系统。

来源：[Headless](https://docs.x.ai/build/cli/headless-scripting)（页脚 2026-06-10）、[Sessions](https://docs.x.ai/build/features/sessions)（页脚 2026-07-21）、[CLI reference](https://docs.x.ai/build/cli/reference)。npm 包 `@xai-official/grok` 页面显示 1.0.62，标注 2026-10-16。CLI 不是公开源码仓库，没有 star。本机 `grok --version` 未能执行。

能覆盖：

- R3 的 Grok 执行者：`grok -p`、`--cwd`、`--output-format json|streaming-json`、`--always-approve`、`--sandbox`、`--max-turns`、`--no-subagents`。[Headless](https://docs.x.ai/build/cli/headless-scripting)、[CLI reference](https://docs.x.ai/build/cli/reference)
- R3 的隔离：`grok -w` / `--worktree` 在 `~/.grok/worktrees/<repo>/<name>` 开独立 git checkout，默认从当前 HEAD 带上未提交改动；`--ref` 可以干净地从某个 ref 起。结束会话不会删 worktree。[Worktrees](https://docs.x.ai/build/features/worktrees)
- R8：会话自动保存 prompt、回复、工具调用和文件快照到 `~/.grok/sessions/`。`grok export` 导出 Markdown。JSON 输出含 `sessionId`。[Sessions](https://docs.x.ai/build/features/sessions)
- R7 的弱形式：`-r` / `--resume` 续同一会话；`--fork-session` 分叉。这是续对话，不是改任务图。[Sessions](https://docs.x.ai/build/features/sessions)、[CLI reference](https://docs.x.ai/build/cli/reference)
- R9 的弱形式：无头进程自己就是后台进程。人离开后它会跑到结束；进程被杀掉之后，监督方可以用 session id 再拉起。文档没有写“进程死后从工具步骤中间恢复且不重复副作用”。
- R10：`grok agent stdio` 是 ACP JSON-RPC。另有文档 MCP `https://docs.x.ai/api/mcp`，那是查文档，不是控制会话。[Headless](https://docs.x.ai/build/cli/headless-scripting)、[Docs MCP](https://docs.x.ai/developers/docs-mcp)
- 内部子代理和 workflow：子代理是独立子会话；workflow 用 Rhai 在一个 Grok 里做有界 fan-out，TUI 里有 `/workflows` 看板。可用 `GROK_WORKFLOWS=0` 或 `--no-subagents` 关掉。这是一个 Grok 进程内部的能力，不是 Helm 要的跨 CLI 调度。[Subagents](https://docs.x.ai/build/features/subagents)、[Modes and Commands](https://docs.x.ai/build/modes-and-commands)

缺口：

- 不拆用户依赖，不限制同时 5 个外部执行者，没有跨 Codex/Claude 的任务单。
- `--prompt-file` 在本次读到的 Headless 页和 CLI reference 里都没有。文档给出的提示入口是 `-p`。本机 help 没跑成，所以不能确认二进制是否另有该 flag。
- `-s` 的官方说明互相矛盾。Headless 页写 “Create or resume a named headless session”。更新的 Sessions 页和 CLI reference 写：`-s` 只给新会话指定 UUID，不恢复旧会话；恢复用 `-r`。接入应以 Sessions 页和 CLI reference 为准，并在实现时用一次真实调用核对。
- `/loop` 最多 50 个、7 天后过期，而且绑在会话里，不是持久任务队列。[Background Tasks](https://docs.x.ai/build/features/background-tasks)
- rewind 会改磁盘文件，没进 git 的修改会丢。[Sessions](https://docs.x.ai/build/features/sessions)

接入代价：低。Helm 已经按 CLI 调用它。要补的是监督进程、worktree 生命周期，以及把 streaming-json 记到任务单。

授权与成本：浏览器登录，或 `XAI_API_KEY`。无浏览器环境用 API key。[Overview](https://docs.x.ai/build/overview)。定价页写 Grok 4.7 Fast 只在 Cursor 和 Grok Build 里提供，走那里的套餐，不在公开 API 上，Grok Build 免费档不包含它。[Pricing](https://docs.x.ai/developers/pricing)。因此：交互登录可以走 SuperGrok / X Subscription 的用量池；CI 式 API key 走 API 价。

成熟度：闭源 CLI，npm 1.0.62（2026-10-16）。文档页面更新时间从 2026-06 到 2026-10 不等，Headless 页旧于 Sessions 页。

## 5. 持久化执行：Temporal、DBOS、Huey SqliteHuey

这三层都不认识 Codex 或 Grok。它们负责的是：进程死了之后从哪一步接着做、重试时已完成的步骤还跑不跑、人没回来时流程停在哪里。

### Temporal

一句话：独立的 durable execution 服务。Workflow 的历史在服务端，Worker 崩溃后按历史重放，已记录完成的 Activity 不重新执行。

来源：[README](https://github.com/temporalio/temporal)（MIT，仓库页约 23.8k stars，检索结果标注 2026-10-19）、[How it works](https://temporal.io/how-it-works)、[Activity definition](https://docs.temporal.io/activity-definition)、[Human-in-the-loop recipe](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)。最新 release tag 本次未读。

能覆盖：

- R9：Worker 挂了，另一个 Worker 按历史接着做。本地有 `temporal server start-dev`。等待人工时不占计算。[HITL recipe](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)
- R2 如果 Helm 把依赖写成 Workflow：未满足的步骤不会被调度。这是代码里的图，不是给模型自由拆分后再强制校验。
- R4 / R7 的等待：Signal 把人的决定送进已经暂停的 Workflow，定时器在进程重启后仍有效。[HITL recipe](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)、[Signals 教程](https://learn.temporal.io/tutorials/ai/building-durable-ai-applications/human-in-the-loop/)
- R8：Web UI 能按事件看每一步。Activity 重试是至少一次：Worker 在外部成功之后、向服务报告之前崩溃，Activity 会再跑。完成一旦被记入历史，就不会因为重放再执行。业务副作用要自己用幂等键。[Activity definition](https://docs.temporal.io/activity-definition)、[Error handling](https://docs.temporal.io/develop/python/error-handling)
- Signal 也是至少一次，文档要求调用方自带 id 去重。[Recover without restart](https://docs.temporal.io/guides/recover-without-restart)

缺口：

- 没有 agent、worktree、任务单 UI。Temporal UI 看的是 Workflow 历史。
- R7 难：人要改的是“计划”，而 Workflow 必须确定。进行中的图若改了步骤顺序，旧历史对不上新代码。本次没有读到 Temporal 的升级指南全文，不能把 DBOS 的 patch/version 机制安到 Temporal 上。
- 单个 Workflow 历史有上限。文档给出的批量例子写 51,200 个事件为硬上限，并建议目标约 2,000。[Batch iterator](https://docs.temporal.io/design-patterns/batch-iterator)
- 生产自托管要跑 Temporal Server 和它的存储。本次没打开数据库选型页，不写具体引擎。开发服务器一条命令能起，不能把它当成服务器部署方案。

接入代价：高，如果自托管一套集群给个人 Helm。中，如果只用 dev server 或 Temporal Cloud，并把 Helm 的任务图限制成少量 Workflow。Cloud 是付费服务，本次没打开价目页。

授权与成本：服务端 MIT。Cloud 另计费。模型费用仍在各个 agent 上，Temporal 不包含模型额度。

成熟度：高。约 23.8k stars，MIT，文档在 2026-10 仍在更新。

### DBOS

一句话：嵌在应用里的库。用 Postgres（部分语言也可用 SQLite）给函数做检查点，没有单独的编排服务器。

来源：[Architecture](https://docs.dbos.dev/architecture)、[Why DBOS](https://docs.dbos.dev/why-dbos)、[HITL](https://docs.dbos.dev/ai/hitl)。Python 仓库页 [dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py) 显示约 1.6k stars。库的 LICENSE 文件本次没打开，不写 SPDX。Conductor 自托管是专有许可证，要 license key；生产和商业使用要付费协议。[Self-hosting Conductor](https://docs.dbos.dev/production/hosting-conductor)

能覆盖：

- R9：崩溃后从最后一个已检查点的步骤恢复。单机在启动时扫描 PENDING。多进程要 Conductor 或自己做恢复。[Architecture](https://docs.dbos.dev/architecture)
- 重试不重复已完成步骤：步骤一旦写入检查点就不再执行。失败中的步骤会在恢复时重跑，所以步骤要幂等。Workflow 函数必须确定。[Architecture](https://docs.dbos.dev/architecture)
- R4 的等待：`DBOS.recv(timeout_seconds=...)` 可以等数小时或数天，超时和通知都在数据库里。[Why DBOS for agents](https://docs.dbos.dev/explanations/why-dbos-agents)
- R6 的原料：workflow 状态可查询。官方 agent inbox 例子用事件给前端显示“谁在等哪个人”。那是示例应用，不是现成的 Helm 界面。[Agent inbox](https://docs.dbos.dev/python/examples/agent-inbox)
- 轻量：Go SDK 的系统库可以是 SQLite URL；Python 的 OpenAI Agents 示例用 `sqlite:///my_agent.sqlite`，并写明 Postgres 才是生产建议。[Go upgrading](https://docs.dbos.dev/golang/upgrading)、[OpenAI Agents integration](https://docs.dbos.dev/integrations/openai-agents)

缺口：

- 和 Temporal 一样，不负责拆需求、跑 CLI、做 worktree。
- R7：进行中的 workflow 若改了步骤顺序，旧检查点对不上。官方有 patch 和 version 两种升级办法，这是部署问题，不是让用户在界面上改任务单。[Architecture](https://docs.dbos.dev/architecture)
- 架构总述仍写 “built on top of Postgres”“除了 Postgres 不需要别的基础设施”。SQLite 是单机系统库，不是文档里的分布式方案。Java 配置页只写了 Postgres JDBC。[Architecture](https://docs.dbos.dev/architecture)、[Java prompting](https://docs.dbos.dev/java/prompting)
- 检查点保存输入和输出。大文件进检查点会放大写入。官方建议步骤只存指针。[Architecture](https://docs.dbos.dev/architecture)
- 多执行器可能同时碰到同一 workflow。库用所有权令牌挡住后写的检查点；步骤语义仍是至少一次，workflow 结果按记录只提交一次。[Concurrent executions](https://docs.dbos.dev/explanations/concurrent-executions)

接入代价：中。比 Temporal 轻，因为应用进程自己连数据库。个人单机用 SQLite 可以再低一档，但要接受它不是多副本方案。Conductor 不是必选。

授权与成本：库是开源安装（SPDX 未核对）。数据库自备。Conductor 自托管另要专有许可。模型费用不在 DBOS 里。

成熟度：库可用，Python 仓库约 1.6k stars。文档更新到 2026-10。比 Temporal 年轻一个数量级。

### Huey 的 SqliteHuey

一句话：一个进程内可嵌的任务队列。SqliteHuey 把队列放在一个 SQLite 文件里，另起 consumer 进程执行。

来源：[Guide](https://huey.readthedocs.io/en/latest/guide.html) 与 [contrib](https://huey.readthedocs.io/en/latest/contrib.html)，文档版本 huey 3.4.0。许可证本次没打开。

能覆盖：

- R9 的最薄形态：任务进 SQLite，consumer 进程在用户离开后继续跑。`retries`、`retry_delay`、`retry_backoff` 控制失败重试。还没开始的任务可以 revoke。[Guide](https://huey.readthedocs.io/en/latest/guide.html)
- 并发：consumer 的 worker 数可配。Helm 的“最多 5 个”可以设成 worker 数，但隔离和依赖要自己做。

缺口：

- 重试的是整段任务函数，没有“函数执行到一半，已完成的前几步跳过”。
- 没有人工等待原语。revoke 是取消，不是把流程停在审核关卡。
- 没有执行历史 UI，没有 agent 身份。
- 官方指南没有写崩溃时的恰好一次。按队列的常规读法，任务被取出后进程死亡，是否再次入队要看存储实现；本次没有读到 SqliteHuey 的崩溃语义段落，不把“至少一次”写成已证实。

接入代价：低。它只配做 Helm 自己的待执行队列，配不上 R2、R6、R8。

授权与成本：本地库加一个 SQLite 文件。无模型费用。许可证未核对。

成熟度：文档站在 3.4.0。star 和最近提交本次未读。

## 补充：Vibe Kanban

为什么补：它是公开文档最完整的“看板 + 多个 coding agent + 每任务一个 git worktree”产品，和 Helm 的界面、隔离、审核三件事直接重叠。Orca 更像 IDE，Vibe Kanban 更像任务板。本次还看到 Kander、Orchestrator.inc 等同类仓库，没有逐个读完，不另写，以免用 README 宣传句代替限制。

一句话：本地看板。建 issue，开 workspace，在独立 worktree 里跑一个已登录的 coding agent，再在界面里看 diff。

来源：[仓库页](https://github.com/BloopAI/vibe-kanban)（约 28.4k stars，Apache-2.0）、[首页](https://vibekanban.com/)、[Creating workspaces](https://vibekanban.com/docs/workspaces/creating-workspaces)、[Supported agents](https://vibekanban.com/docs/supported-coding-agents)、[MCP server](https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server)。最近提交时间未读。

能覆盖：

- R6：看板 issue，workspace 里看 agent。文档的 llms 索引在 2026-10-02 仍在。[llms.txt](https://vibekanban.com/docs/llms.txt)
- R3：创建 workspace 时做 git worktree 和分支，原仓库不动。支持列表里有 Claude Code、Codex、Copilot、Gemini、Amp、Cursor、OpenCode、Droid、CCR、Qwen。没有 Grok。[Creating workspaces](https://vibekanban.com/docs/workspaces/creating-workspaces)、[Supported agents](https://vibekanban.com/docs/supported-coding-agents)
- R4：界面里看 diff、行内评论、开 PR。评论如何送回 agent，以仓库 README 的产品描述为准；本次没单开一篇“评论协议”页。
- R9：`npx vibe-kanban` 起本地服务和 Web UI。文档另有 Docker Compose 自托管页。进程在，工作就在。
- R10 的一部分：本机 MCP，`npx vibe-kanban@latest --mcp`。工具覆盖组织、项目、issue、workspace 和任务执行。文档写明只给本机客户端，不能用公网 URL 访问。[MCP server](https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server)
- 成本：软件 Apache-2.0。agent 用各自的登录或 API key。

缺口：

- 首页写 “Vibe Kanban is sunsetting. The project will continue as open source and community maintained.” 公告正文本次没打开，云账号、组织同步哪些还在，不能下结论。文档索引仍列着 Cloud 自托管，和首页的 sunset 并存。
- 支持列表没有 Grok。Helm 的三个执行者缺一个。
- 同一 workspace 里的多个 session 共享文件，只是对话彼此看不见。并行隔离单位是 workspace，不是 session。[Sessions](https://vibekanban.com/docs/workspaces/sessions)
- 没有读到“用户给定的前后依赖必须被调度器遵守”。看板可以人工排，这不等于 DAG 约束。
- MCP 是本机 stdio，不是给 Olympus 用的远程 HTTP API。
- 公司停止运营后，界面和 agent 适配要靠社区。这是维护代价，不是功能清单。

接入代价：高，如果把 Helm 做成它的一层皮肤。产品边界、sunset 和缺 Grok 都在。中，如果只参考它的 workspace 模型，自己留任务库。

## 汇总

| 候选 | 能当什么用 | 覆盖的要求 | 主要缺口 | 接入代价 |
| --- | --- | --- | --- | --- |
| Orca | 隔离、执行者接入、界面；编排记录，不是确定性调度 | R3、R6 一部分、R7 一部分、R8 一部分、R9、R4 的 diff | 依赖靠协调 agent；Run 不派工；无公开 HTTP API；worker 仍是终端或 chat | 高（整套）／中（只借用 CLI） |
| Claude Agent SDK | Claude 执行者接入 | R3 的 Claude、R8 的会话、R9 要自备进程 | 不是多 CLI；无任务图和看板；API 计费；子代理 resume 文档可能过时 | 中 |
| Managed Agents | Claude 的托管执行与事件流 | R5/R9 的单 Claude 会话、R8、R10 的 REST/MCP | 不能跑 Codex/Grok；无依赖图；beta；不能 ZDR | 中 |
| Codex SDK / app-server | Codex 执行者接入 | R3 的 Codex、R8 的 turn 事件、resume | 无调度和 worktree；WebSocket 非正式生产接口；工具步骤不是恰好一次 | 低到中 |
| Grok CLI | Grok 执行者接入、单机 worktree | R3 的 Grok、R8 的会话文件、resume | 无跨 CLI 调度；`--prompt-file` 文档未列；`-s` 两处文档矛盾 | 低 |
| Temporal | 持久化、人工等待、历史 | R9、R2（若图写在代码里）、R4 的等待、R8 | 不跑 agent；改进行中的图成本高；自托管重 | 高（自托管）／中（Cloud 或 dev server） |
| DBOS | 持久化、人工等待；SQLite 可单机 | 同 Temporal，范围更小 | 同样不跑 agent；改步骤顺序要 patch/version；多副本仍要 Postgres | 中；单机 SQLite 更低 |
| Huey SqliteHuey | 持久化队列 | R9 的进程级队列、有限重试 | 无步骤检查点、无人工关卡、无追溯界面 | 低 |
| Vibe Kanban（补充） | 界面、隔离、执行者接入、本机 MCP | R3 的一部分、R6、R4、R9、R10 的本机 MCP | 支持列表无 Grok；同 workspace 的 session 共享文件；未见依赖约束；项目在 sunset | 高（当底座）／中（只参考） |

## 可以怎么组合

Helm 自己留一张任务图：依赖是硬约束，同时运行不超过 5，状态写在 DBOS 的 SQLite 系统库里。单机、用户还在登录会话里时，这比架 Temporal 集群更接近“人离开但机器还开着”。审核停在 `recv` 上，已检查点的步骤不重跑；每个执行步骤仍要幂等，因为崩溃在检查点之前会再执行。

执行者分开接，不经过 Orca 或 Vibe Kanban。Codex 用 SDK 或 app-server 的 stdio，记下 thread id 和 item 事件。Grok 用 `-p`、`-r`、`--cwd`、`--worktree` 和 `streaming-json`，session id 从 JSON 读取；不要依赖 Headless 页对 `-s` 的旧解释，也不要假设文档里有 `--prompt-file`。Claude 用 Agent SDK 或 CLI 的 `-p`。三者各自一个 git worktree。Managed Agents 只在某张任务明确要 Anthropic 沙箱、并且接受 API 计费时使用。

界面读这张任务表，不读 Orca 或 Vibe Kanban 的界面。那两个产品的界面假定人留在 IDE 或看板里盯 agent，和“只在提需求、审核时出场”相反。以后给 Olympus 的接口是 Helm 自己的 HTTP 和 MCP。Codex app-server、Grok ACP、Vibe Kanban 的本机 MCP、Orca 的配对协议都是执行器或产品私有通道，不能当成平台 API。
