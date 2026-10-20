# 调度者和执行者能否用订阅额度运行

调研日期：2026-10-20。只使用当天能打开的官方文档、帮助中心、使用条款和定价页。每条结论后面附来源。

读不到的部分：

- `web_fetch` 访问 `code.claude.com`、`platform.claude.com`、`support.claude.com` 时被拦截（解析到内网地址）。改用能打开的页面抓取，下面的 Claude 原文都来自这些页面。
- 本机执行 `claude`、`codex`、`grok` 时 shell 返回 `operation not permitted`。`command -v` 没有打出路径。`ls` 能看到 `/Users/dikui/.local/bin/codex` 是指向 `/Users/dikui/.codex/packages/standalone/current/bin/codex` 的符号链接，日期 2026-10-16。`claude` 和 `grok` 的常见安装路径在本环境列不出来。没有跑 `--help`，没有发起模型调用，没有改配置。
- 没有把 GitHub 仓库源码当作依据。SDK 和 CLI 的认证行为以官方文档为准。

先前的 [底座调研](helm-substrates.md) 写过：Claude Agent SDK 和 Managed Agents 按 API 计费，不复用订阅额度。2026-10-20 的帮助中心已经改口，见第 2 节。那份文件本次没有改。

## 两种用法

条款把下面两件事分开写。

个人在自己的电脑或服务器上，用自己的订阅登录，拉起厂商发布的、未修改的官方 CLI，给自己干活。Claude、Codex、Grok 的文档都把这种无头或脚本调用写成产品功能。

把登录或套餐额度做进一个给别人用的产品：代他人付费、转售、代持凭证、让别人的流量记到一份消费者订阅上，或让程序伪装成官方客户端。三家都禁止。

Helm 若只在用户自己的机器上、用用户自己的账号拉起官方二进制，落在第一类。Helm 若变成别人安装后用他们的订阅来跑的产品，或由 Helm 保管并转发他们的登录，落在第二类。

## 1. Claude Code CLI，订阅登录，程序反复拉起 `claude -p`

### 条款

