# 执行编排的通用模板与动态生成调研

调研日期：2026-10-11。范围：公开文档、源码、Codex CLI 离线检查；未调用模型、付费或登录服务，未安装依赖、未发布内容。
证据标记：**事实**来自所引资料；**本机检查**只证明命令实际观察到的行为；**推断/建议**是 Helm 的设计取舍；**未核实**表示资料或实验不足。
链接编号均可点击，文末列出来源。网页和未锁定版本的 main/master 源码可能变化；Codex 源码锁定 `rust-v0.160.1`，Agents SDK Python 源码锁定 `125efa029b4bfd84238bd2c4fd69c3406f802663`。

**范围依据（事实）：** 当前项目流程支持顺序、并行、条件分支，不支持嵌套项目流程；节点拥有需求、边界、测试和上限，核对/挑错使用独立上下文。[H1][H2] 本任务要求 runtime 不承担业务判断；本调研将节点内部执行编排作为新增设计建议，不改变现有项目流程与席位权限。[H3]

## 1. 已有实现：表示与执行

### 1.1 核心项目比较

以下两张表为**事实**；“没有”限于所检查示例或所述组件，不代表整个生态不存在扩展。额外选取 CrewAI Flows、Inngest AgentKit、autoresearch，合计三个；最后一个只作为指标优化的轻量参照。

| 项目 | 表示形式、核心原语 | 并行与循环写法 | 结构化输出 |
|---|---|---|---|
| Claude Code dynamic workflows | 主对话生成 JavaScript，保存脚本为 `export const meta` 加顶层脚本体；`agent()`、`parallel()`、`pipeline()`。[C1] | `parallel()` 收齐结果；`pipeline()` 为清单逐项执行阶段；普通 JS 分支/循环。项目 `.claude/workflows/` 或个人 `~/.claude/workflows/` 保存后成为斜杠命令。[C1] | `agent(prompt,{schema})` 返回匹配 schema 的 JSON；结构化输出验证默认最多 5 次尝试，可配置 `MAX_STRUCTURED_OUTPUT_RETRIES`。[C1] |
| anthropics/claude-cookbooks：Building Effective Agents | Python notebook/函数：`chain`、`parallel`、`route`、`FlexibleOrchestrator`、`generate/evaluate/loop`；开发者预写控制结构，模型生成任务或评价。[C5][C6][C7] | chain 是 for；parallel 使用 ThreadPoolExecutor，默认 3 workers；优化器 while True 到 PASS。orchestrator-workers 虽有“并行”描述，实际 process 为串行 for。[C5][C6][C7] | `llm_call` 返回首个文本块，XML 用正则提取；缺 tag 返回空串，未用 JSON Schema；分类直接 `routes[route_key]`，未提供未知类别兜底。[C5][C8] |
| OpenAI Agents SDK（Python/TS） | 代码定义 Agent、Runner/run、tools、handoffs、agents-as-tools、guardrails；模型派单与代码编排均有官方示例。[O2][O3] | Python `asyncio.gather`；顺序 await；普通 while + evaluator。Runner 自身是工具/交接循环，`max_turns` 限制的是单次 run，不能代替外层优化循环上限。[O4][O5][O6] | Python `output_type` 用 Pydantic/dataclass；TS `outputType` 用 Zod；final_output/finalOutput 与运行明细分开。[O3][O6] |
| Codex CLI 自身多代理 | 模型通过工具派单，配置代理角色；0.160.1 源码分别定义 V1/V2 的 spawn、message/input、wait、resume/close 或 interrupt、list/followup 工具，不能假定各版本工具名相同。[X1][X2] | 代理决定何时创建、等待和继续子代理；线程控制器执行这些调用。外部程序也可并发启动多个 `codex exec`；后者是 Helm 的建议映射，不是内置持久化 DSL。[X2][X3] | `exec --output-schema` 约束最终消息；`--json` 输出 JSONL 事件，二者用途不同；0.160.1 的 resume 同样接受 output-schema。[X4][X5][X6] |
| LangGraph | StateGraph/节点/边/状态 reducer 构成代码图；条件边、`Send`、`Command`、`interrupt`；Functional API 另有 entrypoint/task。[L1][L2][L3][L9] | 多出边并行；动态 Send 做 map-reduce，reducer 汇总；回边做循环；recursion_limit 限 superstep 数，不是单项尝试数。[L1][L8] | 状态用 TypedDict/dataclass/Pydantic 等定义；模型结构化输出另接 with_structured_output；有图不等于业务正确。[L1][L2] |
| Mastra workflows | TS createWorkflow/createStep，then/parallel/branch/foreach/dowhile/dountil/map/sleep/sleepUntil；另有 beta dynamic workflows，以可验证 JSON graph 表达，引用注册步骤而非 JS closure。[M1][M2][M3] | parallel 后 then 汇总；foreach 可配置 concurrency，默认 1，多步逐项流水线可用 nested workflow；dowhile/dountil 为后置检查，至少运行一次；branch 资料差异见下文。[M1][M8] | 步骤/流程 input/output 用 schema；dynamic definition 有 JSON Schema，注册前验证引用和 schema 流；agent entry 可指定 outputSchema。[M2][M3] |
| Temporal | 通用语言 Workflow 代码；TS async 函数协调 Activity、Child Workflow、Signal/Update、Timer、Schedule、Continue-As-New；Worker 从 Task Queue 取任务。[T1][T2] | await 顺序，Promise.all 并行，for/while 循环；受控并行按批派发；sleep/condition 持久等待，长轮询可分 Child Workflow/CAN。[T3][T4] | 可序列化输入/输出，默认 converter 支持 JSON 等；TS 类型与序列化不等于 JSON Schema 验收，此点由 converter 源码推断。[T1][T5] |
| CrewAI Flows | Python Flow + start/listen/router 装饰器，and_/or_；main 源码另有 FlowDefinition 的 JSON/YAML 声明入口，发布版对应关系未核实。[F1][F2] | 同事件 async listeners 用 asyncio.gather；router label 可形成回路，and_ 汇合/or_ 任一触发。main max_method_calls 默认每 listener 最多 100 次，超出抛 RecursionError；业务总轮数/时间/预算仍需限额，发布版对应未核实。[F1][F3] | Pydantic state，Agent kickoff response_format 可产类型化结果；声明式表示不自动保证终止或安全。[F1][F2] |
| Inngest AgentKit | TS Agent/Tool/Network + State/Router；router 可代码判定或模型路由，maxIter 限 Network 循环。[I1][I2] | 多步工具与 Inngest step.run 结合，Promise.all 并行；Network 本身是 agent/router 循环，不应混同持久化引擎。[I1][I3] | 工具 parameters 用 Zod，State 可类型化；最终文本通用严格 output-schema 保证未核实。[I2][I3] |
| autoresearch（轻量参照） | Markdown program.md 约束代理操作 Python 实验；原语是建议代理改动、运行、评价、记录、保留/回退，不是持久化执行器。[A1] | prompt 指定无限循环；每次训练 5 分钟，超过 10 分钟要求终止；val_bpb 更低则保留，否则回退。[A1] | results.tsv 记录 commit、指标、内存、keep/discard/crash、说明；这些是实验状态，不能直接映射为 Helm 测试通过。[A1] |

