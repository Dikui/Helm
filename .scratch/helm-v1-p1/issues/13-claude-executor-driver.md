# 13 — Claude 执行者驱动

**What to build:** 真实的 Claude 执行者通过 Claude Agent SDK 拉起本机 `claude`，在卡片副本里干活：沙箱和权限只放它写副本，不读本机全局配置，经带令牌的 HTTP MCP 使用"提交结论"和浏览器工具。冒烟测试用真 CLI 证明这些设置生效。见 [spec](../spec.md) 的"驱动接口"和"Testing Decisions"副边界。

**Blocked by:** 04 — 执行派单主路径；08 — 浏览器派单

**Status:** resolved

- [x] `pathToClaudeCodeExecutable` 指向本机 `claude`，用户自己登录，Helm 不读、不存、不转发凭证；`settingSources: []`
- [x] 执行者设 `permissionMode: 'default'`；`sandbox` 开启、`autoAllowBashIfSandboxed: true`、`allowUnsandboxedCommands: false`、`network.allowLocalBinding: true`
- [x] `canUseTool` 拒绝副本以外的 Write/Edit/MultiEdit/NotebookEdit；有 `allow_once` 选它，从不选 `allow_always`
- [x] MCP 用 `type: 'http'` 带 `Authorization` 头注入；本机有代理变量时设 `NO_PROXY` 含 `127.0.0.1,localhost`
- [x] 结束判定看 `result` 消息；token 取 `modelUsage`；`compact_boundary` 交回为压缩通知；识别撞订阅限额为"额度用完"
- [x] 冒烟①：执行者在同一端点调用"提交结论"和转发的浏览器工具
- [x] 冒烟③（执行者部分）：副本外的 Write 被 `canUseTool` 拒绝，副本外的 Bash 写入被沙箱拦下，副本内正常
- [x] 冒烟⑤：多跑几轮看 `needs-auth` 是否复现；复现就改用每派单一个 stdio 转发小程序（带令牌连 HTTP），令牌和作用范围不变
- [x] 冒烟测试用消耗小的模型和低推理强度；额度用完的识别怎么验证在报告里说明

## Comments

实现本机 Claude SDK 执行者驱动、单次权限与副本边界、带令牌 HTTP MCP、结束与用量映射，并用假 SDK 查询流和浏览器替身覆盖；另提供 Haiku/low 的独立真实冒烟脚本 `npm run test:claude-executor`，本轮按要求未运行，冒烟勾选项留待沙箱外验证。

- 2026-10-22 调度者：沙箱外真实冒烟（main 83428a3，worktree smoke3）`npm run test:browser`、`test:claude-executor` 5/5、`test:claude-coordinator` 6/6 全部通过，Haiku + low；未复现 needs-auth，截图只落在派单输出目录。
