# 05 — 混合端到端

**What to build:** 用户用 `helm` 命令行提一个小需求（不必是 2048），Claude 调度者把卡片分给 Grok 和 DeepSeek 执行者，跑完执行和验收，一直到审核。用户不等界面做完就能确认多家混用能工作。见 [spec](../spec.md) 的 Testing Decisions 边界 3。

**Blocked by:** 02 — ACP 派单的中止、续跑和异常结束；03 — DeepSeek 执行者；04 — Grok、DeepSeek 模板的 skills

**Status:** resolved

- [x] 沙箱外以 `helm serve` 和真实 CLI 手动跑一次，Claude 调度者，Grok、DeepSeek 至少各接一次派单（执行或验收）
- [x] 工作走到审核；查看对话、派单结果（结束方式、token、自报结论）和浏览器验收截图
- [x] 暴露的 Helm 问题逐条记进本单 Comments，需要修的另开修复单
- [x] 跑之前 `npm run test:real --cache /private/tmp/helm-npm-cache` 通过

## Comments

- 2026-10-23 沙箱外混合端到端（3c4b978，报告与证据在未提交的 `.scratch/tasks/p3-05/`）：Claude 调度者（haiku/low）11 轮，三张卡（逻辑、页面、整体验收），Grok 执行逻辑卡由 DeepSeek 验收，DeepSeek 执行页面卡由 Grok 验收，整体验收两家各一单，均 needsBrowser；6 个派单全部正常完成，走到审核接受，合并推送正常，约 16 分钟。完整 `test:real` 已在 2ee3c35 通过。
- 暴露问题：
  1. **Helm 缺陷（需修，见 [06](06-dsh-git-config-env.md)）**：DeepSeek 执行者 shell 里 `GIT_CONFIG_COUNT=11` 但缺 `GIT_CONFIG_KEY_n`，git 一律 exit 128；执行者自行 `unset` 后继续，这同时去掉了禁止推送的 git 配置。Grok 无此问题。
  2. 调度者策略：整体验收卡上并派第二家被 `DISPATCH_ACTIVE` 拒绝一次，调度者改为顺序派，无害；实现卡 `needsVerification=false` 时验收只靠调度策略。记录，不修。
  3. 工具限制：注入的 Playwright MCP 禁止 `file:`，验收者改用本地静态服务。记录，不修。
