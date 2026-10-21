# 派单结果、成果与实时状态

调研日期：2026-10-21。只使用当天打开的官方文档和官方 API 说明。二手文章只出现在检索结果里，不作为依据。查不到的写「未找到」，不补成事实。

Helm 现有决定：执行者只交一份派单结果（完成 / 失败 / 缺信息，加几句说明），调度者只读这份结果；代码改动、文件和测试输出由运行层保存，挂在卡片和工作上给用户看，调度者需要时再读；整项工作的实时状态由运行层从事件推导；审核前调度者写一份汇总报告，只写结论和指向成果的链接。

覆盖了 11 个对象。编码产品大多没有「调度模型」这一角色，调用方是人或 API。下面把「谁默认读到什么」按这个差别写清。

## 结论

交回上游的默认物，几乎都是一段最终文本，不是工具轨迹。Claude Code 子代理、LangGraph 现在推荐的子代理、OpenAI Agents SDK 的 `Agent.as_tool()`、Codex `exec` 的 stdout、Orca 的 `worker_done` 正文，都是这个形状。长度上限多数未写明。结构化状态不是默认：Codex 要调用方自己给 JSON Schema，Devin 要 playbook 或提示里带 schema。固定的「完成 / 失败 / 缺信息」三态，这些页面里没有同一套枚举。缺信息通常是另一条通道：Orca 的 `ask`、Devin 的 `waiting_for_user`、Claude agent view 的 Needs input。

成果和这段文本是分开的。代码在工作区、分支或 PR 上；会话全文在独立记录里（Claude 的 `agent-{id}.jsonl`、Copilot 的 session log、OpenHands 的 `events/`、Cursor 的 stream）。默认不进上游上下文。要看过程，调用方再去读：Orca `worker-read`、Copilot Chat 在被问到时拉取 session log、Cursor 另调 artifacts 或 SSE。Anthropic 研究系统的附录把这写成设计建议：子代理把产物写到外部系统，只把轻量引用交回协调者。

实时状态分成两层，很多产品两层都有。进程是否还在跑、是否在等人，由系统从运行情况给出：OpenHands 的 `execution_status`、Cursor 的 run status、Devin 的 `status` / `status_detail`、Claude agent view 的行状态、Orca dispatch 的 runtime-confirmed 完成。任务清单、计划、进度说明，则经常由模型自己写：Claude 的 Task 工具、Orca 的 `task-update`、LangGraph 的图状态、Devin 的 structured output、Factory 的编排代理。用户看的是会话列表、PR、diff 或 Mission Control，不是调度模型的上下文。

## 对比

