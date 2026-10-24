# 09 — 设置页

**What to build:** 设置页三个分区。Agent 模板：按角色分组，直接显示是否可用及原因、正在使用的派单数和工作数；详情表单可编辑驱动、模型、推理强度、fast、计费方式、职责说明和 `prompt.md` 并保存，可复制为新模板，编辑已有模板时角色不可改，文件被外部改过时提示冲突并可重新载入；`skills/` 只读显示；新建 API 模板时提示去配置主目录。项目：列表、登记、改默认调度者模板。运行：并发上限、派单看门狗、轮次看门狗、输出提示阈值。见 [需求文档](../spec.md)"设置"，界面以 [设计稿](../../../design/INDEX.md) 的 `settings.html` 为准。

**Blocked by:** 01 — 界面保存 Agent 模板；02 — 界面骨架：托管、收件箱与实时更新

**Status:** ready-for-agent

- [x] `list-agent-templates` 每个模板返回使用情况：正在运行的派单数、以它为调度者模板的未结束工作数
- [x] 保存与复制调用 `save-agent-template`，带回 `revision`；校验失败按字段显示原因；冲突不覆盖
- [x] 不提供删除模板；不在界面编辑 `skills/` 和 API 模板主目录
- [x] 项目和运行参数调用 `register-project`、`set-project-coordinator-template`、`set-concurrency`、`set-dispatch-watchdog`、`set-round-watchdog`、`set-output-threshold`
- [x] HTTP 接口测试覆盖使用情况字段；jsdom 整页测试覆盖可用性显示、保存、复制为新模板、角色不可改、冲突提示、项目登记与默认模板、运行参数保存
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过


## Comments

2026-10-24：实现设置页的 Agent 模板、项目、运行三个分区，沿用任务单 02 的路由、useResource / api.call、共享 SSE 与中英字典。模板按角色显示可用性原因、运行中派单数和未结束工作数；详情支持全部 schema 字段、prompt.md、带 revision 保存、复制与新建、字段错误、文件冲突后的显式重新载入。已有模板角色固定，skills/ 目录条目只读，API 仅提示主目录路径。新建表单使用 /settings/new-template，避免占用合法模板 id new 的详情路径；未保存模板的站内链接跳转提供保留输入或丢弃入口。

项目支持登记、默认调度者模板和工作数；运行参数按并发、派单看门狗、轮次看门狗、输出阈值分别保存，分钟 / GB 转换到现有接口的毫秒 / 字节。没有新增数据层或 SSE，没有修改共享路由、App、样式、类型或 operations。HTTP 与整页测试使用临时 HOME、模板副本及假驱动，新增模板保存不会改动仓库原始模板。

本轮自行完成 diff-review；检查和测试的实际结果见调度者指定报告 /Users/dikui/Project/Helm/.scratch/tasks/ui-09/report.md。按本轮指令不提交、不启动浏览器或真实会话；最后一项包含沙箱外真实冒烟，保持未勾选，留待调度者安排。

2026-10-24：修复真实冒烟 F1：复制从编辑器当前 config 和 prompt 构造副本，覆盖旧列表字段。新增 App + 假驱动真实 helmd 测试，强制保存后的列表仍旧，验证刚保存立即复制、未保存编辑复制的全部表单字段及副本落盘值，原模板未保存值不被写回。设置页 7/7 通过。
