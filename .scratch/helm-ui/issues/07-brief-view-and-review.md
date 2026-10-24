# 07 — 工作说明视图与审核

**What to build:** 执行中切到"工作说明"视图看生效版本，可切换查看历史版本，要改只能在对话里让调度者起草新版。工作进入审核时，用户看到汇总报告、工作分支相对基准 ref 的 diff、整体验收结论、被拒绝的操作数和未声明结论的派单数，只能接受或退回并附意见。展开收件箱行即可直接决定一般关卡或接受 / 退回审核（diff 等详情仍在工作页）。见 [需求文档](../spec.md)"主界面"，界面以 [设计稿](../../../design/INDEX.md) 的 `main.html` 为准。

**Blocked by:** 03 — 新建工作与对齐中

**Status:** ready-for-agent

- [x] 工作说明数据来自 `get-work-descriptions`；生效版本标明，历史版本只读
- [x] 审核数据来自现有审核关卡内容；diff 可读、长 diff 不卡页面
- [x] 接受 / 退回调用 `decide-gate`，退回必须附意见
- [x] 收件箱行展开后的关卡和审核决定与工作页结果一致，决定后行移出"等你处理"
- [x] jsdom 整页测试覆盖版本切换、审核信息显示、接受、退回带意见、收件箱内决定关卡
- [ ] `npm run check`、`npm test` 通过

## Comments

2026-10-24：实现工作说明与审核，组件、类型和样式放在 `frontend/src/pages/work/brief/`。工作说明读取 `get-work-descriptions`，默认生效版本，历史和未确认新版只读，展示基准与工作分支，修改入口返回对话。审核读取现有 `get-conversation` 审核关卡，展示汇总报告、整体验收结论和两项计数；diff 按需展开，每段最多 20,000 个字符，可完整翻阅，不创建逐行的大量节点。工作页和收件箱复用 `GateDecision` 调用 `decide-gate`，退回必须填写非空意见，失败保留输入和原始原因；收件箱链接进入工作页看详情。`WorkPage.tsx` 仅追加 `route.view === 'brief'` 的挂载，顶栏切换留给 04。

新增 6 个 App + 假驱动真实 helmd HTTP / SSE 的 jsdom 用例；与既有 `app.test.tsx` 合计 13/13 通过，包含一般关卡行内决定回归。接受审核测试仅合并、推送到临时本地 git 仓库；夹具使用临时 HOME。不启动浏览器，不进行真实 Agent 会话。按用户要求不提交，交由调度者验收代提交。

最终 `npm run check --cache /private/tmp/helm-npm-cache` 通过；完整 `npm test --cache /private/tmp/helm-npm-cache` 的 Node 测试为 450/451，唯一失败是用户已预告的 `dispatch.test.ts`“执行派单经 MCP 写卡片副本…”偶发项（简报暂未包含 dispatch-ended），单独复跑第一次仍失败、第二次 1/1 通过。因完整命令退出 1，未把“npm test 通过”一项勾上；随后显式补跑全部整页测试，5 文件 31/31 通过。自行完成 diff-review，Standards / Spec 各已审 10/10，无未解决代码问题。

- [ ] 真实浏览器冒烟、截图和视觉验收由调度者后续另派；本轮未执行。
