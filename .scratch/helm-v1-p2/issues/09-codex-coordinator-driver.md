# 09 — Codex 调度者驱动

**What to build:** 用户可以让 Codex 当调度者：它对项目代码只读，通过 Helm 的 MCP 工具对齐、建卡、派单、发起审核；调度轮次撞上限额时运行层暂停工作并通知用户。见 [spec](../spec.md) 的"Codex 驱动"。

**Blocked by:** 08 — Codex 执行者驱动

**Status:** resolved

- [x] 每个调度轮次一个 `codex app-server` 进程，`read-only` 沙箱，新开 thread，不续跑
- [x] Helm MCP 带轮次令牌，工具审批 `default_tools_approval_mode: approve`，`NO_PROXY` 生效
- [x] 调度轮次额度用完时运行层暂停工作并通知用户，不重投
- [x] 内置模板 `codex-coordinator`，提示词按 Codex 的习惯调整，策略与 `claude-coordinator` 一致
- [x] 驱动单元测试覆盖只读沙箱、MCP 配置、结束方式和额度用完
- [x] 沙箱外真 CLI 冒烟并入 `npm run test:real`：技术验证①调度者能建卡、派单、改依赖；②重投时靠 `key` 不重复；③ `read-only` 下写文件被拦；⑥ MCP 工具审批和 `NO_PROXY` 对调度者生效

## Comments

已复用 Codex app-server 驱动实现调度者角色、每轮独立进程和 thread、只读沙箱、轮次 MCP 与 sqlite 目录，新增 codex-coordinator 模板、额度暂停通知测试及真实冒烟入口；真实冒烟已并入 test:real，遵照本轮约束未运行，最后一项留待调度者在临时 HOME 的沙箱外环境验收。

2026-10-23 沙箱外 Codex 真实冒烟通过（gpt-6-luna、low）：两轮各建卡 2、加依赖 2、删依赖 1、派单 1，均 ok；打断后新 session 重投同 key 只留 2 张卡 1 张派单；read-only 写入被拒、旧轮次令牌 401、NO_PROXY、token；initialize 31–39 ms。
