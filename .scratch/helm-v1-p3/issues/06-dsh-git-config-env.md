# 06 — DeepSeek 执行者的禁止推送 git 配置失效

**What to build:** DeepSeek 执行者里 git 能正常运行，且推送仍被拦住。混合端到端（[05](05-mixed-acp-e2e.md) Comments）里 dsh 的 shell 环境有 `GIT_CONFIG_COUNT=11` 却缺 `GIT_CONFIG_KEY_n`（疑似 dsh 按变量名过滤含 `KEY` 的环境变量），git 一律报 `missing config key GIT_CONFIG_KEY_0` 退出；执行者 `unset` 后能继续，但禁止推送的配置（`src/templates.ts` 约 137 行）随之失效，本地裸远端不需要令牌即可推送，违反 spec 用户故事 9。

**Blocked by:** None

**Status:** ready-for-agent

- [ ] 在本机 dsh 源码里找到过滤规则并记进 Comments（文件路径、规则）
- [ ] Helm 改用不会被 dsh 过滤、且 Claude、Codex、Grok 也照常生效的方式注入禁止推送配置（对所有驱动一致，不按档案分叉，除非证据表明必须）
- [ ] 单元测试覆盖新的注入方式下本地远端推送被拦、普通 git 命令可用；`npm run check`、`npm test` 通过
- [ ] `grok-executor.real`、`deepseek-executor.real` 增加：执行者在卡片副本里跑 `git status` 成功、`git push` 到本地远端被拦；沙箱外跑通

## Comments
