# 14 — Claude 调度者驱动

**What to build:** 真实的 Claude 调度者在 `_work` 里跑调度轮次，对项目代码只读，经带轮次令牌的 HTTP MCP 建卡、派单、改依赖。冒烟测试证明只读生效、重投时不重复操作。见 [spec](../spec.md) 的"驱动接口"和"Testing Decisions"副边界。

**Blocked by:** 10 — 用户的直接操作；13 — Claude 执行者驱动

**Status:** ready-for-agent

- [ ] 调度者 cwd 为 `_work`，`settingSources: []`；只读靠 SDK 沙箱不把 `_work` 设为可写，做不到就不给 Bash、只留 Read/Grep/Glob
- [ ] 冒烟①（调度者部分）：调度者经 MCP 建卡、派单、改依赖成功
- [ ] 冒烟②：用打断让同一批事件重投，靠 `key` 不重复建卡和派单
- [ ] 冒烟③（调度者部分）：调度者在 `_work` 里用 Bash 写文件被拦
- [ ] 冒烟测试用消耗小的模型和低推理强度
