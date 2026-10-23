# 13 — 2048 端到端：Codex 调度者加两家执行者

**What to build:** 用 `helm service install` 起的服务跑一次网页版 2048：Codex 调度者，执行者 Claude 和 Codex 都有、两家交叉验收，含浏览器验收，确认第二阶段的路径全部打通。见 [spec](../spec.md) Testing Decisions 的"端到端验收"。

**Blocked by:** 04 — 调度者模板的选择与更换；06 — Claude 模板的 skills；08 — Codex 执行者驱动；09 — Codex 调度者驱动；10 — 用户级服务自启动；11 — 输出压缩与超限提示

**Status:** resolved

- [x] 沙箱外手动 `helm service install`，确认服务起来、日志写进 `~/.helm/logs/`
- [x] 工作用 `codex-coordinator`；执行者 Claude 和 Codex 都有派单，两家互相验收，含浏览器验收
- [x] 用消耗小的模型、低推理强度、不开 fast
- [x] 工作结束后输出已压缩、仍可读
- [x] ~~跑完核对用户 `~/.claude/projects/`、`~/.codex/sessions/` 没有新增记录~~（ADR 0005 改为默认主目录，会话记录写进用户历史，本项作废）
- [x] 查看浏览器验收截图；暴露的 Helm 问题记在本单 Comments，必要时另开修复单

## Comments

2026-10-23 端到端跑通（运行目录 `/private/var/folders/zm/3n6r9htn6cz5h86nxgz0cnj80000gn/T/helm-2048-4E7mNe`，证据在未提交的 `.scratch/tasks/p2-13-run/`）。`helm service install` 装成 LaunchAgent，日志写进 `~/.helm/logs/`，`launchctl kill SIGKILL` 后自动重启（开机/登录自启未验证）。54 个调度轮次全是 `codex-coordinator`（gpt-6-luna/low/fast 关），32 张派单 Claude（haiku）和 Codex（gpt-6-luna）都有执行，每张实现卡由另一家验收，17 次浏览器验收均为有界面 Chrome for Testing。审核一次退回、一次接受；合并 `merged`、推送 `pushed`，`main` 与本地远端同为 `441c857`；32 份派单输出和 54 轮输出均已自动 gzip、读回一致；从 `main` 试玩一局 1268 分，截图已看。中途因调度者把 workId 抄错停滞，暂停后恢复，用户消息纠正 ID 后继续。用户全局 hooks（Codex、ponytail）未造成拦截；全局 gungnir skills 可见但未被调用；未见执行者自行起 agent CLI。

暴露的问题，之后修：
- **Helm**：① 调度者工具要自己传 workId，抄错导致整轮操作全被拒、工作停滞且无人通知——workId 应由轮次令牌确定；一轮操作全被拒时应能察觉。② 执行派单不自动附卡片说明快照（验收派单有），调度者写得简略时执行者不知道做什么。③ 一次调度轮次输入超过 Codex RPC 上限（1,055,661 > 1,048,576 字符），运行层重投后恢复，启动简报需控制体积。④ 浏览器快照返回相对路径，执行者难以定位截图。
- **调度者提示词**：派单要完整转述需求、需要浏览器的执行派单设 needsBrowser、执行者不要自己 git commit、ID 从图里原样复制、整体验收两家派在同一卡上不要提前完成、验收误判（左边界按左键无变化当成失效）。
- **其他**：服务配置记的是带版本号的 node 路径，`brew upgrade node` 后要重新 install。

2026-10-23 修复：MCP 调用由调度轮次或派单令牌确定工作并隐藏 workId，执行派单同样附上并保存卡片说明快照；同步两家调度者的派单、浏览器、ID 与整体验收规则，以及执行者的提交、浏览器和验收证据约定，补充 MCP、HTTP 与实际驱动提示词回归测试，真实冒烟按本次要求未运行。

2026-10-23 修复剩余问题：③ 输入超限的原因是启动简报 `newEvents` 带上了执行者逐步进度——失败轮 389de85c 的新事件里有 1,722 条 `dispatch-step`，约占满上限，其余事件约 1 万字符；简报不再带 `dispatch-step`，调度者需要时用 `get-dispatch-output` 读（a1e05b9）。不加通用体积上限，等简报其他部分真的变大再加。④ Playwright 把文件链接写成相对其 cwd（派单 `browser/` 目录）的 `./…`，转发时改成绝对路径（532da84），只经替身验证，真实冒烟未运行。服务配置改记 PATH 中的 node（如 `/opt/homebrew/bin/node`），找不到才回退 `process.execPath`（fef643d）；本机 LaunchAgent 已重装，helmd 读接口正常。
