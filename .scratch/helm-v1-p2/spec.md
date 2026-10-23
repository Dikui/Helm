# Helm v1 第二阶段

Status: ready-for-agent
Map: [Helm v1 设计](../helm-v1/map.md)

本文覆盖 [15](../helm-v1/issues/15-v1-slice.md) 定的第二阶段：Codex 驱动、模板配置（含换调度者模板）、agent CLI 主目录（订阅用默认、API 用专用）、用户级服务自启动、输出管理，最后用 2048 跑一次 Codex 调度者加两家执行者的端到端。第一版见 [第一版 spec](../helm-v1-p1/spec.md)，本文只写第二阶段的增量。术语以 [GLOSSARY.md](../../GLOSSARY.md) 为准，主目录与凭据的取舍见 [ADR 0004](../../docs/adr/0004-agent-homes-and-cli-owned-credentials.md)，订阅模板部分已由 [ADR 0005](../../docs/adr/0005-subscription-templates-use-default-cli-homes.md) 改为用默认主目录、全局配置正常进入。决策来自 2026-10-23 的 grilling，实测见 [实测单 01](issues/01-agent-home-isolation.md)、[02](issues/02-templates-skills-and-api-homes.md)。

## Problem Statement

第一版只能用 Claude，调度者和执行者各有一个写死的内置模板。用户想让 Codex 也来当调度者和执行者、两家交叉验收，想改提示词和 skills 时只能改代码，也接不上按 API 计费的第三方接口。Helm 拉起的 agent 会话记录混进了用户自己 `~/.claude/projects/` 的历史。`helmd` 要用户手动在终端里 `helm serve`，登出或重启就停。派单输出一直原样堆在 `~/.helm/` 里，没有压缩、提示、导出或删除的办法。

## Solution

Agent 模板改为 Helm 仓库模板目录里的文件，每个模板一个目录，写明角色、驱动、模型、推理强度、fast、主目录、提示词、skills 和职责说明；改了文件，下一次派单或调度轮次就用新内容，不用改代码或重启。内置四个模板：Claude、Codex 各一个调度者、一个执行者。用户在创建工作时选调度者模板，之后随时可换。

新增 Codex 驱动，每个派单、每个调度轮次各起一个 `codex app-server`。订阅模板直接用 agent CLI 的默认主目录和用户已有的登录，用户的全局配置正常进入，模板在其上按职责叠加；API 模板各用 `~/.helm/agent-homes/<模板 id>/`，用户按 CLI 自己的格式把接口和 key 写在里面，Helm 不读。`helmd` 启动时检查各模板是否可用，不可用的告诉调度者和用户原因。

`helm service install` 把 `helmd` 装成开机自动启动、崩溃自动重启的用户级服务。工作结束后输出自动压缩；总量超过阈值时提示一次；用户可以导出或删除已结束工作的原始输出。

## User Stories

**模板**

1. As a 用户, I want 在 Helm 仓库的模板目录里用文件定义 Agent 模板, so that 改提示词、skills、模型不用改代码
2. As a 用户, I want 模板文件改动从下一次派单或调度轮次起生效、不用重启 `helmd`, so that 我能边跑边调策略
3. As a 用户, I want 每次派单和调度轮次都留一份当时模板的快照, so that 事后能追溯某次派单到底用的是什么配置
4. As a 用户, I want 模板能设驱动（`claude-sdk` 或 `codex`）、模型、推理强度和 fast, so that 我能按卡片的难度和成本选执行者
5. As a 用户, I want 设了 fast 的 Claude 模板被拒绝加载并说明原因, so that Helm 不会在订阅之外悄悄计入 extra usage
6. As a 用户, I want 模板写明职责说明, so that 调度者在 `list-agent-templates` 里知道该把什么卡片派给谁
7. As a 用户, I want 每个模板在我的全局 skills 之上叠加自己的 skills, so that 不同职责的模板有各自的技能
8. As a 用户, I want 模板之间的 skills 互相看不到, so that 一个模板的技能不串到另一个模板
9. As a 用户, I want Helm 内置 Claude、Codex 各一个调度者和执行者模板, so that 不写任何配置也能用两家
10. As a 用户, I want 模板文件写错时该模板标为不可用并说明哪里错, so that 一个坏模板不会拖垮整个 `helmd`

