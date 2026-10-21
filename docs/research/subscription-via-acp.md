# 经 ACP 或其他非原生方式接入时，订阅套餐是否仍然有效

调研日期：2026-10-21（Grok，一手来源）。

换一种启动方式，订阅不会自动失效。失效发生在两处：进程环境里留下了会压过订阅的 API key，或者请求不再由厂商发布的程序发出，而是另一个程序拿着用户的登录去打接口。Helm 的边界不变：在用户自己的机器上，拉起用户已经登录的官方程序，运行层不保存、不转发凭证。额度数字、五小时窗口和每周池沿用 [subscription-billing.md](subscription-billing.md)，这里只补「ACP 或非交互协议还走不走那份订阅」。

Helm 的主通道保持三条。Claude 的调度者继续直接拉起本机的 `claude -p --input-format stream-json --output-format stream-json`，不加 `--bare`，环境里没有 `ANTHROPIC_API_KEY`。Codex 的调度者继续直接拉起 `codex app-server`，环境里没有 `CODEX_API_KEY` 和 `OPENAI_API_KEY`。Grok 的调度者继续用 `grok agent stdio`，认证选 `cached_token`，环境里没有 `XAI_API_KEY`。这三条都是厂商自己的程序。`@agentclientprotocol/claude-agent-acp` 和 `@agentclientprotocol/codex-acp` 在源码里也是去拉官方程序，技术上可以走到订阅，但多一层由 Zed / ACP 维护的进程。个人自用可以实测，不作为主通道。

智谱 GLM Coding Plan 绑的是「名单里的工具 + 专用端点」，没有一条与 Claude OAuth 同类的通用订阅登录。最稳的是：拉起未改的 Claude Code，按智谱文档把 Base URL 指到 `https://open.bigmodel.cn/api/anthropic`，填套餐 API key。这样扣的是 Coding Plan，Claude 订阅不参与。官方 `zcode` 现在有一次性无头命令，ZCode 在名单里，适合作为执行者的另一条路。`glm-acp-agent` 是个人维护的社区包，直接请求 Coding Plan 端点，不在名单里。DeepSeek 没有找到包月订阅，`dsh` 的 ACP 与无头都用 `DEEPSEEK_API_KEY` 按量计费。pi 的 `/login` 把 Claude、ChatGPT 订阅做进第三方 harness：Claude 这一条被合规页禁止，ChatGPT 这一条没有找到 OpenAI 的允许句。用户不单独接 pi。

## 总表

图例：走订阅 / 按量 / 不能 / 未找到。条款：明确允许 / 未禁止 / 明确禁止 / 不确定。「走订阅」是文档和源码给出的预期，扣在哪一栏以实测为准。

