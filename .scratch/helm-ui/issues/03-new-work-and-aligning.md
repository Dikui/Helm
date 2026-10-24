# 03 — 新建工作与对齐中

**What to build:** 用户在新建页选项目、写一句需求、选调度者模板后发送，进入主界面这项工作的"对齐中"：左边是和调度者的对话，右边是工作说明草稿逐版显示并高亮相对上一版新增的条目，在关卡或草稿旁点"确认这一版"后工作开始执行。新建页显示项目的基准分支、基准提交和未提交改动提醒；没有登记项目时直接显示登记表单，也可用弹窗登记。见 [需求文档](../spec.md)"新建工作""主界面"中对齐中一条，界面以 [设计稿](../../../design/INDEX.md) 的 `new-work.html` 和 `main.html?state=aligning` 为准。

**Blocked by:** 02 — 界面骨架：托管、收件箱与实时更新

**Status:** ready-for-agent

- [x] `list-projects` 每个项目返回当前分支名、HEAD 提交、未提交改动数；读不到 git 状态时返回原因而不报错
- [x] 调度者模板默认取项目默认模板；不可用的模板显示原因且不可选
- [x] 发送调用 `send-message`（带 `projectId`），前端生成 key，重试沿用同一 key，不重复建工作；成功后跳到该工作的对齐中
- [x] 对齐中的收件箱当前行显示"对齐中"；草稿逐版显示，新增条目高亮；两个"确认这一版"入口调用同一个 `decide-gate`
- [x] 登记项目弹窗和无项目状态调用 `register-project`，非 git 路径显示运行层原因
- [x] HTTP 接口测试覆盖项目 git 字段；jsdom 整页测试覆盖新建、重试不重复、对齐中草稿更新（经 SSE）、确认后进入执行、登记项目
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过


## Comments

实现新建工作与对齐中：扩展 `list-projects` 的 `currentBranch`、`headCommit`、`uncommittedChanges`、`gitStatusReason`，git 状态读取失败仍返回项目。新建页沿用共享数据层，选择项目默认调度者模板并展示不可用原因、基准与未提交改动；无项目及弹窗均可登记项目，错误保留输入并显示运行层原因。

新建与对齐消息保存一次逻辑提交的完整参数和 key；响应丢失后重试沿用原请求，模板随后不可用也不阻断已接受请求的重放。对齐页用既有 SSE 更新对话和工作说明，支持逐版查看、逐行标出新增条目；对话与草稿旁确认共用处理函数，历史草稿禁用确认，过期版本错误显示运行层原文。确认后读取真实工作状态并进入执行；执行中的后续视图由其他任务单扩展。

新增 HTTP 测试和 6 个 jsdom 整页测试（全部通过假驱动的真实 helmd）；登记弹窗补充初始焦点、Tab 循环、Escape、提交中锁定与焦点恢复。中英文新 key 使用 `newWork` / `alignment` 前缀，样式和类型留在页面目录，未另建数据层、SSE 或依赖。

按用户要求未运行浏览器、真实会话及 `npm run test:real`，最后一项保持未勾选；Status 未改，改动未提交。完整命令与结果、自行完成的 Standards / Spec diff-review 见指定报告 `/Users/dikui/Project/Helm/.scratch/tasks/ui-03/report.md`。