| 项目 | 错误与重试 | 持久化与恢复 | 许可证 |
|---|---|---|---|
| Claude Code dynamic workflows | 停止/不可恢复 API 错误可能返回 null；stall 最多重启 5 次，第 6 次失败。并行/流水线保留 null；直接 await agent 失败可结束运行。重启上下文清空，文件改动保留。[C1] | 会话目录保存脚本和结果，按代理启动顺序重放；失败或 prompt 改变，从该调用起后缀失效，包括后面已完成调用；同一会话恢复复用，新会话从头执行。[C1] | 商业条款、保留全部权利；公开 GitHub 仓库不等于执行器开源。[C2] |
| claude-cookbooks | 所述示例无 workflow 级重试；API SDK 的 HTTP 重试是另一层。XML 分类缺兜底，优化示例无最大轮次。[C5][C6][C8] | 所述 basic/orchestrator/optimizer 仅内存与 print，没有 checkpoint/resume；另一个 async notebook 有 mailbox/Event、超时和取消，也不是跨进程恢复。[C5][C7][C9] | MIT。[C10] |
| OpenAI Agents SDK | MaxTurnsExceeded、guardrail/模型错误；现行 Python 支持 model retry policy/backoff 与错误 handler，输出 fallback 不等于重新执行工具。外层步骤仍需自行定义重试。[O6][O7] | Session 保存对话历史；RunState 可序列化审批暂停并跨进程续跑。任意时刻崩溃后的整个业务图恢复另接 Temporal/Dapr；会话存储不是自动 exactly-once。[O8][O9][O6] | Python/TS SDK：MIT。[O10][O11] |
| Codex CLI | JSONL 有 error/turn.failed，进程错误可非零退出；恢复会话并不撤销或去重已经执行的命令。外部重试策略需考虑现场副作用。[X4][X6] | 默认保存会话，exec resume 指定会话继续；ephemeral 不保存。子代理源码有线程恢复控制，但本次未验证崩溃后整棵代理树自动恢复；更没有据此证明 Helm 步骤重放语义。[X4][X3] | Apache-2.0。[X7] |
| LangGraph | 节点 RetryPolicy 可配次数/异常/退避；interrupt 的暂停不是业务失败；恢复重跑节点片段，需避免重复副作用。[L3][L7] | checkpointer + thread_id；每 superstep 全快照及节点 pending writes，可保留同轮其他成功结果；SQLite/Postgres 可持久，InMemorySaver 不跨重启；未落盘副作用仍要幂等。[L4][L5] | LangGraph 开源库 MIT；不要等同于所有托管服务许可。[L6] |
| Mastra | workflow retryConfig 的 attempts/delay，step retries 可覆盖；failed/suspended 分开。[M4] | 配置存储保存 snapshot，包括输出/路径/暂停/剩余重试；同 runId resume；restart 重新执行最后活动步骤。动态定义可跨重启加载，旧 run 保留原图；不保证外部写恰好一次。[M2][M5][M6][M7] | 非 ee/ 内容 Apache-2.0，任意 ee/ 目录及第三方组件分别按其许可证；不能写全仓统一 Apache。[M9] |
| Temporal | Activity 默认自动重试、最大次数 0 表示无限；Workflow Execution 默认无 retry policy，Workflow Task 重试另论。Activity 配超时/退避/最大次数/不可重试错误。[T6][T7] | Service 保存 Event History；Worker 重放 Workflow，已完成 Activity 使用历史结果；History 不自动记录 Activity 内部每条操作或每次重试现场；代码升级需保持历史兼容。[T8][T9] | Server 和 TS SDK 均 MIT。[T10][T11] |
| CrewAI Flows | 通用 Flow step 自动重试 API 未核实；不能用 Agent 重试推断 Flow 重试。[F1][F3] | persist 默认 SQLite 保存 state；仅恢复 state、无 completed_methods 时仍从头运行。main 的 from_checkpoint 另可恢复完成方法/输出，发布稳定性未核实。[F1][F3] | MIT 条文。[F4] |
| Inngest AgentKit | 接 Inngest Function 后 agent/tool 可按 retries 重试；成功 step 重放缓存，失败 step 重试，step 外代码会重跑。[I4][I5] | Network State 仅本次 run；持久性来自 Inngest durable backend。成功且已持久化 step 可复用；外部成功但回执未保存的 step 仍可能被重试。[I2][I5] | AgentKit Apache-2.0；不推断全部 Inngest 产品许可。[I6] |
| autoresearch | prompt 要求处理 crash、有限修复后放弃单次想法；不是引擎强制错误策略。[A1] | Git 分支、实验日志和 TSV 可留下现场；没有步骤 journal、检查点或确定性重放协议。[A1] | README 声明 MIT；根 LICENSE 请求为 404，正式许可文件及完整授权范围**未核实**。[A2] |

### 1.2 Claude Code 限制及来源差异

**事实：** 当前官方写明脚本无直接文件/命令访问、禁 import()、无运行中用户输入；默认至多 16 并发，低 CPU 可更低，v2.1.269+ 可配置 1–256；一次 parallel/pipeline 最多 4096 项，整个运行最多 1000 个代理。Date.now()、Math.random()、无参 new Date() 抛异常；时间等值可由固定 args 注入。这些限制属于 Claude 的产品契约，不是 Helm 已有能力。[C1]

| 细节 | 当前官方 | 可信度与差异处理 |
|---|---|---|
| 缓存/恢复 | 从失败或 prompt 不一致的调用起，后续调用重跑。[C1] | 社区指南的“200 项完成 150 项，恢复只跑 50 项”过度简化；作为作者资料引用，不作为恢复保证。[C3] |
| 并发数 | 默认最多 16；CPU 少时降低，当前可显式配置。[C1] | 实测文章写 min(16, cores−2)，是作者观察，非当前稳定 API；文章发表于 2026-05-29，可能早于配置功能。[C4] |
| 保存文件形状 | meta + 顶层脚本体。[C1] | 社区指南有 export default async function 写法；本机兼容性**未核实**。[C3] |
| 内部 API/日志 | 官方博客确认 token budget 能力。[C11] | workflow(name,args)、budget.total/spent()/remaining()、journal hash、agent 文件名来自第三方；公开参考未完整保证，具体接口**未核实**。[C4] |

**事实：** Anthropic 员工署名博客给出分类、并行汇总、对抗验证、生成筛选、竞赛、循环六类形状；图示提到 schema/model/isolation/agentType。它是产品说明，不宜据图示补造完整函数签名。[C11]
**推断/建议：** 学习其“模型生成、runtime 执行、结果重放”的分工；Helm 采用显式步骤身份，避免依赖调用序号的后缀失效规则。不能照抄社区脚本遇 null 时弃票、裁判失败默认 A 赢的策略。[C1][C12][C13]

**Mastra 资料差异（事实）：** control-flow 快速表写 branch “仅一支”；dynamic definition 明确 conditional 运行所有 predicate=true 的分支；TS builder 将 branch 构建为 conditional，执行源码收集所有 truthy 分支并行运行。JSON dynamic 还明确是 beta，可能在没有 major bump 时出现破坏性变化。[M1][M2][M3][M8][M10]
**推断/建议：** Helm 的独占分类应显式定义 exactly_one 与 unknown 路径；不能从名称 branch 推断互斥。Mastra dynamic 的注册前验证、定义持久化和旧 run 保留原图值得参考，但不据此推断任意崩溃窗口的外部副作用恰好一次。[M2][M3]

### 1.3 Codex CLI：本机检查与源码证据

**本机检查：** 可执行文件 `~/.codex/packages/standalone/current/bin/codex`；以下缩写 `$CODEX_BIN` 仅代表该绝对路径，实际命令均使用绝对路径。所有检查离线，不启动模型，不读写报告/会话。

