# 02 — ACP 派单的中止、续跑和异常结束

**What to build:** 用户暂停或取消卡片、工作时，Grok 派单被中止、结束方式记为被中止；验收不通过打回时，调度者能续跑同一个 Grok 会话，执行者记得上一轮。Grok 撞上限额时结束方式记为"额度用完"，调度者按提示词改派；其他报错和进程崩溃记为出错退出；Grok 自动压缩上下文时记一条压缩事件。见 [spec](../spec.md) 的"ACP 客户端与 agent 档案"（续跑）和"结果映射"。

**Blocked by:** 01 — Grok 执行者跑通一轮

**Status:** ready-for-agent

- [ ] 取消发 `session/cancel`，派单结束方式为被中止；收尾和按 cwd 清残留沿用现有做法，不假设取消会杀掉子进程
- [ ] 续跑按 `sessionCapabilities.resume` 用 `session/resume`，会话 id 不变；验收派单仍一律新开
- [ ] 档案提供额度报错匹配规则，匹配上记为额度用完，匹配不上记为出错退出
- [ ] 进程崩溃或协议错误记为出错退出，原因写进派单结果
- [ ] Grok 私有通知 `auto_compact_started` 记为压缩事件
- [ ] 以上行为由共用模块实现、档案只提供差异；假 ACP agent 测试覆盖；`npm run check`、`npm test` 通过
- [ ] `grok-executor.real` 补上：一轮进行中取消返回被中止；新进程续跑后追问上一轮内容答对

## Comments
