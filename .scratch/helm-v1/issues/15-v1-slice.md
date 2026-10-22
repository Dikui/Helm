# v1 最小可验证版本切分

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 04, 05, 06, 07, 08, 09, 10, 11, 12, 13
Map: [Helm v1 设计](../map.md)

## Question

v1 的第一个可运行版本包含哪些部分，按什么顺序开发，各部分怎样验证？结果交给 `/to-tickets` 拆成开发任务单。

## Comments

- 2026-10-22 冲突复核：地图反目标是"什么都支持一点，却没有一个比现在好用"。第一个可运行版本先打通一种驱动、跑完整流程，其余驱动接在后面；04 定的是架构，不是第一版范围。
- 2026-10-22 来自 [12](12-monitoring-ui.md)：界面只定了必须项，布局和样式由用户之后自己设计（前端开发待办）。切分时把它列为开发界面任务单的前置条件。
- 2026-10-22 20 张整体复查：[14](14-coordinator-trial.md) 因超出范围关闭，本单不再等它。14 中的技术配置验证改为第一版开发的验收项：① helmd 的 MCP 端点校验令牌（调度轮次令牌、派单令牌），`提交结论` 和转发的浏览器工具在同一端点工作；Claude SDK 和 Codex app-server 都能按会话加载带令牌的 HTTP MCP，调度者能用它建卡、派单、改依赖，加载不了就改用每轮一个 stdio 转发小程序。② 同一批事件重投时，靠 `key` 不重复建卡和派单。③ 调度者对项目代码只读：Claude 调度者在 `_work` 里用 Bash 写文件也被拦（沙箱不可写或不给 Bash），Codex `read-only` 生效；Claude 执行者 `permissionMode: 'default'` 下副本外 Write 由 `canUseTool` 拒绝。④ 执行者和调度者都不读本机全局配置：Claude `settingSources: []`；Codex 能否在不丢登录的前提下不读 `~/.codex/config.toml`、`~/.codex/AGENTS.md`；Grok 能否不加载 `~/.grok/hooks`；做不到的一家在模板说明里写明会继承什么。⑤ Claude SDK 动态 HTTP MCP 的 `needs-auth` 多跑几轮看是否复现，复现就改用 stdio 转发。⑥ Codex 的 MCP 工具审批（`default_tools_approval_mode: approve`）和 `NO_PROXY` 对调度者同样生效。调度者能力（A1）不在第一版验收里，第一版只要求默认提示词能跑通完整流程。
