# Helm v1 第三阶段：ACP 驱动

Status: ready-for-agent
Map: [Helm v1 设计](../helm-v1/map.md)

本文覆盖 [15](../helm-v1/issues/15-v1-slice.md) 定的第三阶段里的驱动部分：用通用 ACP 接入 Grok 和 DeepSeek Harness（dsh），两家只当执行者。界面另走一条线（先 `/mockup`），2048 重跑放在界面完成之后，都不在本文。前两阶段见 [第一版 spec](../helm-v1-p1/spec.md)、[第二阶段 spec](../helm-v1-p2/spec.md)，本文只写增量。术语以 [GLOSSARY.md](../../GLOSSARY.md) 为准；沙箱遵守 [ADR 0003](../../docs/adr/0003-own-sandboxes-and-work-branch.md)，订阅模板用默认主目录、全局配置正常进入遵守 [ADR 0005](../../docs/adr/0005-subscription-templates-use-default-cli-homes.md)。决策来自 2026-10-23 的 grilling；驱动前提的实测见 [22](../helm-v1/issues/22-driver-and-subscription-trial.md)，ACP 覆盖与订阅调研见 [20](../helm-v1/issues/20-acp-coverage-research.md)、[21](../helm-v1/issues/21-subscription-via-acp-research.md)。

## Problem Statement

用户现在只能把卡片派给 Claude 和 Codex。平时手动调度时，用户会派 Grok 做调研和审查、用 DeepSeek 省钱，在 Helm 里却做不到：两家的订阅或账号用不上，撞上 Claude、Codex 限额时调度者也没有别家可以改派。04 原想"接一家 ACP agent 只需登记模板"，但每家开沙箱的方法不同，只登记模板就派单，执行者能写卡片副本以外的地方，破坏硬约束。

## Solution

Helm 增加一个通用 ACP 客户端，每家 agent 在代码里登记一份薄的 **agent 档案**，写明怎样启动、怎样强制开沙箱、模型和推理强度怎么设、用量怎么读、额度报错长什么样。第一批登记 Grok（`grok agent stdio`，本机登录）和 DeepSeek（`dsh --profile acp`，`dsh web` 登录的账号路线），各带一个内置执行者模板。用户在模板里只选驱动、模型和推理强度，和 Claude、Codex 模板写法一样。调度者可以像派给 Claude、Codex 一样派给它们，拿到同样的派单结果（结束方式、token 用量、最终回答、自报结论），撞上限额时改派别家。

## User Stories

1. As a 用户, I want 调度者能把执行派单和验收派单交给 Grok, so that 我能用 SuperGrok 订阅分担工作。
2. As a 用户, I want 调度者能把派单交给 DeepSeek, so that 简单卡片能用便宜的模型做。
3. As a 用户, I want DeepSeek 默认模板沿用我 `dsh web` 登录的账号, so that 不用另外管理 API key。
4. As a 用户, I want 想按量计费时能自己加一个 DeepSeek API 模板, so that 不用改 Helm 代码。
5. As a 用户, I want Grok、DeepSeek 模板和 Claude、Codex 模板用同样的字段写模型和推理强度, so that 换家时不用学新格式。
6. As a 用户, I want 模板写了对方不支持的推理强度时模板显示为不可用并写明原因, so that 实际跑的档位和配置一致，不会被悄悄换档。
7. As a 用户, I want 把 Grok 或 DeepSeek 模板设为调度者时被拒绝并说明原因, so that 不会出现对项目代码不是只读的调度者。
8. As a 用户, I want Grok、DeepSeek 执行者只能写自己的卡片副本, so that 即使我全局开了 `always-approve`，它们也改不到我的真实项目和别的卡片。
9. As a 用户, I want Grok、DeepSeek 执行者也不能推送, so that 合并和推送仍只由 helmd 在审核接受后做。
10. As a 用户, I want Grok、DeepSeek 执行者能调用"提交结论"和浏览器工具, so that 它们的派单结果和验收方式与其他家一致。
11. As a 用户, I want 每次 Grok、DeepSeek 派单都记录 token 用量并汇总到卡片和工作上, so that 我能看到各家用了多少。
12. As a 用户, I want Grok、DeepSeek 撞上限额时派单结束方式记为"额度用完", so that 调度者按提示词改派到别家。
13. As a 用户, I want 暂停、取消卡片或工作时 Grok、DeepSeek 派单能被中止, so that 它们不会继续写副本。
14. As a 用户, I want 打回时调度者能续跑同一个 Grok 或 DeepSeek 会话, so that 执行者带着上一轮的上下文修改。
15. As a 用户, I want 运行层自动代答 ACP 权限请求，从不选 `allow_always`, so that 执行者不会停下等人，也不会在我的目录里留下永久授权。
16. As a 用户, I want DeepSeek 用文字反问后结束本轮时派单照常结束、自报结论记为未声明, so that 调度者读最终回答后决定补充信息、改派或提关卡。
17. As a 用户, I want Grok 自动压缩上下文时记一条压缩事件, so that 追查时知道执行者中途丢过上下文。
18. As a 用户, I want DeepSeek 上下文溢出时结束方式记为上下文溢出, so that 调度者能拆小卡片再派。
19. As a 用户, I want 未安装或未登录的 CLI 让对应模板显示为不可用并给出修复命令, so that 我知道该做什么。
20. As a 维护者, I want 接一家新的 ACP agent 只需写一份档案和一组冒烟测试, so that 以后接 Qoder、Gemini 等成本可控，同时沙箱约束不依赖配置写对。
21. As a 用户, I want 一次混合端到端里 Claude 调度者能把卡片分给 Grok 和 DeepSeek 并跑完, so that 不必等界面做完就知道多家混用能工作。

