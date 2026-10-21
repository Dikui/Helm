# ACP 能否作为接入各家 agent CLI 的统一通道

调研日期：2026-10-21（Grok，一手来源）。

ACP 可以作为 Helm 接入多数 coding agent 的默认通道。运行层按每家 `initialize` 返回的能力声明来工作，自己应答权限，自己做空闲和墙钟超时。协议稳定覆盖同一进程多轮、一轮派单、取消、工作目录和 MCP 注入。它不覆盖往当前轮中途追加，也不提供套餐剩余额度。现在要用的是 ACP v1。v2 从 2026-07-20 起是草案，默认导入仍是 v1。

用户点名的产品里，命令本身就是 ACP 的有 Qoder、Gemini CLI、OpenCode、Cursor CLI、Copilot CLI、Kimi CLI、Qwen Code、Goose、Cline、Auggie、Factory Droid，以及 DeepSeek Harness 的 `dsh --profile acp`（官方有，registry 里没有）。走适配器的有 pi（社区 `pi-acp`）、Amp（社区 `amp-acp`）、Codex（`@agentclientprotocol/codex-acp`）、Claude Code（`@agentclientprotocol/claude-agent-acp`）。Grok 的 `grok agent stdio` 已在 registry，沿用既有结论。zcode 是智谱的桌面 ADE，官方文档没有 ACP，也没有一次性无头命令。

调度者里，Codex 继续用 `codex app-server`，Claude 继续用 stream-json，Grok 继续用 `grok agent stdio`。其余原生 ACP 的 agent，调度者和执行者可以共用一个 ACP 驱动：调度者会话保持进程，执行派单是一轮 `session/prompt` 之后退出。没有 ACP 的执行者用一次性无头命令，解析文本或 JSON。添加一家新 agent，最少要有启动命令、认证方式，以及从 `initialize` 读到的能力；权限策略和超时由运行层补上。

既有三份调研不在这里重复：交互通道见 [interactive-drive-and-landscape.md](interactive-drive-and-landscape.md)，无人值守见 [unattended-executors.md](unattended-executors.md)，订阅登录见 [subscription-billing.md](subscription-billing.md)。

## 建议

