# 09 — 设置页

**What to build:** 设置页三个分区。Agent 模板：按角色分组，直接显示是否可用及原因、正在使用的派单数和工作数；详情表单可编辑驱动、模型、推理强度、fast、计费方式、职责说明和 `prompt.md` 并保存，可复制为新模板，编辑已有模板时角色不可改，文件被外部改过时提示冲突并可重新载入；`skills/` 只读显示；新建 API 模板时提示去配置主目录。项目：列表、登记、改默认调度者模板。运行：并发上限、派单看门狗、轮次看门狗、输出提示阈值。见 [需求文档](../spec.md)"设置"，界面以 [设计稿](../../../design/INDEX.md) 的 `settings.html` 为准。

**Blocked by:** 01 — 界面保存 Agent 模板；02 — 界面骨架：托管、收件箱与实时更新

**Status:** ready-for-agent

- [ ] `list-agent-templates` 每个模板返回使用情况：正在运行的派单数、以它为调度者模板的未结束工作数
- [ ] 保存与复制调用 `save-agent-template`，带回 `revision`；校验失败按字段显示原因；冲突不覆盖
- [ ] 不提供删除模板；不在界面编辑 `skills/` 和 API 模板主目录
- [ ] 项目和运行参数调用 `register-project`、`set-project-coordinator-template`、`set-concurrency`、`set-dispatch-watchdog`、`set-round-watchdog`、`set-output-threshold`
- [ ] HTTP 接口测试覆盖使用情况字段；jsdom 整页测试覆盖可用性显示、保存、复制为新模板、角色不可改、冲突提示、项目登记与默认模板、运行参数保存
- [ ] `npm run check`、`npm test` 通过；沙箱外 `npm run test:real` 通过
