# 调度者能否用订阅额度运行

Type: research
Status: resolved
Labels: wayfinder:research
Map: [Helm v1 设计](../map.md)

## Question

调度者（以及执行者）能否用订阅额度运行，而不必按 API 计费？查清 Claude Code CLI（`-p` 无头模式）、Claude Agent SDK、Codex SDK/CLI（ChatGPT 登录）、Grok CLI 在个人自用、后台长期运行、由程序拉起这几种场景下，使用条款和技术上是否允许用订阅登录，以及各自的用量限制。检验 A3。

## Answer

调研结论见 [subscription-billing.md](../../../docs/research/subscription-billing.md)（Grok，2026-10-20，依据官方条款、帮助中心和定价页；本机未做真实调用）。

- **A3：支持，限个人自用**。条件是：在用户自己的机器上，用用户自己的订阅登录，拉起**未修改的官方 CLI**；Helm 不自己实现登录，不代持或转发凭证，也不设置会覆盖订阅的 API key。做成给别人用、靠他们的订阅来跑的产品，三家条款都禁止。
- **调度者最稳妥的选择**依次是：① `codex exec` 加 ChatGPT 登录（文档明确允许为了用订阅限额这样跑，Pro 目前没有五小时窗口）；② SuperGrok 登录、不设 `XAI_API_KEY` 的 `grok -p`（每周池包含 Build）；③ Pro/Max 登录、不加 `--bare`、不设 `ANTHROPIC_API_KEY` 的 `claude -p`（受五小时和每周限额约束，文档已预告 `--bare` 会成为默认，而 bare 模式不读订阅）；④ Claude Agent SDK（帮助中心说目前从订阅扣，但 SDK 文档要求第三方用 API key，不稳）。
- **设计上的影响**：调度者和执行者都通过官方 CLI 拉起，不嵌入 SDK（影响 [04](04-tech-stack.md)、[06](06-coordinator-lifecycle.md)）。额度用尽时服务会停，或转为按量计费，这和 Not yet specified 里的"额度与替补"有关。
- **未能判断**：X Subscription 的额度池是否包含 Grok Build；Codex SDK 在没有 API key 时是否读取 CLI 的 ChatGPT 登录；Claude 的 `-p` 默认改成 bare 之后，订阅无头调用还能不能用。

## Comments

- 2026-10-21 被 [04](04-tech-stack.md) 修订："不嵌 SDK"不再成立。Claude Code 改用 Claude Agent SDK，并用 `pathToClaudeCodeExecutable` 指向本机的 `claude`；依据是帮助中心写明"用计划登录时，SDK 用量从计划额度扣"，以及封号风险调研（[subscription-ban-risk.md](../../../docs/research/subscription-ban-risk.md)，结论为低风险）。Codex 改用 `codex app-server`，其他 agent 走 ACP。前提不变：用户本人在自己的机器上自用，Helm 不读取、不转发凭证。

- 2026-10-21 补充：本单"调度者首选 `codex exec`"也已过时。`codex exec` 跑完一轮就退出，当不了 01 定的长时调度者；Codex 当调度者时用 `codex app-server`（见 04）。