| 编号 | 命令 | 实际结果及证明范围 |
|---|---|---|
| L1 | `$CODEX_BIN --version` | exit 0，codex-cli 0.160.1。 |
| L2 | `$CODEX_BIN features list` | exit 0；multi_agent stable true；multi_agent_v2 stable false。stable 与是否启用是不同列，不能把 V2 当已启用。 |
| L3 | `$CODEX_BIN exec --help` | exit 0；有 --json、--output-schema、-o、--ephemeral、-C、-s、resume/fork/review。 |
| L4 | `$CODEX_BIN exec resume --help` | exit 0；resume 有 --json、--output-schema、-o，可 UUID 或线程名定位。 |
| L5 | `$CODEX_BIN exec resume 00000000-0000-0000-0000-000000000000 --json --output-schema research/scratch/absent.schema.json -o research/scratch/absent.output.json --help` | exit 0，打印 help；证明解析器接受组合，不证明会话存在、schema 合法或输出合规；没有创建 scratch 或输出文件。 |
| L6 | `$CODEX_BIN exec -C /Users/dikui/Project/Helm -s read-only -c 'approval_policy="never"' --disable multi_agent resume 00000000-0000-0000-0000-000000000000 --json --output-schema research/scratch/absent.schema.json -o research/scratch/absent.output.json --help` | exit 0，打印 help；证明工作目录/沙箱/配置放在 resume 前的语法可解析，不证明恢复后的权限强制效果。 |

上述命令均伴随“无法创建 PATH aliases：Operation not permitted”警告，未影响各项输出/退出码。**未核实：** 真模型结构化结果、拒绝/截断处理、断电/崩溃恢复、继承权限和子代理树恢复；为遵守服务限制未做端到端推理。

**源码事实：** 0.160.1 的 output-schema 是 global 参数；exec resume 分支读取 schema 后传入 TurnStart。读取/JSON 解析失败会 exit 1；这一函数只解析 JSON，不能推出本地已完整验证 JSON Schema。[X5][X6]
**源码事实：** JSONL 有 thread.started/thread_id、turn.started/completed/failed、item.*、error；agent_message.text 为最终文本或 JSON 字符串，collab_tool_call 有线程关联信息。CLI 事件字段需按版本解析，不能当业务 verdict。[X8]
**推断/建议：** 标准输出事件与 -o 最终结果分别保存；由 Helm 再做 schema、产物、测试证据校验。外部每个步骤用一个 exec 进程，可明确定义并发与恢复边界；CLI 内置多代理可用于探索，但不能替代 runtime 的编排日志。[X4][X8]

## 2. 编排如何生成

以下为**比较推断/建议**；所列已有项目用法是来源所展示的事实，不能把“框架用代码定义”自动说成“框架默认让模型自由写代码”。[C1][O2][M2]

| 方式 | 可控性、可审阅性 | 校验方式 | 安全边界与适用场景 | 已有项目 |
|---|---|---|---|---|
| 模型自由写代码 | 灵活，能为任务创造新循环/数据变换；静态推导成本、完整步骤和副作用困难，审阅者需懂运行语义。 | 语法/AST/类型检查、接口白名单、限额分析、模拟重放；这些不能单独证明代码安全或最终会终止。 | 需语言能力限制与 OS 故障隔离；只让代码调用受控 capabilities；运行前冻结脚本。适合较成熟执行器。 | Claude dynamic 明确由主对话写 JS；LangGraph/Mastra static/Temporal/SDK 通常由开发者写代码，框架本身不保证模型生成安全。[C1][L1][M1][T1][O2] |
| 从模板选择并填参数 | 形状固定，参数 diff 容易审阅，成本/覆盖/终止可预估；复杂任务需要组合或增加模板。 | template_id/version 白名单、参数 schema、测试引用、资源上限、输入绑定/权限校验；拒绝塞入任意 JS 的“条件参数”。 | 模型只选择受准许操作，runtime 解释模板；低开发与审阅负担，适合 demo。 | cookbook 示例是预写形状，orchestrator 只生成 XML 子任务；autoresearch 是 prompt 约定；CrewAI 预定义 Flow、AgentKit 预定义 tools/router + 模型逐轮选择，不等于先生成完整受控计划。[C5][C7][A1][F1][I1] |
| 受约束 JSON/DSL | 可表达有限图与模式组合，步骤、依赖、预算可见；复杂纯计算需注册受信步骤。 | JSON Schema 后做引用、类型、图/受控循环、可达性、独占分支、权限及上限校验；拒绝未知 op、表达式代码、动态模块。 | 数据由受信解释器执行，仍要约束 agent 能力；结构合规不代表业务正确。 | Mastra beta dynamic 使用可持久 JSON graph；CrewAI main 新声明式入口的发布范围未核实；SDK 的结构化分类是数据路由，不能说其自动生成完整持久化 DSL。[M2][M3][F2][O2][O12] |

**推断/建议：** Helm 用“模板选择/填参 → 受约束 JSON 计划”，两者结合。主对话可按任务生成枚举器、工作者、评价者的指令与输入绑定；runtime 只验证规则、调度和执行明示条件。分类、质量判断由代理/人返回有依据的决定；确定性命令/数值比较由受信执行器完成。[H1][H2][M2]

**建议校验分层：** ①字段/枚举/形状；②步骤 ID 唯一、引用存在、输入输出兼容；③只允许显式 bounded loop，其他依赖无环；④必填并发/调用/重试/时间上限、预算不能超过节点授权；⑤测试/席位/工具/目录不得提权或放宽；⑥预览展开后的步骤/分支/循环边界和预计最大工作量。任一失败返回具体错误让主对话改计划，不在 runtime 中“聪明修复”。依据是已有 schema、控制流、权限分离能力的设计推断。[M3][L1][H1]

## 3. 模型代码如何安全执行

### 3.1 沙箱比较

左列资料为**事实**，最后一列为**推断/建议**；未在本机做逃逸、OOM 或压力试验。

| 方案 | 已核实能力及限制 | Helm 适用判断 |
|---|---|---|
| Node vm | 独立 V8 context、timeout、codeGeneration 限制；官方明确不是安全机制。异步队列/注入的宿主回调不一定受同一次 timeout 覆盖。[S1] | 不作为不可信模型代码边界；无 require/AST 黑名单不足以证明安全。 |
| Node Permission Model | 可限制资源访问；官方定位为可信代码误操作保护，不保证恶意代码安全。[S2] | 作为纵深防护；需锁定 Node 版本后验证支持项，不能代替 OS 隔离。 |
| isolated-vm | 不默认附带 Node 能力，支持 isolate/timeout/memoryLimit；内存限额为近似，恶意代码可用至约 2–3 倍；泄漏 Reference 等可返回 Node host，OOM 可殃及进程，项目处维护模式。[S3] | 独立进程运行，只传 JSON；不传宿主引用、数据库或进程对象；外层 watchdog/内存约束仍必要。 |
| 原生 QuickJS | C API 有 memory/stack limit 和 interrupt handler；qjs CLI 的 std/os 提供文件、环境、popen 等能力。[S4] | 用不注册 std/os/native modules 的嵌入引擎；不能直接把 qjs CLI 当零权限沙箱。 |
| quickjs-emscripten（WASM） | 默认无 host API；可限内存/栈/执行、控制 module loader；Promise job 要宿主推进、句柄要释放；项目声明尚未安全审计。[S5] | 若后续支持脚本，优先评估独立进程中的 WASM 引擎，加总截止时间；该选型安全性尚未实验核实。 |
| 独立进程/容器 | 进程隔离故障；Docker namespaces/cgroups/seccomp 限制访问/资源，但默认没有 CPU/内存上限，宿主挂载、daemon/socket、capabilities 是边界组成部分。[S6][S7][S8] | 最小权限 UID、只读 rootfs、无宿主/凭证/socket 挂载、禁网络、显式 CPU/内存/PID 上限；容器本身不能证明脚本不能启动任意命令。 |

### 3.2 禁止编排脚本直接操作文件/命令

