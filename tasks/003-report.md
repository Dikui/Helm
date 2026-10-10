已完成：[research/workflow-templates.md](/Users/dikui/Project/Helm/research/workflow-templates.md)。正文 267 行，覆盖 6 个问题、全部 15 个模式，附来源与未核实清单。

六问结论：

1. 已有实现涵盖代码、图和 JSON；各自的恢复能力不同。
2. Helm demo 宜采用模板填参，再生成受约束 JSON。
3. 编排层宜使用可信解释器，避免直接执行自由代码。
4. 恢复需固定计划、保存步骤结果，并单独核对副作用。
5. 每种模式都应保留四态结果、终止上限和逐项证据。
6. `agent()` 宜映射到独立 `codex exec`，最终复核使用新上下文。

未核实项包括：Claude 内部接口、Codex 真实推理及崩溃恢复、token 硬封顶、沙箱攻击与 macOS 隔离、发布目标幂等契约、部分框架 API 稳定性及 autoresearch 正式许可文件。

核心建议：受约束 JSON 模板、可信解释器、版本化执行日志、副作用去重核对；demo 优先实现单步/顺序、并行汇总、批量清单、有界生成验证和人工关卡。

本次仅新增交付文档；已有未跟踪任务文件原样保留。未修改已有文件，`research/scratch/` 不存在。