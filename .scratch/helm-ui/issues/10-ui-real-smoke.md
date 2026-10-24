# 10 — 界面全流程真实冒烟

**What to build:** `npm run test:real` 增加界面走查：沙箱外用 Playwright 自带的 Chrome for Testing 有界面模式打开 `helm serve` 的界面，走一遍新建工作 → 对齐 → 执行 → 审核，每步截图存证，验收时人工对照 [设计稿](../../../design/INDEX.md) 检查布局和状态。见 [需求文档](../spec.md)"Testing Decisions"。

**Blocked by:** 06 — 时间线、调度者与事件标签；07 — 工作说明视图与审核；08 — 工作操作菜单与输出管理；09 — 设置页

**Status:** ready-for-agent

- [ ] 走查使用本机已登录的真实 Claude CLI 和低消耗模型，复用现有 `real-smoke-runner` 的组织方式
- [ ] 截图至少覆盖：收件箱、新建页、对齐中、对话视图、卡片图与检查器、时间线、审核、设置页；深色、浅色各一张主界面
- [x] 只用 Playwright 自带 Chromium 有界面模式，不用无头、不用系统 Chrome；沙箱内不运行
- [ ] 验收时亲自看截图，发现的问题补断言或另开任务单
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过

## Comments

2026-10-24：已实现 `tests/ui.real.ts`（`HELM_UI_REAL=1`），追加登记到 `real-smoke-runner`，并更新使用进程替身的 runner 单元测试。通过与 `helm serve` 共用的 `startHelmd` 启动真实运行层，只加载真实 Claude 调度者与执行者，临时模板固定 haiku / low / fast=false。所有新建、登记项目、确认草稿、切换视图、发消息和接受审核均经页面；没有另建数据层或 SSE。

极小需求为只新增 `smoke.txt`，内容 `helm-ui-smoke` 加一个换行；一张执行卡片、一张整体验收卡片。模型在整体验收完成后等待页面发出的明确审核消息，以便保存执行阶段的证据。截图代码覆盖收件箱、新建、对齐、对话、卡片图与检查器、含执行和验收的时间线、审核 diff、浅色主界面、深色主界面、设置共 10 张；每张之前检查关键元素、SSE 已连接、无错误提示和页面异常。接受后只读验证 main、远端临时 bare 项目和单文件 diff。

使用专用、已登录 Claude 的临时 HOME（`HELM_UI_REAL_HOME`；也兼容运行入口本身已使用临时 HOME），不读取或复制凭据、不把可写配置链接到本机家目录。准备登录由沙箱外调度者完成。浏览器从 `@playwright/mcp` 的依赖取得，固定 `headless: false`，复用本机 Playwright 缓存，不指定系统 Chrome 或自定义可执行路径。

本轮只执行沙箱内类型检查、替身单元测试和 jsdom 整页测试，未运行任何真实用例、浏览器或 Agent 会话。前三项中涉及真实 Claude 走查、截图生成的验收项，以及人工查看截图、完整 `test:real` 的验收项均保留待验；第三项勾选仅表示浏览器启动方式已按代码约束实现且沙箱内没有运行。沙箱外单独运行方式、预计耗时与截图目录见 `.scratch/tasks/ui-10/report.md`（不提交）。
