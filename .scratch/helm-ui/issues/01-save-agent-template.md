# 01 — 界面保存 Agent 模板

**What to build:** 新增用户操作 `save-agent-template`，把界面上编辑的模板写回 `templates/<id>/`：改已有模板，或以新 id 新建（界面"复制为新模板"）。模板仍以文件为准，不回到任务库；改动照旧从下一次派单或调度轮次生效。界面见 [design/settings.html](../../../design/settings.html) 的 Agent 模板详情。

**Blocked by:** 无

**Status:** ready-for-agent

## 背景

第二阶段把模板从任务库移到文件，同时去掉了 `configure-agent-template`（[第二阶段 spec](../../helm-v1-p2/spec.md) Implementation Decisions）。本单不改这个决定，只给界面一条写文件的路：读写的都是同一份 `config.json` 和 `prompt.md`。

## 要点

- 操作登记在 `src/operations.ts`，调用方只有 `user`；HTTP、MCP、CLI 照常由操作表生成。
- 参数：`id`、`config`（与 `src/templates.ts` 的 `settings` schema 相同的字段）、`prompt`（`prompt.md` 全文）、`mode`（`update` / `create`）、`update` 时带 `baseRevision`。
- `list-agent-templates` 每个模板多返回 `revision`（`config.json` 与 `prompt.md` 内容的哈希），界面保存时带回；文件在此期间被编辑器改过则拒绝，错误码如 `TEMPLATE_CONFLICT`，不覆盖。
- 写前用同一个 schema 校验，失败返回字段级原因，磁盘文件不动。两个文件各自写临时文件再 rename；`config.json` 按现有内置模板的格式输出（两空格缩进、末尾换行）。
- `id` 只允许目录名安全的字符（如 `^[a-z0-9][a-z0-9-]{0,63}$`），拒绝 `..`、`/` 等路径穿越；`create` 时目录已存在则拒绝，`update` 时不存在则拒绝。
- `update` 不能改 `role`：已有工作和派单按 id 引用模板，换角色会让它们失效。要换角色就新建模板。
- 不碰 `skills/` 和 API 模板的主目录内容（`~/.helm/agent-homes/<id>/`），这些仍由用户在文件里管理；新建 API 模板时只提示用户去配置主目录。
- 不做删除模板。
- 保存后照常产生操作事件。正在运行的派单和调度轮次不受影响（它们用的是启动时的快照）。

## Acceptance

- [ ] 改已有模板：`list-agent-templates` 和下一次派单的模板快照都是新内容；正在运行的派单快照不变
- [ ] 新建模板：生成 `config.json`、`prompt.md`，出现在列表里并做可用性检查
- [ ] 校验失败、`id` 非法、目录已存在 / 不存在、`update` 改 `role`：分别拒绝并说明原因，磁盘文件不变
- [ ] 文件被外部改过后再用旧 `revision` 保存：返回冲突，不覆盖
- [ ] 测试用临时模板目录起真实 `helmd` 覆盖以上情况；`npm run check`、`npm test` 通过

## Comments

- 2026-10-24 由界面设计（`design/settings.html`）提出。注意：默认模板目录在 Helm 仓库里，界面保存会在 Helm 仓库留下未提交改动，提交与否由用户决定。