Free、Pro、Max 使用 [Consumer Terms](https://www.anthropic.com/legal/consumer-terms)（生效日 2025-10-08）。Team、Enterprise 和 Claude API 使用 [Commercial Terms](https://www.anthropic.com/legal/commercial-terms)。Claude Code 文档把这两份条款按账号类型分开。[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

Consumer Terms 第 3 节第 7 项：除了使用 Anthropic API key，或 Anthropic 另行明确允许的情况，不得用 bot、脚本或其他自动化、非人工方式访问服务。同一节禁止转售服务。第 2 节禁止把账号登录信息、API key 或账号凭证分享给别人，也禁止把账号提供给别人用。

Anthropic 已经把官方 Claude Code 的脚本用法写成明确允许的路径：

- 无头文档把 `claude -p` 写成给脚本和 CI 用的非交互模式。[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- `claude setup-token` 生成一年期 OAuth token，环境变量名 `CLAUDE_CODE_OAUTH_TOKEN`。文档写明用途是 CI、脚本，以及没有浏览器登录的环境，并且这个 token 用的是 Claude 订阅，需要 Pro、Max、Team 或 Enterprise。[Authentication](https://code.claude.com/docs/en/authentication)
- 合规页写：OAuth 只给 Claude Free、Pro、Max、Team、Enterprise 的购买者，用来支持 Claude Code 和其他 Anthropic 原生应用的普通使用。终端用户可以用自己的 Claude 订阅登录未修改的 Claude Code 二进制，包括某个平台按该页条件托管这份二进制的情况。开发者不得在自己的应用里提供 Claude.ai 登录，不得用 Free、Pro、Max 凭证替用户转发请求，不得收集、保存或代持 Claude.ai 凭证。登录必须走 Anthropic 自己的流程。Anthropic 可以不经事先通知采取执行措施。[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- 同一页写：Pro 和 Max 对外宣传的用量，假定的是个人对 Claude Code 和 Agent SDK 的普通使用。
- 登录帮助中心写：订阅包含的用量是为 Anthropic 原生应用的普通使用设计的，其中包括 Claude Code。第三方工具优先用 Console API key。Anthropic 可以自行决定，让已打开 usage credits 的付费订阅者用某些第三方工具，并保留把这类用量改记到 usage credits 而不是订阅限额的权利。伪装身份、把第三方流量记到订阅限额，或违反条款的用法，会被执行。[Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)

[Usage Policy](https://www.anthropic.com/legal/aup) 页首写生效日 2026-11-12，晚于本次调研日。其中 “Do Not Abuse Our Platform” 禁止转售、代理，或以未经授权的方式提供 Claude，包括把请求转到消费者订阅上，或谎报产品或客户端。今天已经生效的产品合规页已经有对应限制，不依赖这份尚未生效的 AUP。

### 技术上能不能

能。订阅登录是 Claude Code 的正式登录方式之一。Pro 或 Max 用 claude.ai 账号登录；Team 或 Enterprise 用被邀请的账号登录。[Authentication](https://code.claude.com/docs/en/authentication)、[Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)

凭证优先级里，`ANTHROPIC_API_KEY` 高于订阅 OAuth。`-p` 模式下只要环境里有这把 key，就会用它，从而按 API 计费。要让一次无头运行走订阅，进程环境里不能有 `ANTHROPIC_API_KEY`。订阅登录本身排在 `/login` 保存的 OAuth 上；没有浏览器时可以用 `CLAUDE_CODE_OAUTH_TOKEN`。[Authentication](https://code.claude.com/docs/en/authentication)、[Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)

`--bare` 不走订阅。bare 模式不读 OAuth，也不读系统钥匙串，文档要求改用 `ANTHROPIC_API_KEY` 或 `apiKeyHelper`。文档还写：`--bare` 是脚本和 SDK 调用的推荐模式，并将在以后的版本里成为 `-p` 的默认。那次默认值变化一旦落地，不加参数的 `claude -p` 会不再读取订阅登录。[Headless](https://code.claude.com/docs/en/headless)

帮助中心在 2026-10-07 写明：用 Claude 计划登录时，`claude -p` 和 Agent SDK 仍从计划的用量限额扣除，不使用每月 API credits。用已关联 Console 组织的 API key 自己跑 `claude -p` 时，才记成 Agent SDK 用量，并可以使用那些 API credits。[Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)、[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

无头进程可以长时间停在后台工作上。主对话启动的后台命令会等到命令结束或到达时间上限；默认在连续空闲 10 分钟后停掉其余后台工作。`/loop` 的自定唤醒可以越过这 10 分钟。SIGTERM 以退出码 143 结束，当前回合不记结果。[Headless](https://code.claude.com/docs/en/headless)

### 用量

Pro 和 Max 都有每五小时重置的会话限额，以及每周重置一次的每周限额。两者在 Claude 网页、桌面、移动和 Claude Code 之间共用。Max 另有单独的 Fable 每周限额。Max 5x 是 Pro 的每会话用量的 5 倍，价格每月 100 美元；Max 20x 是 20 倍，每月 200 美元。价格是网页订阅价。Anthropic 写明还可以另行施加每周、每月或按模型、功能的上限。[Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)、[What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)、[What is the Pro plan?](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan)、[How do usage and length limits work?](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)

当前 Pro 和 Max 帮助页没有公布固定的消息条数或小时数。用量随消息长度、对话长度、模型和功能变化。进度在 Settings、Usage 和 Claude Code 的 `/usage` 里看。`/usage` 对订阅用户显示的是计划用量条，会话块里的美元数字不用于订阅账单。[Costs](https://code.claude.com/docs/en/costs)

五小时限额打在一次已经开始的回复中间时，Claude Code 2.1.277 及以后可以有一小段 wrap-up。这段用量仍计入每周限额。Pro 每个每周周期最多一次；Max 在每周限额之内每次碰到五小时限额都可以。新消息不算。功能在逐步放开。[Wrap-up allowance](https://support.claude.com/en/articles/17040437-claude-code-wrap-up-allowance)

2026-05-13 到 2026-09-13，Claude Code 的每周限额曾提高 50%，五小时限额不变。2026-09-14 起，Pro、Max、Team 和按席位的 Enterprise 的 Claude Code 每周限额比促销前高 25%。[Weekly limits promotion](https://support.claude.com/en/articles/15910845-claude-code-may-august-2026-weekly-limits-promotion)

限额用尽后有两条路。不打开额外计费就等到重置。打开 usage credits 后，超出五小时或每周限额的请求按标准 API 价格继续，直到月支出上限或余额用完。这和订阅费分开。Max 附带的每月 API credits 不能用来支付 Claude Code 或 Claude 应用里的超额用量。[Manage usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)、[Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)

Max 和 Team 另有每月 API credits：Max 5x 100 美元，Max 20x 200 美元，领到一个 Console 组织，按账单周期刷新，不结转。覆盖 Messages API、Batches、Playground、Managed Agents、Agent SDK，以及用该组织 API key 自己跑的 `claude -p`。不覆盖交互式 Claude Code。Pro 没有这份额度。用完后不会改记到 Claude 计划上。[Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)

### 违反条款的风险

个人在自己的机器上运行未修改的 `claude`，用自己的 Pro 或 Max 登录，不设置 `ANTHROPIC_API_KEY`，不加 `--bare`，由自己的程序反复调用：文档把这写成订阅路径，Consumer Terms 的自动化禁令留了“另行明确允许”的口子，而 `claude -p` 和 `setup-token` 就是这个口子。

风险在用量和产品形态，不在“程序拉起”这四个字本身：

- 宣传用量假定普通的个人使用。并行、长时间、反复拉起会更快打到五小时和每周限额。Anthropic 保留额外限流，并可以不经通知执行认证限制。
- 把用户的 Claude.ai 登录做进 Helm，替用户保管 token，或让别人的请求记到这一份订阅上：合规页和登录帮助中心都禁止。
- 环境里残留 `ANTHROPIC_API_KEY` 时，`-p` 会按 API 计费。打开 usage credits 后，超额部分也按 API 价格计费。
- 以后 `-p` 默认变成 `--bare` 时，这条订阅无头路径会断。这是文档已经预告的行为变化，不是本次能从条款推出的禁止。

## 2. Claude Agent SDK

### 是不是只接受 API key

对第三方产品，官方要求用 API key。对订阅者自己用，帮助中心写明仍可走订阅限额。两句话同时成立。

SDK 概览和 Quickstart 写：设置 `ANTHROPIC_API_KEY`，或 Bedrock、Vertex、Foundry。未经事先批准，Anthropic 不允许第三方开发者在自己的产品里提供 claude.ai 登录或套餐限额，包括用 Agent SDK 做的 agent。请改用该文档里的 API key。[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)、[平台概览中的同一段限制](https://platform.claude.com/docs/en/agent-sdk/overview)

SDK 的使用受 Commercial Terms 约束，包括用它给自己的客户提供产品时。Commercial Terms 写明其下的服务不是消费者用途；claude.ai 等消费者产品走 Consumer Terms。[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)、[Commercial Terms](https://www.anthropic.com/legal/commercial-terms)

个人自用的例外写在帮助中心，不写在 SDK Quickstart 里：

- 2026-06-15：暂停先前宣布的变更。Agent SDK、`claude -p` 和第三方应用的用量仍从订阅限额扣除。
- 2026-10-07：Max 和 Team 的每月 API credits 覆盖 Agent SDK、`claude -p`、Claude API 和 Managed Agents。订阅者仍然可以用订阅限额使用 Agent SDK、`claude -p` 和第三方应用。
- 每月 API credits 文章写：六月宣布的那份 Agent SDK 额度不可用。用计划登录时，`claude -p` 和 Agent SDK 从计划限额扣除，不用 API credits。用关联组织的 API key 自己跑时，才记成 Agent SDK 用量并使用 API credits。

来源：[Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)、[Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)

因此：SDK 不是“技术上只认 API key”。订阅者本机已有 Claude Code 登录时，帮助中心把 SDK 用量算进订阅限额。Quickstart 仍只教 API key。第三方产品没有“把用户的 claude.ai 登录转给你的用户”这一例外。

Managed Agents 不在这次四个问题里，但和旧结论有关：它由每月 API credits 或 Console 计费覆盖，帮助中心没有写它走 Claude 计划的五小时或每周限额。[Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)

### 用量和风险

走订阅登录时，限额与第 1 节相同：五小时、每周、Max 的 Fable 每周限额，并和 Claude、Claude Code 共用。合规页把“普通的个人使用”也安在 Agent SDK 上。

走 API key 时按 API 或每月 API credits 计费。Max 5x 每月 100 美元、Max 20x 每月 200 美元的 credits 用完后，不会自动改记到 Claude 计划；没有其他 credits 时请求停止。Pro 没有这份 credits。

风险：把 SDK 嵌进给别人用的产品，并让对方用 claude.ai 登录或 Pro、Max 限额，概览页写明不允许。订阅者在自己的程序里调用 SDK、使用自己的计划登录，帮助中心目前仍从订阅限额扣除。Anthropic 已经宣布过一次要把这条挪走，又在 2026-06-15 暂停。这个暂停是“目前”，不是永久承诺。

## 3. Codex CLI 和 Codex SDK，ChatGPT 订阅登录，被程序拉起

### 条款

用 ChatGPT 账号登录 Codex 时，适用 ChatGPT 使用条款和隐私政策；API 以及 Enterprise、Edu、Business 适用对应的在线服务协议。帮助中心原文如此。[Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540)

[Terms of Use](https://openai.com/policies/row-terms-of-use/) 写：不得分享账号凭证或把账号提供给别人，并对账号下的全部活动负责。不得修改、复制、租赁、出售或分发服务。不得自动或程序化地抽取数据或输出。账号共享帮助中心写：账号属于创建它的那个人；可以在多台设备上用；用量限额仍按账号活动执行。[OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy)

这些句子限制的是抓取、转售和共用账号。官方 CLI 自己的非交互模式是另一条产品路径，见下一节。

给别人用的应用若要花用户的 ChatGPT 额度，走的是 Sign in with ChatGPT，不走“代持 Codex 登录”。其条款要求：请求来自用户本机或仅由该用户控制的远程运行时；请求属于该用户本人的活动，或该用户明确授权的自动化和后台进程；后台使用前要取得明确同意；不得用一个用户的订阅完成另一个用户的请求；不得把额度池化、转让、转售、赠送或共享，条款明确允许的 token 处理除外；用户必须能在不向你付费、也不必升级你的应用的情况下使用自己的计划。[Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)（页面标注 2026-09-29）、[Using your ChatGPT plan in other apps and sites](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)

Go、Plus、Pro 可以在参与这项功能的商业应用里选择使用计划额度。这是用户在官方同意屏上单独批准的，不是任何程序拿到登录后都可以转发。

### 技术上能不能

CLI 能。Codex 支持 ChatGPT 登录（订阅）和 API key（按量）。桌面、CLI 和 IDE 扩展两种都支持。本地登录缓存在 `~/.codex/auth.json` 或系统钥匙串，使用中会刷新。`codex exec` 默认复用这份已保存的登录。文档把 `codex exec` 写成脚本和 CI 的非交互模式。[Authentication](https://learn.chatgpt.com/docs/auth)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)

自动化文档同时写了两句：API key 是自动化的默认选择，因为更好发放和轮换；若必须用 Codex 账号，例如需要 ChatGPT 或 Codex 的限额而不是 API 用量，可以在受信任的 runner 上使用 ChatGPT 管理的认证。不要把 `auth.json` 用于公开或开源仓库。刷新大约以 8 天为间隔，成功后写回 `auth.json`，同一份文件只应由一台机器或串行任务使用。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[Maintain Codex account auth in CI/CD](https://learn.chatgpt.com/docs/auth/ci-cd-auth)

API key 不走套餐内额度，按 API 价格计费，并且没有依赖 ChatGPT workspace 的云功能。[Authentication](https://learn.chatgpt.com/docs/auth)、[Pricing](https://learn.chatgpt.com/docs/pricing)

Codex access token 是另一条不打开浏览器的订阅侧路径。目前只支持 ChatGPT Business 和 Enterprise workspace，不覆盖 Plus 和 Pro 个人计划。token 代表创建它的 workspace 用户，用于受信任的 `codex exec`、本地脚本和 app-server。有 Platform API key 能完成的自动化，文档要求继续用 API key。[Access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)

SDK 能被程序拉起，文档没有写“SDK 拒绝 ChatGPT 登录”。TypeScript 包 `@openai/codex-sdk` 要求 Node.js 18+，示例是 `new Codex()` 后 `startThread()` 和 `run()`，示例里没有 API key。同一套非交互文档写 `CODEX_API_KEY` 可用于 `codex exec`、`codex review`、TypeScript SDK 和 `codex exec-server --remote`。SDK 页把用途写成 CI、自建 agent、内部工具和嵌进自己的应用，并指向 app-server 来处理认证、历史、审批和事件流。[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

SDK 页没有写它在无 API key 时是否读取 `~/.codex/auth.json`。本次没有读到仓库源码，不能把“SDK 进程一定复用 CLI 的 ChatGPT 登录”写成已核实。能核实的是：CLI 的 `codex exec` 会复用；SDK 接受 `CODEX_API_KEY`；app-server 有 ChatGPT 管理的 OAuth，会保存并刷新 token。[Authentication](https://learn.chatgpt.com/docs/auth)

### 用量

ChatGPT Work 和 Codex 共用额度，包含在 Free、Go、Plus、Pro、Business、Edu、Enterprise 里。API 标价不能用来估算套餐内任务。定价页写于本次能打开的 [Pricing](https://learn.chatgpt.com/docs/pricing)。

Plus 和标准 Business 的本地消息数是五小时窗口里的估计，不是固定条数。页面给出的范围：GPT-6 Astra 5–45，GPT-6.1 Sol 15–160，GPT-6 Sol 15–150，GPT-6 Luna 350–3,000。本地消息和云端对话共用这份额度。每周限额可能另外存在。Enterprise 和 Edu 在弹性定价下没有固定速率限额，随 credits 伸缩；没有弹性定价时，多数功能的每席限额与 Plus 相同。

Pro 目前没有五小时限额。Pro 有 100、200、500 美元三档，高档包含用量更高。新的 Pro 200 若不符合祖父条款，包含用量低于旧的 Pro 200。每周限额是否对 Pro 生效，定价页的总述是“每周限额可能另外存在”，Pro 帮助页没有单独写“没有每周限额”。模型额度用尽后，该模型会暂时不可用，直到重置。Ultrafast 只在 Pro 500。Fast 按标准模式 2.5 倍消耗包含额度；GPT-6 Astra 和 GPT-6.1 Sol 的 Ultrafast 按 8 倍消耗包含额度，购买的 credits 按 6 倍。[Pricing](https://learn.chatgpt.com/docs/pricing)、[About ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)

进行中的回合碰到限额时，agent 可以在公平使用的前提下把这一回合做完。Plus 和 Pro 可以购买 credits 在包含额度之后继续。credits 覆盖 Codex、ChatGPT Work 以及 Word、Excel、PowerPoint 里符合条件的用量，不给所有模型和功能加额度。支持不能重置限额。[Pricing](https://learn.chatgpt.com/docs/pricing)、[About ChatGPT Pro tiers](https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers)

### 违反条款的风险

用户在自己的受信任机器上，用自己的 ChatGPT 登录运行官方 `codex exec`：文档把这写成默认行为，并单独写了“为了使用订阅限额而不是 API key”的自动化路径。

风险：

- 把 `auth.json` 或 access token 交给别人、提交进仓库，或让多个互不相关的人共用一份登录。账号共享政策和 token 文档都禁止。
- Helm 作为给别人用的应用，未经 Sign in with ChatGPT 的同意屏就花他们的计划，或用一个人的订阅完成另一个人的请求。
- 公开 CI、fork 的 pull request、共享机器上放置 ChatGPT 登录。文档要求这条路径只用于受信任的私有 runner。
- 打开 credits 之后，超出包含额度的部分按 credits 计费，不再是“只花订阅”。
- Plus 的五小时估计很低，长驻调度者会很快用完。Pro 没有五小时窗口，仍可能有每周限额；页面没有给出 Pro 的每周数字。

## 4. Grok CLI，SuperGrok 或 X 订阅登录，被程序拉起

### 条款

消费者使用 Grok 适用 [Terms of Service — Consumer](https://x.ai/legal/terms-of-service)，页首 Last Updated: 2026-10-12。开发者和企业，包括 SpaceXSI API，适用 [Enterprise Terms](https://x.ai/legal/terms-of-service-enterprise)。Grok on X 不适用这份消费者条款，而适用 X 的条款。

消费者条款：不得分享账号凭证或把账号提供给别人，并对账号下的活动负责。付费订阅自动续费，已付款项除法律要求外不退。新的捆绑计划另见 [Bundled Subscription Terms](https://x.ai/legal/bundled-subscription-terms) 和 [The X Subscription 说明](https://docs.x.ai/x-subscription/overview)。

[Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy) 生效日 2026-08-14，适用于消费者、开发者和企业。其中禁止：用 bot 访问服务并以此损害服务；绕过速率限制、限制或安全措施；抓取、转售输入或输出；经营网站、收费提供违反政策的输出；未经授权的自动化或非人工访问，包括 bot 和脚本；误导他人，使服务看起来来自你而实际来自 SpaceXSI，或看起来来自 SpaceXSI 而实际不是。

“未经授权”这几个字是相对旧版的变化。2026-06-26 的旧 AUP 把“通过自动化或非人工方式访问”写成禁止，没有“未经授权”这个限定。当前产品文档把官方 CLI 的无头模式写成给脚本和 bot 用的功能，因此官方 `grok -p` 不属于“未经授权的自动化”。自己写一个客户端、拿用户的 Grok 凭证去访问服务，AUP 和 FAQ 都没有提供授权。FAQ 还写：若通过使用你的 Grok 凭证的第三方应用进入已停用的 Studio，应撤销并更换凭证。[Headless](https://docs.x.ai/build/cli/headless-scripting)、[Grok FAQ](https://docs.x.ai/grok/faq)

定价页写：订阅只由 X Subscription Corp. 直接销售，没有授权经销商。从其他来源购买的订阅可以随时暂停或终止。[Pricing](https://x.ai/pricing)

### 技术上能不能

能，分两条账单。

Grok Build 可以交互使用，也可以无头用于脚本、bot，或嵌进其他应用。首次启动打开浏览器登录。没有浏览器时设置 `XAI_API_KEY`。无头示例是 `grok -p`。设置参考把 `XAI_API_KEY` 定义为不用浏览器或会话登录时的 key，并注明用于 CI 和无头。[Overview](https://docs.x.ai/build/overview)、[Settings reference](https://docs.x.ai/build/settings/reference)、[Headless](https://docs.x.ai/build/cli/headless-scripting)

ACP 示例假定本机已经登录，或设置了 `XAI_API_KEY`。没有 `cached_token` 也没有 API key 时，文档要求先 `grok login` 或设置 key。[Headless](https://docs.x.ai/build/cli/headless-scripting)

因此：程序可以反复拉起已登录的 `grok -p`。进程里若有 `XAI_API_KEY`，走的是 API key 路径。API 按模型和 token 另计，不走订阅池，见用量一节。

本次没有执行本机 `grok`，不能用 `--help` 核对 flag 是否与文档一致。

### 用量

还没切换的 SuperGrok：2026 年 6 月起，付费用户从按产品拆开的每日限额，改为一个每周用量池，可全部用在 Chat、Imagine、Voice 或 Build 上。FAQ 把 Build 列在被合并的产品里，用量页的产品分解也包含 API、Build、Chat、Imagine、Voice。池的重置时间在 Settings、Usage。没有公布固定的消息数或小时数。长编码任务比一条聊天更费额度。用尽后付费功能暂停，Chat 和 Voice 仍有单独的免费档。可以买 Extra Usage Credits、升级或开 Auto Top Up。Credits 按标准费率，比套餐内的有效费率贵，网页购买，购买后一年过期。文档没有写五小时窗口。[Grok FAQ](https://docs.x.ai/grok/faq)、[Grok overview](https://docs.x.ai/grok/overview)

The X Subscription 是新的捆绑计划。未切换的 Cursor、SuperGrok 和 X Premium 可以保持原价和功能。切换后旧订阅取消，且不能撤销。[Overview](https://docs.x.ai/x-subscription/overview)

新计划的每周池按席位，在符合条件的第一方 Grok 和 Cursor 表面之间共用，不按产品拆成独立配额。Plus 为基准，Premium 4 倍，Super 15 倍，Ultra 50 倍。每周刷新。第三方模型不在池内，按量另计。用尽后的第一方用量成为 Additional Usage，用充值 credits 支付。自助团队计划是每席一个池，席位之间不共用每周池。[Usage limits](https://docs.x.ai/x-subscription/usage-limits)、[Pricing](https://x.ai/pricing)

定价页的功能表把 Grok Build 列为计划功能，Plus 的功能列表写着 “Grok Chat, Voice, Imagine, and Build”。同一页的“用量如何计算”只写：池在 Grok 与 Cursor 之间共用；在 Grok 之内，池覆盖 Chat、Imagine、Voice 和 Bot。这句没有点名 Build。同一页写明：付费计划包含 Grok API 访问，但 API 按标准模型价格另计，不从计划的用量池扣除。[Pricing](https://x.ai/pricing)

Grok 4.7 Fast 与 Grok 4.7 是同一模型的更快基础设施，价格为标准 token 费率的 2 倍，长上下文为 1.5 倍。它只在 Cursor 和 Grok Build 里提供，通过那里的计划计费；不在公开 API 上；Grok Build 免费档不包含它。[API Pricing](https://docs.x.ai/developers/pricing)

单独的 X Premium、未并入 The X Subscription、也不是 SuperGrok 时，本次打开的页面没有写它是否包含 Grok Build CLI 的用量。消费者条款写 Grok on X 走 X 的条款。FAQ 只写：在 grok.com 绑上 X 账号后，SpaceXSI 可以读取 X 订阅状态并发放相应权益，没有列出 Grok Build。这里记为未能从已打开的页面判断。

### 违反条款的风险

用户用自己的浏览器登录，在自己的机器上运行官方 `grok -p`，环境里没有 `XAI_API_KEY`：无头模式是官方功能，SuperGrok 的每周池明确包含 Build。

风险：

- 把登录交给别人，或让 Helm 替其他用户转发他们的 Grok 会话。消费者条款禁止共享凭证；AUP 禁止未经授权的自动化和转售。
- 设置 `XAI_API_KEY` 后按 API 价格计费，不走每周池。
- 用尽每周池后，若打开充值或 Auto Top Up，继续使用按标准费率计费。
- 已切换到 The X Subscription 的账号：Grok Build 是计划功能，Fast 通过 Grok Build 的计划计费，但每周池说明没有点名 Build。不能把“一定从那个每周池扣除”写成已证实。
- 官方没有写五小时窗口。调度者的中断点是每周重置，外加额度用尽后的暂停。

## 调度者用哪种方式最稳妥

调度者是一项工作期间常驻、由程序拉起、当时没有人在终端前。最稳妥的形态是：在用户自己的机器上，拉起未修改的官方 CLI，使用用户自己已经完成的订阅登录，不在 Helm 里实现登录、不保存可转给别人的凭证、不设置会覆盖订阅的 API key。

按这个标准，四条路的排序是：

1. Codex CLI，`codex exec`，ChatGPT 登录。文档既允许非交互，也写明可以专门为了使用订阅限额而这么跑，只要机器是用户自己的、受信任的。Pro 目前没有五小时限额，长驻调度比 Plus 不容易被五小时窗口打断。每周限额可能存在，页面没有给 Pro 的每周数字。Plus 的五小时估计对常驻调度者太小。SDK 可以程序化调用，但是否在无 API key 时走同一份 ChatGPT 登录，SDK 页没有写明；调度者应调用 CLI，而不是假定 SDK 继承登录。
2. Grok CLI，`grok -p`，SuperGrok 的浏览器登录，且没有 `XAI_API_KEY`。无头是官方功能，每周池明确包含 Build，没有文档化的五小时窗口。已切换到 The X Subscription 的账号，每周池是否包含 Build 没有写死，稳妥程度低一档。
3. Claude Code CLI，`claude -p`，Pro 或 Max 登录，不加 `--bare`，环境里没有 `ANTHROPIC_API_KEY`。今天会计入订阅，并且 `setup-token` 明确给脚本使用。五小时加每周限额会打断长驻调度。文档已预告 `--bare` 将成为 `-p` 的默认，而 bare 不读订阅。这条路今天可用，对“长期不必改调用方式”不够稳。
4. Claude Agent SDK，订阅者自己的登录。帮助中心目前从订阅限额扣除，但 SDK 文档要求第三方用 API key，并且 Anthropic 已经暂停过一次相反的变更。个人调度者用官方 CLI 比把 SDK 嵌进自己的进程更贴近“原生应用的普通使用”。给别人用的产品没有这条订阅例外。

Managed Agents 和 Console API key 不满足“不必按 API 计费”。Max 的每月 API credits 是 Console 里的 API 额度，不是 Claude 计划的五小时或每周限额。

## 对 A3 的判断

A3：“调度者能用订阅额度运行，不必按 API 计费。”

判断：支持。范围是个人自用。

支持所依据的事实：用户在自己的机器上，用自己的订阅，拉起未修改的官方 CLI。Claude 的 `claude -p`（非 bare）、Codex 的 `codex exec`（ChatGPT 登录）、Grok 的 `grok -p`（浏览器登录、无 API key）都会按各自文档走订阅或计划额度，而不是必须先购买 API 用量。Codex 文档还把“要用订阅限额而不是 API key”写成一条明确的自动化路径。

支持所附的边界：

- 额度之内不必按 API 计费。Claude 的五小时和每周限额、Codex Plus 的五小时估计和可能的每周限额、Grok 的每周池用尽后，服务会停，或在用户打开 credits、usage credits、Extra Usage 时改为按量计费。
- 不成立的推广：一个提供给他人的产品，让用户的消费者订阅为这个产品付费，或由产品代持、转发登录。三家条款都禁止。
- Agent SDK 对订阅者个人目前仍走订阅限额，这不推翻 A3。它也不是第三方产品的例外。
- 未能判断，且不改变上面的支持结论：The X Subscription 的每周池说明没有点名 Grok Build；单独的 X Premium 是否包含 Grok Build CLI；Codex SDK 在不提供 API key 时是否读取 CLI 的 ChatGPT 登录；Claude 把 `--bare` 做成 `-p` 默认之后，订阅无头路径是否还在。最后一项是文档已经预告的方向，落地前 A3 对 Claude CLI 仍然成立。
