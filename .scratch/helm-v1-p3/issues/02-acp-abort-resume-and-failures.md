# 02 — ACP 派单的中止、续跑和异常结束

**What to build:** 用户暂停或取消卡片、工作时，Grok 派单被中止、结束方式记为被中止；验收不通过打回时，调度者能续跑同一个 Grok 会话，执行者记得上一轮。Grok 撞上限额时结束方式记为"额度用完"，调度者按提示词改派；其他报错和进程崩溃记为出错退出；Grok 自动压缩上下文时记一条压缩事件。见 [spec](../spec.md) 的"ACP 客户端与 agent 档案"（续跑）和"结果映射"。

**Blocked by:** 01 — Grok 执行者跑通一轮

**Status:** ready-for-human

- [x] 取消发 `session/cancel`，派单结束方式为被中止；收尾和按 cwd 清残留沿用现有做法，不假设取消会杀掉子进程
- [x] 续跑按 `sessionCapabilities.resume` 用 `session/resume`，会话 id 不变；验收派单仍一律新开
- [x] 档案提供额度报错匹配规则，匹配上记为额度用完，匹配不上记为出错退出
- [x] 进程崩溃或协议错误记为出错退出，原因写进派单结果
- [x] Grok 私有通知 `auto_compact_started` 记为压缩事件
- [x] 以上行为由共用模块实现、档案只提供差异；假 ACP agent 测试覆盖；`npm run check`、`npm test` 通过
- [x] `grok-executor.real` 补上：一轮进行中取消返回被中止；新进程续跑后追问上一轮内容答对

## Comments

2026-10-23 实现：共用 ACP 驱动先发 `session/cancel`，有限等待本轮响应后关闭进程；重复取消和取消/完成竞态只结束一次，启动中的取消也收尾。打回按 initialize 公布的 resume 能力调用 `session/resume`，保留会话 id、传入本次 HTTP MCP 令牌；未声明能力时明确失败。验收继续由现有派单入口保证新开。Grok 档案提供额度错误码/文本规则及私有压缩通知标识，共用模块负责映射和事件；压缩通知按接收顺序处理，避免紧邻 prompt 响应时遗漏。结束事件的可选 `failure` 写入派单结果，保留 RPC 错误数据、崩溃和协议错误原因。

验证：`npm run check --cache /private/tmp/helm-npm-cache` 通过；`npm test --cache /private/tmp/helm-npm-cache` 全部 379 项通过。假 ACP agent 覆盖取消、忽略取消、竞态、启动中止、新进程续跑、验收新开与打回、额度/普通报错、崩溃、畸形协议、压缩落库，以及卡片/工作暂停和取消后按 cwd 清理独立子进程。测试均使用临时 HOME，浏览器使用工具替身。

等待沙箱外验证：本轮按用户要求没有运行任何真实冒烟、浏览器或真实模型会话。`tests/grok-executor.real.ts` 已补写新 ACP 进程续跑后回答上一轮随机暗号（本轮不提供暗号且禁止读文件），以及前台工具实际等待期间暂停卡片、派单返回被中止、工具连接随清理关闭；只编译，尚未运行。需在沙箱外运行 `HELM_GROK_EXECUTOR_REAL=1 npm run test:real --cache /private/tmp/helm-npm-cache`，核对 `resume.json`、`cancel.json` 和原有 `grok.png` 等证据。保留任务单 01 原有一轮、沙箱、令牌、用量、模型档位及并行验收。状态为 `ready-for-human`，等待真实冒烟。