| 厂商 | 接入方式 | 是否走订阅 | 条款 |
| --- | --- | --- | --- |
| Claude Code | 官方 CLI 一次性无头：`claude -p`，不加 `--bare`，无 `ANTHROPIC_API_KEY` | 走订阅 | 明确允许。见既有调研 |
| Claude Code | 官方 CLI 协议：`claude -p --input-format stream-json --output-format stream-json`，同样不加 `--bare`、不设 key | 走订阅。与上一行是同一个二进制、同一套登录 | 明确允许 |
| Claude Code | 官方原生 ACP | 不能。Claude Code 自己没有 ACP 子命令 | — |
| Claude Code | 第三方适配器 `@agentclientprotocol/claude-agent-acp@0.94.0`（旧包 `@zed-industries/claude-code-acp@0.16.2` 已废弃） | 不设 `ANTHROPIC_API_KEY`、不加 `--hide-claude-auth` 时，源码把这一轮判定为 claude.ai 订阅支付。拉起的是 SDK 附带的官方 `claude` 二进制，PATH 上的 `claude` 只有设置 `CLAUDE_CODE_EXECUTABLE` 才会被用到 | 不确定，偏严。合规页允许终端用户登录未修改的官方二进制；SDK 概览禁止第三方在自己的产品里提供 claude.ai 登录。个人自用、登录仍由该二进制自己的 `auth login` 完成，落在两句之间 |
| Codex | 官方 CLI 一次性无头：`codex exec`，ChatGPT 登录，无 API key | 走订阅 | 明确允许。见既有调研 |
| Codex | 官方 CLI 协议：`codex app-server` | 走订阅。认证模式 `chatgpt` 由 Codex 保存并刷新 token，与 CLI、IDE 扩展共用 `~/.codex/auth.json` 或系统钥匙串 | 本机和开源应用可以继续用 app-server 的这套登录。商业或托管服务明确不允许，应改走 Sign in with ChatGPT |
| Codex | 官方原生 ACP | 不能。Codex 自己没有 ACP 子命令 | — |
| Codex | 第三方适配器 `@agentclientprotocol/codex-acp@2.2.2` | 与直接用 `codex app-server` 相同：适配器 spawn 官方 `codex app-server`，自己不打开 `auth.json`。已有 ChatGPT 登录时由 app-server 读到 | 与上一行相同。Zed、JetBrains 写明账单在用户与 OpenAI 之间，IDE 不代收这笔费用 |
| Grok Build | 官方 CLI 一次性无头：`grok -p`，无 `XAI_API_KEY` | 走本机登录。SuperGrok 的每周池写明包含 Build。已切到 The X Subscription 时，每周池说明没有点名 Build | 官方无头，未禁止。见既有调研 |
| Grok Build | 官方 CLI 协议，且不是 ACP | 未找到。多轮通道就是下面的 ACP | — |
| Grok Build | 官方原生 ACP：`grok agent stdio`，`authenticate` 选 `cached_token` | 走本机登录。源码把该方法写成 `~/.grok/auth.json` 里的缓存 token。官方示例在同时存在 `XAI_API_KEY` 时改选 `xai.api_key`，那一档按 API 计费 | 这是官方 CLI 写明的模式，未禁止。未找到「第三方程序拿 Grok 凭证、经 ACP 花订阅」的允许句 |
| Grok Build | 第三方适配器 | 未找到官方适配器 | 未找到允许 |
| 智谱 GLM / zcode | 官方 CLI 一次性无头：`zcode --prompt … --json` | 产品可绑 GLM Coding Plan。本次没有读到「`zcode login` 一定扣套餐、不会扣资源包」 | 明确允许使用名单内的 ZCode。ZCode 条目写 1.5 倍用量。CLI 与桌面是否同一产品环境，页面没有分开写 |
| 智谱 GLM / zcode | 官方协议或官方原生 ACP | 未找到。zcode.z.ai 仍是桌面文档。GitHub 使用指南目录没有 ACP。社区桥接自称调用 `zcode app-server --stdio`，作者写明非官方 | 社区桥接：不确定 |
| 智谱 GLM | 名单内的其他工具：Claude Code 改 Base URL；OpenCode、Goose、Cline、Kilo、Crush 等 | 配置了套餐 key 和 Coding Plan 专用端点时走套餐。Claude 订阅、OpenAI 订阅不参与 | 明确允许这些工具。名单外的自建应用、网站、机器人、SaaS 明确不可用套餐额度 |
| 智谱 GLM | registry 的 `glm-acp-agent` | 维护者把默认端点写成 Coding Plan 的 `https://api.z.ai/api/coding/paas/v4`，凭据是 API key | 明确落在名单外。不作为 Helm 的接入 |
| DeepSeek | `dsh --profile headless` | 按量。凭据是 `DEEPSEEK_API_KEY` | 未找到订阅。按 token 计费是公开价格 |
| DeepSeek | `dsh --profile acp` | 按量。随附路由是 `deepseek-official` / `deepseek-v4-flash`，同一把 key | 同上 |
| DeepSeek | 官方原生以外的 CLI，例如 Claude Code 把 Base URL 改到 `https://api.deepseek.com/anthropic` | 按量，使用 DeepSeek API key。Claude 订阅不参与 | DeepSeek 文档写明了 Claude Code、OpenCode、Copilot CLI 的接法 |
| pi | `pi` 的 `/login`，以及社区 `pi-acp` 再拉起 `pi --mode rpc` | v0.65.0 的 README 把 Claude Pro/Max、ChatGPT Plus/Pro 列为订阅登录。2026-10-21 的 main 文档仍写 `/login` 连接订阅或 API key，本次打开的章节没有再逐条点名这两家 | Claude：明确禁止第三方这么用。ChatGPT：不确定。OpenAI 给其他应用用计划额度的路径是 Sign in with ChatGPT，pi 的登录不走那块同意屏 |

## 逐家事实

### Claude Code

`@agentclientprotocol/claude-agent-acp@0.94.0` 的 `package.json` 把入口写成 `dist/index.js`，依赖 `@anthropic-ai/claude-agent-sdk@0.3.303`。npm 上的 `@zed-industries/claude-code-acp@0.16.2` 已标记废弃，作者说明要求改用新包名。两代 README 都写：这个程序用官方 Claude Agent SDK 实现 ACP agent。

