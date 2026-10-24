# 04 — 对话视图与调度者引导

**What to build:** 执行中的工作页"对话"视图：消息和关卡按时间穿插，关卡可选选项或自由回答；发消息时可选范围（整项工作 / 某张卡片 / 某个未决关卡）。下方显示调度者本轮正在做的步骤和用时，轮次运行中发的消息排进"下一轮处理"，⌘⏎ 立即打断本轮。见 [需求文档](../spec.md)"运行层补的读取"中 `send-message` 与 `list-rounds`、"主界面"，界面以 [设计稿](../../../design/INDEX.md) 的 `main.html` 对话视图为准。

**Blocked by:** 03 — 新建工作与对齐中

**Status:** ready-for-agent

- [ ] `send-message` 接受可选 `cardId`（校验属于该工作），记录在消息上，调度者读对话时可见
- [ ] 新增 `list-rounds`（调用方 `user`、`coordinator-round`）：轮次号、模板、状态、起止时间、token、结束原因，以及排队待下一轮处理的用户消息；照常进 MCP 和命令行
- [ ] 本轮步骤取自运行中轮次的输出并实时更新；轮次结束后排队消息移出"下一轮处理"
- [ ] ⌘⏎ 调用 `interrupt-round`；没有运行中的轮次时不可用
- [ ] 顶栏"对话 / 调度结构 / 工作说明"切换可用（后两个视图可先为空壳）
- [ ] HTTP 接口测试覆盖 `cardId` 和 `list-rounds`；jsdom 整页测试覆盖三种范围发消息、关卡选项与自由回答、排队消息显示、打断轮次
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过