**调度者模板**

11. As a 用户, I want 给项目设默认调度者模板, so that 新工作不用每次选
12. As a 用户, I want 创建工作时选调度者模板, so that 不同工作可以用不同的调度者
13. As a 用户, I want 工作中途换调度者模板，从下一个调度轮次起生效, so that 一家表现不好或额度用完时能换另一家
14. As a 用户, I want 换模板时记一条事件, so that 回看时知道哪一轮是谁在调度

**Codex 驱动**

15. As a 用户, I want Codex 能当执行者，在卡片副本里写代码、由 `helmd` 在派单结束后提交, so that 两家都能干活
16. As a 用户, I want Codex 能当调度者，对项目代码只读、通过 Helm 的 MCP 工具建卡派单, so that 换调度者模板时 Codex 也是一个选项
17. As a 用户, I want Codex 派单记录驱动报告的 token 用量, so that 我知道每张卡片花了多少
18. As a 用户, I want Codex 撞上限额时派单记为"额度用完"、由调度者改派, so that 一家额度用完工作不会停
19. As a 用户, I want Codex 调度轮次撞上限额时运行层暂停工作并通知我, so that 和 Claude 调度者的处理一致
20. As a 用户, I want Helm 拉起的 agent 正常读我的全局配置（设置、`CLAUDE.md` / `AGENTS.md`、hooks、插件、MCP、skills），只有硬约束、fast、自动记忆由 Helm 按会话压过, so that 不用为隔离维护专用目录（ADR 0005）

**主目录与登录**

21. As a 用户, I want 订阅模板直接用我本机 agent CLI 的默认主目录，会话记录混进我的历史也可以, so that 不用另登录、不用维护专用目录
22. As a 用户, I want Codex 订阅模板沿用我原来的登录, so that 首次使用不用多做一步
23. As a 用户, I want Claude 订阅模板沿用我原来的登录, so that 不用另登录
24. As a 用户, I want 走第三方接口的 API 模板各用一个专用主目录、接口和 key 由我按 CLI 自己的格式写在里面, so that 订阅和 API 能同时用，Helm 也不经手我的 key
25. As a 用户, I want 订阅模板和 API 模板能同时跑、互不串用登录, so that 调度者可以把不同卡片派到不同计费方式
26. As a 用户, I want Helm 不打开、不复制我的凭据文件, so that 我的登录不会因为副本失效

**可用性**

27. As a 用户, I want `helmd` 启动时检查每个模板能不能用, so that 调度者不会对一个没登录的模板反复派单失败
28. As a 调度者, I want `list-agent-templates` 标出不可用的模板和原因, so that 我只派给能用的执行者
29. As a 用户, I want 不可用的模板列进待处理事项、附上要运行的登录命令, so that 我知道该做什么
30. As a 用户, I want 补好登录或配置后，下次使用该模板前自动重新检查、不用重启, so that 修好就能用

**自启动**

31. As a 用户, I want 用 `helm service install` 把 `helmd` 装成开机自动启动的用户级服务, so that 我不用手动开终端跑 `helm serve`
32. As a 用户, I want 服务崩溃后自动重启, so that 工作不会因为一次崩溃停下
33. As a 用户, I want 安装时把当前 shell 的 `PATH` 和代理变量写进服务配置, so that 服务里也能找到 `claude`、`codex` 并联网
34. As a 用户, I want 服务日志写到 `~/.helm/logs/`, so that 出问题时有地方看

**输出管理**

