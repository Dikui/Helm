# ACP 能否作为接入各家 agent CLI 的统一通道

Type: research
Status: resolved
Labels: wayfinder:research
Blocked by: 19
Map: [Helm v1 设计](../map.md)

## Question

用户要求以后接入市面上大多数 coding agent（pi、DeepSeek Harness、Qoder、zcode 等），不只 Codex、Claude Code、Grok。哪些 agent 原生或经适配器支持 ACP（Agent Client Protocol）？用 ACP 同时驱动调度者（多轮）和执行者（一次派单）是否可行：订阅或本机登录、无人值守审批、取消、续跑、结构化事件、用量是否都能拿到？不支持 ACP 的 agent 有什么替代（一次性无头命令、各自协议）？结论交给 [技术栈与进程结构](04-tech-stack.md)。

## Answer

调研结论见 [acp-coverage.md](../../../docs/research/acp-coverage.md)（Grok，2026-10-21，一手来源）。

- **覆盖**：ACP registry 有 43 个 coding agent，同日协议矩阵 36 个里 35 个 `initialize` 成功。原生 ACP：Qoder（`qoder --acp`）、Gemini、OpenCode、Cursor、Copilot、Kimi、Qwen、Goose、Cline、Auggie、Droid、Grok（`grok agent stdio`）、DeepSeek Harness（`dsh --profile acp`，不在 registry）。经适配器：pi（`pi-acp`）、Amp、Codex（`codex-acp`）、Claude Code（`claude-agent-acp`）。zcode 是智谱的桌面 ADE，没有 CLI，也没有 ACP，暂时接不了。
- **协议能覆盖的**（ACP v1 稳定）：同一进程多轮、一轮派单（`session/prompt` 返回 `stopReason`）、取消（`session/cancel`）、`cwd` 与 `mcpServers` 注入、结构化事件。权限由客户端代答 `session/request_permission`（协议没有 yolo 参数）。续跑按 `initialize` 能力选 `session/resume` 或 `session/load`，各家不一。**不能覆盖的**：当前轮中途追加（v2 草案才有）、套餐剩余额度（`usage_update` 只有上下文占用和可选费用）。
- **建议**：ACP v1 作为 Agent 模板的默认驱动，TS 客户端用官方 `@agentclientprotocol/sdk`（钉 v1）；执行派单用短命 ACP 进程（一轮后结束）；不支持 ACP 的用一次性无头命令兜底。Grok 原生 ACP；调研倾向 Codex、Claude 的调度者仍用原生通道（app-server 有中途追加，Claude 适配器订阅登录未核实）。添加一家 agent 最少要：启动命令、认证方式、`initialize` 读到的能力，权限策略和超时由运行层补。
- **待实测**：`codex-acp`、`claude-agent-acp` 不设 API key 时是否走订阅登录；Grok 是否实现 `session/cancel`；各家广告的续跑能力是否真能用。

## Comments