**推断/建议：** demo 直接解析 JSON/DSL，不 eval JS，也不允许条件/映射字段藏 JS。若允许代码，guest 只得到 agent/join/timer/gate 等小接口，采用 JSON 消息与 host broker 通信；不提供 fs、shell、process、require/import loader、通用 fetch、环境变量、原生宿主引用。关闭动态加载和字符串代码生成只是纵深措施，外层仍限内存、墙钟时间和消息大小。[S1][S3][S4][S5]

**推断/建议：** broker 不接受模型提供的任意二进制路径、shell command 或文件路径；只接受注册 agent/test ID、受校验参数和范围内的 artifact ID。每个 capability 再检查席位、目录、并发、预算；编排沙箱禁止 I/O，不代表受授权的 Codex 子进程也没有 I/O，执行/测试能力应单独在工作现场限制。[H1][X4][S3]

**推断/建议：** 编排进程不挂载仓库、runtime DB、会话目录或凭证；Codex 的工作目录与证据目录由 host 管理。CLI read-only 只表明写限制，不能据此保证看不到执行过程；独立核对还要限制可读资料/会话日志，并启动新上下文。[H1][X4]

## 4. 中断恢复与幂等

### 4.1 三种恢复机制及确定性

| 机制 | 已核实行为 | Helm 的推断 |
|---|---|---|
| 会话续跑 | Codex resume 和 SDK Session 继续对话；SDK RunState 可恢复审批暂停。[X4][O8][O9] | 保留知识/待处理调用，但不据此推断外部命令未重复；与 runtime 步骤恢复分层。 |
| 图检查点 | LangGraph checkpoint + thread_id；Command(resume=...) 会从含 interrupt 的节点开头重新跑；Mastra snapshot 保存执行路径，CrewAI 的 state hydration 与 checkpoint 不同。[L3][L4][M5][F3] | 记录清晰步骤边界；人工关卡前的副作用必须幂等或拆成已完成步骤。 |
| 日志重放 | Temporal 历史驱动重放，已完成 Activity 结果复用；Claude 按调用启动顺序复用，但失败/改 prompt 使后缀重跑。[T8][T9][C1] | 复用已落盘输出；冻结版本/输入，避免恢复时重问模型或重新分类/枚举。 |

**事实：** Claude JS 禁 Date.now/Math.random/无参 new Date；Temporal TS 则替换 Date、Math.random、setTimeout 为历史驱动的确定性版本。不能把两者统称为“SDK 禁止这些 API 名字”；禁止的是未经记录的宿主实时值/随机值。[C1][T1][T12]

**推断/建议：** JSON 计划只读取事件/结果中的数据；时间、随机种子、轮询观察、人工决定由 runtime 首次取得后写入日志。枚举顺序、并行结果消费排序、分支决定也必须稳定；限制 Date/随机数只是必要约束的一部分，不能保证重放确定性。[T9][T12][C1]

**推断/建议：** 冻结 plan/template/evaluator/schema/context 的 version/hash；逻辑步骤身份为 run + step + iteration + item_id，重试另加 attempt。完成记录与依赖解锁同事务；恢复先确认日志、产物 hash、存活进程/会话，再决定继续、重试或转无法验证。计划改变产生新版本，显式失效受影响结果，不静默替换运行中脚本。[H1][T9][L5]

### 4.2 副作用不能只靠“已完成步骤不重跑”

**事实：** 外部操作成功、完成回执尚未落盘时崩溃，是重复执行窗口；Temporal 推荐 Activity 幂等，并不自动令所有目标系统 exactly-once。“先查不存在再写”也有竞态，需要目标端幂等键、唯一约束或原子条件操作。[T13]

| 操作 | 推断/建议：执行前固定 | 推断/建议：恢复与去重 |
|---|---|---|
| 通用外部写入 | operation_id、目标、request_hash、expected_version、approval_id；先持久化 intent，幂等键不含 attempt。 | 以同一键执行、存 receipt；恢复先查目标/reconcile；回执未知记无法验证，禁止盲目重试。[T13][O9] |
| Git 提交 | 已批准 diff/tree、parent HEAD、提交元数据；受信操作器产生并记录候选 commit SHA。 | 查询对象/ref 是否已到目标；重做 git commit 使用新时间会改变 SHA，不能视为同一次操作。update-ref 可核对 old SHA 后更新，冲突停下。[G1][G2] |
| 合并 | 被验收的源 commit、目标 expected HEAD、合并结果及授权。 | 比较目标 ref/合并回执；目标变化需重新处理冲突和授权范围。不要只凭“分支名存在”认定完成。[G1][H1] |
| 发布 | 内容 hash、不可变版本/目标路径、目标支持的幂等键或版本条件。 | 用回执或内容/版本核对；HTTP If-Match 是条件写机制，不能普遍替代幂等协议；无可靠查询/原子条件的目标保留未知并交人处理。[G3][T13] |

**推断/建议：** 不可逆/对外动作保留人的决定，审批绑定具体内容 hash 和目标版本；elapsed time 不等于批准。事务 outbox 可协调本地 intent 与派发，但仍需消费端去重；只有双方明确提供事务/幂等契约时才谈恰好一次的业务效果。[H1][T13][O9]

**事实：** Temporal History 有大小/事件数量限制，长期流程可 Continue-As-New；这会创建新 Run 和历史，需显式传状态。[T8][T14]
**推断/建议：** Helm 压缩日志/续 Run 时仍保留累计预算、最佳结果、已处理清单和 operation_id，不能利用新 Run 重置总上限。[T14][H2]

## 5. 全部 15 个模式的参考与模板

**统一规则（推断/建议）：** 所有模板都带 input bindings、agent/test/evaluator ID 与版本、output schema、证据要求、失败策略、并发/总调用/每步尝试/总轮次/墙钟/用量上限。表中参数是建议字段，**不是已存在的 Helm API**。条件由已登记命令、代理或人产出，runtime 只校验与应用；内部评价不取代节点最终核对/挑错与人验收。[H1][H2][O12]

| 每项验证状态（建议英文编码） | 如何产生 | 对应执行状态与验收含义 |
|---|---|---|
| 通过 pass | 固定测试/证据核对明确满足项目要求，记录 test_id、方法、verifier、产物版本和依据。 | exec 结束、JSON 合法均不足以直接通过；通过仍受节点验收规则约束。[H1][O12] |
| 失败 fail | 固定测试明确不满足或证据能证伪；人工关卡明确拒绝。 | 保存失败证据与 correction；执行器崩溃另有 failed phase，未必证明业务测试失败。[H1][H2] |
| 无法验证 unverifiable | 已尝试处理/检查，但缺证据、裁判无结果、评估器错误、外部效果未知或冲突无法判定。 | 不当作通过、弃票或“默认胜”；需要补证据或按授权交其他核对/人。[H1][H2] |
| 未处理 unprocessed | 未派发，因依赖、分流不选中、预算/取消而未处理；附原因与是否必需。 | 预期全集保留空槽；不能删掉槽位以提高通过率。waiting/running 是独立阶段，进行中保留非最终 verdict。[H1][H2] |

以下“参考”栏为**事实/参考形状**；参数、终止和证据栏全部是**推断/建议**。源码参考表示已存在该形状，不表示已做 Helm 所需权限、限额或持久化；仅 prompt/组合原语的参考会明确注明。

