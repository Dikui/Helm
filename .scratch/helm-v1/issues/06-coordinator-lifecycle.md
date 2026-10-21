# 调度者生命周期

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 03, 17
Map: [Helm v1 设计](../map.md)

## Question

调度者由谁来当（哪个模型、通过哪个 CLI 或 SDK 运行）？哪些事件会唤醒它，一项工作期间怎么常驻，什么时候退出？上下文快满了怎么交接给新会话？按工作类型加载哪些技能，从哪里加载？

## Comments

- 来自 01（2026-10-21）：用户选定调度者为**长时对话**（每项工作一个调度者会话，从对齐到审核），参照 Agent Teams、Factory；未采用 [17](17-coordinator-runtime-form-research.md) 的"短回合"。本单待定：① 上下文满了怎么办：CLI 自动压缩，还是先写外部记忆再换新会话（Anthropic 研究系统做法）；用户不想因压缩丢信息，倾向后者。② 两次唤醒之间进程常驻，还是退出后按 session id 续跑。调度者会话与执行者"每次派单起一个进程"差别很大，需单独设计。
