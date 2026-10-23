# 06 — Claude 模板的 skills

**What to build:** 每个 Claude 模板只用自己 `skills/` 里的 skills：模板之间互相看不到，也看不到用户自己的 skills 和 Claude Code 自带的 skills。见 [spec](../spec.md) 的"skills 按模板挂载"，实测见 [02](02-templates-skills-and-api-homes.md)。

**Blocked by:** 05 — Claude 专用主目录与模板可用性检查

**Status:** ready-for-agent

- [ ] 模板的 `skills/` 作为本地插件经 Agent SDK `plugins` 挂上；`skills` 选项只列这个模板自己的 skill 名
- [ ] 没有 `skills/` 的模板不挂插件，`skills` 为空列表
- [ ] 驱动单元测试覆盖插件路径和 `skills` 列表
- [ ] 真 CLI 冒烟：两个 Claude 模板各挂一个模拟 skill（不同暗号）同时跑，各自只答对自己的暗号；init 的 `skills` 里没有另一个模板的、用户 `~/.claude/skills/` 里的和 Claude Code 自带的 skills