调用链在源码里是三步。

1. `src/index.ts` 的 `--cli` 会 `spawn` `claudeCliPath()`，把其余参数交给那个二进制。登录参数来自 `initialize` 里的认证方法：`claude-ai-login` 的说明是 “Use Claude subscription”，参数为 `--cli auth login --claudeai`；另一条是 Anthropic Console 的按量登录。
2. `claudeCliPath()` 先看 `CLAUDE_CODE_EXECUTABLE`。没设置时，用 `createRequire` 解析 SDK 的可选依赖 `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`。找不到就报错，并提示重装 SDK 或设置该变量。它不查找 PATH 上的 `claude`。
3. 建会话时把这个路径传给 SDK 的 `query()`，字段是 `pathToClaudeCodeExecutable`。SDK 文档写：TypeScript SDK 自带一份原生 Claude Code 二进制；`pathToClaudeCodeExecutable` 的默认值就是这份二进制，只有跳过可选依赖或平台不在支持列表时才需要另指路径。SDK 概览写：Agent SDK 是在你自己的进程里运行 Claude Code 二进制的库。

因此：适配器使用 Claude Agent SDK，SDK 再拉起一份官方 `claude` 二进制。默认是 SDK 附带的那一份，可以改成用户本机的那一份。

不设 `ANTHROPIC_API_KEY` 时，适配器把账号当成订阅来处理。`src/hide-claude-auth.ts` 写明：`subscriptionType` 有值、没有 `tokenSource`、`apiProvider` 为空或 `firstParty`、`apiKeySource` 不是 `ANTHROPIC_API_KEY`、`apiKeyHelper` 或 `/login managed key` 时，这一轮由 claude.ai 订阅支付。`--hide-claude-auth` 会藏起订阅登录，并拒绝这种账号。默认不加这个旗标。适配器自己不写入 API key。环境里如果已经有 `ANTHROPIC_API_KEY`，Claude Code 的凭证优先级会让 key 压过 OAuth，账单改为 API。这一点沿用既有调研，适配器没有做相反的处理。

条款有两句，都在 2026-10-21 打开的页面上。

- [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) 的 Authentication and credential use：OAuth 只给 Claude Free、Pro、Max、Team、Enterprise 的购买者，用于 Claude Code 和其他 Anthropic 原生应用的普通使用。开发者不得在自己的应用里提供 Claude.ai 登录，不得用 Free、Pro、Max 凭证替用户转发请求，不得收集、保存或代持凭证。同一段接着写：这不阻止终端用户用自己的 Claude 订阅登录未修改的 Claude Code 二进制，包括某个平台按该页条件托管这份二进制。托管条件在同一页 “Can customers offer Claude Code in their products?”：二进制不得修改，不得代终端用户付费、转售或居中转发，每个终端用户用自己的订阅、API key 或云厂商凭证。
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)：未经事先批准，不允许第三方开发者在自己的产品里提供 claude.ai 登录或套餐限额，包括用 Agent SDK 做的 agent，请改用 API key。同一页写 SDK 受 Commercial Terms 约束。

帮助中心仍把订阅者自己用 Agent SDK 算进计划限额，见既有调研的 [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)。那是订阅者本人的用量归属，不是第三方产品的许可。