| # / 模式 | 找到的参考实现或形状 | 建议模板参数 | 终止条件与硬上限 |
|---|---|---|---|
| 1 单步 | cookbook llm_call；SDK Agent/Runner。[C8][O3] | agent、输入、schema、test_ids、产物范围。 | 获得并验证一次结果；每步 timeout/max_attempts，异常按固定策略停止。 |
| 2 顺序 | cookbook chain；SDK deterministic.py。[C5][O4] | steps、输入输出绑定、前置条件、stop/continue 策略。 | 必需步骤全部结束；前置失败/无法验证阻断后续；最大 steps、总预算与截止时间。 |
| 3 并行汇总 | Claude fanout-and-synthesize；Temporal Promise.all。[C11][T3] | branches、concurrency、join=all/显式 quorum、partial_policy、synthesizer。 | barrier 收齐或达到截止时间；quorum 必须预先授权，缺席项不能消失；分支数/并发/调用数有界。 |
| 4 批量清单 | Claude 文件迁移逐项验证；LangGraph Send map-reduce；cookbook 动态子任务。[C1][L2][C7] | enumerator、冻结 manifest/item_id/source、worker、per_item_validator、覆盖规则、并发。 | 枚举冻结后逐项处理→逐项验证；全覆盖或限额终止；max_items、每项尝试、总调用/时间。 |
| 5 分类分流 | cookbook route；SDK 结构化分类后选代理。[C5][O2] | classifier、categories、路由表、unknown/fallback、独占/多选策略。 | 获得合法类别后进入所选支；无类别/多匹配不能猜测；最多分类尝试、分支数与总预算。 |
| 6 生成-验证 | cookbook evaluator-optimizer；Claude 测试修复循环；SDK llm_as_a_judge。[C6][C1][O5] | generator、固定 validator/tests、feedback、max_rounds、同错/无进展阈值。 | 必需测试全部 pass 才成功；fail 可返工；unverifiable 补证或阻塞；轮数/无进展/时间上限先到先停，禁止改松测试。 |
| 7 指标优化 | autoresearch program.md 的基线→实验→指标→keep/reset，**prompt 纪律而非 durable 实现**。[A1] | metric/direction、baseline、固定评估器/环境/数据、epsilon、候选现场、incumbent、rollback、target。 | 达目标/轮数/无提升阈值/预算终止；仅合法可比指标改善才替换 incumbent；回退只作用于隔离现场。 |
| 8 轮询等待 | Temporal Polling + durable timer/Child Workflow。[T4] | probe_id、target、predicate、interval/backoff、max_polls、deadline、失败终态。 | 观察满足条件或明确失败终态；错误重试有界，到期不得当成功；next_due 持久化，停止/恢复不重置累计轮询。 |
| 9 对抗验证 | Claude 官方形状；社区 adversarial-verification 脚本。[C11][C12] | 主张清单、只读 challenger、回应者、独立核对、有效证据规则、max_rounds。 | 每条质疑有证据回应且独立核对达标；未答/无法核实不能算“未被反驳”；总质疑/轮次/时间有界。 |
| 10 多视角评审 | cookbook stakeholders parallel；Claude 投资人/客户/竞品视角示例。[C5][C11] | perspectives、共同 rubric、各视角 scope、reviewers、冲突处理、required_checks。 | 必需视角完成并解决必需冲突；最大视角数/并发/轮数；不以简单多数抹掉关键阻断项。 |
| 11 best-of-N | SDK parallelization.py 三译文选最佳；社区 generate-and-filter。[O13][C14] | N、生成差异、硬门槛、评分 rubric、selector、top_k、去重、平分规则。 | N 个槽位评价后选择合格候选；全部有效验证且不合格为 fail；未评价/裁判无结论导致有效数量不足为 unverifiable；N/top_k/尝试/预算有界。 |
| 12 竞赛比较 | Claude tournament；社区脚本相邻配对、fresh judge、奇数轮空。[C11][C13] | candidates、赛制/配对 seed、judge、rubric、draw/bye/rejudge、round_limit。 | 得到有有效裁判证据的赢家或上限；裁判 null 不默认 A 胜；轮数/重判/候选数有限。 |
| 13 人工关卡 | LangGraph interrupt；SDK HITL/RunState；Temporal approval。[L3][O9][T15] | gate_id、授权人、decision schema、批准对象 hash、理由、deadline、reject/expire 路径。 | approve 才放行；reject 为拒绝终态；到期结束本次等待并进入 expired/blocked，升级另设次数/总等待上限，绝不自动批准。Claude 单个 workflow 中途输入**未提供**。[C1] |
| 14 对齐点 | parallel barrier；LangGraph 分支汇合/Send reducer；Temporal 受控 join。[C1][L1][L2][T3] | milestone、required branches/items、接口/schema版本、join policy、缺席/冲突处理。 | 收齐约定结果且接口验证合格；语义分歧交指定代理/人；最大等待/重对齐轮次，不暗自选择一个版本。 |
| 15 定时触发 | Temporal Schedules；Claude workflow 与 /loop 组合（组合形状）。[T16][C11] | calendar/interval、timezone、start/end、max_runs、catchup、overlap、occurrence_key。 | 每个 due slot 最多启动一个逻辑 run；结束日/次数/总预算终止；错过/重叠按显式策略，触发本身不等于交付通过。 |

| # / 模式 | 逐项状态具体如何产生（推断/建议） | 交核对者的证据（推断/建议） |
|---|---|---|
| 1 单步 | 本项按固定检查得 pass/fail；检查无结论 unverifiable；尚未派发 unprocessed。 | 输入范围、schema检查、产物 hash、实际检查及输出。 |
| 2 顺序 | 各步骤保留自身 verdict；依赖阻断的后续 unprocessed；最后完成不覆盖早期 fail/unverifiable。 | 步骤依赖、输入来源/输出 hash、每步结果与停止原因。 |
| 3 并行汇总 | 各分支独立检查；错误/缺证据 unverifiable，未启动 unprocessed；汇总结论另查，不能“继承全通过”。 | 预期分支全集、逐分支依据、缺席原因、汇总与原文引用对应。 |
| 4 批量清单 | 冻结清单每个 ID 必有四态之一；只处理未验证为 unverifiable，未处理为 unprocessed；枚举完整性单独核对。 | 枚举来源/全集 hash、处理与验证分母、逐项产物/测试、漏项/重复/无法验证列表。 |
| 5 分类分流 | 分类证据符合路由约定才 pass；无效类别/无结论 unverifiable；未选分支 unprocessed 并标“不适用”；选中支另查。 | 分类输入、类别/依据、路由表版本、选择记录、fallback及覆盖证明。 |
| 6 生成-验证 | 每轮记录原 verdict；fail 保留反例，unverifiable 不推动成功条件；上限停止未开始轮次 unprocessed，不能把最后候选自动通过。 | 固定测试版本、基线、每轮 diff/hash、命令输出/核对意见、失败方法和 correction。 |
| 7 指标优化 | 候选检查与 keep/discard 分离；合规但更差仍可 pass 并 discard；评估崩溃/不可比为 unverifiable，未实验为 unprocessed。 | 基线/候选、指标原始日志/环境/评估器 hash、比较计算、最佳链和回退凭据。 |
| 8 轮询等待 | 等待中记录非最终观察；满足条件 pass，明确失败终态 fail；到期/探测错误无结论 unverifiable；未查询对象 unprocessed。 | 时间戳、探测响应、全部观察、持久 timer/next_due、停止原因。 |
| 9 对抗验证 | 每条 claim/挑战可 pass/fail/unverifiable；未核对 unprocessed；“无人反驳”不是 pass，须实际独立检查与证据。 | 主张→挑战→回应→核对链，证据来源及 hash，独立上下文范围。 |
| 10 多视角评审 | 每视角每条 rubric 四态；冲突未解 unverifiable；缺席未派发 unprocessed；综合风险独立记录。 | 视角职责/输入、原始评审、关键风险/冲突、处理决定和依据。 |
| 11 best-of-N | 每候选先检查四态，再写 selected/rank；落选不自动 fail；裁判无输出为 unverifiable，未生成槽 unprocessed。 | 全候选及 hash、门槛/评分/去重依据、排序、有效数量、选中理由。 |
| 12 竞赛比较 | 候选合规 verdict 与胜负分离；每局裁判有依据才定胜负，unverifiable 重判或停止；轮空不是质量 pass。 | 全部候选、赛程/seed、各局评判/平分/重判/轮空、最终选择依据。 |
| 13 人工关卡 | 明确批准为关卡 pass、拒绝 fail；待定保持 waiting 及非最终 verdict，过期无决定为 unverifiable；未到关卡 unprocessed；产物测试独立。 | 人的决定、身份、时间/理由、被批准内容 hash、单次消费记录。 |
| 14 对齐点 | 必需接口确定性检查通过才 pass；明确不兼容 fail；语义冲突待判 unverifiable；未到达分支 unprocessed。 | 上游全集及版本、接口检查、差异/缺席列表、协调决定；不得送执行者私有复核思路。 |
| 15 定时触发 | 各 occurrence 保留运行/验证四态；trigger fired 只写调度事件；missed/skipped 附原因，未启动 unprocessed。 | scheduled/actual 时间、时区与触发配置版本、去重键、错过/重叠记录、各次测试。 |