35. As a 用户, I want 工作结束后它的派单输出和调度轮次输出被自动压缩、内容不丢, so that `~/.helm/` 不会涨得太快
36. As a 用户, I want 压缩后的输出照样能通过 `get-dispatch-output` 读到, so that 追查不受影响
37. As a 用户, I want 输出总量超过阈值（默认 10 GB，可调）时只提示一次, so that 我知道该清理了，又不被反复打扰
38. As a 用户, I want 把一项已结束工作的输出导出为一个 `.tar.gz`（全部输出文件加它在任务库里的记录 JSON）, so that 删除前能留一份
39. As a 用户, I want 删除一项已结束工作的原始输出，删除前提示先导出, so that 我能腾出空间又不误删
40. As a 用户, I want 删除后成果文件和代码都保留，派单和事件仍可看，输出处显示"已删除", so that 汇总报告的证据和追溯不受影响
41. As a 用户, I want Helm 从不自动删除任何输出, so that 是否删除始终由我决定

**端到端**

42. As a 用户, I want 用 2048 跑一次 Codex 调度者、Claude 和 Codex 两家执行者交叉验收的完整流程, so that 我确认第二阶段的路径全部打通

## Implementation Decisions

**模板以文件为准**

- 模板目录在 Helm 仓库里，每个模板一个目录：一个设置文件、提示词文件 `prompt.md`、可选的 `skills/`。模板 id 就是目录名。内置四个：`claude-coordinator`、`claude-executor`、`codex-coordinator`、`codex-executor`。
- 设置字段：角色（调度者 / 执行者）、驱动（`claude-sdk` / `codex`）、模型、推理强度、fast（默认关）、主目录（共用 / 模板专用）、职责说明。不做工具调整，不做额外 MCP 服务器，不在模板里写接口或 key。
- 每个调度轮次、每次派单开始时读取模板，解析结果作为快照存在派单和调度轮次上（派单已有快照列，调度轮次补上）。任务库不再存模板内容：现有的模板表和 `configure-agent-template` 操作去掉，卡片和派单对模板 id 的外键去掉，只存 id 文本。模板 id 不存在或解析失败时，该模板不可用，派单和调度轮次按"模板不可用"拒绝。
- 提示词文件只放策略。运行层约定（端口段、提交结论、进程清理、截图路径、不推送、验收前附卡片说明快照）仍由代码拼在提示词后面，不进模板；现在混在默认提示词里的这些约定要拆出来。Helm 自己的 MCP 工具、沙箱、凭据过滤也留在代码里。
- fast：Codex 驱动映射为 `service_tier="fast"`；Claude 模板设了 fast 时该模板不可用，原因写明"Claude fast 在订阅下要开 extra usage 并计入 extra usage"（实测 `fast_mode_disabled_reason: extra_usage_disabled`，只有 Opus 系列支持）。
- `list-agent-templates` 返回每个模板的 id、角色、驱动、模型、职责说明、计费方式（订阅 / API）、是否可用及原因。

**skills 按模板挂载**

- Claude：每个模板的 `skills/` 作为一个本地插件，通过 Agent SDK 的 `plugins` 选项挂上，和用户自己的、Claude Code 自带的 skills 一起可用（ADR 0005，只叠加不过滤）。
- Codex：每个 app-server 进程启动后调用 `skills/extraRoots/set`，指向这个模板的 `skills/`。Codex 自带的系统 skills、OpenAI 精选插件和用户自己的 skills（`~/.codex/skills`、`~/.agents/skills`）保留，Codex 没有按会话过滤的参数。

**调度者模板**

- 项目有一个默认调度者模板（默认 `claude-coordinator`），用户可改。创建工作时可指定调度者模板，不指定就用项目默认。
- 新增用户操作"换调度者模板"：随时可用，写入工作，记一条事件；正在跑的调度轮次不受影响，下一个调度轮次起用新模板。调度轮次不再写死 `claude-coordinator`。

**驱动按模板分派**

