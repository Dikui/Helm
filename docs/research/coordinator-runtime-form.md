# 调度者运行形态：长时会话还是持久化执行

调研日期：2026-10-21（Grok，一手来源）。

“pi durable”指的是 Earendil 在 2026-10-01 与 Pi 1.0 一起发布的实验包 `@earendil-works/pi-durable`。它是嵌进进程的 agent 运行时，模型走 `pi-ai` 的 API key，不能代替 Helm 用订阅登录拉起的官方 CLI。

调度者应按短回合跑：一次唤醒读任务库、做一轮决定、写回后退出。等人的几小时到几天停在运行层的状态上。整项工作不要做成一条常驻会话，也不要把调度者换成 Pi Durable、Temporal 或同类 agent 循环。那些循环的耐久性建在它们自己的模型调用上，卡片图又是模型改写的数据，和“必须确定重放的工作流代码”合不上。

运行层保留最小的持久化执行：派单有幂等键，完成写入之后才算完成。不必再架一套编排服务器。

## “pi durable”指什么

用户原话里的 “pi durable” 与下面这份一手材料对得上，其他候选是它的宿主或扩展。

| 候选 | 依据 | 取舍 |
| --- | --- | --- |
| `@earendil-works/pi-durable` | 官方公告标题就是 “Pi Durable”，日期 2026-10-01，与 Pi 1.0 同日。包说明写 “Experimental”。作者是 Earendil / Mario Zechner | 采用 |
| `mavam/pi-agents` | README 写 agents 跑在 `pi-durable` 上，给 Pi coding agent 加可委托的命名 agent | 扩展，不是这个名字本身 |
| Temporal 博文 *The immortal life of Pi*（2026-10-08） | Temporal 官方把 Pi coding agent 放到 Worker 上，并单独提到 Pi Durable | 宿主实验，不是产品名 |
| Cloudflare Agents 的 `PiHarness` | 文档写在 Durable Object 里跑 Pi Durable，页脚更新 2026-10-21，标 beta | 官方宿主 |