**推断/建议：** 核对包包含项目/测试、被核对产物与可追溯证据、覆盖清单/缺项、必要环境信息；完整执行日志留作审计，不默认把执行对话或执行者判断路径送入核对上下文。内部 loop 的评价者可看反馈，但节点最终核对仍应全新上下文。[H1][H2]

**参考的边界（事实）：** cookbook evaluator-optimizer 没有数值指标保优回滚；autoresearch 有这种操作纪律，却无引擎强制总上限；社区 tournament 裁判失败默认 A，adversarial 的 null 可缩小有效票数。它们提供形状，不满足上述四态与核对证据契约。[C6][A1][C12][C13]
**参考的边界（事实）：** LangGraph list join 与各自独立 incoming edges 的语义不同，后者可能多次运行下游；非执行分支不能随意放入必需 join；其 map-reduce 示例 best_joke 含硬编码选择，不宜当真实质量评分器。[L8]
**推断/建议：** Helm 显式记录所选分支、必需集合及 barrier 消费次数，依赖图需验证每个汇合点的完整性和单次执行条件。[L8][T3]

## 6. 给 Helm 的建议

### 6.1 表示、生成与执行分工（推断/建议）

建议采用版本化 JSON 计划：顶层为 node/project_version、plan_id/version/hash、template_id/version、inputs/context/schema/evaluator 引用、limits；步骤只允许 agent、registered_test、sequence、parallel_join、foreach、branch、bounded_loop、gate、timer。此处是建议词汇，不是实现 API；所有模型产生的条件为类型化结果，条件表达式只允许字段比较、布尔连接和固定数值比较。[M2][M3][H1]

动态范围由“枚举步骤返回有 schema 的清单”与“分类步骤返回枚举值”实现；清单落盘冻结后，runtime 按稳定 item_id 展开模板，不让模型在运行中任意插入无上限步骤。仍保留节点一个负责交付的执行代理；内部子代理是它的执行手段，多专业业务责任拆节点的现有规则需在后续规格中明确协调，不能在调研文档中悄悄改掉。[C7][L2][H1]

主对话负责理解任务、选模板/填参、提出变更；runtime 负责静态验证、权限、调度、计数/终止、日志/恢复；命令/核对代理/挑错代理/人分别负责已有四类测试。子编排不得改项目测试、改变席位或自行验收。[H1][H2]

### 6.2 日志与限额（推断/建议）

| 记录 | 建议内容与用途 |
|---|---|
| 计划/环境 | plan/template/schema/evaluator/context/input hash、项目版本、CLI版本、模型/强度、权限配置、基线 worktree/产物；变化能定位失效范围。[H1][T9] |
| 稳定身份 | run/step/item/iteration/attempt；逻辑 identity 不随重试变化，operation_id 去重与审计关联。[T13] |
| 追加事件 | planned/dispatched/started/progress/result_received/result_validated/completed/failed/canceled/waiting/reconciled；含序号、时间、actor、thread_id、exit code、原因；状态快照可从日志重建。[T8][X8] |
| 结果/证据 | 原始 JSONL、stderr、-o 内容引用、解析/schema结果、产物 hash、测试版本/命令/退出码/核对者、四态 verdict、selection/rank/metric；完成与通过分离。[X8][H2] |
| 控制/恢复 | budget reservation/已用/取消、timer next_due、人工决定、lease/owner、结束原因、现场核对、幂等 intent/receipt；完成与依赖解锁原子落盘，按第4节恢复。[T13][O9] |

SQLite + 受管理证据文件足够支撑本地 demo；日志元数据引用文件 hash，写产物后再原子提交引用，恢复识别未引用临时文件。独立核对按上下文包读取证据，所有写状态走 runtime。[H2]
并发、总调用、轮数、重试次数与截止时间由 host 强制；token 用量来自 CLI 事件，不能声称目前有精确执行前封顶的已核实参数。预算应预留、限制启动并发并外层中断，说明在途调用可能超出估算；未证明能逐 token 阻断。[X8][H2]

### 6.3 agent() 映射到 Codex CLI（推断/建议）

建议 demo 一个逻辑 agent step 对应一个独立 exec 进程；并行写任务各用隔离工作现场，汇总只读产物。默认关闭步骤内部 multi_agent，避免隐式 fan-out 绕过 runtime 限额；若开放，则需把子代理事件、用量与权限一并归入该步骤。这里的 agent() 是 Helm 建议接口，不是 Codex 已有同名 CLI API。[X2][X8][H1]

| 动作 | 建议映射与验证 |
|---|---|
| 新执行 | 固定二进制版本；以参数数组调用 `codex exec -C <worktree> -s <allowed_sandbox> -c 'approval_policy="never"' --disable multi_agent --json --output-schema <schema> -o <result> -`，stdin 传上下文。用 argv 传参，不拼接 shell；真实权限效果仍需端到端验证。[X4][X5] |
| 输出读取 | 流式持久化 stdout JSONL、独立 stderr；thread.started 记录 thread_id；-o 读取最终消息并重新 JSON/schema 校验。turn.completed/exit 0 只说明执行完成，还要拿产物跑固定检查。[X8][H2] |
| 返工续跑 | 仅同一执行者继续同一任务时用 `codex exec -C <worktree> -s <allowed_sandbox> -c 'approval_policy="never"' --disable multi_agent resume <UUID> --json --output-schema <schema> -o <result> -`；明确 UUID，禁止依赖 --last 选错并发会话。语法已由 L4/L6 检查，真实恢复未试。[X4][X5][X6] |
| 核对/挑错 | 另起 exec，新上下文，只给项目+所需证据，read-only 并限制可读范围；不 resume 执行者会话。不把只读等同于上下文/资料隔离。[H1][X4] |
| 崩溃/取消 | host 记录 intent/已知 thread、退出码/终止理由；恢复先核对现场与运行状态，成功步骤复用落盘结果；未知副作用转人工核对，resume 不视为去重。[X3][T13] |
| 错误/拒绝/缺输出 | schema 无效、输出缺失、模型拒绝/截断、工具错误、超时分别记录；是否 retry 由注册策略和剩余预算决定，缺验证结论不能传 pass。[O12][X6][H2] |

**事实依据：** output-schema 约束最终输出形状，不限制模型执行命令/写文件；Structured Outputs 有 schema 子集、拒绝及错误边界。runtime 仍需做业务校验、权限与输出大小约束。[X4][O12]
**推断/建议：** 需要恢复的步骤不使用 ephemeral；不把 CLI 自己的会话文件当 Helm 唯一证据日志。执行进程只能写工作现场，核对进程只能读指定证据；权限配置和代理工具按席位从注册表取得，不能由计划任意提高。[X4][H1]

