# 01 — Grok 执行者跑通一轮

**What to build:** 调度者能把执行派单和验收派单交给 Grok：派单以本机登录拉起 `grok agent stdio`，执行者只能写卡片副本，能调用"提交结论"和浏览器工具，正常完成时派单结果带最终回答、自报结论和 token 用量。同时建好所有 ACP agent 共用的 ACP 客户端模块和"agent 档案"登记方式，Grok 是第一份档案。见 [spec](../spec.md) 的"ACP 客户端与 agent 档案""角色""模型与推理强度""沙箱、环境与计费""可用性检查"。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 共用 ACP 驱动模块实现现有 `Driver` 接口，客户端用 `@agentclientprotocol/sdk`，锁定确切版本、用 v1 入口；每次派单一个进程：`initialize` → `authenticate` → `session/new` → 一轮 `session/prompt` → 收尾关进程，结束看 `stopReason`
- [ ] agent 档案在代码里登记，描述启动命令、认证、环境变量、模型和推理强度下发、用量来源；协议流程不进档案
- [ ] 模板 `driver` 新增 `grok`；`startHelmd` 默认驱动表登记；内置 `grok-executor` 模板钉死模型 id 和推理强度
- [ ] 调度者角色的模板选 `grok` 时不可用，原因写明本阶段只支持执行者
- [ ] 模型和推理强度经启动参数 `-m`、`--effort` 下发，`max` 映射为 `xhigh`，其余对方没有的档位让模板不可用并写明原因
- [ ] 设 `GROK_SANDBOX=workspace`、清掉 `XAI_API_KEY`、`authenticate` 选 `cached_token`；禁止推送的 git 设置和无效 `GH_TOKEN` 照常生效
- [ ] Helm MCP 以 HTTP 加派单令牌请求头进 `session/new` 的 `mcpServers`
- [ ] `session/request_permission` 有 `allow_once` 选它，只有拒绝项就拒绝并记录，从不选 `allow_always`
- [ ] 模板提示词（`templatePrompt`）放在本轮 prompt 内容前面
- [ ] 正常完成时派单结果带最终回答，token 用量取 `session/prompt` 返回值 `_meta.usage`
- [ ] 可用性检查：命令能执行并完成 `initialize`、`authMethods` 含 `cached_token`；不可用时给出修复命令
- [ ] 假 ACP agent 进程（按脚本应答并记录请求，先例为 Codex 驱动测试的假 app-server）覆盖以上行为；`npm run check`、`npm test` 通过
- [ ] `grok-executor.real` 接进 `npm run test:real`（沙箱外，便宜模型、低推理强度），覆盖：跑完一轮；"提交结论"和浏览器工具同端点调通；写卡片副本以外被拦；记录 token；会话元数据里的当前模型和强度与模板一致；两个派单同时跑时真并行（排队就记下并回到 spec 改设计）

## Comments
