# 14 — Claude 调度者驱动

**What to build:** 真实的 Claude 调度者在 `_work` 里跑调度轮次，对项目代码只读，经带轮次令牌的 HTTP MCP 建卡、派单、改依赖。冒烟测试证明只读生效、重投时不重复操作。见 [spec](../spec.md) 的"驱动接口"和"Testing Decisions"副边界。

**Blocked by:** 10 — 用户的直接操作；13 — Claude 执行者驱动

**Status:** resolved

- [x] 调度者 cwd 为 `_work`，`settingSources: []`；只读靠 SDK 沙箱不把 `_work` 设为可写，做不到就不给 Bash、只留 Read/Grep/Glob
- [x] 冒烟①（调度者部分）：调度者经 MCP 建卡、派单、改依赖成功
- [x] 冒烟②：用打断让同一批事件重投，靠 `key` 不重复建卡和派单
- [x] 冒烟③（调度者部分）：调度者在 `_work` 里用 Bash 写文件被拦
- [x] 冒烟测试用消耗小的模型和低推理强度

## Comments

复用执行者的 Claude SDK 会话与事件映射，实现调度者每轮新开、`_work` 显式只读沙箱及带令牌 HTTP MCP，并以假 SDK 流覆盖映射和打断重投去重；另提供 Haiku/low 的独立脚本 `npm run test:claude-coordinator`，按要求未运行真实 CLI 冒烟，相关勾选留待沙箱外验证。

- 2026-10-22 调度者：沙箱外真实冒烟（main 83428a3，worktree smoke3）`npm run test:browser`、`test:claude-executor` 5/5、`test:claude-coordinator` 6/6 全部通过，Haiku + low；未复现 needs-auth，截图只落在派单输出目录。
