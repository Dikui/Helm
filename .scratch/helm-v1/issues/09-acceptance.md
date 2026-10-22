# 验收流程

Type: grilling
Status: resolved
Labels: wayfinder:grilling
Blocked by: 05, 08
Map: [Helm v1 设计](../map.md)

## Question

验收由谁来做，怎样保证是全新上下文？依据什么来验收（工作说明中的标准、边界，以及调度者落成的检查项）？是否在合并后的临时树上跑验收（参考 devteam skill）？验收不通过时怎么打回？

## Comments

- 来自 01（2026-10-21）：验收由执行者通过**验收派单**完成；每张卡片验收还是整项工作验收，由调度者决定。验收派单需要一个运行层能读的"通过 / 不通过"结论，以便拦住卡片，由本单定格式。

- 来自 [05](05-task-store-model.md)（2026-10-21）：每次派单都有"自报结论"字段，由运行层从最终回答解析：执行派单为完成 / 受阻，验收派单为通过 / 不通过，解析不出来为未声明。格式（约定末行，或注入 MCP 工具让执行者调用）由本单定。整项工作验收做成一张依赖所有卡片的"整体验收"卡片，其派单都是验收派单。验收派单记下所依据的工作说明版本（生效的最新版）。打回不是卡片状态：验收不通过后卡片处于"验收中"，调度者再派执行派单即回到"执行中"。

- 2026-10-22 冲突复核：验收派单永远开新对话，不续跑已有对话；"需要验收"由调度者设置，汇总报告列出未经验收的卡片；"整项工作必须有整体验收"不做硬约束，写进调度者提示词。整体验收不通过时，调度者建修复卡片，并给整体验收卡片补上对这些修复卡片的依赖；修复期间整体验收卡片没有派单在跑，状态为"等待前置"（推导规则见 [05](05-task-store-model.md) 的 2026-10-22 评论）。

- 2026-10-22 来自 [07](07-hard-constraints-and-tools.md)：执行者没有 Helm 工具，验收派单要用的工作说明、标准和被验收卡片的成果，由调度者写进派单内容或放进验收者的工作副本。每张卡片同时最多一个活动派单，验收派单和执行派单不能并行。

- 2026-10-22 来自 [08](08-isolation-and-merge.md)：卡片完成时才合并进工作分支，所以验收派单检查的是**卡片分支**上的成果，验收发生在合并之前。由本单决定验收派单在哪份副本里跑（复用卡片副本并保持只读，还是从卡片分支另开一个），以及整项工作的整体验收是否在 `_work`（工作分支）上做。

- 2026-10-22 15 张整体复查：① 整体验收卡片就是一张普通卡片：需要验收、只派验收派单；完成条件已放宽为"正常完成过任何派单"（见 [07](07-hard-constraints-and-tools.md) 复查评论）。08 留下的"整体验收是否在 `_work` 上做"已有答案：在它自己的卡片副本里做，副本在第一次派单时从已合齐所有成果的工作分支开出。② 验收通过后的改动一律走新卡片，与工作分支冲突也由修复卡片解决（见 [08](08-isolation-and-merge.md) 复查评论）；运行层不检查"验收是否晚于最近执行派单"，提示词要求验收通过后不再给该卡片派执行单。

## Answer

2026-10-22 与用户讨论定稿。上面各条评论中已定的内容继续有效（执行者通过验收派单验收、永远新开对话、整体验收是一张普通卡片、打回即再派执行派单），本单补齐其余部分。