- `helmd` 不再只接一个调度者驱动和一个执行者驱动，改为按驱动名（`claude-sdk`、`codex`）登记驱动，派单和调度轮次按模板的驱动字段选。测试按驱动名注入假驱动。
- 驱动接口新增可用性检查：给定模板，返回可用或不可用及原因，以及用户要运行的命令（如有）。

**Codex 驱动**

- 每个派单、每个调度轮次一个 `codex app-server` 进程（[04](../helm-v1/issues/04-tech-stack.md) Q15），订阅模板不设 `CODEX_HOME`，`CODEX_SQLITE_HOME` 放在该派单或调度轮次的数据目录下。推翻条件：新 sqlite 目录的 backfill 让 `initialize` 超过约 15 秒时，改为共用进程或共用 sqlite 目录。
- 执行者 `workspace-write`，可写根为卡片副本，开网络；调度者 `read-only`。`approvalPolicy: never`。Helm MCP（带令牌的 HTTP）和转发的浏览器工具按会话配置，工具审批 `default_tools_approval_mode: approve`。环境里的 `NO_PROXY` 必须含 `127.0.0.1,localhost`：实测在没有任何代理变量时，Codex 发往本机的请求也会被拦。
- 结束判定看 `turn/completed`；token 用 `thread/tokenUsage/updated` 的 `total`；撞上限额识别为"额度用完"，按真实错误消息样本识别。执行派单结束后由 `helmd` 提交（Codex 沙箱里不能提交）。
- 续跑用 `thread/resume`，派单记下 thread id 和 sqlite 目录。

**主目录与凭据**（[ADR 0004](../../docs/adr/0004-agent-homes-and-cli-owned-credentials.md)、[ADR 0005](../../docs/adr/0005-subscription-templates-use-default-cli-homes.md)）

- 订阅模板直接用 CLI 默认主目录：驱动不设 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`（也不能显式设成默认路径，Claude 会走"自定义配置目录"分支、钥匙串对不上），登录沿用用户在终端里的登录，会话记录写进用户自己的历史。
- 用户的全局配置正常进入：Claude 订阅模板加载用户、项目、本地设置（含 `CLAUDE.md`、hooks、插件、MCP、skills）；Codex 读用户的 `config.toml`、`AGENTS.md`、hooks、skills 和插件。用户的 MCP 调度者和执行者都能用。
- Helm 按会话显式传、压过全局配置的只有：硬约束（执行者只写卡片副本、调度者对代码只读、不推送、Helm MCP 令牌，由权限检查和沙箱保证）、fast 按模板（Claude `settings.fastMode`，Codex `serviceTier`）、关掉 Claude 自动记忆。项目设置和本地设置里的放行规则或沙箱例外不能让执行者写出卡片副本，冒烟要验证；用户级沙箱例外照常生效（见 Further Notes）。
- API 模板用 `~/.helm/agent-homes/<模板 id>/`，驱动按 CLI 设 `CLAUDE_CONFIG_DIR` 或 `CODEX_HOME`。用户自己写 CLI 的配置：Claude 写 `settings.json` 的 `env`（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`），该模板的 `settingSources` 只读主目录里的用户设置；Codex 写 `config.toml` 的自定义 provider（`base_url`、`experimental_bearer_token`）。Helm 不打开这些文件。
- 计费方式由模板的主目录决定，不看 `apiKeySource`（实测 API 模板也报 `none`）。
- API 模板下的结束方式：余额不足或 key 失效记"额度用完"；429 限流由 CLI 自己重试，仍失败记"出错退出"。
- 子进程环境仍按第一版的白名单，API 模板多出主目录变量。

**可用性检查**

- `helmd` 启动时、每次派单和调度轮次用某个模板之前检查。订阅模板：由 CLI 自己报告登录状态（`claude auth status`、`codex login status`），Helm 不读凭据文件。API 模板：只查主目录和配置文件（`settings.json` 或 `config.toml`）存在。
- 不可用的模板在 `list-agent-templates` 标出原因；列进待处理事项（附登录命令）并推送"需要用户处理"事件，同一原因只推一次。派给不可用模板的派单被拒绝，返回结构化错误；调度轮次的调度者模板不可用时，运行层暂停工作并通知用户，和调度者额度用完一样处理。

