# 13 — 2048 端到端：Codex 调度者加两家执行者

**What to build:** 用 `helm service install` 起的服务跑一次网页版 2048：Codex 调度者，执行者 Claude 和 Codex 都有、两家交叉验收，含浏览器验收，确认第二阶段的路径全部打通。见 [spec](../spec.md) Testing Decisions 的"端到端验收"。

**Blocked by:** 04 — 调度者模板的选择与更换；06 — Claude 模板的 skills；08 — Codex 执行者驱动；09 — Codex 调度者驱动；10 — 用户级服务自启动；11 — 输出压缩与超限提示

**Status:** ready-for-agent

- [ ] 沙箱外手动 `helm service install`，确认服务起来、日志写进 `~/.helm/logs/`
- [ ] 工作用 `codex-coordinator`；执行者 Claude 和 Codex 都有派单，两家互相验收，含浏览器验收
- [ ] 用消耗小的模型、低推理强度、不开 fast
- [ ] 工作结束后输出已压缩、仍可读
- [ ] 跑完核对用户 `~/.claude/projects/`、`~/.codex/sessions/` 没有新增记录
- [ ] 查看浏览器验收截图；暴露的 Helm 问题记在本单 Comments，必要时另开修复单
