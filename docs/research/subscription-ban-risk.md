# 用订阅无人值守驱动官方 CLI 的封号风险

调研日期：2026-10-21（Grok，一手来源）。


**结论：封号风险低。** Helm 在用户自己的电脑上拉起未修改的官方 `claude`，命令是 `claude -p --input-format stream-json --output-format stream-json --verbose`，不加 `--bare`，环境里没有 `ANTHROPIC_API_KEY`，登录是用户自己的 `/login`。这样用，落在条款里「另行明确允许」的官方程序用法上。已公开的封号和拦截，针对的是另一类做法：别的程序拿着订阅 OAuth、伪装成 Claude Code，或把订阅转给别人。24 小时跑官方 Claude Code，公开处置是每周限额，不是封号。

低风险不等于不会误封。滥用分类器有误报，条款允许不经通知暂停或终止。用量高时先碰到的是五小时和每周限额。额度细则见 [subscription-billing.md](subscription-billing.md)，这里不重复。

## 条款对照

判断只针对题目里的用法：本人、本机、未改官方二进制、不提取 token、不共享、不转售、调度者可常驻数小时、同时最多 5 个 `claude -p`。

| 来源与位置 | 原句 | 判断 |
| --- | --- | --- |
| [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) 第 3 节第 7 项（生效 2025-10-08） | Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise. | 允许。禁止的是自行用脚本访问服务；口子是 API key，或 Anthropic 另行明确允许。下面几行官方文档就是这个口子 |
| 同上，第 2 节 Account | You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. | 允许。Helm 不把登录交给别人 |
| 同上，第 2 节下一句 | You also may not make your Account available to anyone else. | 允许。只有用户本人使用 |
| 同上，第 3 节第 2 项 | To develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models or resell the Services. | 允许。个人编排器不转售服务 |
| 同上，第 3 节禁则之后 | You also must not abuse, harm, interfere with, or disrupt our Services, including, for example, introducing viruses or malware, spamming or DDoSing Services, or bypassing any of our systems or protective measures. | 允许，只要不绕过限额和防护。打满限额后换账号或改客户端身份去继续用，会落到这句 |
| 同上，第 9 节 Termination | We may suspend or terminate your access to the Services (including any Subscriptions) at any time without notice to you if we believe that you have breached these Terms, or if we must do so in order to comply with law. | 不确定。这是执行权，不是把这种用法写成违约。同节还写，可以不经通知修改、暂停或停止服务 |
| [Usage Policy](https://www.anthropic.com/legal/aup) 页首与执行段（页面标注生效 2026-11-12） | If we suspect that you may have violated our Usage Policy, we may warn you or throttle, limit, suspend, or terminate your access to our products and services. | 不确定。写的是怀疑违规后的手段，包括限流和封号。今天是 2026-10-21，[公告](https://www.anthropic.com/news/2026-usage-policy-update)写该版于 11 月 12 日生效 |
| 同上，Do Not Abuse Our Platform | Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used. | 未禁止。禁止的是转售、代理、把请求转到消费者订阅，或谎报客户端。官方二进制自己向服务器表明身份，Helm 不转发请求 |
| 同上，同节前两条 | Utilize automation in account creation or to engage in spammy behavior. | 未禁止。这条限制的是自动开号和垃圾行为。同节还禁止用多个账号规避检测或绕过已有封禁 |
| [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)，Acceptable use | Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK. | 不确定。「普通的个人使用」没有数量。常驻和 5 路并行没有被写成禁止，只是可能超出宣传用量所假设的用法，从而更快碰到限额 |
| 同上，Authentication and credential use | OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. | 允许。OAuth 就是给 Claude Code 等官方应用的普通使用 |
| 同上，Developers | Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. | 允许。Helm 不在自己的界面里做 Claude.ai 登录，也不拿凭证替用户发请求 |
| 同上，下一句 | Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic’s own flow. | 允许。登录停在官方二进制自己的 `/login`，token 不拿出进程 |
| 同上，段末 | Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under Can customers offer Claude Code in their products? | 明确允许。这句直接盖住「未修改二进制 + 用户自己的订阅」 |
| 同上，Can customers offer Claude Code | The Claude Code binary must not be modified. | 允许。题目要求拉起未修改的官方二进制 |
| 同上，段末 | Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice. | 不确定。执行的是上面的凭证限制，且可以不通知。不构成一条新的禁止 |
| [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)，Get started | Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. | 未禁止。这句限制的是把 claude.ai 登录做进自己的产品。Helm 的主通道是直接拉 CLI，不是在产品里提供登录 |
| [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)（2026-10-15），Authenticating to subscription plans | Use of third-party tools that misrepresent their identity to Anthropic’s servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited and such use may be enforced against. | 允许。不伪装身份，也不把别人的流量记到这份订阅上 |
| 同上，前一句 | Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain third-party tools to access Anthropic services included in paid subscription plans, but reserves the right to draw use of such third-party tools from usage credits rather than subscription limits. | 不确定。若以后把编排器算成「某些第三方工具」，用量可以改记到 usage credits。这是计费变化，页面没有把它写成封号 |
| [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) 开篇 | It’s available as a CLI for scripts and CI/CD, or as Python and TypeScript packages for full programmatic control. | 明确允许。`claude -p` 被写成给脚本和 CI 的非交互模式 |
| 同上，Get structured output | stream-json: newline-delimited JSON for real-time streaming. | 明确允许。同页还要求 `--output-format stream-json` 与 `--verbose` 一起用来收流式事件 |
| [CLI reference](https://code.claude.com/docs/en/cli-reference)，`--input-format` | Specify input format for print mode (options: text, stream-json). | 明确允许。同页示例就是 `claude -p --input-format stream-json --output-format stream-json --verbose` |
| 同上，`--restricted` | Use it when an evaluation harness drives claude on a shared machine and Claude Code must not run commands or read that machine’s user and project settings. | 明确允许。官方把「harness 驱动 `claude`」写成一种用法。共享机器才需要这个受限模式；用户自己的电脑不在这句的前提里 |
| [Authentication](https://code.claude.com/docs/en/authentication)，Generate a long-lived token | For CI pipelines, scripts, or other environments where interactive browser login isn’t available, generate a one-year OAuth token with `claude setup-token`. | 明确允许。下一句写这个 token 用的是 Claude 订阅，需要 Pro、Max、Team 或 Enterprise。Helm 连 token 都不导出，比这条更窄 |
| [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions) | CLAUDE_CODE_OAUTH_TOKEN: an OAuth token that authenticates with your Claude subscription, available on Pro, Max, Team, and Enterprise plans. | 明确允许。官方 Action 可以用订阅 token 在 CI 里无人值守运行。安装流程写可「用 Claude 订阅创建长期 token」 |
| [Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)（2026-10-19） | When you're signed in with your Claude plan instead, `claude -p` and Agent SDK usage still draw from your plan's usage limits and don't use your API credits. | 明确允许。同一答还写 GitHub Action、IDE 扩展和桌面应用发起的运行算 Claude Code 用量 |

「明确允许」指的是官方程序被写成可以这么跑，包括脚本、CI、stream-json，以及 harness 去驱动未修改的 `claude`。它不包含：自己实现一个客户端，拿用户的 OAuth 去打接口。

并行和无人值守没有单独的禁止句。[Claude Code on the web](https://www.anthropic.com/news/claude-code-on-the-web)（2025-10-20）把「run multiple tasks in parallel」写成产品功能，并写云端会话与其他 Claude Code 用量共用限额。无头页写 `claude -p` 可以停在那里等后台工作。帮助中心 [Pro 或 Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)（2026-10-14）只写五小时和每周限额，没有写进程数上限。

## 执法事件

「封号」指账号被暂停或终止。「限额」指请求停在五小时、每周或 extra usage，账号还在。

| 日期 | 事件 | 处置 | 原因（来源怎么写） | 来源 |
| --- | --- | --- | --- | --- |
| 2025-07-28，8 月 28 日生效 | 官方宣布 Pro 与 Max 增加每周限额 | 限额。估计影响当时不到 5% 的订阅者。五小时限额保留。Max 可按 API 价格另购用量 | 有人把 Claude Code「continuously in the background, 24/7」跑着；个别账号在 200 美元计划上用掉数万美元模型用量。另有少数人共享、转售账号，官方写「we're taking appropriate action」 | [Anthropic 帖](https://x.com/AnthropicAI/status/1949898514844307953)；[TechCrunch](https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/) 引述邮件与帖文 |
| 2026-01-05 起用户报告，1 月 9 日官方说明 | OpenCode 等第三方工具用订阅 OAuth，并伪装 Claude Code | 先是部分账号被滥用过滤器封禁；1 月 9 日员工说已知由此造成的封禁已解除。工具侧被服务器拒绝，报凭证只允许用于 Claude Code | 第三方 harness 用订阅产生异常流量，又没有 Claude Code 的遥测；员工写这违反 Terms of Service。支持的做法是 API | [Thariq Shihipar，2026-01-09](https://x.com/trq212/status/2009689809875591565)；用户报告 [opencode#6930](https://github.com/anomalyco/opencode/issues/6930) |
| 2026-02-18 至 02-19 | 合规文档一度写：Free、Pro、Max 的 OAuth 用于任何其他产品，包括 Agent SDK，构成违反 Consumer Terms | 员工当晚说这是文档清理，Agent SDK 配 Max 的用法没有变化。当前合规页已没有「包括 Agent SDK」那句 | 文档清理造成误解。员工同时写：持有多个 Max 账号不违反条款；用多个 Max 转售 token 才违反 | [文档清理](https://x.com/trq212/status/2024212378402095389)；[多个 Max](https://x.com/trq212/status/2024230184287949207)；[The Register，2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/) |
| 2026-02-19，PR 于 2026-03-19 合并 | OpenCode 删掉内置的 Claude Pro/Max OAuth 插件和 `claude-code-20250219` 请求头 | 功能下架。维护者写 Anthropic 法务要求回应并关闭 issue | 维护者转述：条款禁止在 Claude Code 之外使用 Claude Max 订阅 | [PR #18186](https://github.com/anomalyco/opencode/pull/18186)；[issue #6930 中 thdxr 于 2026-02-19 的回复](https://github.com/anomalyco/opencode/issues/6930) |
| 2026-04-04 12:00 PT 起 | Claude 订阅不再覆盖 OpenClaw 等第三方工具 | 计费。仍可用 Claude 登录，但走 extra usage 或 API key。订阅者获一笔等于月费的一次性额度。员工于 4 月 10 日写：没有因为用 OpenClaw 而封号，更像另一个偏严的滥用分类器 | Claude Code 负责人写：订阅不是按这些第三方工具的用量模式设计的，容量优先给使用官方产品和 API 的客户。The Register 引述发言人：用订阅配合第三方工具不被条款允许，且对系统压力过大 | [Boris Cherny，2026-04-03](https://x.com/bcherny/status/2040206440556826908)；[Thariq，2026-04-10](https://x.com/trq212/status/2042628252309872782)；[The Register，2026-04-06](https://www.theregister.com/2026/04/06/anthropic_closes_door_on_subscription/) |
| 2026-05-16 | Claude Code 负责人谈额度消耗 | 限额。叫用户看 `/usage` | 少量插件或技能吃掉异常多的 token，或者并行 agent 非常多 | [Boris Cherny](https://x.com/bcherny/status/2055503100811911432) |
| 2026 上半年，2026-07-23 公布 | 透明度中心的总封号数 | 封号 1140 万；申诉 39.8 万；推翻 4.2 万 | 页面没有按 Claude Code、自动化或订阅拆开。触发范围写成 Usage Policy、Consumer Terms、Commercial Terms 或支持地区政策 | [System Trust and Reporting](https://www.anthropic.com/transparency/system-trust-reporting) |
| 2026-10-12 | 蒸馏防御说明 | 封号，常在活动开始后两小时内。反复尝试提取推理的用户先被加更严的限额 | 模型蒸馏、用代理网络在不提供服务的地区转售、虚假身份和盗用的支付方式。一个网络曾同时握有 2 万多个欺诈账号 | [Strengthening our defenses against distillation attacks](https://www.anthropic.com/research/distillation-defenses) |
| 2026-03 中至 2026-10，用户在 GitHub 自述 | 官方 CLI 用户收到「suspicious signals / violation of our Usage Policy」后账号被暂停 | 用户称是封号。Anthropic 没有在这些 issue 里确认原因 | 投稿人自己归因为并行终端、VPN、付款失败、断线重连风暴，或称只用官方网站和 IDE。这些是自述 | [#51670](https://github.com/anthropics/claude-code/issues/51670)（2026-04-21）、[#63421](https://github.com/anthropics/claude-code/issues/63421)（2026-05-28）、[#100182](https://github.com/anthropics/claude-code/issues/100182)（2026-10-07） |

未找到官方公告，把「本机未修改的 `claude -p` stream-json、个人订阅、不提取 token」写成封号原因。

## 风险与缓解

和上表相比，Helm 对得上的是 2025 年 7 月说的后台长时间运行，以及 2026 年 5 月说的并行 agent 更费额度。对不上的是 OpenCode 那类：别的程序保存 OAuth、改请求头、让服务器以为来的是 Claude Code。也对不上 OpenClaw 那类：第三方工具自己持有 Claude 登录。Helm 的请求从官方二进制出去，遥测也是那份二进制发的。Thariq 把「没有 Claude Code 遥测」写成第三方 harness 的问题。

仍有四个风险点。

1. 数小时常驻、人离开后继续跑、最多 5 个进程，会更快打到五小时和每周限额。公开对策是限额和 extra usage，不是封号。
2. 帮助中心允许 Anthropic 把「某些第三方工具」的用量改记到 usage credits。2026-04-04 对 OpenClaw 做过一次这种收窄。合规页的「未修改二进制」例外今天还在。若以后把编排器拉起官方 CLI 也收进「第三方工具」，变化会先出现在账单上。
3. 分类器会误封。员工在 2026-01-09 和 2026-04-10 都说过过滤器过严，并处理解封。GitHub 上有人在只用官方客户端时收到同样的 Usage Policy 邮件。原因没有被官方在那些 issue 里证实。
4. Consumer Terms 允许在认为违约时不经通知终止订阅，且违规终止不退款。这是一般权力。透明度报告的 1140 万没有拆出 Claude Code。

能降低风险的做法：

- 继续用 Anthropic 发布的、未修改的 `claude`。不改 User-Agent，不改 `anthropic-beta` 一类头，不在 Helm 里重放 OAuth。
- 登录只走二进制自己的 `/login`。不把钥匙串或 `CLAUDE_CODE_OAUTH_TOKEN` 读进 Helm。
- 碰到限额就停，或打开 usage credits，或把超出来的工作改成 API key，或升到 Max。不用第二个账号去绕过限额。
- 只在用户本人、用户自己的电脑上跑。不把同一份登录放进别人的机器、公开 CI 或代他人执行。
- 进程崩溃重连时做退避。不要让失败握手连着打。这一点来自用户对重连误封的自述，官方没有公布阈值。

推翻条件：Anthropic 写明「第三方进程拉起官方 `claude -p`」也算被禁止的 harness；或滥用过滤器开始把长时间、多进程的官方 CLI 会话封号，而不是只限额；或合规页删掉「终端用户登录未修改二进制」那句。`--bare` 若成为 `-p` 的默认，断的是订阅计费路径，见既有调研，不是封号。

## Codex 与 Grok

Codex。ChatGPT 条款禁止把账号凭证交给别人，也禁止自动或程序化抽取数据或输出。[Terms of Use](https://openai.com/policies/row-terms-of-use/) 的原句是 “Automatically or programmatically extract data or Output.” 官方非交互文档把另一条路写开了：需要 ChatGPT 或 Codex 的限额、而不是 API 用量时，可以在受信任的 runner 上使用 ChatGPT 管理的认证，并把 `auth.json` 当成密码，不用于公开仓库。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)。[App Server](https://learn.chatgpt.com/docs/app-server) 写：已经用 app-server 认证做了本地或开源应用的，可以继续用；这套认证从未被允许用于商业或托管服务。给别人用的应用要花计划额度，走 [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)（页面标注 2026-09-29）：请求来自用户本机或仅由该用户控制的远程运行时，并且可以是该用户明确授权的自动化和后台进程。未找到 OpenAI 官方公告，称个人在本机运行 `codex app-server` 或 `codex-acp` 会封号。开发者社区有 Pro 账号被封的自述，帖子没有把原因写成 app-server，OpenAI 也没有在帖里确认，故不列入与 Helm 对等的执法。

Grok。[Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy) 禁止 “Accessing the Services through unauthorized automated or non-human means, whether through a bot, script, or otherwise.” 同一页还禁止用 bot 访问并以此损害服务、绕过速率限制，以及转售输入或输出。「未经授权」是限定语。[Headless & Scripting](https://docs.x.ai/build/cli/headless-scripting) 把无头模式写成给脚本、bot 或其他机器友好任务，并写 `grok agent stdio` 与 `-p` 一样用于脚本、CI 和其他自动化环境。因此拉起未修改的官方 `grok` 属于文档已经写出的用法。未找到 xAI 官方公告或员工说明，称个人用 `grok agent stdio` 的本机登录会被封号。

## 没能确认的事项

- 「普通的个人使用」没有小时数或进程数。5 路并行、常驻数小时是否仍算普通，页面没有写。
- 帮助中心里「某些第三方工具可改记 usage credits」会不会在以后罩住「编排器拉起官方 CLI」。今天的合规页仍允许终端用户登录未修改二进制。
- Usage Policy 页面标注 2026-11-12 生效。本次没有把它和生效前的 PDF 逐字对照。转售、代理、谎报客户端那句，是否在今天已经独立生效，未单独核实。
- 滥用分类器的特征没有公开。并行、无人值守、重连是否单独触发封号，未找到官方阈值。
- GitHub 上官方 CLI 用户的封号自述，Anthropic 没有在对应 issue 里确认原因。
- 1140 万封号没有按产品拆分。2025 年 7 月至 12 月的报告 PDF 本次没有打开。
- 支持地区名单本次没有逐国核对。AUP 禁止向违反该政策的人提供访问；蒸馏说明里的封号包含不提供服务的地区转售。用户本机已经能 `/login` 时，没有另一条「地区导致封号」的句子。
- Codex、Grok 两侧，未找到与 2026-01-09、2026-04-04 同类的官方封号事件。