### 6.4 Demo 最小模板集合（推断/建议）

| 顺序 | 模板/能力 | 原因与验收演示 |
|---|---|---|
| P0 | 单步 + 顺序 | 先打通 schema、四态结果、日志和 resume 返工；内部动作与节点最终验收分开。[X4][H1] |
| P0 | 并行汇总 | 展示多来源工作、全分支证据、独立汇总；演示一支失败/超时后仍保留全集与已完成结果。[C11][T3] |
| P0 | 批量清单 | 将“枚举→逐项处理→逐项验证”做成完整模板；演示缺项、重复项、无法验证和中断续项。[C1][L2] |
| P0 | 有界生成-验证 | 固定测试不放宽、返工反馈、失败尝试记录；演示达到轮数/预算上限后的部分报告。[C6][H2] |
| P0 控制能力 | 人工关卡 | 作为可组合 gate，绑定具体 hash；副作用未知不自动重试；最终验收保持现有席位规则。[L3][O9][H1] |
| P1 | 分类、轮询/timer、对齐 | 在上述结果/日志契约稳定后加；对齐先由 join + 固定接口检查组合，无需另写自由脚本。[O2][T4][L1] |
| P2 | 指标优化、best-of-N/竞赛、多视角/对抗、定时调度 | 成本、评价独立性、可比性/证据覆盖与副作用要求更高；先复用基础组合，验证语义后再提供独立 UI 模板。[A1][C11][T16] |

### 6.5 未核实清单与交付检查

| 未核实项 | 本次能确定的边界 / 后续验证 |
|---|---|
| Claude 第三方内部 API、导出函数兼容、精确并发公式 | 采用当前官方说明；不以第三方观察承诺接口。未运行 Claude。[C1][C3][C4] |
| Codex 真实 schema 输出、拒绝/截断、resume 权限、进程中断、子代理树恢复 | 仅 L1–L6 离线检查与锁版本源码；后续在获授权的推理环境做完整试验。[X5][X6][X8] |
| 精确 token 硬封顶 | CLI 用量事件已核实，未核实通用逐 token 截断参数；并发在途用量需估算和 host 管控。[X8] |
| 沙箱逃逸/OOM/超时、Helm Node版本及 macOS可用隔离 | 文档与源码调研，不是安全测试；Linux 容器配置不可直接等同本机 macOS。[S1][S3][S5][S6] |
| 发布目标幂等、条件写、查询回执契约 | 目标未指定；不能泛称 exactly-once，需要逐目标核实。[T13][G3] |
| autoresearch 独立 LICENSE 文件 | README 声明 MIT，根 LICENSE 为 404；正式授权范围未核实。[A2] |
| 托管/企业版与 beta API 稳定性 | 只调研公开库和当前公开文档，不推断托管版合同或未来兼容性。[L6][M2] |
| CrewAI 声明式/完整 checkpoint 的发布范围、通用 Flow step 重试 | main 源码存在，但与已发布版本的对应/稳定性和全局重试契约未核实。[F2][F3] |
| AgentKit 最终文本严格 schema；Mastra 任意崩溃窗口的完整恢复 | 已核实工具 schema、snapshot/resume/restart；未核实它们对任意最终文本或外部副作用的普遍保证。[I3][M5][M6] |

**本次交付检查：** 只新增本文件；research/scratch 未创建，已检查不存在；未修改已有文件。任务开始时 git status 已有未跟踪 tasks/003-research-workflow-templates.md，原样保留；因此“只新增交付物”按本次变更与起始基线比较，不能通过删除用户已有任务文件达成字面上的单行 status。

## 来源列表

下列链接均为本次已阅读的资料；编号在正文就近使用。C3/C4/C12–C14 为第三方，其余外部来源优先官方文档/源码；A1 为作者的 prompt 示例。源码未运行，不代表通过端到端验证。

- [H1] — Helm FEATURES.md v3。
- [H2] — Helm DESIGN.md：架构、独立核对与长任务纪律。
- [H3] — 本任务 003：runtime 分工与调研范围。
- [C1] — Claude Code 官方 workflows：API示例、保存、上限、错误、恢复。
- [C2] — Claude Code 仓库 LICENSE.md。
- [C3] — FlorianBruniaux 社区 dynamic workflows 指南。
- [C4] — Akshay Parkhi 实测文章，2026-05-29。
- [C5] — cookbook basic_workflows.ipynb。
- [C6] — cookbook evaluator_optimizer.ipynb。
- [C7] — cookbook orchestrator_workers.ipynb。
- [C8] — cookbook util.py。
- [C9] — cookbook async_multi_agent_orchestration.ipynb。
- [C10] — cookbook LICENSE。
- [C11] — Anthropic 员工署名动态工作流博客，2026-06-02。
- [C12] — rawwerks 对抗验证脚本。
- [C13] — rawwerks 竞赛脚本。
- [C14] — rawwerks 生成筛选脚本。
- [O2] — Agents SDK Python orchestration 文档源码。
- [O3] — OpenAI 官方 Agent definitions。
- [O4] — Agents SDK deterministic.py。
- [O5] — Agents SDK llm_as_a_judge.py。
- [O6] — Agents SDK running_agents.md：run 上限、错误、持久化集成。
- [O7] — Agents SDK retry.py。
- [O8] — Agents SDK Sessions 文档源码。
- [O9] — Agents SDK HITL/RunState 文档源码。
- [O10] — Agents SDK Python LICENSE。
- [O11] — Agents SDK TS LICENSE。
- [O12] — OpenAI Structured Outputs 指南。
- [O13] — Agents SDK parallelization.py。
- [X1] — Codex 官方 Subagents 文档。
- [X2] — Codex 0.160.1 多代理工具定义源码。
- [X3] — Codex 0.160.1 agent/control.rs。
- [X4] — Codex 官方非交互模式。
- [X5] — Codex 0.160.1 exec CLI 参数源码。
- [X6] — Codex 0.160.1 exec 主逻辑/schema读取。
- [X7] — Codex LICENSE。
- [X8] — Codex 0.160.1 JSONL 事件定义。
- [L1] — LangGraph Graph API。
- [L2] — LangGraph workflows/agents：Send、map-reduce。
- [L3] — LangGraph interrupt。
- [L4] — LangGraph persistence。
- [L5] — LangGraph Checkpointers：superstep 与 pending writes。
- [L6] — LangGraph LICENSE。
- [L7] — LangGraph fault tolerance：节点重试。
- [L8] — LangGraph use Graph API：循环、fan-in、map-reduce 示例。
- [L9] — LangGraph Functional API 文档源码。
- [M1] — Mastra control flow。
- [M2] — Mastra beta dynamic workflows。
- [M3] — Mastra dynamic workflow definition。
- [M4] — Mastra error handling。
- [M5] — Mastra snapshots。
- [M6] — Mastra suspend/resume。
- [M7] — Mastra overview/restart。
- [M8] — Mastra control-flow 执行器源码。
- [M9] — Mastra 分区许可证。
- [M10] — Mastra workflow builder 源码。
- [F1] — CrewAI Flows。
- [F2] — CrewAI main FlowDefinition 源码。
- [F3] — CrewAI main Flow runtime 源码。
- [F4] — CrewAI LICENSE。
- [I1] — AgentKit Networks。
- [I2] — AgentKit State。
- [I3] — AgentKit multi-step tools。
- [I4] — AgentKit retries。
- [I5] — Inngest durable execution。
- [I6] — AgentKit LICENSE。
- [T1] — Temporal TS Workflow basics。
- [T2] — Temporal Activities。
- [T3] — Temporal parallel execution。
- [T4] — Temporal polling。
- [T5] — Temporal TS payload converter 源码。
- [T6] — Temporal retry policies。
- [T7] — Temporal TS Activity timeout。
- [T8] — Temporal Event History。
- [T9] — Temporal Workflow definition/确定性。
- [T10] — Temporal Server LICENSE。
- [T11] — Temporal TS SDK LICENSE。
- [T12] — Temporal TS global-overrides 源码。
- [T13] — Temporal 官方幂等与 durable execution 文章。
- [T14] — Temporal Continue-As-New。
- [T15] — Temporal approval pattern。
- [T16] — Temporal TS Schedules。
- [S1] — Node vm 官方文档。
- [S2] — Node Permission Model 官方文档。
- [S3] — isolated-vm README/API。
- [S4] — QuickJS 官方文档。
- [S5] — quickjs-emscripten README/API。
- [S6] — Docker Engine security。
- [S7] — Docker resource constraints。
- [S8] — Docker seccomp。
- [G1] — Git update-ref。
- [G2] — Git commit-tree。
- [G3] — RFC 9110：If-Match。
- [A1] — autoresearch program.md，锁定提交 228791fb499afffb54b46200aca536f79142f117。
- [A2] — autoresearch README（许可声明）。

