# 调度者生命周期

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 03
Map: [Helm v1 设计](../map.md)

## Question

调度者由谁来当（哪个模型、通过哪个 CLI 或 SDK 运行）？哪些事件会唤醒它，一项工作期间怎么常驻，什么时候退出？上下文快满了怎么交接给新会话？按工作类型加载哪些技能，从哪里加载？
