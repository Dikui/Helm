# 09 — Codex 调度者驱动

**What to build:** 用户可以让 Codex 当调度者：它对项目代码只读，通过 Helm 的 MCP 工具对齐、建卡、派单、发起审核；调度轮次撞上限额时运行层暂停工作并通知用户。见 [spec](../spec.md) 的"Codex 驱动"。

**Blocked by:** 08 — Codex 执行者驱动

**Status:** ready-for-agent

- [ ] 每个调度轮次一个 `codex app-server` 进程，`read-only` 沙箱，新开 thread，不续跑
- [ ] Helm MCP 带轮次令牌，工具审批 `default_tools_approval_mode: approve`，`NO_PROXY` 生效
- [ ] 调度轮次额度用完时运行层暂停工作并通知用户，不重投
- [ ] 内置模板 `codex-coordinator`，提示词按 Codex 的习惯调整，策略与 `claude-coordinator` 一致
- [ ] 驱动单元测试覆盖只读沙箱、MCP 配置、结束方式和额度用完
- [ ] 沙箱外真 CLI 冒烟并入 `npm run test:real`：技术验证①调度者能建卡、派单、改依赖；②重投时靠 `key` 不重复；③ `read-only` 下写文件被拦；⑥ MCP 工具审批和 `NO_PROXY` 对调度者生效