[H1]: ../FEATURES.md
[H2]: ../DESIGN.md
[H3]: ../tasks/003-research-workflow-templates.md
[C1]: https://code.claude.com/docs/en/workflows
[C2]: https://github.com/anthropics/claude-code/blob/main/LICENSE.md
[C3]: https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/guide/workflows/dynamic-workflows.md
[C4]: https://www.akshayparkhi.net/2026/May/29/claude-code-dynamic-workflows-inside-out/
[C5]: https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/basic_workflows.ipynb
[C6]: https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/evaluator_optimizer.ipynb
[C7]: https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/orchestrator_workers.ipynb
[C8]: https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/util.py
[C9]: https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/async_multi_agent_orchestration.ipynb
[C10]: https://github.com/anthropics/claude-cookbooks/blob/main/LICENSE
[C11]: https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
[C12]: https://github.com/rawwerks/dynamic-agent-workflows/blob/main/languages/claude-code-dynamic-workflows/adversarial-verification.workflow.js
[C13]: https://github.com/rawwerks/dynamic-agent-workflows/blob/main/languages/claude-code-dynamic-workflows/tournament.workflow.js
[C14]: https://github.com/rawwerks/dynamic-agent-workflows/blob/main/languages/claude-code-dynamic-workflows/generate-and-filter.workflow.js
[O2]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/docs/multi_agent.md
[O3]: https://developers.openai.com/api/docs/guides/agents/define-agents
[O4]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/examples/agent_patterns/deterministic.py
[O5]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/examples/agent_patterns/llm_as_a_judge.py
[O6]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/docs/running_agents.md
[O7]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/src/agents/retry.py
[O8]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/docs/sessions/index.md
[O9]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/docs/human_in_the_loop.md
[O10]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/LICENSE
[O11]: https://github.com/openai/openai-agents-js/blob/main/LICENSE
[O12]: https://developers.openai.com/api/docs/guides/structured-outputs
[O13]: https://github.com/openai/openai-agents-python/blob/125efa029b4bfd84238bd2c4fd69c3406f802663/examples/agent_patterns/parallelization.py
[X1]: https://developers.openai.com/codex/multi-agent
[X2]: https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/tools/handlers/multi_agents_spec.rs
[X3]: https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/agent/control.rs
[X4]: https://developers.openai.com/codex/noninteractive
[X5]: https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/cli.rs
[X6]: https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/lib.rs
[X7]: https://github.com/openai/codex/blob/main/LICENSE
[X8]: https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/exec/src/exec_events.rs
[L1]: https://docs.langchain.com/oss/python/langgraph/graph-api
[L2]: https://docs.langchain.com/oss/python/langgraph/workflows-agents
[L3]: https://docs.langchain.com/oss/python/langgraph/interrupts
[L4]: https://docs.langchain.com/oss/python/langgraph/persistence
[L5]: https://docs.langchain.com/oss/python/langgraph/checkpointers
[L6]: https://github.com/langchain-ai/langgraph/blob/main/LICENSE
[L7]: https://docs.langchain.com/oss/python/langgraph/fault-tolerance
[L8]: https://docs.langchain.com/oss/python/langgraph/use-graph-api
[L9]: https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx
[M1]: https://mastra.ai/docs/workflows/control-flow
[M2]: https://mastra.ai/docs/workflows/dynamic-workflows
[M3]: https://mastra.ai/reference/workflows/dynamic-workflow-definition
[M4]: https://mastra.ai/docs/workflows/error-handling
[M5]: https://mastra.ai/docs/workflows/snapshots
[M6]: https://mastra.ai/docs/workflows/suspend-and-resume
[M7]: https://mastra.ai/docs/workflows/overview
[M8]: https://github.com/mastra-ai/mastra/blob/main/packages/core/src/workflows/handlers/control-flow.ts
[M9]: https://github.com/mastra-ai/mastra/blob/main/LICENSE.md
[M10]: https://github.com/mastra-ai/mastra/blob/main/packages/core/src/workflows/workflow.ts
[F1]: https://docs.crewai.com/en/concepts/flows
[F2]: https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/flow/flow_definition.py
[F3]: https://github.com/crewAIInc/crewAI/blob/main/lib/crewai/src/crewai/flow/runtime/__init__.py
[F4]: https://github.com/crewAIInc/crewAI/blob/main/LICENSE
[I1]: https://agentkit.inngest.com/concepts/networks
[I2]: https://agentkit.inngest.com/concepts/state
[I3]: https://agentkit.inngest.com/advanced-patterns/multi-steps-tools
[I4]: https://agentkit.inngest.com/advanced-patterns/retries
[I5]: https://www.inngest.com/docs/durable-execution/durable-workflows
[I6]: https://github.com/inngest/agent-kit/blob/main/LICENSE.md
[T1]: https://docs.temporal.io/develop/typescript/workflows/basics
[T2]: https://docs.temporal.io/activities
[T3]: https://docs.temporal.io/design-patterns/parallel-execution
[T4]: https://docs.temporal.io/design-patterns/polling
[T5]: https://github.com/temporalio/sdk-typescript/blob/main/packages/common/src/converter/payload-converter.ts
[T6]: https://docs.temporal.io/encyclopedia/retry-policies
[T7]: https://docs.temporal.io/develop/typescript/activities/timeouts
[T8]: https://docs.temporal.io/workflow-execution/event
[T9]: https://docs.temporal.io/workflow-definition
[T10]: https://github.com/temporalio/temporal/blob/main/LICENSE
[T11]: https://github.com/temporalio/sdk-typescript/blob/main/LICENSE
[T12]: https://github.com/temporalio/sdk-typescript/blob/main/packages/workflow/src/global-overrides.ts
[T13]: https://temporal.io/blog/idempotency-and-durable-execution
[T14]: https://docs.temporal.io/develop/typescript/workflows/continue-as-new
[T15]: https://docs.temporal.io/design-patterns/approval
[T16]: https://docs.temporal.io/develop/typescript/workflows/schedules
[S1]: https://nodejs.org/api/vm.html
[S2]: https://nodejs.org/api/permissions.html
[S3]: https://github.com/laverdet/isolated-vm
[S4]: https://bellard.org/quickjs/quickjs.html
[S5]: https://github.com/justjake/quickjs-emscripten
[S6]: https://docs.docker.com/engine/security/
[S7]: https://docs.docker.com/engine/containers/resource_constraints/
[S8]: https://docs.docker.com/engine/security/seccomp/
[G1]: https://git-scm.com/docs/git-update-ref
[G2]: https://git-scm.com/docs/git-commit-tree
[G3]: https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1
[A1]: https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/program.md
[A2]: https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/README.md