**用户级服务**

- `helm service install`：macOS 写 LaunchAgent，Linux 写 systemd user unit 并提示开 lingering。服务配置里写入安装时 shell 的 `PATH` 和代理变量，开机启动、崩溃自动重启，标准输出和错误写到 `~/.helm/logs/`。环境变了就重新 install。这是本地程序命令，不经 HTTP 接口，不进操作定义。

**输出管理**

- 工作进入终态（审核被接受或工作被取消）后，把它所有派单输出和调度轮次输出压缩成 gzip，原文件删掉；读输出的操作透明解压。
- 新增设置"输出提示阈值"（默认 10 GB）。`helmd` 在压缩和派单结束时统计 `~/.helm/` 下输出总量，首次超过阈值时列进待处理事项并推送"需要用户处理"事件；降回阈值以下再超过时才再提示。
- 新增用户操作"导出输出"：只对已结束的工作，参数是目标路径，生成一个 `.tar.gz`，内含该工作的全部输出文件、成果文件，以及它在任务库里的记录 JSON（工作、工作说明各版本、卡片、派单、调度轮次、调度笔记、对话、关卡、事件）。
- 新增用户操作"删除输出"：只对已结束的工作；没有导出过时返回提示，用户确认后才删；只删派单输出和调度轮次输出的原始事件流，成果文件、任务库里的派单和事件保留，派单的输出处标"已删除"。
- 以上都是用户操作，`helm` 命令行随操作定义生成子命令。不自动删除任何东西。

## Testing Decisions