依据：[Pi Durable 公告](https://earendil.com/posts/pi-durable/)（访问 2026-10-21）、[包 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)（同日）、[Cloudflare Pi 文档](https://developers.cloudflare.com/agents/harnesses/pi/)（同日）。

Pi 1.0 的终端 coding agent 仍是一个人在一台机器上驱动的进程。进程死后由人看着结果让它继续。Pi Durable 是另一份框架：存储加上同时跑多段对话的机器，工具在执行环境里跑。官方写它不替换 coding agent，二者共用 `pi-ai`。源码不含测试约 1.5 万行，许可证在 README 文末为 MIT。API 会在版本之间不经通知改变。

## 两种形态在这些产品里各是什么

**A 长时会话**：一个进程（或一条 CLI 会话）一直活着，事件追加进同一段上下文。崩溃后按会话 id 续上的是对话，已经执行过的外部副作用不会因为续跑而自动跳过。

**B 持久化执行**：进度写在日志或数据库里。等待时进程可以不在。下次唤醒重放已记下结果的步骤，只补未完成的那段。模型调用要被包进他们定义的“步骤”里，结果才会被记住。

下面六个是和 Helm 最相关的代表。Cloudflare Agents 和 Vercel Workflow 同一类，放在文末短记，避免和 Pi、Inngest 各写一遍。

## 对比

| | 状态放哪 | 一次唤醒做多少 | LLM 怎么变成可重放步骤 | 等几小时到几天 | 崩溃后 | 外部 CLI 进程 | 与“官方 CLI + 订阅” |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pi Durable | 一个进程独占的 SQLite、JSONL 或内存。Durable Object 用对象自己的 SQLite | 有未完成任务就 `resume()`，把能跑的阶段跑下去。默认 Node 定时器会把进程留住 | `pi.generation` 调 `pi-ai`。被掐断的请求会再发；已写入的回答留在记录里。工具先记意图，只有 `replay: "safe"` 才重跑 | 任务可 `sleepUntil`，睡眠写在库里，睡眠期间不占一次调用。Node 默认定时器仍使进程存活；`onWake` 交给宿主休眠 | 新进程打开同一存储，从最后检查点继续。连续崩溃默认 5 次后停住 | 工具和 `env.exec` 可以起程序。脑子仍是 `pi-ai` | Quickstart 用 `openaiProvider()`，读 `OPENAI_API_KEY`。未找到订阅 CLI 适配 |
| Temporal | Server 上的事件历史。Worker 无状态 | Worker 领一条任务：重放工作流到当前步，再执行下一个 Activity | 官方 AI 集成把每次模型调用做成 Activity。历史里已完成的 Activity 重放时不执行 | `sleep`、Signal、`wait_condition`。等待时不占计算。工作流没有时长上限，事件数有上限 | Worker 挂了，另一个 Worker 按历史接着做。Activity 在向 Server 报告完成前崩溃会再执行 | Activity 是普通函数，可以起子进程。未找到把官方 coding CLI 当成模型通道的文档 | 集成列表是各家模型 SDK 和 Agent SDK |
| Restate | Server 的 journal，加上 Virtual Object / Workflow 的键值 | 一次 handler 调用。重放已完成的 `ctx.run`，再执行未记下的部分 | 模型调用放进 `ctx.run`，结果写入 journal 后重放不再调用 | `ctx.sleep`、awakeable、signal。FaaS 上等待不占函数时间。文档写可以睡很久，并建议超长等待拆成延迟消息 | Server 重试到新实例，跳过已入 journal 的步骤 | `ctx.run` 包的是任意非确定操作。未找到订阅 CLI 通道 | 官方 agent 教程用 OpenAI SDK。服务要嵌 Restate SDK，前面有 Server |
| DBOS | Postgres 系统库里的工作流输入和步骤输出 | 进程起来后扫未完成工作流，或由队列拉起。重放已检查点的步骤，执行第一个没有检查点的步骤 | `durableCalls` 把每次模型调用检查点到 Postgres。已检查点的步骤不再执行 | `recv` / `sleep` 把截止时间写在库里，中间可以重启 | 单机在启动时扫 `PENDING`。多进程要 Conductor 或自己协调 | 步骤是普通函数。未找到订阅 CLI 通道 | 库嵌进应用。模型示例是 Vercel AI SDK 的 `openai()`。架构页写除 Postgres 外不要别的基础设施 |
| LangGraph | Checkpointer：开发用 SQLite，生产用 Postgres。内存版进程一退就没 | 用同一个 `thread_id` 再 `invoke`。从最后成功的 superstep 继续 | 普通节点恢复时从头再跑，里面的模型调用会再发出。Functional API 的 `@task` 按调用位置缓存结果，重放时跳过已完成的 task | `interrupt()` 把状态写入 checkpointer，然后无限期等。持久 checkpointer 下进程可以退出，以后用同一 `thread_id` 和 `Command(resume=...)` 继续 | `durability="sync"` 在下一步开始前写入。`"exit"` 只在结束或 interrupt 时写，执行中途崩溃恢复不了中间步骤 | 节点里可以起子进程，但该节点在检查点之前失败会整段再跑。未找到订阅 CLI 通道 | 文档示例是 `init_chat_model(...)`。要嵌 LangGraph |
| Inngest + AgentKit | Inngest 记下每个 step 的结果。AgentKit 的对话史要自己写 History Adapter | 函数被事件或 step 完成唤醒，重放已完成的 step，再跑下一个 | `step.ai.infer()` 把推理请求交给 Inngest，函数暂停直到结果回来，结果留在轨迹里。`step.run` 成功后不再执行 | `step.waitForEvent` / `step.sleep` 暂停时函数进程不跑。`sleep` 最长一年；整次函数还有套餐时长上限（Free 30 天，Pro 90 天，Business 366 天） | 失败的 step 重试，已成功的 step 用记下的结果 | `step.run` 里可以起进程，整段 step 是重试单位。未找到订阅 CLI 通道 | AgentKit 的推理走 `step.ai`。密钥留在你的函数里，请求由 Inngest 代发。要装 Inngest SDK |

## Pi Durable

公告和 README 把一次运行拆成任务。一次提交的形状是：`submit` 写下用户条目，`pi.generation` 调模型，每个工具调用是它拥有的 `pi.tool` 任务，模型再根据工具结果生成下一次。全部改动走一次原子提交，提交落地之前不对外显示。

存储：

- SQLite：一个文件，WAL，`synchronous = NORMAL`。进程崩溃后已提交的还在；断电或宿主机故障可能丢掉最新一条。
- JSONL：追加文件，还会把整段历史放进内存。README 写长时 agent 用 SQLite。
- 一个进程独占一份存储，没有跨进程锁。
- 每段对话有一个持久的 UUIDv7，当作 `pi-ai` 的 `sessionId`，给厂商做提示缓存和会话亲和。

一次唤醒：`Harness.open` 同一份存储，`resume()` 继续上次没做完的任务。提交或等待也会把调度器拉起来。阶段中间不能睡觉；阶段崩溃后从阶段开头重跑，所以等待之后的工作要放在下一阶段，需要的数据放进检查点。

模型：被中断的请求会再送一次，已经流出来的部分留在记录里并标成 aborted。所以“已完成的生成”不会重发，“发到一半”会再花一次模型调用。工具在 `execute()` 之前先把意图提交。进程死在调用中途时，只有声明 `replay: "safe"` 的工具会重跑；其余给模型一条 interrupted，并带上已经提交的输出。README 的 bash 段落没有写它的 `replay` 值。作者 Mario Zechner 在 2026-10-15 写：工具本身耐久（replay safe）才能从工具调用中途恢复；bash 不是，subagent 是。来源：[这条帖](https://x.com/badlogicgames/status/2110699878833926607)。本次没有逐行打开 bash 的实现文件，不把 README 没写的默认值写成已核对。

同一 `requestId` 的再次提交返回原来的 submission。嵌套工具按 key 重新接上已经做过的调用；replay-safe 的外层若重跑，内层仍按自己的 replay 策略，外部副作用还要自己做幂等。

等人：`sleepUntil` 把睡眠写进存储，这段时间不占一次调用，重启后到点继续。Node 上，调度还在跑时，定时器会把进程留着。要让进程真的睡下去，设置 `onWake`：Harness 不再为睡眠设定时器，只告诉宿主现在是 `active` 还是最早的 `at`。README 的例子是 Cloudflare Durable Object：宿主写 alarm，alarm 里再 `resume()`。连续崩溃（默认 5 次，且中间没有新的已提交状态）会把任务停住，`wake()` 不再把它算作活跃，要用 `retryTask` 再放行。

上下文：自动压缩会摘要旧条目，旧条目仍留在存储里。`reset(交接说明)` 让模型从此只看见新的上下文。工作集只留活跃记录；压缩把活跃记录限制在模型窗口内。

费用记在 `pi.usage`，按 `provider/model` 和工具累计，失败和中止的尝试也算。Quickstart 的提供方是 `openaiProvider()`，注释写明读 `OPENAI_API_KEY`。

和外部 CLI：执行环境的 `exec(["git", ...])` 以及自定义工具可以起本机或远程程序。Harness 的模型循环仍经过 `pi-ai`。未找到把 Codex、Claude Code 或 Grok 的订阅登录接成模型提供方的官方适配。

Cloudflare 的 `PiHarness`（beta，文档更新 2026-10-21）把上述存储放进 Durable Object 的 SQLite，表名以 `pi_` 开头。对象被逐出后，Lifecycle 的 alarm 再打开存储继续跑。有工作时心跳 alarm 约 30 秒一次；单次 alarm 最长约 15 分钟，Harness 每 10 分钟交接一次。一次模型流超过 15 分钟可能被掐断。文档写 Pi Durable 目前没有工具调用的批准步骤。来源：[Pi harness](https://developers.cloudflare.com/agents/harnesses/pi/)、[长时 agent 概念](https://developers.cloudflare.com/agents/concepts/long-running-agents/)。

## Temporal

事件历史在 Temporal Server。Workflow 代码必须能重放：同样的历史走出同样的下一步。非确定的事放进 Activity。Activity 是在 Worker 上注册的普通函数。

已完成并记入历史的 Activity，重放时不再执行。Activity 在返回或报错之前不会写入历史。Worker 在做完外部动作、报告 Server 之前崩溃，这个 Activity 会再跑。文档因此要求 Activity 幂等，并用 Workflow Run ID 加 Activity ID 当作下游的幂等键。把三步合成一个 Activity 时，重试会三步都再做。来源：[Activity definition](https://docs.temporal.io/activity-definition)（访问 2026-10-21）。

等人：人工批准食谱写，等待可以是几小时、几天或一直等，等待期间不占计算；Signal 把决定送进来；定时器在执行中断后仍然有效。来源：[Human-in-the-loop](https://docs.temporal.io/ai-cookbook/human-in-the-loop-python)。工作流没有时长上限。事件历史超过 51,200 条或 50 MB 会被终止，10,240 条或 10 MB 起警告。长寿命用 Continue-As-New：同一 Workflow ID、新的 Run ID、空历史，状态靠参数带过去。Entity Workflow 是“一个实体一条工作流”，并用 Continue-As-New 防止历史无限涨。来源：[事件历史](https://docs.temporal.io/workflow-execution/event)、[Continue-As-New](https://docs.temporal.io/workflow-execution/continue-as-new)、[Entity Workflow](https://docs.temporal.io/design-patterns/entity-workflow)。

AI 页把 agent 定义成：长时间、有状态、调 LLM 和工具、等人、失败后从原处继续。官方集成包括 Vercel AI SDK、OpenAI Agents SDK、Google ADK、LangGraph、Deep Agents、Strands、Pydantic AI。这些集成的共同写法是：编排循环在 Workflow 里重放，每一次模型调用和有 I/O 的工具变成 Activity。来源：[Durable AI](https://docs.temporal.io/ai)、[AI SDK 集成](https://docs.temporal.io/develop/typescript/integrations/ai-sdk)、[Deep Agents 集成](https://docs.temporal.io/develop/python/integrations/deepagents)。

因此一次“唤醒”是 Worker 处理一条 Workflow 任务或 Activity 任务，做完就可以退出；等人的时候不需要 Worker 一直占着。未找到把订阅登录的官方 coding CLI 写成模型通道的文档。Activity 既然是普通函数，起一个 CLI 子进程在机制上落在 Activity 里；那次 CLI 的内部工具步骤不会进 Temporal 历史，只有 Activity 的返回值会。返回值没报告成功之前，整段 CLI 会再执行。

## Restate

应用嵌 SDK，前面有一个 Restate Server（单个 Rust 二进制，也可做集群）。一次调用是一次 invocation。`ctx.run` 把 HTTP、数据库和其他非确定操作的结果写入 journal。崩溃后重放 journal，已完成的步骤跳过，从断点继续。不加 `ctx.run` 的非确定操作在重放时会得到不同结果。来源：[Key concepts](https://docs.restate.dev/foundations/key-concepts)、[Actions](https://docs.restate.dev/foundations/actions)（访问 2026-10-21）。

Virtual Object 按 key 隔离状态，同一 key 同时只有一个写 handler。官方把 chat session 和 AI agent 列在这个类型的用途里。状态在 Server 里，服务进程可以无状态，适合 FaaS。来源：[Services](https://docs.restate.dev/foundations/services)、[Durable Sessions](https://docs.restate.dev/ai/patterns/sessions)。

等人：`ctx.sleep` 在重启后只睡剩余时间，FaaS 上挂起后不占函数时间。文档写睡眠没有硬上限，同时写：在 Virtual Object 的独占 handler 里睡眠会把这个 key 上的其他调用排进队列；超长等待建议拆成延迟消息。Awakeable 是一次性外部回调，signal 用来在进行中的调用里转向，包括 “steer an ongoing agent”。HTTP 请求带 idempotency key 时，重复请求附着到同一次 invocation。来源：[Actions](https://docs.restate.dev/foundations/actions)、[Durable timers](https://docs.restate.dev/develop/python/durable-timers)、[Invocations](https://docs.restate.dev/foundations/invocations)。

一次唤醒就是一次 handler 执行：重放 journal 直到未完成的 `ctx.run`，执行它，再在 sleep 或 awakeable 处挂起。官方 agent 材料用的是 OpenAI SDK 和 DurableRunner，把对话事件放进 Virtual Object。未找到订阅 CLI。`ctx.run` 里起 CLI 时，整段 `run` 是重试单位：结果写入 journal 之后不再执行；写入之前失败会再跑。

## DBOS

库嵌在应用里，系统库是 Postgres，没有单独的编排服务器。每个步骤一次写，外加工作流开始和结束各一次写。恢复分三步：发现 `PENDING`（单机在启动时扫描；多进程靠 Conductor 或手动），用检查点里的输入重新调用工作流函数，已有输出的步骤直接返回记录，第一个没有检查点的步骤才真正执行。工作流函数必须确定；步骤必须幂等，因为失败发生在检查点之前会再执行，检查点之后不再执行。改了步骤顺序的进行中工作流，要用 patch 或按版本恢复到兼容代码。来源：[Architecture](https://docs.dbos.dev/architecture)（访问 2026-10-21）。

等人：`DBOS.recv(timeout_seconds=...)` 和 `DBOS.sleep` 把醒来时间放在数据库里。HITL 文档写人可以花几小时或几天，中间服务器可以重启、代码可以升级，工作流会继续等，直到通知到达或超时。`send` 成功之后，对方一定能 `recv` 到；工作流内发送是恰好一次，工作流外发送靠 `idempotency_key`。来源：[HITL](https://docs.dbos.dev/ai/hitl)、[Why DBOS for agents](https://docs.dbos.dev/explanations/why-dbos-agents)、[Python contexts](https://docs.dbos.dev/python/reference/contexts)。

Vercel AI 集成用 `durableCalls` 包住模型、`durableTools` 包住工具，要求 DBOS v4.27+ 或 v5、AI SDK v7+、Postgres。进程中断后从检查点重放。示例模型是 `openai('gpt-5')`。来源：[Vercel AI SDK 集成](https://docs.dbos.dev/integrations/vercel-ai)。

本次打开的架构页只写 Postgres。各语言是否仍支持 SQLite 系统库，本次没有重开那些页。未找到订阅 CLI。步骤函数可以起子进程，语义与 Activity 相同：检查点之前失败会整段再跑。

## LangGraph

Checkpointer 按 `thread_id` 保存图状态。`InMemorySaver` 在进程退出后消失。持久化用 `SqliteSaver`（文档写适合本地和实验）或 `PostgresSaver`。长对话的检查点会一直堆积，文档建议另外做清理；默认每个 superstep 写入通道的全量值。来源：[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[Checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)（访问 2026-10-21）。

`interrupt()` 把图停住，状态写入 checkpointer，然后无限期等待。恢复时用同一个 `thread_id` 和 `Command(resume=...)`。节点从该节点函数的开头再执行，interrupt 之前的代码会再跑。同一 superstep 里已经成功的节点，恢复时不重跑。来源：[Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)、[Checkpointers 的 Pending writes](https://docs.langchain.com/oss/python/langgraph/checkpointers)。

耐久三档：`"exit"` 只在成功、出错或 interrupt 时落盘，执行中途崩溃没有中间状态。`"async"` 在下一步执行时异步写，崩溃可能来不及写上。`"sync"` 在下一步开始前写完。用旧的 `checkpoint_id` 做 time-travel 重放时，该点之后的节点会再执行，包括 LLM 调用、API 请求和 interrupt。

Functional API 把 `@task` 的结果缓存下来，entrypoint 恢复时从头重放函数体，已完成的 task 用缓存。task 或 interrupt 的调用顺序变了，缓存会配错。task 外面的网络调用在重放时会再发生。文档示例的模型是 `init_chat_model(...)`。来源：[Backward compatibility](https://docs.langchain.com/oss/python/langgraph/backward-compatibility)、[Functional API](https://docs.langchain.com/oss/python/langgraph/use-functional-api)。

最新的图代码会立刻用到所有还在进行的 thread，包括从检查点恢复的。改节点名字、改 task 顺序，都可能让恢复失败。这和 Temporal、DBOS 把进行中的运行留在旧代码上的做法不同。

`durable-execution` 这个 URL 本次打开后内容是 Persistence 页。上面的耐久模式以 Checkpointers 页为准。

未找到订阅 CLI。节点里起 CLI 时，这个节点在检查点之前失败会整段再跑；interrupt 之前的代码在恢复时也会再跑。

## Inngest 与 AgentKit

AgentKit 的 Agent 本身无状态。`run()` 时用 `step.ai` 做推理；文档写 `step.ai` 失败会重试，并缓存结果以便耐久。Network 在一次循环里选下一个 agent，把结果放进内存中的 State。跨运行的对话要自己实现 History Adapter，可以接任何数据库。来源：[Agents](https://agentkit.inngest.com/concepts/agents)、[History](https://agentkit.inngest.com/concepts/history)、[Networks](https://agentkit.inngest.com/concepts/networks)（访问 2026-10-21）。

耐久来自 Inngest 的 step。`step.run` 成功后不再执行。`step.ai.infer()` 把推理交给 Inngest 的基础设施，函数在等待时不执行；密钥和认证头留在你的函数里，由函数发出，Inngest 不记录这些密钥。`step.sleep` 和 `step.waitForEvent` 暂停时不保留函数进程。`waitForEvent` 的例子包括 7 天、30 天。`sleep` 最长一年，但整次函数运行还有套餐上限：Free 30 天，Pro 90 天，Business 366 天，Enterprise 另计。来源：[step.ai](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/step-ai-orchestration)、[Durable agents](https://www.inngest.com/docs/learn/durable-agents)、[step.sleep](https://www.inngest.com/docs/durable-execution/primitives/step-sleep)、[step.waitForEvent](https://www.inngest.com/docs/durable-execution/primitives/step-waitforevent)。

部署页写：装上 Inngest SDK 之后才得到可重试的工具、LLM 卸载和逐步轨迹。未找到订阅 CLI。`step.run` 起 CLI 时，整段 step 是重试和记忆的单位。

## 同一类、本次不单列

**Cloudflare Agents。** Agent 是 Durable Object：有地址、有 SQLite 状态，空闲约 2 分钟后休眠，计算为 0，直到 HTTP、WebSocket、alarm 或邮件把它唤醒。`this.state`、SQL、日程在休眠和重启后还在；内存变量、定时器和未完成的 fetch 不在。日程存在 SQLite，靠 Durable Object alarm 唤醒。来源：[Long-running agents](https://developers.cloudflare.com/agents/concepts/long-running-agents/)、[Schedule tasks](https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/)（访问 2026-10-21）。模型示例走 Workers AI 或自备提供方。这是托管运行时，和 Helm 在用户机器上拉起官方 CLI 的约束对不上。它和 Pi 的关系已经写在 Pi Durable 一节。

**Vercel Workflow。** `'use workflow'` 的输入输出进事件日志，崩溃或部署后确定重放。`'use step'` 有重试，步骤执行时工作流挂起、不占资源，完成后从断点继续。`sleep('7 days')` 不占计算。`defineHook` 用来等外部批准。默认把运行留在创建它的那次部署上。来源：[Workflow concepts](https://vercel.com/docs/workflows/concepts)（页脚 2026-09-10，访问 2026-10-21）。开源 SDK 的入门页列出 Express、Hono 等框架，所以“只能跑在 Vercel 上”这次没有被单独的自托管页证实，也不把反面写成事实。模型示例在 `'use step'` 里调 AI SDK。未找到订阅 CLI。

## A 和 B 差在哪

**上下文增长和交接。** 长时会话把一项工作从对齐到审核的模型上下文堆在一条 CLI 会话里。上下文满了，仍然要新开一条，并用任务库里的工作说明、卡片图和事件写交接提示。这条交接 Helm 已经要求，和选 A 还是 B 无关。

持久化执行产品自己也有一段会变长的记录：Pi 的 transcript 靠压缩和 `reset`，Temporal 的事件历史靠 Continue-As-New，LangGraph 的检查点会堆积，Inngest 的 step 结果留在运行轨迹里。它们交接的是“已完成步骤的返回值”，模型下次看到的是这些返回值，不是把整段 CLI 会话原样续上。

对 Helm，调度者每次醒来要看见的是任务库里的事实：工作说明、卡片图、未处理的消息和派单结果。这是一份有界简报。简报变长时，压缩的是任务库里的报告，不是一条从第一天堆到审核日的模型会话。

**成本。** 这些引擎都不包含模型额度。它们的官方模型路径是 API SDK 或由平台代发推理。Helm 若走订阅 CLI，引擎的模型集成用不上，引擎本身还多一份进程或服务（Temporal Server、Restate Server、Inngest、Postgres、Vercel、Cloudflare）。

订阅额度花在 CLI 上。长时会话每次继续都带上更长的上下文，等待期间 CLI 进程还在。短回合每次重新装一份简报，调用次数更多，单次上下文更小，等待期间没有模型进程。Pi Durable 在默认 Node 上等人时仍把进程留着；Temporal、Restate、DBOS、Inngest、Vercel 的等待和 Cloudflare 的休眠不占这段计算。具体的五小时窗口和每周限额已写在 `docs/research/subscription-billing.md`，这里不重复。

**实现量。** 长时会话要保管 session id、在事件到达时把文本送进还活着的进程、进程死后按 id 续跑。三家 CLI 的续跑已经在 `docs/research/unattended-executors.md` 里核对过：续上的是会话，已完成的工具副作用不会因此变成恰好一次。

完整的 B 还要：把调度逻辑写成可重放的函数；给每个模型调用和每次派单划步骤；处理历史上限或检查点膨胀；处理进行中的逻辑变更（Temporal / DBOS 的版本与 patch，LangGraph 立刻用新代码，Vercel 把运行钉在旧部署）。Helm 的卡片图是调度者在运行中改的数据。把它写成一份必须确定重放的工作流，改依赖、打回、插入决策关卡都会变成“旧历史对新代码”的问题。

最小的 B 只要求运行层已经要有的东西：任务库里的卡片、依赖、派单和事件。调度者一次进程只做一轮，通过运行层的工具改这些记录，然后退出。

**和官方 CLI + 订阅。** 长时会话直接就是这条 CLI。短回合也是这条 CLI，只是每次新起或在一轮之内续跑，轮末退出。

Pi Durable、Temporal 的 AI 集成、DBOS 的 `durableCalls`、LangGraph 的 `init_chat_model`、Inngest 的 `step.ai`、Vercel 的 `'use step'` 模型调用，文档写的都是模型 SDK 或平台代发。未找到其中任何一个把用户已登录的 `codex`、`claude` 或 `grok` 当作模型通道。把 CLI 塞进 Activity、`ctx.run`、DBOS 步骤或 `step.run`，只能让“整段进程”成为重试单位，CLI 内部的读文件、改文件、跑命令仍然要靠 CLI 自己的会话，引擎看不到。

## 倾向和推翻条件

倾向：

1. 一项工作的调度者按短回合运行。运行层在有新消息、派单结束、派单失败或决策关卡放行时拉起一次官方 CLI。提示词来自任务库。这一轮的决定通过运行层的工具落成卡片和派单。进程退出。
2. 对齐这种需要来回说话的阶段，可以在这一阶段内按 session id 续跑。阶段结束，会话可以丢掉，留下的是已经确认的工作说明。
3. 审核和决策关卡是任务库里的状态。没有人回答时，不保留调度者进程。
4. 崩溃或上下文满：再拉起一次 CLI，读任务库。不依赖从对齐一直续到审核的那条会话。
5. 派单在运行层带幂等键。运行层把“已派发”写上之后，恢复时不再派同一张。写上之前崩溃，可以再派；执行者那一侧要能认出同一次派单。这是这些产品共同的底线：检查点之前的副作用至少一次，检查点之后不再执行。
6. 不把调度者实现成 Pi Durable、Temporal Workflow 里的 agent 循环、LangGraph 图或 Inngest AgentKit。登记的调度者仍然是一份 CLI 配置，一项工作一份实例，就是一次一次拉起的进程，不是这些框架里的一份对象。

推翻条件：

- 官方 CLI 若提供“按工具调用记下结果、重放时跳过已完成副作用”的协议，并且订阅额度承受得住多日常驻，整项工作一条会话的恢复成本会下降。本次调研没有在这些 durable 产品里找到这条协议；CLI 自身的会话恢复以已有调研为准。
- 若调度者改为 API key、允许嵌 SDK，Pi Durable（一份 SQLite、多段对话、压缩、`onWake`）或 DBOS 的 `durableCalls` 才和“调度者的脑子”对得上。那会直接违反现在的订阅约束。
- 若卡片图改成部署时写死的代码，模型只填参数，Temporal、Restate、Inngest 或 Vercel Workflow 的确定重放才值得引入。模型还在改依赖和插入关卡时，这套重放是负担。
- 若测下来一次 CLI 冷启动加上简报组装，明显贵于在同一会话里多留几轮，可以把“一轮”放大到一次对齐或一批事件。轮末仍然退出，不把进程留过审核等待。

## 对 Helm 的启示

支持当前设计的部分：

- 运行层掌握任务库、依赖、并发上限和唤醒，调度者是被唤醒的 CLI。这和“等待不占模型进程、崩溃后读库接着干”一致。Temporal、Restate、DBOS、Inngest、Cloudflare、Vercel 都把长时间等待放在运行时的记录里，而不是放在一条不退出的模型会话里。
- 一项工作一个调度者实例、登记项是模板。Pi Durable 的“一个 Harness 多段对话”和 Temporal 的 Entity Workflow 都是“一个键一份状态”。Helm 的键可以是工作 id，状态在任务库，不必让每份实例变成一个常驻进程。
- 卡片图由调度者改写。这支持“图是数据、执行靠运行层检查依赖”，不支持“图是一份要确定重放的工作流源码”。

反对或需要收紧的部分：

- “一条 CLI 会话从对齐常驻到审核结束”和这些产品要解决的问题相反。上下文会涨满，进程会崩，等人时还占着订阅会话。用户要求的“新开一个、读任务库接着干”说明任务库才是恢复源，会话只是一轮的工作记忆。
- 不要为了耐久再引入 Pi Durable 或上述引擎来当调度者。它们的模型步骤走 API，和订阅 CLI 冲突；它们也看不见 CLI 进程内部的工具调用。
- 派单若只在 CLI 会话里记一笔、运行层没有幂等的“已派发”记录，崩溃后续跑会再派一次。这是上面每一家对“检查点前的副作用”的共同限制。执行者 CLI 的会话恢复补不上这一笔，已有调研已经写过会话恢复的边界。

## 本次没读到的

- Pi Durable、Temporal、Restate、DBOS、LangGraph、Inngest、Vercel Workflow、Cloudflare Agents 的文档里，把 Codex、Claude Code 或 Grok 的订阅登录写成模型通道的页面。
- Pi Durable 内置 bash 在源码里的 `replay` 默认值。README 只写了总规则；bash 不是 replay-safe 来自作者 2026-10-15 的帖子，不是工具实现文件。
- DBOS 各语言当前是否仍把 SQLite 当作系统库。本次以架构页的 Postgres 为准。
- Vercel Workflow 开源 SDK 在不使用 Vercel 时的持久化后端和计费。概念页描述的是 Vercel 上的事件日志、休眠和按部署钉住运行。