## Implementation Decisions

**ACP 客户端与 agent 档案**
- 新增一个通用 ACP 驱动模块，实现现有 `Driver` 接口（`checkAvailability`、`start`，事件流同 `DriverEvent`），客户端用官方 `@agentclientprotocol/sdk`，锁定确切版本、用 v1 入口。
- 每家 agent 一份 agent 档案，在代码里登记，包含：启动命令和参数、认证方式、要设和要清的环境变量（含沙箱开关）、模型和推理强度如何下发、token 用量来源、额度报错匹配规则、压缩和上下文溢出的识别。档案只描述差异，协议流程在共用模块里。
- 模板 `driver` 字段新增 `grok`、`deepseek` 两个值，各对应一份档案；`startHelmd` 默认驱动表登记这两家。修正 04"只需登记模板"的说法，见 04 评论。
- 一次派单一个 ACP 进程：`initialize` → `authenticate`（档案声明时）→ `session/new` 或续跑 → 一轮 `session/prompt` → 收尾关进程。结束判定看 `session/prompt` 响应的 `stopReason`，不看模型文字；收尾和残留进程清理沿用 11 定的做法（关管道、超时强杀、按 cwd 清残留）。
- 模板提示词沿用 `templatePrompt`，放在本轮 prompt 内容前面。
- Helm MCP 端点以 HTTP（带派单令牌请求头）放进 `session/new` 的 `mcpServers`。两家 `initialize` 都声明 `mcpCapabilities.http: true`（2026-10-23 实测），不做 stdio 转发。
- 权限代答：`session/request_permission` 有 `allow_once` 选它，只有拒绝项就拒绝并记录，从不选 `allow_always`（07）。
- 续跑：打回时按 `sessionCapabilities.resume` 用 `session/resume`（两家都有；dsh 没有 `session/load`）。验收派单仍一律新开。

**角色**
- 本阶段两家只当执行者。档案声明不支持调度者，角色为调度者的模板选这两个驱动时，模板不可用并写明原因。

**模型与推理强度**
- 模板格式不变，不加"会话选项"字段。档案把模板的 `model`、`reasoningEffort` 翻译成各家设置：
  - Grok：推理强度用启动参数 `--effort <强度>`，`max` 同义映射为 `xhigh`；模型在 `session/new`（续跑时 `session/resume`）之后用 `session/set_config_option` 设 `model`（2026-10-23 冒烟实测 `-m` 在 ACP 会话里不生效，会话仍是默认模型）。设完核对会话当前模型和强度，对不上记为出错退出，不带错模型跑。
  - DeepSeek：`session/set_config_option` 设 `model` 和 `reasoning_effort`。计费路线由模型 id 决定（`deepseek-flash`、`deepseek-v4-pro` 走 `deepseek-account`，`deepseek-v4-flash` 走 `deepseek-official` 要 API key），档案按 id 在 `configOptions` 里找到对应取值。
- 推理强度只做同义映射。对方没有的档位（DeepSeek 无 `medium`）或找不到的模型 id，模板不可用并写明原因，不就近换档。模板要钉死模型 id，不依赖各家默认值（实测 Grok 默认模型会变）。

**沙箱、环境与计费**
- Grok：设 `GROK_SANDBOX=workspace`，清掉 `XAI_API_KEY`，`authenticate` 选 `cached_token`。
- DeepSeek：显式设 `DSH_PERMISSION_MODE=workspace-write`（可写根是 cwd）；默认模板用账号路线，不设 `DEEPSEEK_API_KEY`。
- 环境变量在现有 `templateEnvironment` 基础上加档案的设置，禁止推送的 git 设置和无效 `GH_TOKEN` 同样生效。
- 主目录：订阅模板用默认主目录（`~/.grok`、`~/.dsh`），全局配置和 hook 正常进入（ADR 0005）。API 模板按第二阶段的做法用专用主目录，key 由用户按 CLI 自己的格式写。
- 提交仍由 helmd 在派单结束时做。