1. **把 ACP v1 做成 Agent 模板的默认驱动，能力以当场的 `initialize` 为准。** 依据：registry 在 2026-10-21 有 43 个带认证的 agent（[registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)）。同日探测矩阵对 36 个进程做了握手，35 个 `initialize` 成功，能力从「只有 `loadSession`」到「load、list、fork、resume 都有」不等（[协议矩阵](https://github.com/agentclientprotocol/registry/blob/main/.protocol-matrix/latest.md)）。推翻条件：Helm 要接的那一家在无 TTY 下 `initialize` 失败，或 `session/new` 在已登录后仍一直返回 `auth_required`。

2. **Codex 调度者继续走 `codex app-server`，不把 `codex-acp` 当成主通道。** 依据：适配器现由 `@agentclientprotocol/codex-acp@2.2.2` 发布，作者栏写着 OpenAI、JetBrains、Zed，矩阵显示它广告 `loadSession`、`session/list`、`session/fork`、`session/resume`。ACP v1 的下一轮要等本轮 `session/prompt` 返回，没有与 `turn/steer` 对等的方法（[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)）。app-server 的中途追加和中断已在既有调研里写明。推翻条件：`codex-acp` 在同一轮里提供与 `turn/steer`、`turn/interrupt` 等价的稳定方法，并且在不设置 `CODEX_API_KEY` 时复用本机 ChatGPT 登录。

3. **Claude 调度者继续直接 spawn `claude` 的 stream-json。适配器留给「必须走 ACP」的客户端。** 依据：官网 Agents 页写 Claude Agent 经适配器接入，包是 registry 里的 `@agentclientprotocol/claude-agent-acp@0.94.0`，作者栏含 Anthropic、Zed、JetBrains（[Agents](https://agentclientprotocol.com/get-started/agents)、[registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)）。Claude Code 自己的多轮、订阅登录和权限模式已在既有两份调研里写明。推翻条件：当前 `claude -p --input-format stream-json` 在第一条结果后退出，而适配器在不加 `ANTHROPIC_API_KEY`、不加 `--bare` 时能连续收 `session/prompt` 并走订阅登录。

4. **Grok 调度者继续用 `grok agent stdio`。这已经是 ACP，不必再包一层。** 依据：registry 条目 `grok-build` 1.0.66 的启动参数就是 `npx @xai-official/grok agent stdio`。矩阵广告 `loadSession`、`session/list`、`session/resume`。`session/cancel` 是否实现，仍是既有调研的未决项。推翻条件：该 stdio 进程在只有本机登录、没有 `XAI_API_KEY` 时拒绝 `authenticate`。

5. **执行派单优先用短命 ACP 进程：`session/new`、一轮 `session/prompt`、读到 `stopReason` 后结束进程。** 依据：派单结果的定义就是进程退出后的记录。v1 一轮就是一次 `session/prompt`，返回 `stopReason`（`end_turn`、`max_tokens`、`cancelled` 等）（[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)）。同一进程再发下一轮是调度者会话的用法，不是执行派单的默认用法。推翻条件：某一家在 `stopReason` 返回后进程不退出，也不再接受请求，运行层无法判定这一派单已经结束。

6. **没有 ACP 的执行者用一次性无头命令，输出能解析就解析，不能解析就只留最终文本。** 依据：下面覆盖表里，多数点名的 CLI 另有 `-p`、`exec` 或 `run`。zcode 官方文档只有桌面应用，这条兜底目前也不存在。推翻条件：该 CLI 的无头进程在无 TTY 下停在权限提示上，而它的 ACP 进程能用下面第 7 条自动应答走完。

7. **无人值守的权限由运行层代答，不依赖协议里的 yolo 参数。协议没有这个参数。** 依据：Agent 用 `session/request_permission` 发选项，种类是 `allow_once`、`allow_always`、`reject_once`、`reject_always`。规范写客户端可以按用户设置自动允许或拒绝。取消时必须回 `cancelled`。不回答，这一轮就停在请求上。规范没有写超时（[Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)）。选项由 Agent 提供，客户端不能假定一定有 `allow_always`。运行层的规则：有 `allow_always` 就选它，否则选 `allow_once`；只有拒绝类选项就拒绝并记入派单输出。各家自己的 `--yolo`、`--always-approve`、`--afk` 是启动参数，放在 Agent 模板里，和协议应答叠用。推翻条件：某一家把「问用户一句话」做成没有 `allow_*` 选项的权限请求，自动应答只能拒绝，任务因此完不成。那时改用该 CLI 文档写明的无头自动批准开关。

8. **续跑先看能力，再选方法。不要假定每家都有 `session/load`。** 依据：`session/load` 会重放历史，能力位是 `loadSession`。`session/resume` 不重放，能力位是 `sessionCapabilities.resume`，RFD 于 2026-04-22 标为 Completed（[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)、[session-resume RFD](https://agentclientprotocol.com/rfds/session-resume)）。矩阵里 Cline、Gemini、Codebuddy、Stakpak 只广告 `loadSession`；Cursor、Auggie、Goose、Copilot CLI 广告 load 和 list，没有 resume；Corust 的能力列为空。调度者崩溃后的新会话，优先 `session/resume`，没有就 `session/load`，两个都没有就用该 CLI 自己的 `--resume` 新进程。推翻条件：广告了 `loadSession` 的进程，`session/load` 仍返回 method not found，或重放把任务库里已有的消息再写一遍且无法用 `messageId` 对齐。

9. **额度不要等 ACP。`usage_update` 只是上下文占用和可选的累计费用。** 依据：该通知于 2026-06-05 稳定，字段是 `used`、`size`，可选 `cost.amount` 与 `currency`。RFD 写明速率限制和套餐配额不在这次范围内（[usage 公告](https://agentclientprotocol.com/announcements/session-usage-stabilized)、[session-usage RFD](https://agentclientprotocol.com/rfds/session-usage)）。回合级 token 明细仍是 Draft（[end-turn-token-usage](https://agentclientprotocol.com/rfds/end-turn-token-usage)）。派单前看剩余额度，继续走各家自己的接口；Codex 的 `account/rateLimits/read` 在 app-server，不在 ACP。推翻条件：规范新增稳定的配额或速率字段，并且 Helm 要用的那几家在 `session/new` 之后就会发送。

10. **TypeScript 客户端用官方 `@agentclientprotocol/sdk` 的默认入口，钉住 v1。** 依据：官方库页写 `npm install @agentclientprotocol/sdk`，用 `client()` 做客户端（[TypeScript](https://agentclientprotocol.com/libraries/typescript)）。仓库说明默认导入是稳定 v1；`@agentclientprotocol/sdk/experimental/v2` 是草案（[typescript-sdk README](https://github.com/agentclientprotocol/typescript-sdk)）。2026-10-19 的 v2.0.0 删掉了 `ClientSideConnection` 一类旧 API（[Release v2.0.0](https://github.com/agentclientprotocol/typescript-sdk/releases)）。官方库页仍写这些类「已废弃但还在」，和发布说明不一致，接入时以发布说明为准。推翻条件：默认入口改成只导出 v2，而目标 agent 仍只回答 v1。

11. **不要把 ACP v2 的空闲态、排队和中途追加写进 v1 的驱动。** 依据：v2 草案把 `session/prompt` 的返回改成用户消息的 `messageId`，工作结束改由空闲状态表示，并明确是为了排队和 steering（[v2 草案公告](https://agentclientprotocol.com/announcements/acp-v2-draft)）。公告要求放在版本协商和功能开关后面，不要默认进生产。推翻条件：v2 公告从 Draft 改为稳定，并且 Helm 启用的每家 agent 都在 `initialize` 里协商到 v2。

## 点名 agent 的覆盖

图例：能 / 不能 / 部分 / 未找到。ACP 列的「原生」指厂商自己的命令进入 ACP；「适配器」指另一个包把该 CLI 译成 ACP。登录列只写本次读到的官方说法。

| Agent | 是什么 | ACP | 启动 | 一次性无头 | 输出 | 本机登录或订阅，不必模型 API key |
| --- | --- | --- | --- | --- | --- | --- |
| pi | Earendil 的 pi coding agent，包 `@earendil-works/pi-coding-agent` | 适配器。社区 `pi-acp`，registry `pi-acp` 0.0.34，维护者 Sergii Kozak | `npx pi-acp`。适配器再拉起 `pi --mode rpc` | 能。`pi -p`，或 `--mode json` | 文本，或 JSONL 事件 | 能。`/login` 列出 Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、Gemini CLI、Antigravity。也可以用 API key |
| DeepSeek Harness（dsh） | deepseek-ai/deepseek-harness 的 profile 启动器 | 原生，不在 registry。`dsh --profile acp` | 同上，stdio，直到断开 | 能。`dsh --profile headless "任务"` | 最后一段非空助手文本。headless README 另写 `--json` 事件流 | 未找到订阅登录。已打开的文档要求 `DEEPSEEK_API_KEY` |
| Qoder CLI | Qoder 的 coding agent | 原生。registry `qoder` 0.2.14 | `qoder --acp`，或 `npx @qoder-ai/qodercli --acp` | 部分。传入提示词即非交互。JSON 输出格式未找到 | 未找到 | 能。沿用 `qoder login` 的本机会话，或 `QODER_PERSONAL_ACCESS_TOKEN`。这是账号令牌，不是模型 API key |
| zcode | 智谱 Z.ai 的桌面 ADE，默认智能体是 ZCode Agent，模型走 GLM | 不能。registry 无此 id。官网 Agents 页也没有 | 未找到官方 CLI | 未找到 | 未找到 | 桌面端可绑 GLM Coding Plan，或填 API key。没有可拉起的官方进程 |
| Gemini CLI | Google 的 `gemini` | 原生。registry `gemini` 0.65.0 | `gemini --acp` | 能。`gemini -p` | `json` 一个对象（`response`、`stats`）；`stream-json` 为 JSONL（`init`、`message`、`tool_use`、`tool_result`、`result` 等） | 能。已缓存的 Google 登录可被无头复用。Google AI Pro/Ultra 用对应账号。没有缓存时文档要求 API key 或 Vertex |
| OpenCode | Anomaly 的开源 coding agent | 原生。registry 有 `opencode` 1.19.3 和 `opencode-v2` 2.1.2 | `opencode acp` | 能。`opencode run "…"` | `--format json` 为原始 JSON 事件；默认是带格式的文本 | 部分。官方写 ChatGPT Plus、GitHub Copilot、GitLab Duo 可直接用。Claude Pro/Max 出现在 `/connect` 里，同一页写 Anthropic 禁止第三方这样用，1.3.0 起不再捆绑该插件。OpenCode Zen / Go 是他们自己的 key |
| Cursor CLI | Cursor 的 `agent` | 原生。registry `cursor` 2026.10.19 | `agent acp` | 能。`agent -p` | `text`、`json`、`stream-json` | 部分。推荐 `agent login`，凭证存在本机。无头示例同时写 `CURSOR_API_KEY`。认证页没有写「登录一定走订阅额度」 |
| Copilot CLI | GitHub Copilot 的 `copilot` | 原生。registry `github-copilot-cli` 1.0.101，包 `@github/copilot` | `copilot --acp`（默认同 `--stdio`） | 能。`copilot -p` | `text` 或 `json`（JSONL） | 能。GitHub 登录使用 Copilot。配了 BYOK（`COPILOT_PROVIDER_*`）时可以不登录 GitHub |
| Kimi CLI | 月之暗面的 Kimi Code CLI | 原生。registry `kimi` 1.52.0 | `kimi acp` | 能。`kimi -p`，隐式 `--afk` | `text` 或 `stream-json`（JSONL，角色为 user/assistant/tool） | 部分。`kimi login` 是浏览器 OAuth。会员文档写 CLI 请求计入 Kimi 会员额度。开放平台是另一条按量 key |
| Qwen Code | 阿里 Qwen 的 `qwen` | 原生。registry `qwen-code` 0.25.3 | `qwen --acp`。registry 还加了 `--experimental-skills` | 能。`qwen -p` | `text`、`json`、`stream-json` | 部分。交互用 `/auth`。无头文档给的是环境变量里的 key，包括 QwenCloud Token Plan 和 ModelStudio Coding Plan 的 key。未找到「只靠浏览器缓存、不设 key」 |
| Amp | Sourcegraph 的 Amp，CLI 包已迁到 `@ampcode/cli` | 适配器。社区 `amp-acp` 0.10.0，维护者 tao12345666333 | 发布的 `amp-acp` 二进制，内部再调 `amp` | 能。`amp -x "…"` | 未在官方入门页找到 JSON 事件表 | 部分。先 `amp login`，适配器共用这份凭证。无头可用 `AMP_API_KEY`。本次打开的 ampcode.com 入门页没有写套餐名 |
| Goose | Block 的开源 agent | 原生。registry `goose` 1.55.0 | `goose acp` | 能。`goose run -t "…"` 或 `--recipe` | `--output-format`：`text`、`json`、`stream-json` | 部分。Goose 自己用配置好的模型提供方。它也能反过来把 Claude、Codex、pi、Amp 的 ACP 当提供方，从而用那些订阅。没有单独的 Goose 订阅 |
| Cline | Cline 的 CLI | 原生。registry `cline` 3.0.73 | `cline --acp` | 能。`cline "任务"`，或 `--json` | `--json` 为换行 JSON | 能。`cline auth` 可登录 Cline 用量账号、ClinePass 订阅，或 ChatGPT 订阅。也可以 `CLINE_API_KEY` |
| Auggie | Augment Code 的 CLI | 原生。registry `auggie` 0.36.0 | `auggie --acp` | 能。`auggie --print "…"` | `--output-format json`；`--quiet` 只留最终消息 | 部分。`auggie login` 把会话存在本机。自动化要带 `AUGMENT_SESSION_AUTH` 或 `auggie token` 打出的会话 JSON |
| Droid | Factory 的 `droid` | 原生。registry `factory-droid` 0.245.1 | `droid exec --output-format acp-daemon` | 能。`droid exec "…"` | 文档列出 `text`、`json`、`stream-json`、`stream-jsonrpc`。`acp-daemon` 出现在 registry，没有出现在本次打开的 CLI reference 摘录里 | 部分。交互有 `/login`。自动化文档要求 `FACTORY_API_KEY`。未找到「只靠本机订阅、不设 key」的无头说明 |
| Codex | 见既有调研 | 适配器，不是主通道 | `npx @agentclientprotocol/codex-acp@2.2.2` | 已有：`codex exec --json` | JSONL | 适配器 README 写过 ChatGPT 订阅。app-server 是否在无 key 时读 `auth.json`，仍是既有未决项 |
| Claude Code | 见既有调研 | 适配器 | `npx @agentclientprotocol/claude-agent-acp@0.94.0` | 已有：`claude -p` | `text`、`json`、`stream-json` | 不加 `--bare`、不设 `ANTHROPIC_API_KEY` 时走订阅。适配器是否同样不读 key，本次未逐文件核对 |
| Grok Build | 见既有调研 | 原生 | `grok agent stdio` | 已有：`grok -p` | `plain`、`json`、`streaming-json` | `cached_token` 对应本机登录 |

当日矩阵没有探测 Qoder。Qoder 的 load、resume 以「未找到」记，不从包版本推断。

## Registry 里其余 coding agent

来源是 2026-10-21 的 [registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) 和同日 [协议矩阵](https://github.com/agentclientprotocol/registry/blob/main/.protocol-matrix/latest.md)。能力列是矩阵在 `initialize` 响应里看到的广告。`—` 表示该 id 不在这 36 行里。无头命令和登录方式，除上表点名者外，本次没有逐家打开，记为未逐页核对。

| id | 版本 | 启动形状 | 矩阵里的会话能力 |
| --- | --- | --- | --- |
| agoragentic-acp | 1.3.0 | `npx agoragentic-mcp --acp` | — |
| antigravity-acp | 1.4.1 | 二进制 `agy_acp_server.par` | load、list、resume |
| autohand | 0.2.1 | `npx @autohandai/autohand-acp` | load、list、fork、resume |
| bob | 2.0.8 | `npx @ibm/bob acp` | load、list、resume |
| codebuddy-code | 2.171.0 | `npx @tencent-ai/codebuddy-code --acp` | load |
| cortex-code | 1.0.73 | `cortex acp serve` | 进程错误，没有能力 |
| corust-agent | 0.6.0 | 二进制 `corust-agent-acp` | 能力列为空 |
| crow-cli | 0.1.24 | `crow-cli acp` | — |
| deepagents | 0.1.7 | `npx deepagents-acp` | — |
| devin | 3000.11.92 | 二进制，网站写 Devin CLI | load、list |
| dimcode | 0.5.21 | npx | load、list、fork、resume |
| dirac | 0.5.22 | `npx dirac-cli --acp` | load、resume |
| fast-agent | 0.10.1 | `uvx fast-agent-acp -x` | — |
| glm-acp-agent | 1.15.0 | `npx glm-acp-agent` | load、list、fork、resume |
| harn | 0.10.171 | `harn serve acp` | load、list、resume |
| junie | 3659.7.0 | 二进制 | load、list、fork、resume |
| kilo | 7.8.15 | npx | load、list、fork、resume |
| kimchi | 1.17.0 | `kimchi --mode acp` | load、list |
| minimax-code | 0.2.7 | `npx @minimax-ai/code acp` | load、list、fork、resume |
| minion-code | 0.1.44 | `uvx minion-code` | — |
| mistral-vibe | 2.26.1 | 二进制 | load、list、fork |
| nova | 1.1.59 | `npx @compass-ai/nova acp` | load、list、fork、resume |
| poolside | 1.0.16 | `pool acp` | load、list |
| sigit | 1.7.3 | npx | load、list、fork、resume |
| stakpak | 0.3.88 | `stakpak acp` | load |
| vtcode | 0.96.14 | 二进制 | — |

矩阵另有一行 `github-copilot` 1.556.0（load、list）。当天拉到的 registry JSON 没有这个 id，只有 `github-copilot-cli`。

`glm-acp-agent` 是社区包，说明文字写它调用智谱 GLM Coding Plan 的模型。它不是 ZCode 桌面应用。

官网 [Agents 页](https://agentclientprotocol.com/get-started/agents) 还列出一批不在这份 registry JSON 里的实现，包括 AgentPool、AutoDev、Blackbox、Bub、Claw Orchestrator、Code Assistant、Construct、CUGA、Docker cagent、fount、Hermes、Kaagum、Kiro、localharness、Muse Spark Code、OpenClaw、OpenHands、Raven、Raxol、stdio Bus。registry 自己写明：只收录实现了认证的 agent，未收录不等于没有 ACP。这些页本次没有逐个打开无头命令和登录方式。

## ACP 能力对照

规范状态以 2026-10-21 的 v1 文档和 RFD 修订记录为准。实现列只写矩阵或该家官方页里读到的事实。

| Helm 需要 | 规范 | 状态 | 主要实现情况 |
| --- | --- | --- | --- |
| 调度者多轮，同一进程 | 一轮 `session/prompt` 结束后再发一轮 | v1 稳定。[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn) | 协议允许。官方示例经常只演示一轮。矩阵没有跑第二轮 |
| 执行者一轮派单 | 没有单独的 one-shot 方法。客户端发一轮后自己结束进程 | 同上 | 各家另有无头命令，见上表 |
| 运行中往当前轮追加 | v1 没有。v2 草案把 prompt 返回从「回合结束」改成消息 id，并讨论排队和 steering | v2 Draft，2026-07-20。[公告](https://agentclientprotocol.com/announcements/acp-v2-draft) | 不能当成现成能力。Codex 的 `turn/steer` 仍只在 app-server |
| 无人值守权限 | `session/request_permission`，客户端回 `selected` 加 `optionId`，或 `cancelled`。没有 yolo 字段，没有超时 | v1 稳定。[Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls) | 规范允许客户端自动选择。Cline 写明 ACP 模式下 `--auto-approve` 默认是 false，普通 CLI 默认 true。Gemini 的 ACP 页写 `setSessionMode` 可改到 auto-approve。Kimi 的 `-p` 隐式 `--afk`，这是无头开关，不是 ACP 参数 |
| 取消 | `session/cancel` 是通知。Agent 应以 `stopReason: cancelled` 结束该轮，不要报成错误。未完成的权限请求要回 `cancelled` | v1 稳定。同一页 | 矩阵没有探测取消。Grok 是否实现，仍是既有未决项 |
| 续跑并重放 | `session/load`，要 `loadSession: true` | v1 稳定，可选能力。[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup) | 矩阵里多数广告了 load。Corust 没有。Qoder 未探测 |
| 续跑不重放 | `session/resume`，要 `sessionCapabilities.resume` | 2026-04-22 起稳定，可选。[RFD](https://agentclientprotocol.com/rfds/session-resume) | 矩阵：13 个方法探测为支持，13 个 method not found，7 个先要认证。Cline、Gemini、Cursor、Auggie、Goose 的能力列没有 resume |
| 关闭会话 | `session/close`，要 `sessionCapabilities.close` | v1 稳定，可选。同一 Session Setup 页 | 矩阵探测的是 `session/stop`：0 个支持，33 个 method not found。没有探测 `session/close` |
| 结构化事件 | `session/update` 的 `sessionUpdate` | v1 稳定，后来并入的种类见下节 | 适配器会少种类。pi-acp 写明思考没有单独的 `agent_thought_chunk` |
| 用量 | `usage_update`：`used`、`size`，可选累计 `cost` | 2026-06-05 稳定，可选。[公告](https://agentclientprotocol.com/announcements/session-usage-stabilized) | pi-acp 写它在 `get_session_stats` 有 `contextUsage` 时会发。没有读到哪一家用它报告套餐剩余 |
| 套餐剩余额度 | 无此字段。session-usage RFD 把速率和配额留到以后 | 未做。回合 token 仍是 Draft | 未找到统一查询 |
| 工作目录 | `session/new`、`session/load`、`session/resume` 的 `cwd`，必须是绝对路径 | v1 稳定 | 规范要求 Agent 用这个目录，而不是进程的启动目录 |
| 额外根目录 | `additionalDirectories`，要 `sessionCapabilities.additionalDirectories` | 已稳定，可选。[公告](https://agentclientprotocol.com/announcements/additional-directories-stabilized) | 矩阵没有列这项 |
| MCP 注入 | `mcpServers`。stdio 每家必须支持，HTTP/SSE 可选 | v1 稳定。[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup) | pi-acp 写它收下 MCP 参数，但没有接进 pi |
| 会话模式 | `session/set_mode`，以及更新的 session config options | 模式页写将来会去掉专用方法，改走 config options。[Session Modes](https://agentclientprotocol.com/protocol/v1/session-modes) | Gemini ACP 页用模式切换审批级别。模式 id 由各家自定，没有标准的 `yolo` |

`session/update` 当前种类：`user_message_chunk`、`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`、`plan`、`available_commands_update`、`current_mode_update`、`config_option_update`、`session_info_update`、`usage_update`、`notice`、`compaction_update`、`compaction_summary_chunk`。后三个里，`notice` 和 compaction 要求客户端在 `initialize` 里先广告对应能力（[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)）。

`session/prompt` 的 `stopReason` 至少包括 `end_turn`、`max_tokens`、`cancelled`。同一页还列出拒绝类等原因，接入时以 [schema](https://agentclientprotocol.com/protocol/v1/schema) 为准。

## 客户端和编排器怎么用

官方 TypeScript 库是 `@agentclientprotocol/sdk`。默认入口是 ACP v1 的 `client()` / `agent()`。v2 放在 `experimental/v2`，发布说明写线协议和 API 都可能在任一版本里不兼容地改动。2026-10-19 的 SDK 2.0.0 是破坏性升级：旧的连接类被删除，但默认协议没有从 v1 改成 v2。官方文档站的 TypeScript 页还说旧类仍可用，和这次发布说明冲突。Gemini CLI 被库页当作生产级 Agent 实现，源码在 `packages/cli/src/acp`（[acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md)）。

Zed 从 ACP registry 安装 agent，也可以在 `agent_servers` 里写 `command` 和 `args`。OpenCode、Qwen、pi-acp 的文档都给了这段配置（[OpenCode ACP](https://opencode.ai/docs/acp/)、[Qwen Zed](https://qwenlm.github.io/qwen-code-docs/en/users/integration-zed/)）。

JetBrains AI Assistant 把 registry 当安装目录：IDE 下载 agent，需要时再下载 Node 或 Python。自定义 agent 写在 `~/.jetbrains/acp.json`，字段是 `command`、`args`、`env`。MCP 是否传给 agent 有两个开关。限制写明：WSL 里不能用 ACP agent。新版本用蓝点提示更新，要人手点 Update。启动失败时，文档要求用绝对路径，并先在终端里手动跑通（[JetBrains ACP](https://www.jetbrains.com/help/ai-assistant/acp.html)，页脚 2026-10-07）。

Goose 同时是 ACP agent（`goose acp`）和 ACP 客户端：它把 Amp、Claude、Codex、pi 的适配器登记成模型提供方，并写这样可以用已有的 Claude 或 ChatGPT 订阅（[ACP Providers](https://goose-docs.ai/docs/guides/acp-providers)、[goose 作为 agent](https://goose-docs.ai/docs/gdk/acp/)）。

官网客户端名单里，把 ACP 当成多 agent 接入层的还有 Codeg、Jockey、Alchemist Coder、Vibex。名单本身只是链接，本次没有打开它们的问题跟踪（[Clients](https://agentclientprotocol.com/get-started/clients)）。Todos 的驱动方式已写在 interactive-drive-and-landscape.md：Codex 走 app-server，Claude 走 Agent SDK，另外还有多个 ACP 适配器。

已经能对上的问题：

- 能力不一致是实测结果，不是猜测。同一天的矩阵里，`session/resume` 支持与 method not found 各 13 家，`session/fork` 只有 10 家支持，`cortex-code` 进程起不来。
- 24 次 `session/new` 直接 `auth_required`。未登录的进程不会进入派单。
- 适配器会落后于 CLI。pi-acp 自述是 MVP，可能有小的破坏性变更；MCP 参数不转给 pi；思考流合并进正文；开发围绕 Zed（[pi-acp README](https://github.com/svkozak/pi-acp)）。Auggie 写明 ACP 模式并不包含交互模式的全部功能（[Auggie ACP](https://docs.augmentcode.com/cli/acp/agent)）。
- 文档方法名会漂移。Gemini 的 ACP 页写 `newSession`、`loadSession`、`prompt`、`cancel`，规范方法名是 `session/new`、`session/load`、`session/prompt`、`session/cancel`。
- registry 版本和矩阵版本会差一截。factory-droid 在 JSON 里是 0.245.1，矩阵探的是 0.245.0。
- SDK 在两天前拆了旧 API，文档站还没有改完。

## 分项事实

### 协议

连接以 JSON-RPC 2.0 进行，默认传输是 stdio 上的换行 JSON（[Transports](https://agentclientprotocol.com/protocol/v1/transports)）。先 `initialize`，需要认证时再 `authenticate`。`authMethods` 非空时必须实现认证和 `auth/logout`（[v1 Overview](https://agentclientprotocol.com/protocol/v1/overview)、[Authentication](https://agentclientprotocol.com/protocol/v1/authentication)）。

`session/new` 的必填上下文是绝对路径 `cwd` 和 `mcpServers`。stdio MCP 是必须实现的传输。Agent 必须使用请求里的 `cwd`，不论进程在哪个目录被拉起（[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)）。

权限选项的 `kind` 只是界面提示。真正回给 Agent 的是 `optionId`。客户端可以不展示给人、直接代选（[Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)）。会话模式的例子里，计划模式退出时会出现 `allow_always` 这种选项，但那是该 Agent 自己列出来的，不是协议保证每家都有（[Session Modes](https://agentclientprotocol.com/protocol/v1/session-modes)）。

`usage_update` 的 `used` 和 `size` 是当前上下文的 token 数。费用是累计的、可选的、带货币代码。Agent 可以不发。RFD 修订记录：2026-06-03 Preview，2026-06-05 Completed（[RFD](https://agentclientprotocol.com/rfds/session-usage)）。

v2 仍是 Draft。公告要求 v1 客户端继续留着，因为只说 v1 的对端还会存在很久（[公告](https://agentclientprotocol.com/announcements/acp-v2-draft)）。

### pi

pi 的 README 写打印模式是 `pi -p` 和 `pi --mode json`，订阅登录用 `/login`，名单包括 Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、Gemini CLI、Antigravity，同时保留 API key（[coding-agent README](https://github.com/badlogic/pi-mono/tree/v0.65.0/packages/coding-agent)）。当前仓库路径在 Agents 页写的是 [earendil-works/pi 的 coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)；v0.65.0 树仍在 badlogic/pi-mono。包名以 pi-acp 的安装说明为准：`@earendil-works/pi-coding-agent`。

`pi-acp` 把 ACP 译成 `pi --mode rpc`。它要求 pi 0.81.0 以上。`session/load` 靠 `~/.pi/pi-acp/session-map.json` 找回 pi 自己的会话文件。矩阵对 0.0.34 的广告是 `loadSession` 和 `session/list`，没有 resume。认证方式列是 terminal，对应 README 的 `pi-acp --terminal-login`（[README](https://github.com/svkozak/pi-acp)）。

### DeepSeek Harness

官方 CLI README 写：`dsh --profile acp` 在 stdio 上为自动化客户端提供 ACP，直到断开；`dsh --profile headless "job"` 跑一个新的持久会话，打印最终回答后退出（[apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)）。中文蓝皮书写退出码 0 表示 `completed`，否则为 1，并要求事先配置 `DEEPSEEK_API_KEY`（[CLI 与 Profile](https://dsh.hicyou.com/zh/docs/user-guide/cli)）。headless 包 README 写可选 `--json` 和 `--session-id`（[headless/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)）。

权限预设文档写默认表包含 `workspace-write` 加 `ask`，以及 `danger-full-access` 加 `never`（[permission-presets.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/permission-presets.md)）。这些预设是否经 ACP 的会话配置暴露，已打开的页面没有写。它不在 registry，也不在当日矩阵。

### Qoder

`qoder --acp` 以 stdio 充当 ACP 服务器。已登录的 CLI 会话可以直接用。未登录时用 `qoder login` 或 `QODER_PERSONAL_ACCESS_TOKEN`（[ACP](https://docs.qoder.com/cli/acp)、[认证](https://docs.qoder.com/zh/cli/authentication)）。参考页写：不带参数是交互，传入提示词进入非交互；`--acp` 在编辑器集成一节（[CLI reference](https://docs.qoder.com/cli/cli-reference)）。JSON 输出格式、load、resume，本次未找到。registry 有条目，矩阵没有这一行。

### zcode

官方安装页写的是桌面应用，macOS、Windows、Linux，当前文档版本 v3.16.2（[安装](https://zcode.z.ai/cn/docs/install)）。ZCode Agent 是应用内的默认智能体，执行模式有变更前确认、自动编辑、计划模式、完全访问（[ZCode Agent](https://zcode.z.ai/docs/agents)）。模型通道可以是 GLM Coding Plan，或 API key（[API key 配置](https://zcode.z.ai/docs/configuration)）。文档里的 Command 是输入框里的 `/` 命令，不是 shell CLI（[Command](https://zcode.z.ai/cn/docs/commands)）。命令行一节是应用内的终端面板（[ADE 工具](https://zcode.z.ai/cn/docs/ADE-tools)）。

未在 zcode.z.ai 找到 `zcode` 这个可执行文件、`--acp` 或无头开关。registry 和 Agents 页都没有 zcode。社区仓库 [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) 自述非官方，其中 `zcode-acp-bridge` 标为 experimental。本次没有把它当成可用通道。

### Gemini CLI

`gemini --acp`。该页列出的能力包括认证、新会话、加载会话、prompt、cancel，以及用 `setSessionMode` 把工具审批改到 auto-approve。同一页写文件读写经 ACP 客户端代理（[acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md)）。矩阵只广告 `loadSession`，没有 list、fork、resume。

无头是 `gemini -p`，`--output-format json` 或流式 JSONL（[headless.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md)）。认证页写个人账号用 Google 登录；无头会沿用已缓存的凭证，没有缓存时用 API key 或 Vertex（[authentication.mdx](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx)）。

若 Helm 的 ACP 客户端不实现文件读写方法，Gemini 这篇文档意味着它可能无法自己改工作目录。这需要实测，见文末未决项。

### OpenCode

`opencode acp` 直到客户端断开（[Commands](https://opencode.ai/v2/docs/cli/commands/)）。v1 文档的 `opencode run` 有 `--format json`，取值是带格式文本或原始 JSON 事件（[CLI](https://opencode.ai/docs/cli)）。认证：ACP 使用已经配好的提供方凭证；未登录时可以广告 terminal auth，由客户端去跑 `opencode auth login`（[ACP v2 文档](https://opencode.ai/v2/docs/cli/acp/)）。提供方页写 ChatGPT Plus、GitHub Copilot、GitLab Duo 可以直接用；Claude Pro/Max 的第三方用法被 Anthropic 禁止，1.3.0 起不再内置那个插件（[Providers](https://opencode.ai/docs/providers)）。

矩阵对 `opencode` 1.19.3 广告 load、list、fork、resume，认证列是 terminal。`opencode-v2` 2.1.2 在 registry 里，不在矩阵里。

### Cursor CLI

`agent acp`，stdio，换行 JSON。文档中的顺序是 `initialize`、`authenticate`（`cursor_login`）、`session/new` 或 `session/load`、`session/prompt`、权限、可选 `session/cancel`。也可以事先 `agent login`，或带 `--api-key` / `CURSOR_API_KEY`（[ACP](https://cursor.com/docs/cli/acp)）。无头是 `agent -p`，输出 `text`、`json`、`stream-json`。`--yolo` 是 `--force` 的别名，用来强制允许命令，除非被明确拒绝（[Parameters](https://cursor.com/docs/cli/reference/parameters)）。登录页把浏览器登录写成推荐方式，API key 写成脚本和 CI 的方式（[Authentication](https://cursor.com/docs/cli/reference/authentication)）。矩阵广告 load 和 list，没有 resume。

### Copilot CLI

`copilot --acp` 默认 stdio，也可以 `--port` 改成 TCP。启动时加上的 `--effort`、`--available-tools` 对该进程里所有会话生效，客户端不能在 `session/new` 里按会话改掉（[ACP server](https://docs.github.com/copilot/reference/acp-server)）。无头是 `copilot -p`，`--output-format` 为 `text` 或 `json`（JSONL），`--no-ask-user` 避免停下来问人（[程序化参考](https://docs.github.com/copilot/reference/copilot-cli-reference/cli-programmatic-reference)）。自动放行还有交互里的 `/yolo`，以及 `copilot --autopilot --yolo -p`（[Autopilot](https://docs.github.com/copilot/concepts/agents/copilot-cli/autopilot)）。BYOK 配好后，ACP 和 `-p` 都可以不登录 GitHub（ACP server 页）。矩阵对 `github-copilot-cli` 1.0.101 广告 load 和 list，认证列是 terminal。

### Kimi CLI

`kimi acp`。未登录时创建或加载会话会返回 `AUTH_REQUIRED`（`-32000`），文档要求先在终端 `kimi login`（[kimi acp](https://moonshotai.github.io/kimi-cli/en/reference/kimi-acp.html)）。`kimi login` 打开浏览器并写入 OAuth（[kimi 命令](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html)）。打印模式 `kimi -p` 隐式 `--afk`，工具调用、提问和计划模式切换都自动处理；`--output-format=stream-json` 是 JSONL。退出码 0 成功，1 为不可重试（含认证失败和额度用尽），75 为可重试（[Print Mode](https://moonshotai.github.io/kimi-cli/en/customization/print-mode.html)）。会员文档写 CLI 请求计入 Kimi 会员额度，和开放平台按量 key 不是同一条账单（[会员权益](https://www.kimi.com/code/docs/kimi-code/membership.html)、[FAQ](https://www.kimi.com/code/docs/en/kimi-code/faq.html)）。矩阵广告 load、list、resume，认证列是 terminal。

### Qwen Code

`qwen --acp` 把同一套运行时放在 ACP 传输后面（[架构](https://qwenlm.github.io/qwen-code-docs/zh/developers/architecture/)）。Zed 的配置是 `qwen --acp`（[Zed](https://qwenlm.github.io/qwen-code-docs/en/users/integration-zed/)）。无头是 `qwen -p`，`--output-format` 支持 text、json、stream-json，`--yolo` 自动批准，`--approval-mode` 取值包括 `plan`、`default`、`auto-edit`、`auto`、`yolo`，`--resume` 续会话（[无头模式](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)）。认证交互走 `/auth`；无头示例是 `QWENCLOUD_API_KEY` 或 `BAILIAN_CODING_PLAN_API_KEY` 这类 key（[Authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)）。矩阵广告 load、list、resume。registry 的参数比文档多一个 `--experimental-skills`。

### Amp

官方入门是安装脚本后运行 `amp`，用 `amp` 的账号命令管理登录（[CLI 入门](https://ampcode.com/docs/cli)）。社区适配器要求先 `amp login`，或设 `AMP_API_KEY`；它把权限做成 ACP 配置项，取值包括 Default 和 Bypass（[amp-acp README](https://github.com/tao12345666333/amp-acp/blob/main/README.md)）。非交互执行在社区整理的 CLI 说明里是 `amp -x`（[amp-examples CLI 指南](https://github.com/sourcegraph/amp-examples-and-guides/blob/main/guides/cli/README.md)）。这次没有在 ampcode.com 打开到一份带 JSON 事件表的无头参考，输出格式记为未找到。矩阵对 amp-acp 0.10.0 广告 load 和 resume，认证列是 terminal。npm 上的 `@sourcegraph/amp` 写明包已迁到 `@ampcode/cli`。

### Goose

`goose acp` 在 stdio 上做 ACP agent，也可以 `goose serve` 走 HTTP 或 WebSocket（[Use goose as an ACP agent](https://goose-docs.ai/docs/gdk/acp/)）。无头是 `goose run -t` 或 recipe，`--output-format` 为 text、json、stream-json，`--resume` 续跑（[goose-run(1)](https://manpages.opensuse.org/Tumbleweed/goose/goose-run.1.en.html)）。模型来自配置的提供方，其中一类提供方就是别的 ACP agent（[ACP Providers](https://goose-docs.ai/docs/guides/acp-providers)）。矩阵广告 load 和 list，没有 resume。Goose 自己的扩展方法以 `_goose/unstable/` 开头，不在 ACP 稳定面上（[ACP Reference](https://goose-docs.ai/docs/gdk/acp/reference)）。

### Cline

`cline --acp`。文档写客户端可以在会话开始时登录，已保存的 `cline auth` 会复用；登录选项包括 Cline、ClinePass 和 ChatGPT 订阅（[ACP](https://docs.cline.bot/usage/acp)）。无头在给了提示词、`--json`、管道或重定向时发生。`--auto-approve` 默认 true，ACP 模式下默认 false。`--json` 输出换行 JSON（[CLI Reference](https://docs.cline.bot/cli/cli-reference)、[CLI Overview](https://docs.cline.bot/usage/cli-overview)）。账号也可以是按用量的 Cline 登录，或每月的 ClinePass（[Authorization](https://docs.cline.bot/getting-started/authorizing-with-cline)）。矩阵只广告 `loadSession`。

### Auggie

`auggie --acp`。文档写 ACP 仍在发展，交互模式的功能未必都在（[ACP Mode](https://docs.augmentcode.com/cli/acp/agent)）。无头是 `auggie --print`，可加 `--quiet` 或 `--output-format json`（[CLI Flags](https://docs.augmentcode.com/cli/reference)）。登录是 `auggie login`，自动化使用 `auggie token` 打出的会话 JSON，环境变量名 `AUGMENT_SESSION_AUTH`（[Authentication](https://docs.augmentcode.com/cli/setup-auggie/authentication)）。矩阵广告 load 和 list，认证列是 terminal。

### Factory Droid

registry 的启动行是 `droid exec --output-format acp-daemon`，包名 `droid@0.245.1`。矩阵对 0.245.0 的 `initialize` 成功，广告 load、list、resume。无头概览写 `droid exec` 一轮后退出，默认偏只读，`--auto low|medium|high` 才允许修改和执行命令，另有 `--skip-permissions-unsafe`。`json` 结果对象含 `result` 和 `session_id`，`stream-json` 是 JSONL（[Droid Exec](https://docs.factory.ai/cli/droid-exec/overview)）。CLI reference 的认证步骤是设置 `FACTORY_API_KEY`；交互命令表里有 `/login`（[CLI Reference](https://docs.factory.ai/cli/configuration/cli-reference)）。`acp-daemon` 这个格式名没有出现在本次打开的 reference 摘录中。

### Codex、Claude、Grok 的 ACP 增量

只记相对既有三份调研的新增事实。

Codex 适配器的 registry 版本是 2.2.2，包 `@agentclientprotocol/codex-acp`，仓库 [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp)。矩阵认证列是 agent，会话能力是 load、list、fork、resume。

Claude 适配器的 registry 版本是 0.94.0，包 `@agentclientprotocol/claude-agent-acp`，仓库 [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)。矩阵认证列是 terminal，会话能力同样是 load、list、fork、resume。Agents 页仍链到 Zed 的旧仓库说明。

Grok 的 registry 版本是 1.0.66，启动参数 `agent stdio`。矩阵认证列是 agent，会话能力是 load、list、resume。这和既有调研里「仓库用户指南写了 load、docs.x.ai 示例只有 session/new」可以并读：registry 探测看到了 load 和 resume 的广告，不证明 docs.x.ai 的示例已经演示它们。

## 添加一个新 agent 时运行层最少要有的配置

这些字段足够登记一个 Agent 模板，并让调度者会话或一次派单跑起来。

- 启动命令和参数。优先抄 registry 的 `distribution`，其次抄厂商文档里的 `--acp` 或 `acp` 子命令。版本钉住，不使用浮动的 `latest`。
- 传输。v1 用 stdio 上的换行 JSON。Copilot 另有 TCP，Helm 不需要。
- 认证。三选一：本机已经登录；环境变量里的账号令牌或 API key；`initialize` 广告的 terminal auth，由用户在本机终端完成一次登录。运行层不保存可转给别人的凭证，这和既有订阅调研的边界一致。
- 能力声明。保存这次 `initialize` 里的 `loadSession`、`sessionCapabilities` 和 prompt 能力。缺哪项，模板里就标哪项不可用。
- 权限策略。默认代答，规则见建议第 7 条。若厂商无头开关会在进程启动时关掉提问，把该参数写进模板，ACP 代答仍保留。
- 工作目录。每个派单把 worktree 的绝对路径放进 `cwd`。只有广告了 `additionalDirectories` 才加额外根。
- MCP。把 Helm 要注入的服务器放进 `mcpServers`。适配器可能收下但不连接，派单输出里要能看到工具是否真的出现。
- 取消和超时。取消发 `session/cancel`，并对未完成的权限请求回 `cancelled`。空闲多久、墙钟多久由运行层决定，协议没有这张表。
- 续跑 id。记下 `sessionId`。方法按建议第 8 条选择。没有 ACP 续跑时，改用该 CLI 的 `--resume` 新进程。

## 没能确认的事项

- Qoder 是否实现 `session/load` 或 `session/resume`，以及非交互模式有没有 JSON 事件。它在 registry 里，不在 2026-10-21 的探测矩阵里。
- zcode 是否存在未写入 zcode.z.ai 的官方 CLI。已打开的安装、Agent、命令和 ADE 页都是桌面应用。
- DeepSeek Harness 的 ACP profile 是否广告 load、resume，权限预设能否经 ACP 设成 `never`。GitHub discussion [#3481](https://github.com/deepseek-ai/deepseek-harness/discussions/3481) 的回复称 rc.8 的权限请求只有 `toolCallId` 和一次允许或拒绝，并指向 `packages/acp/acp/src/index.ts`。本次没有打开该文件。
- `droid exec --output-format acp-daemon` 的事件是否就是 ACP JSON-RPC。registry 用它做启动参数，CLI reference 摘录没有这个格式名。
- Gemini ACP 在客户端不实现文件读写时，是否仍用自己的工具写 `cwd`。官方 ACP 页把文件代理写成 ACP 模式的行为。
- Cursor 浏览器登录在无 `CURSOR_API_KEY` 时，账单是订阅额度还是另计。认证页只写了两种登录方式。
- Kimi 的 `kimi login` OAuth 是否就是会员额度那条路，还是还要再配 Kimi Code key。两边文档都存在，CLI 参考没有把它们写成同一句话。
- Qwen 无头在不设置任何 key、只保留交互 `/auth` 缓存时能否启动。已打开的无头认证示例都是环境变量。
- Amp 的套餐名称，以及 `amp -x` 的机器可读输出。入门页没有事件表。
- Auggie、Copilot、Cursor、Goose、Cline、Gemini 在广告了某种会话能力之后，对应方法是否真能完成。矩阵只记录广告和一部分方法探测，没有逐家做一轮写文件的派单。
- 矩阵里的 `session/stop` 与规范里的 `session/close` 不是同一个名字。`session/close` 有多少家实现，未探测。
- `codex-acp` 2.2.2 和 `claude-agent-acp` 0.94.0 在不注入 API key 时是否复用本机订阅登录。矩阵只标了认证类型，没有读凭证文件。
- Grok `grok agent stdio` 是否实现 `session/cancel`。矩阵没有这一列。
- OpenCode 用 ChatGPT Plus 登录时，ACP 进程是否需要再跑一次 terminal auth。提供方页写可以直接用，ACP 页写未认证会返回 `auth_required`。
- 官网 Agents 页中、registry JSON 之外的那些 agent，各自的无头命令和登录方式。
- SDK 文档站与 2026-10-19 发布说明关于旧连接类是否仍可导入的冲突。接入前要对照实际安装的包入口，本次没有安装该包。