Zed 的 [External Agents](https://zed.dev/docs/ai/external-agents) 写：外部 Agent 的账单、条款、留存和数据处理在用户与 Agent 提供方之间，Zed 不收费。Claude Agent 自己拥有认证和账单；Zed Agent 里配置的 Anthropic API key 不会自动配给它。选择账单的方式是在 Claude Agent 线程里认证，可以是 API key，或在支持的地方使用 Claude Code。同一页的例子写 Claude Agent 可以使用 Claude Code 的认证和 Claude 自己的配置。Zed 没有写「ACP 适配器一定计入 Pro/Max 限额」。

直接拉起本机 `claude` 的 stream-json 更稳。它就是合规页点名的那份未修改二进制，也是用户 `/login` 写进钥匙串的那一份。适配器默认拉起另一份随 SDK 发布的二进制，版本由包锁定（0.94.0 对应 SDK 0.3.303）。两份都是 Anthropic 发布的，登录存储按 Claude Code 的钥匙串和 `~/.claude` 共用，但本次没有在适配器里读到「强制使用用户 PATH 上的 claude」。调度者要连续收 stream-json，既有调研已经把这条写成主通道。适配器还要处理 ACP 的一轮 `session/prompt`，并且作者准备了专门拒绝订阅的旗标，说明这层进程的集成方可以关掉订阅。

推翻条件：本机 `claude` 在 stream-json 下第一条结果后退出，而适配器在不设 `ANTHROPIC_API_KEY`、不加 `--hide-claude-auth`、不设 `CLAUDE_CODE_EXECUTABLE` 时连续接受 `session/prompt`，用量页扣在计划限额上。或者 Anthropic 把「终端用户登录未修改二进制」收窄到交互终端，把 SDK 拉起的同一二进制排除在外。

### Codex

`@agentclientprotocol/codex-acp@2.2.2` 的 README 写：它是 stdio 上的 ACP agent，启动 Codex App Server，把 ACP 请求译成 Codex 操作。`package.json` 依赖 `@openai/codex@^0.160.1`。`src/CodexJsonRpcConnection.ts` 的默认启动参数是 `["app-server"]`。设置了 `CODEX_PATH` 就 spawn 那个可执行文件；否则 spawn `process.execPath`，脚本是包内的 `@openai/codex/bin/codex.js`。子进程环境是调用时传入的 env，入口处用的是 `process.env`。源码里没有打开 `~/.codex/auth.json`。

已登录时由 app-server 回答账号。`CodexAcpServer.ts` 写：没有登录时账号读取不需要网络，加载会话以 `auth_required` 失败；有 ChatGPT 登录时会等 ChatGPT 后端，app-server 最多等 15 秒。认证方法在 `CodexAuthMethod.ts`：始终广告 API key；没设 `NO_BROWSER` 时广告 `chat-gpt`，说明是 “Use ChatGPT to authenticate”；客户端支持 URL elicitation 时再广告设备码。README 写 API key 来自 `CODEX_API_KEY`，否则 `OPENAI_API_KEY`，并且只在选了 API key 这种方法时使用。

官方 [App Server](https://learn.chatgpt.com/docs/app-server) 写：app-server 是 Codex 用来驱动富客户端的接口，例子是 Codex VS Code 扩展；用途包括认证、会话历史、审批和事件流。入门示例就是 `spawn("codex", ["app-server"])`，握手后直接 `thread/start`，没有另写一次登录。Auth endpoints 一节写了三种模式。其中 ChatGPT managed（`chatgpt`）：Codex 拥有 ChatGPT OAuth，持久化 token 并自动刷新。同一节写：已经用 app-server 认证做了本地或开源应用的，可以继续用，同时建议迁到 Sign in with ChatGPT，让用户对自己的用量有更多控制和可见性。app-server 认证从未被允许用于商业或托管服务。Sign in with ChatGPT 是为后一类场景推出的。

[Authentication](https://learn.chatgpt.com/docs/auth) 写：用 ChatGPT 登录是订阅访问，用 API key 是按量访问。ChatGPT 桌面、Codex CLI 和 IDE 扩展的登录缓存在本地，CLI 与扩展共用这份缓存。缓存位置是 `~/.codex/auth.json`，或操作系统凭证库，由 `cli_auth_credentials_store` 选择 `file`、`keyring`、`auto` 或 `ephemeral`。因此：文件模式下 app-server 读的就是 `~/.codex/auth.json`；钥匙串模式下不是这个文件，而是同一份 CLI 登录。适配器没有自己实现第三种存储。

[Access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens) 写：`codex app-server` 可以用 `CODEX_ACCESS_TOKEN`，或一次登录所建立的凭证，来认证发往 OpenAI 的请求。这是企业 workspace 的无浏览器路径，个人 Plus、Pro 仍是既有调研里的浏览器登录。传输层的 WebSocket 令牌是另一回事，不要把 Codex 访问令牌当成它。

Zed 同一页写：Codex 自己拥有认证和账单；可以是 ChatGPT 登录、Codex API key、OpenAI API key 或 Codex 自己的配置，视安装版本和环境而定。JetBrains 知识库 [Using Claude, Codex, and Cursor agents](https://youtrack.jetbrains.com/articles/SUPPORT-A-3700)（2026-10-19）写：ACP 模式不需要 JetBrains AI 订阅，用户向 Agent 厂商认证并向他们付费。表中 Codex 的登录是 ChatGPT 账号或 OpenAI API key。帮助页 [Activate AI Assistant](https://www.jetbrains.com/help/ai-assistant/activation-scenarios.html) 写：提供方账号（OAuth）只激活该 Agent，账单在提供方账号上。

直接用 `codex app-server` 走订阅。适配器只是多 spawn 一次同一个子命令。Helm 已经要自己说 app-server 的 `turn/steer` 和 `turn/interrupt`，不必再译一层 ACP。

推翻条件：无 `CODEX_API_KEY`、无 `OPENAI_API_KEY` 时，`account/read` 的 `authMode` 不是 `chatgpt`，或用量记入 Platform API。商业化把 Helm 做成别人安装的托管服务时，app-server 这套登录按该页不再被允许。

### Grok Build

[Headless & Scripting](https://docs.x.ai/build/cli/headless-scripting) 把 `grok agent stdio` 写成 IDE 或工具集成用的 ACP，JSON-RPC 走 stdin/stdout。示例先看 `XAI_API_KEY` 且 `authMethods` 含 `xai.api_key`，否则选 `cached_token`。两边都没有时，示例要求先登录或设置 key。页首写无头模式用于脚本、bot 或其他机器友好任务；`--no-auto-update` 同时适用于 `-p` 和 ACP。

官方仓库 [auth_method.rs](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/agent/auth_method.rs) 把 `cached_token` 的说明写成 “Cached token from ~/.grok/auth.json”。有缓存 token 时，默认认证方法是它；源码注释写它会压过 `xai.api_key` 成为默认方法，以便会话型认证保持刷新。这与文档示例的选择顺序不同：示例在环境里有 key 时主动选 key。Helm 要走订阅，就不要设置 `XAI_API_KEY`，并在 `authenticate` 里显式传 `cached_token`。

SuperGrok 每周池包含 Build、The X Subscription 的池没有点名 Build、API 不走每周池，都已写在既有调研。[Grok 4.7 Fast 的定价](https://docs.x.ai/developers/pricing) 仍写它只在 Cursor 和 Grok Build 里提供，通过那里的计划计费，不在公开 API 上。

xAI 条款里没有找到「第三方客户端经 ACP 使用订阅」的允许句。[Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy) 禁止未经授权的自动化和非人工访问，以及把服务说成来自别人或说成来自 xAI 而实际不是。官方把 `grok agent stdio` 写成 CLI 的功能，所以拉起未修改的 `grok` 属于已经写出的用法。[Grok FAQ](https://docs.x.ai/grok/faq) 写：若通过使用你的 Grok 凭证的第三方应用进入已停用的 Studio，应撤销并更换凭证。这是在说别人的应用持有凭证，不是在说官方 CLI 的 ACP。

推翻条件：只有 `cached_token`、没有 `XAI_API_KEY` 时 `authenticate` 失败，或用量页把这次调用记在 API 而不是 Build。

### 智谱 GLM 与 zcode

这次对「zcode 没有 CLI」的旧结论要改。改的是 GitHub 上的官方仓库，不是 zcode.z.ai。

[zai-org/ZCode 的 README](https://github.com/zai-org/ZCode/blob/main/README.md)（更新记录写到 2026-10-19 的 v3.16.2）写：ZCode 提供桌面、浏览器和终端 Agent。命令行发行包用一个 `zcode`：无参数进 TUI，第一个参数是 `--web` 时启动 Web，其他参数交给 Agent CLI。本机运行，不需要 Electron。[CLI 快速开始](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/01-quickstart.md) 写了非交互：`zcode --prompt "…" --cwd <绝对路径> --mode plan --json --no-color`，成功时返回 `sessionId` 和 `response`。要改文件、跑命令时用 `--mode yolo`。登录是 `zcode login`，无浏览器时 `zcode login --no-browser`。个人模型在 `~/.zcode/v2/provider_config.json`。使用指南目录列了命令、配置、权限、会话、MCP，没有 ACP。

zcode.z.ai 的安装、Agent 和命令页仍是桌面应用，与既有调研一致。本次在 zai-org/ZCode 的 README 和使用指南里没有找到 `--acp` 或 ACP。社区仓库 [william0wang/zcode-acp](https://github.com/william0wang/zcode-acp) 写它启动 `zcode app-server --stdio`，[supermomonga/zcode-acp](https://github.com/supermomonga/zcode-acp) 写明非官方，并警告无文档的 headless 可能被解释成违反条款。这两份都不作为 Helm 的通道。

[适用工具](https://docs.bigmodel.cn/cn/coding-plan/tool/others)（页面时间 2026-10-16）第一句：GLM Coding Plan 仅限在列出的官方支持工具和产品环境中使用，用户不得把订阅权益用于此范围之外的工具或场景。Coding Agent 名单包括：ZCode（1.5 倍用量）、Claude Code、Claude for IDE、Codex、OpenCode、Pi Coding Agent、TRAE、CodeBuddy、Lingma、Qoder、Kilo、MonkeyCode、Cline、Droid、Roo、Crush、Goose、Cursor。通用 Agent 另有 AutoClaw、WorkBuddy、OpenClaw、Cherry Studio、Hermes Agent，并写明次级调度。专用端点：

| 协议 | Base URL |
| --- | --- |
| Anthropic Messages | `https://open.bigmodel.cn/api/anthropic` |
| OpenAI Chat Completions | `https://open.bigmodel.cn/api/coding/paas/v4` |
| OpenAI Responses | `https://open.bigmodel.cn/api/v1` |

同一页写：端点配错就不能用套餐额度。

[套餐概览](https://docs.bigmodel.cn/cn/coding-plan/overview) 写：只在官方支持的指定工具和产品环境中使用；在规定工具之外调用 API，不能享用 Coding 套餐额度。额度用尽后等下一个 5 小时周期，不会继续扣其他资源包或账户余额。[FAQ](https://docs.bigmodel.cn/cn/coding-plan/faq) 写：自建应用、网站、机器人、SaaS 要通过 API 集成模型时，使用标准 API，按对应协议计费。是否扣了编码套餐，到费用明细的抵扣资源包里看。

条款限制的是工具和场景，本次没有找到「名单内的工具一旦被编排器拉起就失去套餐」的句子。也没有找到「允许任意自动化客户端，只要 Base URL 正确」的句子。Helm 自己发 HTTP 请求，属于 FAQ 里的自建应用。Helm 拉起名单里的 Claude Code、OpenCode、Goose、Cline、Kilo、Crush 或官方 `zcode`，工具身份仍是名单上的那一个。

`glm-acp-agent` 的仓库是 [stefandevo/glm-acp-agent](https://github.com/stefandevo/glm-acp-agent)。`package.json` 的 author 是 Stefan de Vogelaere。README 写它只为 GLM Coding Plan 而做，默认端点是 `https://api.z.ai/api/coding/paas/v4`，不是通用的 `/api/paas/v4`。凭据是 `Z_AI_API_KEY` 或 `glm-acp-agent --setup` 写到磁盘的 key。它不拉起 zcode，也不是智谱维护的。registry 在既有调研当天记的版本是 1.15.0。本次打开的 main `package.json` 版本是 1.12.0，两处版本不一致，行为以仓库 README 的端点说明为准。它不在适用工具名单里。

对 Helm，最稳的是 Claude Code 加智谱的 Anthropic 端点：未改的 `claude`，`ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`，套餐 key 放在智谱文档要求的变量里，环境里不要留 Claude 的 OAuth 和 `ANTHROPIC_API_KEY`。调度者沿用已有的 stream-json。执行者同样是一次 `claude -p`。这样工具在名单里，端点是文档写死的那一个，驱动也不用新写。

若这项工作指定用智谱自己的程序，执行者用 `zcode --prompt … --json`。ZCode 在名单首位，并标了 1.5 倍用量。调度者需要多轮时，本次没有找到 zcode 的常驻协议，不能把它当成 Codex app-server 的替代。

名单里已经有原生 ACP 的，包括 OpenCode、Goose、Cline。它们可以作为 ACP 驱动的执行者，前提是按智谱为该工具写的配置使用套餐 key 和专用端点。本次没有逐份打开这三家在 docs.bigmodel.cn 上的配置页，所以不把它们放在 Claude Code 那条前面。

推翻条件：费用明细把 Claude Code 加智谱端点的调用记成资源包或标准 API，而不是编码套餐。或智谱把「工具」收窄成图形界面里的人工操作，把程序拉起的同一 CLI 排除。或 `zcode --prompt` 在已 `zcode login` 后仍要求单独的资源包 key。

### DeepSeek

[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-10-19）按百万 token 计费，有高峰和空闲两档，模型是 `deepseek-flash` 与 `deepseek-v4-pro`。页面没有月费、套餐档或包含额度。本次没有找到 DeepSeek API 的包月订阅页。

[第一页](https://api-docs.deepseek.com/) 写 API 兼容 OpenAI 与 Anthropic，凭据是 API key。它写 Claude Code、GitHub Copilot、OpenCode 可以把 DeepSeek 当后端，并指向 Agent 集成指南。DeepSeek Harness 在同一页是给 harness 开发者的预览，没有写成订阅。

`dsh --profile acp` 的包说明 [acp-app README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/acp-app/README.md) 写：随附配置用 `deepseek-official` 和 `deepseek-v4-flash` 创建会话。维护者在 [discussion #5438](https://github.com/deepseek-ai/deepseek-harness/discussions/5438) 写：默认凭据就是环境变量 `DEEPSEEK_API_KEY`，这是设计行为，调用消耗 API 余额。[providers 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md) 的 DeepSeek 卡片是一个 API key 字段，存在 `$DSH_HOME/.credentials.yaml`。headless profile 沿用既有调研：`dsh --profile headless` 同样要求事先有这把 key。

[接入 Claude Code](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code) 是官方步骤：`ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`，`ANTHROPIC_AUTH_TOKEN` 为 DeepSeek API key，并设置模型名。这是按量，不会占用 Claude Pro/Max。同一指南还写了 OpenCode。Copilot CLI 另有 [官方页](https://api-docs.deepseek.com/quick_start/agent_integrations/copilot_cli)，提供方类型要选 `anthropic`，Base URL 仍是 `https://api.deepseek.com/anthropic`。

Helm 若要 DeepSeek，执行者用 `dsh --profile acp` 或 `dsh --profile headless`，环境里只有 `DEEPSEEK_API_KEY`。已经在用 Claude 的 stream-json 时，可以按上面的官方变量把这一次派单指到 DeepSeek，同时清掉 Claude 的 OAuth，避免两套凭证叠在一起。没有订阅可实测，只核对平台余额下降。

### pi

v0.65.0 的 [coding-agent README](https://cdn.jsdelivr.net/gh/badlogic/pi-mono@v0.65.0/packages/coding-agent/README.md) 在 Subscriptions 下列出 Anthropic Claude Pro/Max、OpenAI ChatGPT Plus/Pro（Codex）、GitHub Copilot、Google Gemini CLI、Google Antigravity，并写 `/login` 后选择提供方。2026-10-21 的 main [providers.md](https://cdn.jsdelivr.net/gh/badlogic/pi-mono@main/packages/coding-agent/docs/providers.md) 写 `/login` 连接订阅或 API key，凭证进 pi 自己的 `auth.json`。本次打开的章节没有再逐条列出 Claude Pro/Max 和 ChatGPT Plus/Pro，所以当前版本是否仍提供这两条，记为未重新逐项核对。社区 `pi-acp` 拉起的是 `pi --mode rpc`，登录仍是 pi 的登录，见既有 ACP 调研。

Claude：合规页禁止第三方开发者在自己的应用里提供 Claude.ai 登录，或用 Pro/Max 凭证转发请求。pi 是独立 harness，`/login` 把订阅凭证存进 pi 自己的 `auth.json`。这落在禁止的那一句。OpenCode 已因同一限制去掉内置插件，见既有 ACP 调研。

ChatGPT：OpenAI 给其他应用使用计划额度的路径是 [Sign in with ChatGPT](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)，用户在同意屏上单独批准。app-server 那套登录明确不给商业和托管服务。没有找到 OpenAI 允许 pi 用 ChatGPT Plus/Pro 登录的句子。

用户不单独接 pi。若某个执行者模板选用 pi，只给它 API key，不走 `/login` 里的 Claude 或 ChatGPT 订阅。

## 实测办法

每条都在用户自己的机器上做。先在各家用量页记下当前数字，再发一条只回答 “ok” 的提示，然后刷新用量页。一次只留一种凭证。Helm 还没接好时，用下面的命令代替一次派单。

1. Claude，直接 stream-json。新开一个 shell：`env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL claude -p --input-format stream-json --output-format stream-json --verbose`。不要加 `--bare`。stdin 送一行用户消息。看 [claude.ai 的 Usage](https://claude.ai/settings/usage) 和 Claude Code 里的 `/usage`，计划用量条应增加。若 Console 账单增加而计划条不动，说明仍走了 API key。
2. Claude，适配器。同样清掉上述三个变量，不要加 `--hide-claude-auth`，不要设 `CLAUDE_CODE_EXECUTABLE`。运行 `npx -y @agentclientprotocol/claude-agent-acp@0.94.0`，完成 `initialize` 和一轮 `session/prompt`。再把 `CLAUDE_CODE_EXECUTABLE` 指到 `command -v claude` 的路径重做一次。两次都看计划用量条。第二次若成功而第一次走 API，说明 SDK 自带二进制与本机登录不是同一份凭证。
3. Codex，直接 app-server。`env -u CODEX_API_KEY -u OPENAI_API_KEY codex app-server`。`initialize` 之后调 `account/read`，记录 `authMode` 和 `planType`。再 `thread/start`、一轮 `turn/start`。ChatGPT 的用量或 Codex 的速率限额应变化，Platform API 用量不应变化。`authMode` 为 `apikey` 时，这条不算订阅。
4. Codex，适配器。同样清掉两把 key，运行 `npx -y @agentclientprotocol/codex-acp@2.2.2`。已登录时应能建会话，不必再走 `chat-gpt` 登录。用量页与第 3 条对照。再在只设置 `CODEX_API_KEY` 时重跑，确认账单改到 Platform。
5. Grok。`env -u XAI_API_KEY grok agent stdio`。`initialize` 的 `authMethods` 应含 `cached_token`。`authenticate` 传这个 methodId，再一轮 `session/prompt`。看 grok.com 的 Usage，产品分解里 Build 应增加。再只设置 `XAI_API_KEY` 重跑，确认记到 API 用量而不是每周池。已切换 The X Subscription 的账号，把 Build 是否出现在该池的产品分解里记下来。
6. GLM。用第 1 条的 `claude` 命令，改为带上智谱文档要求的 `ANTHROPIC_BASE_URL` 和套餐 key，并继续清掉 Claude 的 OAuth 变量。智谱费用明细的抵扣资源包应出现编码套餐。Claude 的 Usage 不应变化。再跑 `zcode --prompt "只回复 ok" --cwd "$PWD" --mode plan --json --no-color`，同样只看智谱费用明细。最后用一次 `npx glm-acp-agent`，若明细不是编码套餐，或请求被拒绝，就不要把它写进 Agent 模板。
7. DeepSeek。`dsh --profile headless "只回复 ok"`，环境里只有 `DEEPSEEK_API_KEY`。平台余额应下降。再按官方变量把一次 `claude -p` 指到 `https://api.deepseek.com/anthropic`，Claude Usage 不动，DeepSeek 余额下降。
8. 每家跑完后看 Helm 不会做、但实测要看的一件事：派单进程的环境打印。`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`CODEX_API_KEY`、`OPENAI_API_KEY`、`XAI_API_KEY` 哪一个出现，就把那一次的用量归因到它，不归因到订阅。

## 没能确认的事项

- 适配器自带的 `claude` 与用户 PATH 上的 `claude` 是否一定读同一条钥匙串记录。源码只证明它 spawn 官方二进制并调用 `auth status`。两份二进制版本不同时，登录是否兼容，要靠第 2 条实测。
- `codex app-server` 在 ChatGPT 登录和 `OPENAI_API_KEY` 同时存在时，默认 `authMode` 是哪一个。认证页写了两种登录和可选的 `preferred_auth_method`，本次没有在 app-server 页读到默认优先级。
- The X Subscription 的每周池是否包含 `grok agent stdio` 的用量。定价页的功能表有 Grok Build，用量计算那段没有点名 Build。
- `zcode login` 建立的是 GLM Coding Plan，还是一份可改去资源包的 provider 配置。快速开始把 `zcode login` 和 `provider_config.json` 写成两条路。
- 智谱名单里的 OpenCode、Goose、Cline、Kilo、Crush，各自配置页是否都给出了 Coding Plan 的 Base URL，以及 ACP 进程是否沿用这份配置。本次只核对了总名单和 Claude Code、Cline 示例所用的端点。
- zcode 的 CLI 是否计入 ZCode 条目上的 1.5 倍用量。
- zai-org/ZCode 里是否存在未写入使用指南目录的 `app-server` 或 ACP。社区仓库这么称呼它，官方目录本次没有对应页。
- DeepSeek 是否在 API 文档之外、用另一个产品名出售包月。已打开的价格页和 Harness 凭据说明都是 API key。
- pi 当前 main 是否仍在 `/login` 里提供 Claude Pro/Max 和 ChatGPT Plus/Pro。v0.65.0 有名单，本次打开的 main 章节没有重复该名单。
- 帮助中心「订阅者使用 Agent SDK 仍扣计划限额」会不会在适配器这条路径上改记到 extra usage。合规页和 SDK 概览对第三方产品的句子比帮助中心更严，实测前不能把适配器写成与 `claude -p` 同等稳妥。