1. **自报结论**：每次派单，helmd 都给执行者注入一个 `提交结论` 工具（经 helmd 的本机 HTTP MCP，令牌只对本次派单有效）。执行派单可选 `完成` / `受阻`，验收派单可选 `通过` / `不通过`，另附一句理由。可以多次调用，以派单结束时最后一次为准；调用不结束派单；只有派单正常完成时结论才有效；没调用记为"未声明"，不解析最终回答。执行者除此之外仍没有 Helm 工具。"未声明"不算通过，卡片停在验收中，由调度者读完整回答后决定重派；调度者不能改判。检查过程和证据写在最终回答里（提示词要求）。
2. **验收派单的副本**：复用卡片副本，可以写（跑测试、装依赖、写临时脚本）。helmd 在派单开始时记下卡片分支 HEAD，结束后 `git reset --hard <该 HEAD>` 加 `git clean -fd`，丢弃所有改动和验收者自己的提交，保留被 ignore 的依赖和缓存。这是硬约束（防验收者改代码让自己通过）。被验收的提交 SHA 记在派单结果里，只供追溯，不在标记完成时比对。
3. **不开临时合并树**：单卡验收只看卡片分支；集成问题由"标记完成时冲突被拒、转修复卡片"和"整体验收在合齐后的工作分支上做"兜住。
4. **验收者模板**：不做硬约束。提示词建议调度者优先选和执行者不同家的模板交叉验收，只登记了一家时同家也可以。
5. **验收依据**：运行层在每次验收派单的内容前自动附上派单时这张卡片的说明快照，并记下当时生效的工作说明版本（只作追溯），不附整份工作说明。调度者在派单内容里补检查项和成果位置；和本卡相关的边界、标准由调度者建卡时写进卡片说明，整体验收卡片的说明里写工作说明的标准（都写进提示词，运行层不特殊处理）。
6. **浏览器**：执行者不能在沙箱里自己启动 Chromium（实测四家 × 四种启动方式全部失败：macOS Seatbelt 拒绝 Chromium 注册 Mach 端口或建 socket 目录，关掉 Chromium 沙箱、把 profile 放进副本都无效；调研见 [browser-in-agent-sandbox.md](../../../docs/research/browser-in-agent-sandbox.md)）。改为：调度者派单时可以标"需要浏览器"（执行派单和验收派单都可用），helmd 为这次派单在沙箱外起一个 Playwright MCP（`@playwright/mcp`，HTTP 模式，`--isolated`，Playwright 自带 Chromium、有界面），派单结束即关。helmd 用同一个派单 MCP 端点对外提供，只转发检查所需的浏览器工具（navigate、snapshot、click、type、screenshot 等），不暴露 `browser_evaluate`、`browser_run_code_unsafe`（Playwright MCP 0.0.83 自身关不掉这两个）。执行者在沙箱里起开发服务，浏览器从沙箱外访问它。
7. **端口**：helmd 给每次派单分配一段本机端口，用环境变量传给执行者（参考 Conductor 的 `CONDUCTOR_PORT`），提示词要求开发服务用它。
8. **网络设置修订**（已记到 [08](08-isolation-and-merge.md)）：Codex 执行者 `network_access = true`，Claude 执行者 `allowLocalBinding: true`；否则两者都不能监听本机端口，Codex 还装不了依赖。

**实测**（2026-10-22，脚本在 `.scratch/prototype/helm-drivers/`：`browser-probe.mjs`、`sandbox-browser-probe.mjs`、`sandbox-mcp-probe.mjs`、`claude-mcp-retest.mjs`、`mcp-stdio-bridge.mjs`、`listen-probe.mjs`，未提交）：用第 6、8 条的设置，四家执行者都在沙箱内起服务监听成功，调用沙箱外 HTTP Playwright MCP 打开页面、截图，截图和回答中的随机 nonce 全部匹配。接入细节：
- Codex app-server：`thread/start.config.mcp_servers.playwright.url` 注入；`approvalPolicy: never` 下 MCP 工具会被拒，须给所需工具配 `default_tools_approval_mode: approve`（或逐个 `enabled_tools`）；本机有 `HTTP(S)_PROXY` 时须设 `NO_PROXY`/`no_proxy` 含 `127.0.0.1,localhost`，否则握手 403。
- Claude SDK：`mcpServers: { type: 'http', url, headers }` 可用，带 `Authorization` 头也行；首轮曾出现 `needs-auth`、未复现、原因未查明。stdio 直接起 Playwright MCP（浏览器在 Bash 沙箱外）和 stdio 转发小程序（约 35 行，带令牌头连 HTTP）两条退路都实测通过。
- Grok、DeepSeek：ACP `session/new.mcpServers` 的 `type: http` 可用（两者 `mcpCapabilities.http: true`）。Grok 的沙箱虽包住整个进程，浏览器在 helmd 侧，不受影响。
- Playwright MCP 0.0.83 默认只放行 `localhost:<port>` 的 Host，用 127.0.0.1 要加 `--allowed-hosts`；它要求 chromium-1247，须按版本装浏览器；socket 路径过长时设 `PWTEST_SOCKETS_DIR`。
- 浏览器在沙箱外运行，会写 `~/Library/Application Support/Google/Chrome for Testing/Crashpad/`，接受。

已在 05、07、08、14 留评论，GLOSSARY 的"派单结果""验收"已更新。

- 2026-10-22 20 张整体复查：第 2 条的重置之前，helmd 先结束副本里残留的进程（先 `SIGTERM`，5 秒后 `SIGKILL`）；派单开始前检查副本是否干净。见 [11](11-persistence-and-recovery.md) 复查评论。
