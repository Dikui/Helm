# 运行层硬约束与调度者工具集

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 05, 06
Map: [Helm v1 设计](../map.md)

## Question

运行层强制执行哪些硬约束（依赖、最多 5 个并发、隔离、验收权、凭据、对外动作……），违反时怎么拒绝、怎么告诉调度者？调度者通过哪些工具（建议以 MCP 提供）操作任务库和派单？哪些事交给调度者的提示词，不做成规则？
