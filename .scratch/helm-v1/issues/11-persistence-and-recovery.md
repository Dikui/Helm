# 持久化与崩溃恢复

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 04, 05
Map: [Helm v1 设计](../map.md)

## Question

守护进程、调度者或执行者崩溃后，怎么恢复且不重复已完成的步骤？用 DBOS（SQLite）这类持久化执行库，还是自己写状态表加启动时扫描？等待用户审核时状态停在哪里？
