# 04 — Grok、DeepSeek 模板的 skills

**What to build:** 用户给 Grok 或 DeepSeek 执行者模板放了 skills 目录时，执行者能用上这些 skills，且不改用户全局配置；做不到的一家，带 skills 目录的模板显示为不可用并写明原因。见 [spec](../spec.md) 的 Further Notes。

**Blocked by:** 03 — DeepSeek 执行者

**Status:** ready-for-agent

- [ ] 查清 `grok agent stdio`、`dsh --profile acp` 加载 skills 的方式（一手来源或源码），结论记进本单 Comments
- [ ] 有不改用户全局配置、按会话或进程生效的办法：档案按模板 `skillsPath` 接上，两个模板的 skills 互不可见
- [ ] 没有办法的一家：带 skills 目录的模板不可用，原因写明
- [ ] 假 ACP agent 测试覆盖接上或不可用的行为；`npm run check`、`npm test` 通过
- [ ] 接上的一家在其 `*.real` 冒烟里验证执行者确实用到了模板 skill

## Comments