- **好测试**只经外部接口断言外部行为：HTTP 读到的状态、SSE 收到的事件、MCP 工具的返回、git 仓库和文件系统的实际状态、生成的服务配置文件。不读表、不测内部函数。
- **主边界**（沿用第一版）：测试里起一个真的 `helmd`（临时数据目录、临时 git 仓库、临时 `HOME`、临时模板目录），按驱动名注入假驱动。至少覆盖：
  - 模板：从模板目录读取；改文件后下一次派单生效、不用重启；派单和调度轮次存了快照；坏模板和设了 fast 的 Claude 模板不可用且不影响其他模板；`list-agent-templates` 的字段
  - 驱动分派：派单和调度轮次进了模板驱动字段对应的假驱动
  - 调度者模板：项目默认、创建时指定、中途更换从下一个调度轮次生效并记事件、正在跑的轮次不受影响
  - 可用性：假驱动按脚本报不可用时，模板标原因、进待处理事项、推一次事件、派单被拒；调度者模板不可用时工作被暂停；补好后不用重启即恢复
  - 主目录：订阅模板的会话环境里没有 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`；API 模板指向 `~/.helm/agent-homes/<模板 id>/`
  - 额度用完：Codex 执行派单以"额度用完"结束时调度者被唤醒改派；Codex 调度轮次额度用完时工作暂停
  - 输出管理：工作结束后输出变为 gzip 且 `get-dispatch-output` 读到原内容；阈值调小后只提示一次、降回再超过时再提示；导出的 `.tar.gz` 内容完整；未导出时删除返回提示；删除后成果仍可读、输出处为"已删除"；未结束的工作不能导出或删除
- **副边界**（沿用第一版）：驱动接口。
  - 单元测试：仿照现有 Claude 驱动测试注入假 `query` 的做法，给 Codex 驱动注入一个按脚本回放 JSON-RPC 的假 app-server，测结束方式、token、额度用完识别（真实错误消息样本作固定输入）、`skills/extraRoots/set` 调用、沙箱和 MCP 配置、`NO_PROXY`、fast 映射。Claude 驱动补测：主目录变量、skills 插件挂载和 `skills` 列表、API 模板的 `settingSources`、额度用完识别的错误消息样本。
  - 真 CLI 冒烟：并入沙箱外的 `npm run test:real`，用消耗小的模型、低推理强度。Codex 的验收项为原 14 技术验证：① 按会话加载带令牌的 HTTP MCP，调度者能建卡、派单、改依赖，"提交结论"和转发的浏览器工具在同一端点工作；② 重投时靠 `key` 不重复；③ Codex 调度者 `read-only` 生效，执行者副本外写入被拦；⑥ MCP 工具审批和 `NO_PROXY` 对调度者同样生效。另测 token 记录、结束方式、模板之间 skills 隔离、续跑。Claude 用默认主目录重跑第一版的冒烟，并验证项目设置里的宽松放行规则不能让执行者写出卡片副本、全局 fast 被模板压过。API 模板不做真实接口冒烟。
- **新边界**：`helm` 命令行进程，只测 `helm service install`。在临时 `HOME` 下运行编好的 `helm`，`PATH` 里放 `launchctl`、`systemctl` 的替身，断言生成的 plist 或 unit 内容（`PATH` 和代理变量、开机启动、崩溃重启、日志路径）和替身收到的参数。真正装进系统在 2048 端到端前手动做一次。
- **浏览器**：同第一版，起真实浏览器的测试不在沙箱里跑，用 Playwright 自带的 Chrome for Testing 有界面模式，验收时看截图。
- **端到端验收**（不是测试边界）：网页版 2048，Codex 调度者，执行者 Claude 和 Codex 都有、两家交叉验收，含浏览器验收，用真实驱动跑一次完整流程；用 `helm service install` 起的服务跑；消耗小的模型、低推理强度、不开 fast。
- **先例**：主边界见现有 `helmd`、派单、调度轮次、对账等测试；驱动单元测试见 Claude 驱动测试；真实冒烟见 `real-smoke-runner` 和 Claude 执行者、调度者的 real 测试；Codex app-server 的用法见未提交的实测脚本 `.scratch/prototype/helm-drivers/`（codex、home、coexist、skills），不作为测试复用。

## Out of Scope

- **第三阶段**：界面（前置条件是用户的前端设计）、Grok 和 DeepSeek 的 ACP 驱动、界面做完后再跑一次 2048。第一版的 [修复单 06](../helm-v1-p1-fixes/issues/06-rerun-2048-e2e.md)（重跑 2048）也推到第三阶段。
- 模板里的工具调整、额外 MCP 服务器、由 Helm 注入的接口和 key。
- API 模板的真实接口冒烟和验收。
- 隐藏 Codex 自带的系统 skills 和 OpenAI 精选插件。
- Claude 模板开 fast。
- 自动删除输出、按天数提示。
- 调度者能力（A1、A2）的验证和调度者技能：用户在 Helm 之外另做。
- 第一版 Out of Scope 里其余各项（外层隔离、用户接口认证、系统通知、回放播放器等）仍不做。

## Further Notes

- 所有实测都在 macOS 上做；Linux 的 systemd user unit 照写但未实测。
- Codex 的 `experimental_bearer_token` 名字带 experimental，升级后可能失效；失效时 API 模板派单会"出错退出"。
- 已接受的风险：执行者能在沙箱里 `echo` 出环境变量，API 模板的 key 可能出现在派单输出和导出的 `.tar.gz` 里；Codex 订阅模板读用户的个人配置、`AGENTS.md`、skills 和插件（ADR 0005）；用户级 Claude 设置里的 `sandbox.filesystem.allowWrite` 和 `sandbox.excludedCommands` 对执行者同样生效，CLI 不支持按会话覆盖（ADR 0005）。
- Codex 发往本机的请求在没有代理变量时也被拦，原因（系统代理设置还是测试会话的沙箱）未分辨；以 `NO_PROXY` 为准。
- 开发测试用真实驱动时一律用消耗小的模型、调低推理强度、不开 fast。
- 开发任务单放在 [issues/](issues/)，从 03 起编号（01、02 是实测单）。