| 产品 | 交回上游的结果 | 上游默认读什么 | 成果放哪、谁看 | 实时状态谁维护、用户在哪看 |
| --- | --- | --- | --- | --- |
| Claude Code 子代理 | 最终报告，作为 Agent 工具结果；可标 partial | 只有这份报告。中间工具调用留在子会话 | 改动在工作区或临时 worktree；全文在 `~/.claude/projects/.../subagents/agent-{id}.jsonl` | 面板和 `/tasks` 由程序显示行状态。任务清单由模型用 Task 工具写。用户在终端 |
| Claude Code Agent Teams | 队友不把结果当工具返回。空闲时程序把最终回答通知主管 | 主管收到这条通知和邮箱里的消息 | 各自会话。任务目录 `~/.claude/tasks/{team-name}/` 会话结束后仍在 | 任务三态由持有 Task 工具的代理改。依赖解除和空闲通知由程序做。用户看代理面板，Ctrl+T 看任务 |
| Codex `exec` | stdout 只有最终消息。`--output-schema` 时为调用方定义的 JSON | 不读 JSONL，除非加了 `--json` | 文件在工作区。`--json` 的 item 里另有 file changes。rollout 默认落盘 | 进度在 stderr，或在 JSONL 事件里。没有官方任务看板 |
| Codex 云任务 | 结束时给用户一段回答加 diff | 没有调度模型。本地对话可接着做 | diff；PR 由用户开 | 在 Codex 界面或 IDE 里跟进度。未找到云任务状态枚举 |
| GitHub Copilot cloud agent | 没有交回编排模型的固定结果。对人是会话、diff、有的路径还有 PR | Chat 被问到时才拉 session log | 临时云环境里改代码并推分支；环境销毁后日志留在 GitHub | 会话列表、PR 时间线由 GitHub 记。用户在 Agents 页、IDE 或 PR 上看 |
| Cursor Cloud Agents | 终态 run 的 `result` 是最终助手文本 | API 调用方默认拿到这段文本，加上该 agent 当前的 git 快照 | 分支 / PR 在 `git`；`artifacts/` 另列，下载是 15 分钟预签名 URL | agent 状态 ACTIVE / IDLE / ARCHIVED，run 状态另计。用户看 `url` 指向的页面，或接 SSE |
| Devin | 会话没有单独的「最终消息」字段。消息是全文列表。可另有校验过的 `structured_output` | 协调会话在子会话结束或需要输入时被唤醒。唤醒载荷的长度未找到 | `pull_requests[]` 挂在会话上。子会话各自一台隔离 VM | `status` 与 `status_detail` 由服务给出。structured output 由模型按 schema 写。用户在会话页 |
| OpenHands | 没有独立的派单结果。模型看见的是可转换事件，最后往往是一条 Message | 同一会话默认带着这些事件 | 工作区文件；工具结果在事件里。持久化为 `base_state.json` + `events/` | `execution_status` 由 agent-server 推送。用户或集成方看 WebSocket |
| Factory Missions | 未找到 worker 交回编排器的字段或长度 | 未找到编排器是否默认读 worker 终端 | 功能上有提交；worker 有终端输出。用户在 Mission Control 里点开 | Mission Control 显示进度。编排器是可对话的代理。未找到状态是事件推导还是模型写入 |
| Orca | `worker_done`：`succeeded` 或 `failed`，加短 `--body`，可带 `--files-modified` | 协调者 `check` 等这几类消息。终端要用 `worker-read` | 终端输出可归档后再读。文件名单写在完成消息上 | Task 状态可由 `task-update` 改。Dispatch 完成由 runtime 确认。用户看 worktree 和完成通知 |
| LangGraph 子代理 | 工具结果默认是子代理最后一条消息 | 监督者只看见这份输出，除非包装代码另附状态 | 框架不提供代码成果库。额外状态要放进图状态 | 图状态由节点和工具写入，checkpointer 持久化。子代理若在工具函数里调用，`get_state` 看不到它的内部状态 |
| OpenAI Agents SDK | handoff 移交控制权和历史，不交回一份结果。`as_tool` 把嵌套运行的最终输出当工具结果 | handoff 后接收方默认看见此前对话。`as_tool` 的父代理看见工具结果字符串 | 无内置成果库。轨迹在 `new_items`，由调用方决定是否给模型 | 流式的 `current_agent`、`new_items`。无任务看板 |
| Anthropic 研究系统 | 子代理把发现交回 lead。附录建议外部产物只回轻量引用 | lead 综合这些发现，再整包交给 CitationAgent | 研究产物在报告和引用里。附录建议子代理把大产物写到外部系统 | lead 把计划写入 Memory。没有用户任务看板。用户看到的是最终带引用的报告 |

## Claude Code：子代理与 Agent Teams

