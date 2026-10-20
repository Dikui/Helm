# 隔离与合并

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 02
Map: [Helm v1 设计](../map.md)

## Question

每张任务单的 worktree 从哪个 ref 开出来，什么时候清理？完成的分支怎么合并（谁来合、什么时候合、冲突怎么处理）？依赖前一张单的任务，是在前一张单合并后的基础上开始，还是基于它的分支？A4 已被推翻（见 02）：要不要加一层外部边界（容器、VM，或按进程拆开家目录和凭证），加到什么程度？
