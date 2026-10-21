# 调度者运行形态：长时会话还是持久化执行

Type: research
Status: resolved
Labels: wayfinder:research
Map: [Helm v1 设计](../map.md)

## Question

调度者从对齐到审核结束都在。它应该是一条长时 CLI 会话，还是持久化执行（durable execution）形态：状态都在库里，每次被事件唤醒时跑一小步就退出？用户提到"pi durable 这种产品"，要先弄清它指什么。结论交给 [调度者生命周期](06-coordinator-lifecycle.md)。

## Answer

调研结论见 [coordinator-runtime-form.md](../../../docs/research/coordinator-runtime-form.md)（Grok，2026-10-21，一手来源）。

- **"pi durable"** 指 Earendil 于 2026-10-01 随 Pi 1.0 发布的实验包 `@earendil-works/pi-durable`：一个嵌进进程的 agent 运行时，状态存 SQLite，按任务提交、崩溃后恢复，用 `sleepUntil`/`onWake` 等人。它的模型调用走 `pi-ai` 的 API key，没有接订阅 CLI 的适配，不能直接当 Helm 的调度者。Temporal、Restate、DBOS、LangGraph、Inngest 等也一样：模型通道都是 API SDK，看不见 CLI 进程内部的工具调用。
- **倾向：既不是长时会话，也不引入 durable 引擎，而是"短回合"。** 运行层在有新消息、派单结束或失败、决策关卡放行时拉起一次调度者 CLI；调度者读任务库里的简报（工作说明、卡片图、未处理消息、派单结果），通过运行层的工具做完这一轮的操作后退出。等人时不保留进程。对齐这种需要来回对话的阶段，可以在阶段内按 session id 续跑。持久化执行的思想只留在运行层：派单有幂等键，"已派发"写入后不会重复派。
- **对 A1 的影响**：A1 里"一项工作从开始到验收结束期间常驻"与此相反，改由 [调度者生命周期](06-coordinator-lifecycle.md) 决定，A2"新开一个读任务库就能接着干"则更容易成立。
- **推翻条件**：官方 CLI 提供按工具调用记录、重放时跳过已完成副作用的协议，且订阅额度承受得住多日常驻；或者调度者改用 API key、可以嵌 SDK；或者实测一次冷启动加上组装简报的成本明显高于多留几轮。