来源：[Subagents](https://code.claude.com/docs/en/sub-agents)、[Agent teams](https://code.claude.com/docs/en/agent-teams)、[Run agents in parallel](https://code.claude.com/docs/en/agents)、[Agent view](https://code.claude.com/docs/en/agent-view)、[Tools reference](https://code.claude.com/docs/en/tools-reference)、[Interactive mode](https://code.claude.com/docs/en/interactive-mode)。访问日期 2026-10-21。

子代理在自己的上下文里干活，中间的工具调用和结果留在子会话。父会话收到的是最终消息，文档也称作最终报告。父代理可以在自己的回复里再摘要一次。要让用户原样看到子代理原文，得在主会话的提示里要求保留。未找到这份报告的字符或 token 上限。

到达父代理之前，程序会先扫描。扫描不删改措辞：模仿控制标签的文本会被插入反斜杠，并可能在前面加一行 `[harness: ...]` 标记。v2.1.210 起就有这次扫描。auto 模式下，本地、非 fork 的子代理还要经 `SubagentHandback`：分类器先审阅报告，再交给接收结果的那个会话（v2.1.271 起）。

失败和截断有单独形状，不是一份普通完成报告。`maxTurns` 用尽时，返回的输出标成 partial（v2.1.246 起），Claude 可以 resume。前台子代理若因限速、过载或服务器错误中断，已经写出的文字会连同一句「被截断、没做完」交回；只有工具调用、没有文字时，Agent 工具报错。后台子代理被标成失败，交回的消息里写明 API 错误，并带上最后一段输出。

全文在独立文件：`~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`。主会话压缩不影响这些文件。默认保留后按 `cleanupPeriodDays` 删除，默认 30 天。完成的后台子代理会立刻从输入框下的面板消失，并在 `/tasks` 里以 done 再留约 30 秒，期间可以打开 transcript。用户平时不看这份 jsonl。

代码改动发生在当前工作区，或 `isolation: worktree` 的临时 git worktree。没有改动的 worktree 会清掉。未找到父代理在收到报告后被要求再去读 diff 的说明。后台 Bash 的输出写到文件，Claude 用 Read 自己去取；这和子代理结果被推进父会话不是同一条路径。`TaskOutput` 已在 v2.1.277 删除，背景任务改读输出文件。

Agent Teams 实验开关默认关。队友不把结果返回成工具结果，彼此用 `SendMessage` 通信。邮箱是 `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`。队友结束并停下来时，程序自动通知主管，通知里包含它的最终回答；因 API 错误结束则通知失败并带上错误文本。未找到这条最终回答的长度上限。`SendMessage` 可选的一行预览超过 200 字会被截断，那是预览，不是正文。

共享任务有三态：pending、in progress、completed，并可依赖其他任务。有 Task 工具的代理用 `TaskCreate` / `TaskUpdate` 改状态；没有这些工具的代理改用消息协调。依赖解除由程序做：一个任务完成，依赖它的任务会被放开。任务认领用文件锁。任务目录在 `~/.claude/tasks/{team-name}/`，会话结束后还在。团队配置目录在会话结束时删除。用户在主管终端的代理面板里看队友，Ctrl+T 打开任务列表，也可以点进某个队友的 transcript。文档写明：长时间无人看着跑，浪费工作的风险会上升。

Agent view（`claude agents`）是另一条路：人自己派后台会话。这些会话把结果报告给人，不报告给另一个 Claude。[并行代理页](https://code.claude.com/docs/en/agents)写明这个差别。行状态由界面给出：Working、Needs input、Idle、Completed、Failed、Stopped。Needs input 包括等人回答、权限、沙箱或 MCP 的输入。这层状态不是模型写进清单的。单会话里的任务清单则是模型用任务工具写的，存在 `~/.claude/tasks/`，可用 `CLAUDE_CODE_TASK_LIST_ID` 跨会话共享；没有这些工具的模型默认不写清单。

## OpenAI Codex：`exec` 与云任务

来源：[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[Cloud environments](https://developers.openai.com/codex/cloud/environments)、[IDE cloud tasks](https://developers.openai.com/codex/ide/cloud-tasks/)。访问日期 2026-10-21。云环境页当天打开时标题带 “Codex Cloud (Legacy)”，下面第 5 步仍在该页上。未找到取代这句的更新页。

`codex exec` 把进度打到 stderr，只把最终 agent 消息打到 stdout。`-o` / `--output-last-message` 把同一份最终消息写入文件，stdout 仍打印。`--json` 时 stdout 改为 JSONL，事件包括 `thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.*`、`error`。item 覆盖 agent 消息、推理、命令、文件变更、MCP、网页搜索、计划更新。因此默认管道只得到最终消息；要过程，调用方得显式要 JSONL。未找到最终消息的长度上限。

`--output-schema` 让最终回复符合调用方提供的 JSON Schema，例子是项目名和语言列表，文档举的用途是 job summary、风险报告、发布元数据。没有内置的完成 / 失败 / 缺信息枚举。文件变更留在工作区；JSONL 里可以再看到 file change item。会话 rollout 默认写盘，`--ephemeral` 不写。

云任务没有调度模型。页面上的运行步骤是：建容器并检出仓库，跑安装脚本，套用网络设置，代理在循环里改代码、跑检查；结束时向用户展示回答和改动 diff，用户可以开 PR 或继续追问。从 IDE 委派时，进度在 Codex 界面或 IDE 里看，也可以把云上的改动应用到本地再接着做。未找到云任务的状态枚举，也未找到「一段短状态交回本地模型、diff 默认不进上下文」的协议。本地对话在继续时会保留上下文，这是同一条对话接着做，不是另一次派单。

## GitHub Copilot cloud agent

文档正文用 Copilot cloud agent。部分 URL 仍在 `coding-agent` 路径下。来源：[Copilot on GitHub.com](https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-on-github)、[Research, plan, and iterate](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/research-plan-iterate)、[Use in your IDE](https://docs.github.com/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-in-your-ide)、[Use on GitHub](https://docs.github.com/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)、[Agent management](https://docs.github.com/copilot/concepts/agents/coding-agent/agent-management)、[Session data](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/session-data)、[Troubleshooting](https://docs.github.com/en/copilot/using-github-copilot/coding-agent/troubleshooting-copilot-coding-agent)。访问日期 2026-10-21。

这是交给人的后台编码会话，没有编排模型。云会话在 GitHub 托管的临时环境里读仓库、改文件、跑测试和 linter。环境在会话结束时销毁，session log 留在 GitHub.com，对有仓库权限的人默认可看，出现在仓库 Agents 页的 All sessions。本地 CLI 和 Copilot app 的完整记录在 `~/.copilot/session-state/`。

给人的成果是分支上的改动和 diff。PR 不是所有入口都自动建。研究 / 计划 / 迭代这篇写：会话不自动建 PR，人先看 Diff，满意后再点 Create pull request；提示里也可以要求立刻建。IDE 委派那篇写：会话开始后就给 PR 链接，做完把你加为 reviewer 并发通知。GitHub 上的另一条路径是从 session log 一键开 PR，或推到已有 PR。这些入口并存，不能收成一种。

过程在 session log 里，可以实时看，Agents 页点开即可。PR 时间线上有 “Copilot started work” / “Copilot has started work”，以及眼睛表情表示看见了评论。卡住时排障页写会话会在一小时后超时。VS Code 的 GitHub Pull Requests 扩展里，每个会话能一眼看到状态。

Chat 和云代理可以共享你正在用的那次上下文：从聊天启动的会话带上对话；会话进行中可以继续聊进度并改方向。问一个 Copilot 开的 PR 时，Chat 会去取相关 session log，用来回答改了什么、验证了什么、为什么。日志不代替人的审查和测试。未找到另一位编码代理被默认喂入整份 session log 的说明。按问题去取，是「需要时再读」。

## Cursor Cloud Agents

Cloud Agents 文档写明旧名是 Background Agents。来源：[Cloud Agents](https://cursor.com/docs/cloud-agent)、[API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)、[Capabilities](https://cursor.com/docs/cloud-agent/capabilities)。访问日期 2026-10-21。API 标为 public beta。

一次工作拆成持久的 agent 和每次提示一个 run。终态 run 上的 `result` 是最终助手回复文本。示例是 “Added README.md with installation instructions and usage examples.” 同一次响应里的 `git.branches[]` 带仓库、分支和可选 `prUrl`。文档写明 `git` 是 agent 级快照，不是 run 级：同一 agent 的每个 run 返回同一份 git。`durationMs` 在 `FINISHED`、`ERROR`、`CANCELLED`、`EXPIRED` 时给出。

SSE 示例事件有 `status`、`assistant`、`tool_call`、`result`、`done`。工具调用的参数和结果在流里。只调 Get A Run 的调用方拿到最终文本和 git 快照，拿不到工具轨迹。

产物另算。`GET /v1/agents/{id}/artifacts` 列出工作区 `artifacts/` 下的文件，字段是相对路径、`sizeBytes`、`updatedAt`。下载是 15 分钟的预签名 S3 URL。代码本身在推上去的分支里。默认 `workOnCurrentBranch: false` 时推到自动生成的 `cursor/...` 分支，`autoCreatePR` 可让它开 PR。

状态有两套，都由 API 给出，不是模型写的清单。agent：`ACTIVE`（回合在跑、在等后台工作或即将开始）、`IDLE`（上一回合结束，可追问；可恢复错误的 run 也报 IDLE，错误细节在 run 上）、`ARCHIVED`。run 文档里出现的值包括 `CREATING`、`RUNNING`，以及上面四个终态。用户看 agent 的 `url`（`https://cursor.com/agents/...`）和 Cloud Agents 仪表板。未找到把 `result` 自动送进另一个 Cursor 代理上下文的协议。代理自己可以在运行中通过 Cursor Cloud MCP 取本次和相关 run 的 transcript、diff 元数据、事件和安装日志，那是代理按工具去取，不是上游默认装进上下文。

## Devin

来源：[Get session](https://docs.devin.ai/api-reference/v3/sessions/get-enterprise-session)、[List session messages](https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session-messages)、[Advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities)、[First session](https://docs.devin.ai/get-started/first-run)、[Structured output (v1)](https://docs.devin.ai/api-reference/v1/structured-output)、[Create playbook](https://docs.devin.ai/api-reference/v3/playbooks/post-enterprise-playbooks)。访问日期 2026-10-21。

会话对象上的机器可读状态是 `status`：`new`、`claimed`、`running`、`exit`、`error`、`suspended`、`resuming`。`status_detail` 在 get/list 上才有。`running` 时可以是 `working`、`waiting_for_user`、`waiting_for_approval`、`finished`。`suspended` 时的原因包括闲置、用户要求、额度、配额、付款失败、合约到期、error 等。`pull_requests[]` 带 `pr_url` 和 `pr_state`。还有 `parent_session_id`、`child_session_ids`。消息接口返回的是时间、`event_id`、自由文本 `message`、`source` 等，默认分页最多 200 条。未找到「只回最后一条给父会话」的字段。

`structured_output` 是「已校验的结构化输出」，只在 get/list 上。Playbook 可带一份 JSON Schema（Draft 7，最大 64KB，不许外部 `$ref`），使用该 playbook 的会话要产出这份输出。v1 说明页写的用法是：把 schema 放进创建会话的提示，并要求 Devin 在相关事情发生时立刻更新；网页里用 ⌘+I 查看。示例 schema 里可以有 `status`、`current_task`、`completed_tasks`。这是模型按约定改写的进度对象，和上面的 `status` 枚举不是同一个字段。

Managed Devins：协调会话把大任务拆给多个子会话，每个子会话一台隔离 VM。协调者划范围、看进度、解决冲突、汇集结果。子会话结束或需要输入时，协调者会被唤醒，即使它在睡眠，因此不必轮询。它还可以给子会话发消息、看 ACU、让子会话睡眠或终止。未找到这次唤醒附带的正文是短状态、最终消息还是子会话全文。示例提示要求每个模块各开一个 PR，这是提示里的要求，不是 API 保证每次子会话都有 PR。

用户在会话页看。Ask 模式只规划和提问，不改代码；从 Ask 发出的 Agent 会话，状态显示在 Ask 对话里。做完后可以在 Session Insights 里生成分析：时间线、可执行反馈和改进后的提示。那是给人的事后分析，不是派单结果。

## OpenHands

来源：[Events](https://docs.openhands.dev/sdk/arch/events)、[Persistence](https://docs.openhands.dev/sdk/guides/convo-persistence)、[React to state](https://docs.openhands.dev/cookbook/react-to-state-websocket)、[Watch terminal state](https://docs.openhands.dev/cookbook/watch-terminal-state)。访问日期 2026-10-21。

SDK 把一次对话的事件做成只追加日志，既是代理的记忆，也是外部服务的接入点。可送进模型的事件包括用户和代理的 `MessageEvent`、工具调用 `ActionEvent`、工具结果 `ObservationEvent`、拒绝、`AgentErrorEvent`、系统提示和压缩摘要。`ConversationStateUpdateEvent`、压缩请求和 `PauseEvent` 不送给模型。

没有单独的派单结果对象。模型在同一会话里看见可转换事件。调用方若只想要一句结论，文档没有规定截成最后一条 Message；未找到官方的监督者只读最终消息的模式。

代码和命令输出在工作区，工具结果同时写进事件。持久化目录默认 `workspace/conversations/<id>/`：`base_state.json` 放配置、执行状态、统计和 `agent_state`；`events/event-*.json` 放消息和工具调用。状态变化会自动写入，不需要调用方手动 save。

`execution_status` 由 agent-server 用 `ConversationStateUpdateEvent` 推送。文档列出的值：`idle`、`running`、`paused`、`waiting_for_confirmation`、`finished`、`error`、`stuck`、`deleting`。逐字段的 `finished` 只是暂定，Stop hook 可以把它改回去；要确认结束，得看到 `full_state` 里的同一状态。集成方订阅 WebSocket，而不是轮询对话状态。这是系统从运行推出来的状态，不是模型写的清单。

## Factory Missions

来源：[Missions overview](https://docs.factory.ai/features/missions/overview)、[Configuration](https://docs.factory.ai/features/missions/reference)、[Running in the CLI](https://docs.factory.ai/missions/running-cli)、[Running in the Factory App](https://docs.factory.ai/missions/running-app)、[Planning](https://docs.factory.ai/features/missions/planning)。访问日期 2026-10-21。Missions 在 CLI 文档里标过 research preview；overview 页未再写这句。

人先和 Droid 一起做计划：功能、里程碑、成功标准。批准后进入 Mission Control，由编排层执行。编排器、worker、validator 可以是不同模型。里程碑结束时跑验证 worker；可在设置里关掉 scrutiny 或用户测试。无头入口是 `droid exec --mission`。

Mission Control 给人看：总时间和额度、每个 worker 和里程碑的进度日志、当前里程碑的功能摘要、功能的验证标准和提交、worker 列表。点开一个 worker 能看终端输出、思考过程和它完成的子任务。人可以暂停编排器，用自然语言让它重新评估或改计划。

未找到 worker 交回编排器的消息格式、字段或长度。未找到编排器默认是否读 worker 终端全文。未找到进度日志是运行层从事件生成，还是编排模型写出来的。文档把使用方式写成管一组 worker 的项目经理，编排器本身是可以对话的代理。

## Orca

来源：[Orchestration](https://www.onorca.dev/docs/cli/orchestration)、[Notifications](https://www.onorca.dev/docs/notifications)、[Hibernation](https://www.onorca.dev/docs/agents/hibernation)。访问日期 2026-10-21。底座调研里已写过 Orca 能不能当 Helm，这里只记结果、成果和状态。

Run 是命名空间和收件箱，文档写明它从不调度、也不安置 worker。Task 有 spec、依赖和状态：`pending`、`ready`、`dispatched`、`completed`、`failed`、`blocked`。Dispatch 是一次尝试，是 `worker_done` 和 heartbeat 的生命周期权威。完成权在当前 dispatch 上。

Worker 收到的约定是：无论成败，`worker_done` 只发一次，必须带 `--outcome succeeded|failed`；`--body` 要短，写做了什么、发现了什么、还剩什么；必须带 task id 和 dispatch id。示例里还有 `--files-modified` 列出改过的文件。长时间工作发 heartbeat。要问人就用 `orca orchestration ask`，不要在本地 TUI 里提问；`--json` 时 `ask` 打出一个 JSON，worker 可以取 `.answer`。缺信息不是第三种 outcome。

协调循环用 `check --wait --types worker_done,escalation,question`。等到的是这些消息，不是终端。stdout 是命令的最终结果；等待期间 stderr 每 15 秒一行心跳 JSON。终端全文用 `worker-read --dispatch <id> --limit 50`。`worker-release` 会把可查看的输出归档，再关掉该终端。文档要求不要为了重读输出而把做完的终端留着。

`task-update` 可以改 Task 状态，并带一份 `--result` JSON。这是一条单独命令，出现在恢复示例里。未找到 runtime 在接受 `worker_done` 之后自动把 Task.status 改成 completed 的句子。Dispatch 侧则写明由 runtime 确认：休眠条件里，未结算的 dispatch（pending、dispatched、unknown）会挡住休眠；runtime 确认 completed、failed 或 circuit_broken 之后才允许睡。

用户侧：代理从工作变为空闲时发系统通知；结构化聊天里，成功回合把标签标成未读，失败或取消不标。编排状态用 CLI JSON 查看。worktree 上能看到代理。

## LangGraph：监督者与现行子代理

来源：[Subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)、[Migrate from langgraph-supervisor](https://docs.langchain.com/oss/python/migrate/langgraph-supervisor)。访问日期 2026-10-21。`langgraph-supervisor` 包已不再积极维护。官方推荐改成：主代理把子代理包成工具来调用。

旧的 `create_supervisor` 用 `output_mode` 控制工人消息如何进入对话：`full_history` 是工人的全部消息，`last_message` 只有最终回复。迁移说明让调用方在工具包装里自己做这件事。

现行文档写：子代理默认无状态，对话记忆在主代理。子代理把结果返回主代理，不直接对用户。单任务工具的约定是：任务描述作为 human 消息送入，子代理的最终消息作为工具结果返回。输出一节写明两种做法：在子代理提示里规定返回什么；或在代码里改写再返回。它点名一种失败：子代理做了工具调用和推理，但最终消息里没有结果，而监督者只能看见最终输出。包装代码也可以用 `Command` 把额外状态键和最后一条消息一起写回。

图状态由工具和节点更新，checkpointer 持久化。子代理若在工具函数内部调用，LangGraph 不能静态发现它们，`get_state` 带 subgraphs 也拿不到子代理状态。要在中断时查看内部状态，得改成在图节点里调用子代理。没有代码 diff、测试日志或任务看板。交接（handoffs）是另一种模式：工具改一个状态变量，系统按这个变量换提示或路由，每个状态直接和用户对话。那不是「做完交回一段结果然后退出」。

## OpenAI Agents SDK：handoff 与 as_tool

来源：[Handoffs](https://openai.github.io/openai-agents-python/handoffs/)、[Tools](https://openai.github.io/openai-agents-python/tools/)、[Results](https://openai.github.io/openai-agents-python/results/)、[Context](https://openai.github.io/openai-agents-python/context/)。访问日期 2026-10-21。

Handoff 在模型眼里是一个工具，例如 `transfer_to_refund_agent`，作用是把对话交给另一个代理。接收方默认看见此前的全部对话历史。要用 `input_filter` 或可选的嵌套历史摘要才会变短。嵌套历史默认关，而且摘要里仍可能留下工具参数和工具输出。控制权转走之后，原代理不会收到一份「做完了」的结果。`RunResult.last_agent` 是下一轮通常该用的代理。流式运行时 `current_agent` 会随交接更新。

`Agent.as_tool()` 是另一条路：中心代理把专家当成工具调用，不移交对话。文档把自定义 `custom_output_extractor` 的用途写成改写、校验或从子运行里抽出最终回答或某段 JSON。未在该页看到默认把嵌套运行的每条工具调用放进父代理上下文。整次运行的 `final_output` 是最后一个代理的最终输出：无 `output_type` 时为字符串，有则为该类型；在产出最终输出前停下（例如等审批）则为 `None`。轨迹在 `new_items`，供日志和 UI，由应用决定要不要再送给模型。应用自己的状态放在 `RunContextWrapper.context`，和对话历史分开。没有内置的任务状态机或成果目录。

## Anthropic「多代理研究系统」

文章现地址：[How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system)。工程博客路径会打开到这一页。文内日期对应 2025-06-13 的发布。访问日期 2026-10-21。

LeadResearcher 先想策略，把计划写进 Memory，因为上下文超过 200,000 token 会被截断，计划必须留下。然后按子任务生成子代理。每个子代理自己搜索、用交错思考评估工具结果，把发现交回 lead。Lead 决定要不要再派。足够之后，全部发现交给 CitationAgent，由它在报告上标引用，再把带引用的结果给用户。子代理被描述成过滤器：并行探索，再把最重要的 token 压给 lead。

委派说明里要有目标、输出格式、工具和来源、任务边界。早期用很短的指令时，子代理会误解或互相重复。他们还把「简单查询不要派太多子代理」写进提示。早期失败包括一次派 50 个子代理、无止境搜索，以及用过多更新互相打扰。

当时的实现是同步的：lead 等这一批子代理都完成再继续。文章写明因此不能中途改方向，一个慢的子代理会堵住整批。异步被写成期望，同时指出结果汇合、状态一致和错误传播会更难。

附录两条和本题直接相关。一是长对话：代理把做完的阶段摘要进外部记忆，上下文将满时开一个干净的子代理，再用记忆里的计划接上。二是减少传话游戏：与其所有东西都经 lead 转述，不如让专门的代理把产物写到外部系统，只把轻量引用交回协调者。文章说这对代码、报告、数据可视化这类结构化产物尤其合适，因为专家提示直接产出的结果，好过再被通用协调者滤一遍。

同一篇写：他们的多代理系统主要适合宽、可并行、超出单上下文、工具很多的研究。大多数编码任务真正可并行的部分更少，代理当时还不擅长实时协调和委派。评估上他们看最终状态是否正确，而不是逐步是否走了规定路径。

文中没有用户可见的任务看板，也没有子代理返回文本的长度上限。

## 对 Helm 的启示

1. **支持「调度者默认只读一份短结果，成果另存」。** Claude 子代理、LangGraph 的最终消息、OpenAI `as_tool`、Codex `exec` 的 stdout、Orca 的短 `--body`、Anthropic 的压缩发现和「外部产物 + 轻量引用」，都是这条。Cursor 的 Get Run 与 artifacts、Copilot 的「被问到才拉 log」、Orca 的 `worker-read`，都是需要时再读。Helm 把测试输出和 diff 留在运行层，和这些一致。

2. **支持「给人看的材料是成果本身，汇总只是索引」。** Copilot、Cursor、Codex 云任务和 Devin 把 diff、分支和 PR 放在用户面前。Anthropic 的用户结果是带引用的报告，引用指向来源。Orca 在完成消息上带 `--files-modified`，等于短名单，不是 diff 正文。Helm 的汇总报告只写结论和链接，方向与此相同。这些编码产品里，审核材料是 diff 和 PR，没有再让一个模型把成果重写一遍。

3. **支持「进程级状态由运行层维护」。** OpenHands 的 `execution_status`、Cursor 的 run/agent 状态、Devin 的 `status` / `status_detail`、Claude agent view 的行状态、GitHub 的会话列表和 PR 时间线、Orca dispatch 的 runtime 确认，都不是模型现写的。用户在界面上看，不在调度上下文里看。

4. **反对把卡片进度也全部交给运行层推导。** 上面这些系统状态只回答「还在跑、在等人、结束了没有」。清单和计划经常由模型写：Claude Task 工具、Orca `task-update`、LangGraph 图状态、Devin structured output、Factory 里可对话的编排器、Anthropic lead 写进 Memory 的计划。Helm 若希望界面上的「当前在做哪一步」也完全从事件推导，这些产品没有这么做；它们把这一层留在模型写的对象里。

5. **反对把派单结果收成唯一的三态加几句，并取消其它返回通道。** Orca 的 outcome 只有成功和失败，提问走 `ask`，会挡住等回答。Devin 把 `waiting_for_user` 和 `waiting_for_approval` 放在 `status_detail`，和 `finished` 分开。Claude 还有 partial 和带错误说明的截断输出。Agent Teams 的空闲通知里是完整最终回答，不是几句。Anthropic 要求子任务带输出格式，lead 收到的是发现本身。Codex 和 Devin 的结构化输出都是调用方自定 schema。Helm 的三态适合运行层分支；若调度者下一步要靠执行者的具体发现，这些产品交回的是一整段最终文本，或一条会阻塞的问题，而不是把「缺信息」和「做完了」塞进同一种短结果。
