# 调度者实测：按任务库推进与重启接续

Type: prototype
Status: open
Labels: wayfinder:prototype
Blocked by: 02, 06, 07
Map: [Helm v1 设计](../map.md)

## Question

用一个真实的小型软件需求实测：调度者能否只凭任务库和工具集稳定地拆单、派单、处理返工（A1）？中途杀掉调度者，再开一个新会话读任务库，能否接着干（A2）？记录观察到的问题，以及哪些必须挪进运行层的硬约束。
