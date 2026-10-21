# 持久化与崩溃恢复

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 04, 05
Map: [Helm v1 设计](../map.md)

## Question

守护进程、调度者或执行者崩溃后，怎么恢复且不重复已完成的步骤？用 DBOS（SQLite）这类持久化执行库，还是自己写状态表加启动时扫描？等待用户审核时状态停在哪里？

## Comments

- 来自 01（2026-10-21）：派单输出很占空间，用户要求工作结束后加以整合，只保留重要信息；事件保留。保留什么、保留多久，由本单决定。

- 2026-10-21 来自 [04](04-tech-stack.md)：调度者和执行者都是 `helmd` 的子进程，`helmd` 重启时随之退出，不重新接管；恢复靠各驱动的续跑：Claude SDK `resume`、Codex `thread/resume`（读 `~/.codex/sessions` 的 rollout 文件，需用回原 `CODEX_SQLITE_HOME`）、ACP 按 `initialize` 能力选 `session/resume` 或 `session/load`，都没有就用 CLI 自己的 `--resume`。

- 来自 [05](05-task-store-model.md)（2026-10-21）：任务库为当前状态表 + 事件表、同事务写入（[ADR 0001](../../../docs/adr/0001-state-tables-plus-event-log.md)）。派单输出和调度者会话输出按序号存成库外文件，库里只记路径；保留多久由本单定。暂停是终止派单而非冻结进程，恢复时由调度者重新派单、续跑同一对话。
