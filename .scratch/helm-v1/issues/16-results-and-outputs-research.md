# 其他产品怎样处理派单结果、成果与实时状态

Type: research
Status: resolved
Labels: wayfinder:research
Map: [Helm v1 设计](../map.md)

## Question

其他多 agent 编排或后台编码 agent 产品，怎样区分"执行者交回给调度方的结果"、"执行产出的代码与文件"和"整项工作的实时状态"？调度方读多少、展示给用户多少？用来对照 [核心概念与术语](01-core-concepts.md) Q20 的决定：执行者只交简短的派单结果，成果由运行层保存、在界面上展示，调度者需要时再读，实时状态由事件推出。

## Answer

调研结论见 [results-and-outputs.md](../../../docs/research/results-and-outputs.md)（Grok，2026-10-21，覆盖 11 个产品，依据官方文档）。

- **支持**：上游默认只读一段最终文本，工具轨迹和全文另存，需要时再读（Claude 子代理、Codex `exec`、LangGraph、OpenAI `as_tool`、Orca `worker-read`、Anthropic "外部产物 + 轻量引用"）。给人看的是 diff、PR 等成果本身，汇总只是索引。进程级状态（在跑、在等人、结束）由系统维护，不由模型写。
- **需要收紧**：① 交回的是执行者的**完整最终回答**，不是"几句话"；调度者下一步常要靠其中的具体发现。② "缺信息"在多数产品里是独立通道（Orca `ask`、Devin `waiting_for_user`），不和"完成"混在一种短结果里；Helm 的执行者无人值守、不能停下来问，缺信息只能结束派单，这一点要在 [任务库数据模型](05-task-store-model.md) 里明确。③ 计划和清单通常由模型写；Helm 中卡片图本来就是调度者通过操作写的，运行层只推导状态，不冲突。
