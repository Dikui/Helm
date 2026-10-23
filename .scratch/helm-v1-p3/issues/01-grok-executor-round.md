# 01 — Grok 执行者跑通一轮

**What to build:** 调度者能把执行派单和验收派单交给 Grok：派单以本机登录拉起 `grok agent stdio`，执行者只能写卡片副本，能调用"提交结论"和浏览器工具，正常完成时派单结果带最终回答、自报结论和 token 用量。同时建好所有 ACP agent 共用的 ACP 客户端模块和"agent 档案"登记方式，Grok 是第一份档案。见 [spec](../spec.md) 的"ACP 客户端与 agent 档案""角色""模型与推理强度""沙箱、环境与计费""可用性检查"。

**Blocked by:** None — can start immediately

**Status:** ready-for-human

- [x] 共用 ACP 驱动模块实现现有 `Driver` 接口，客户端用 `@agentclientprotocol/sdk`，锁定确切版本、用 v1 入口；每次派单一个进程：`initialize` → `authenticate` → `session/new` → 一轮 `session/prompt` → 收尾关进程，结束看 `stopReason`
- [x] agent 档案在代码里登记，描述启动命令、认证、环境变量、模型和推理强度下发、用量来源；协议流程不进档案
- [x] 模板 `driver` 新增 `grok`；`startHelmd` 默认驱动表登记；内置 `grok-executor` 模板钉死模型 id 和推理强度
- [x] 调度者角色的模板选 `grok` 时不可用，原因写明本阶段只支持执行者
- [x] 模型和推理强度经启动参数 `-m`、`--effort` 下发，`max` 映射为 `xhigh`，其余对方没有的档位让模板不可用并写明原因
- [x] 设 `GROK_SANDBOX=workspace`、清掉 `XAI_API_KEY`、`authenticate` 选 `cached_token`；禁止推送的 git 设置和无效 `GH_TOKEN` 照常生效
- [x] Helm MCP 以 HTTP 加派单令牌请求头进 `session/new` 的 `mcpServers`
- [x] `session/request_permission` 有 `allow_once` 选它，只有拒绝项就拒绝并记录，从不选 `allow_always`
- [x] 模板提示词（`templatePrompt`）放在本轮 prompt 内容前面
- [x] 正常完成时派单结果带最终回答，token 用量取 `session/prompt` 返回值 `_meta.usage`
- [x] 可用性检查：命令能执行并完成 `initialize`、`authMethods` 含 `cached_token`；不可用时给出修复命令
- [x] 假 ACP agent 进程（按脚本应答并记录请求，先例为 Codex 驱动测试的假 app-server）覆盖以上行为；`npm run check`、`npm test` 通过
- [x] `grok-executor.real` 接进 `npm run test:real`（沙箱外，便宜模型、低推理强度），覆盖：跑完一轮；"提交结论"和浏览器工具同端点调通；写卡片副本以外被拦；记录 token；会话元数据里的当前模型和强度与模板一致；两个派单同时跑时真并行（排队就记下并回到 spec 改设计）

## Comments

2026-10-23 实现：新增共用 ACP v1 客户端、Driver 和代码内 agent 档案，首份为 Grok；SDK 精确锁定 `@agentclientprotocol/sdk@2.0.2`，使用默认稳定 v1 入口。订阅沿用默认 HOME，强制 `GROK_SANDBOX=workspace`、清除 `XAI_API_KEY` / `GROK_HOME`，保留现有禁止推送设置。模型与推理强度经 `agent -m ... --effort ... stdio` 下发，按 initialize 的模型元数据拒绝未知模型或不支持的档位；调度者角色在模板同步读取和驱动入口均被拒绝。已登记 startHelmd 与 CLI serve 驱动表，新增 `grok-executor`（`grok-4.7` / low）。权限仅单次允许或拒绝，HTTP MCP 携带派单令牌，模板提示词前置，最终回答与 `_meta.usage` 进入既有派单结果及用量汇总。进程正常收尾有 TERM 后强杀兜底，副本残留仍由既有运行层清理。

假 ACP 子进程与 helmd 外部行为测试覆盖执行和验收派单、同端点结论与浏览器工具、执行提交及验收重置、可用性和收尾。实际 `npm run check` 通过；最终 `npm test` 为 348/348 通过。早期回归暴露的旧驱动表和模板列表断言已同步更新；一次既有派单唤醒断言失败后，定向复跑与最终全量均通过，详见执行报告。

上述复选框表示实现及测试代码已完成。`tests/grok-executor.real.ts` 已接入 `test:real`（`HELM_GROK_EXECUTOR_REAL=1`），本轮按用户要求只编译、未执行。需在沙箱外运行 `npm run test:real --cache /private/tmp/helm-npm-cache`，确认一轮完成、token、同端点结论/浏览器和令牌、副本外写入被拦、会话元数据的模型/强度，以及同一默认 leader socket 的两个派单真并行，并查看输出证据目录里的 `grok.png`。并行冒烟用双 HTTP 等待点交会判定，排队则断言失败，需记录证据并回到 spec 修订设计。

范围：取消、续跑、额度识别和压缩留给任务单 02；模板 skills 接入留给 04，本轮带 skills 的 Grok 模板明确不可用。本轮未派生子代理，未运行浏览器或真实 claude/codex/grok 会话。

提交阻塞：当前环境禁止写入项目 `.git`；逐文件暂存的第一步 `git add -- package.json` 因无法创建 `.git/index.lock`（Operation not permitted）失败，且不允许提权，因此尚未提交 main。改动保留在工作区；未暂存或提交 `todos-research.html`。待在允许写入 `.git` 的环境逐文件暂存后使用中文提交信息，并以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。完整执行及工作区自审记录仅写入 `.scratch/tasks/p3-01/report.md`。
