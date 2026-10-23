# 05 — 混合端到端

**What to build:** 用户用 `helm` 命令行提一个小需求（不必是 2048），Claude 调度者把卡片分给 Grok 和 DeepSeek 执行者，跑完执行和验收，一直到审核。用户不等界面做完就能确认多家混用能工作。见 [spec](../spec.md) 的 Testing Decisions 边界 3。

**Blocked by:** 02 — ACP 派单的中止、续跑和异常结束；03 — DeepSeek 执行者；04 — Grok、DeepSeek 模板的 skills

**Status:** ready-for-agent

- [ ] 沙箱外以 `helm serve` 和真实 CLI 手动跑一次，Claude 调度者，Grok、DeepSeek 至少各接一次派单（执行或验收）
- [ ] 工作走到审核；查看对话、派单结果（结束方式、token、自报结论）和浏览器验收截图
- [ ] 暴露的 Helm 问题逐条记进本单 Comments，需要修的另开修复单
- [ ] 跑之前 `npm run test:real --cache /private/tmp/helm-npm-cache` 通过

## Comments
