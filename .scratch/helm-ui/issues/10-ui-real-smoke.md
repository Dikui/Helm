# 10 — 界面全流程真实冒烟

**What to build:** `npm run test:real` 增加界面走查：沙箱外用 Playwright 自带的 Chrome for Testing 有界面模式打开 `helm serve` 的界面，走一遍新建工作 → 对齐 → 执行 → 审核，每步截图存证，验收时人工对照 [设计稿](../../../design/INDEX.md) 检查布局和状态。见 [需求文档](../spec.md)"Testing Decisions"。

**Blocked by:** 06 — 时间线、调度者与事件标签；07 — 工作说明视图与审核；08 — 工作操作菜单与输出管理；09 — 设置页

**Status:** ready-for-agent

- [ ] 走查使用本机已登录的真实 Claude CLI 和低消耗模型，复用现有 `real-smoke-runner` 的组织方式
- [ ] 截图至少覆盖：收件箱、新建页、对齐中、对话视图、卡片图与检查器、时间线、审核、设置页；深色、浅色各一张主界面
- [ ] 只用 Playwright 自带 Chromium 有界面模式，不用无头、不用系统 Chrome；沙箱内不运行
- [ ] 验收时亲自看截图，发现的问题补断言或另开任务单
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过