**结果映射**
- token 用量：Grok 取 `session/prompt` 返回值 `_meta.usage`；DeepSeek 在派单结束后按会话 id 读取 `~/.dsh/sessions/.../session.v4.jsonl.zstd`，累加每步 `usage`（内部格式，冒烟测试覆盖）。
- 额度用完：档案的匹配规则识别报错，尽力而为；匹配不上记为出错退出。
- 压缩：Grok 私有通知 `auto_compact_started` 记一条压缩事件；dsh 不把压缩送进 ACP，不记。
- 上下文溢出：dsh 报错 `CONTEXT_WINDOW_EXCEEDED` 记为上下文溢出。
- DeepSeek 文字反问后 `end_turn`：按正常完成处理，没调用"提交结论"记为未声明（07）。

**可用性检查**
- 命令能执行并完成 `initialize`；Grok 的 `authMethods` 含 `cached_token`。检查不到登录的，第一轮报错按出错退出处理，原因写进派单结果。不可用时给出修复命令（安装或 `grok login`、`dsh web`）。

**内置模板**
- 新增 `grok-executor`、`deepseek-executor` 两个执行者模板，钉死模型 id 和推理强度；冒烟测试用便宜模型和低推理强度（15 的省额度要求）。

## Testing Decisions

好测试只测驱动接口和 helmd 的外部行为：给定模板和会话参数，驱动发出什么启动参数、环境变量和协议请求，产生什么事件和派单结果；不测档案的内部结构。

**边界 1：驱动接口 + 假 ACP agent 进程**（沙箱内，`npm test`）
- 先例：Codex 驱动测试用按脚本应答的假 app-server 进程，记录收到的请求再断言。这里同样写一个假 ACP agent，脚本描述 `initialize` 能力、`configOptions`、通知、权限请求和 `stopReason`。
- 覆盖：两家的启动参数和环境变量（沙箱开关、清掉的 key）；模型和推理强度的翻译、同义映射和"不可用"；调度者角色被拒；HTTP MCP 和令牌请求头进 `session/new`；权限代答不选 `allow_always`；token 用量；额度报错映射为额度用完、其他报错为出错退出；Grok 压缩事件；dsh 上下文溢出；取消返回被中止；续跑用 `session/resume` 且会话 id 不变；进程崩溃。
- DeepSeek 用量文件解析用一个小的 zstd 样本测试。
- "额度用完 → 调度者改派"的流程已由第一版假驱动测试覆盖，不重复。

**边界 2：同一驱动接口 + 真实 CLI**（沙箱外，接进 `npm run test:real`）
- 先例：`codex-executor.real`。新增 `grok-executor.real`、`deepseek-executor.real`，各有环境变量开关，加入 real-smoke-runner。
- 每家覆盖：跑完一轮；记录 token；"提交结论"和浏览器工具在同一端点调通（同时验证令牌请求头经 ACP 送达）；写卡片副本以外的文件被拦；取消结束本轮；打回续跑答对上一轮内容。
- 顺带验证并写进测试断言：Grok `session/set_config_option` 设置模型、`--effort` 设置强度生效（配置后的会话元数据里的当前模型和强度对得上）；两个 Grok 派单同时跑时真并行（排队就算推翻、回头改设计）。实测 `GROK_SANDBOX=workspace` 会关掉 leader，每个派单在自己进程里执行工具，不共用 `~/.grok/leader.sock`；冒烟只验两派单同时到达会合点。

**边界 3：helmd + `helm` 命令行**（手动，一次）
- 混合端到端：Claude 调度者，一个小需求（不必是 2048），卡片分给 Grok 和 DeepSeek 执行者，跑到审核。看对话、派单结果和截图，不写成自动测试。

## Out of Scope

- 界面（先 `/mockup`，另出需求文档）和界面完成后的 2048 重跑（含第一版修复单 06）。
- Grok、DeepSeek 当调度者，以及它们的只读沙箱验证。
- 其他 ACP agent（Qoder、Gemini、pi 等）、zcode 一次性命令兜底。
- 模板"会话选项"通用字段。
- 读各家套餐剩余额度、美元花费。
- ACP 当前轮中途追加消息（v2 草案）。

## Further Notes

- **待验证（冒烟测试时确认）**：Grok `-m`、`--effort` 是否生效；多个 Grok 执行者能否真并行；令牌请求头能否经 ACP 送达 Helm；DeepSeek 账号路线怎么计费（跑完冒烟测试看一眼账户）。推翻任一条就回到本文修改对应决策。
- **实现时确认**：模板 skills 目录怎样交给 Grok、dsh（两家的 skills 加载方式本次没讨论）。找不到不改用户全局配置的办法时，这两个驱动的模板带 skills 目录视为不可用并写明原因，在任务单里记下。
- Grok 会加载用户全局 hook 和 `~/.claude` 规则，按 ADR 0005 接受。
- Grok 取消后正在跑的子进程是否被杀仍未确认，看门狗和按 cwd 清理不能假设取消会清掉子进程（11）。
