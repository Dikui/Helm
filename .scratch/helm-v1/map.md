# Helm v1 设计

Labels: wayfinder:map

## Destination

Helm v1 的设计定稿，并拆出可以直接开发的任务单。开发不在这张地图里，交接给执行阶段（`/to-tickets` → `/implement`）。

## Direction

选定方向：M 调度交给模型 + 薄运行层（类别：交给模型）；不保留多个方向。

## Notes

**领域**：个人使用的多 agent 编排器。v1 的第一个工作类型是"做软件项目"。

**动机**：现在靠 Claude Code + `~/.claude/CLAUDE.md` 调度太原始：没法监控，不直观，编排写死了，隔离等多 agent 的好处都没有。

**期望流程**：用户和调度者对齐出工作说明（需求、边界、标准）→ 调度者拆成卡片（拆法和卡片间依赖由调度者定）→ 执行者在隔离环境里并行执行 → 汇总报告交给用户审核验收。

**成功标准**（可检查）：
1. 用户只在三种场合出场：对齐工作说明、回答调度者提出的决策关卡、审核。不用盯终端，也不用主动查进度。
2. 在一个界面里能看到每张卡片的状态、谁在做、做到哪一步。
3. 最多 10 个执行者派单（执行派单和验收派单都算，调度者会话不计）同时在各自的隔离环境里执行，互不干扰；上限是全局的，用户可以调整。
4. 拆法和卡片间依赖由调度者决定，运行层强制依赖；用户可以中途通过消息修改卡片图和卡片，也能直接暂停或取消卡片。
5. 汇总报告写清每张卡片的结果、验收是否通过、由谁完成；任何问题都能追溯到具体的 agent 和步骤。
6. 在"做软件项目"上完整跑一次，比现在手动调度省心（由用户判断）。

**持续运行**：用户离开时，靠本机或服务器上的后台进程继续跑；不要求关机后继续。为了不交互、让代理持续运行，执行方式需要专门设计（用户在 Q15 补充）。

**反目标**：用户仍得盯着终端；出了问题说不清是谁、在哪一步；为了通用，什么都支持一点，却没有一个比现在好用。多花时间或额度不算失败。

**边界**：先独立做，保留以后接入 Olympus 的能力（Olympus 架构：`/Users/dikui/Project/Olympus/docs/architecture/ai-workbench-architecture.html`）。

**"薄运行层"的含义**：运行层只做防 agent 本身的硬约束和记录（任务库、依赖检查、并发上限、worktree、在新上下文里验收、事件记录、唤醒调度者、对外接口）。拆单、选执行者、排序、返工、写报告都交给调度者，写在提示词和技能里。

**方向假设**（不保留多个方向，仍需实测）：
- A1：调度者按需唤醒。有新需求、执行者完成或失败、用户改计划时，由运行层唤醒；一项工作从开始到审核结束期间常驻，结束后退出；按工作类型加载不同技能。常驻期间能凭任务库稳定地拆单、派单、处理返工。→ [14](issues/14-coordinator-trial.md)。**06 修订**：不再常驻，改为任务型：每次唤醒新开 CLI 会话（调度轮次），读启动简报和调度笔记，处理完退出；推翻 01 的长时对话，采用 17 的"短回合"（不在对齐阶段续跑）。跨轮次不失忆待 14 实测。→ [06](issues/06-coordinator-lifecycle.md)、[17](issues/17-coordinator-runtime-form-research.md)
- A2：调度者崩溃或上下文满了，开一个新会话、读任务库就能接着干。用户认可。→ [14](issues/14-coordinator-trial.md)
- A3：调度者能用订阅额度运行，不必按 API 计费。用户认可。**已验证**（03，限个人自用、官方程序）；04 修订：Claude 改用 Agent SDK（指向本机 `claude`），Codex 用 `codex app-server`，其余走 ACP，都由用户自己登录、Helm 不碰凭证；[22](issues/22-driver-and-subscription-trial.md) 实测 Claude SDK `apiKeySource: none`、Codex 为 ChatGPT 登录，未看用量条。→ [03](issues/03-subscription-billing.md)
- A4：git worktree 加上执行者自带的沙箱参数，隔离就足够了。用户认可。**已证伪**（02）：只能隔开工作副本。08 决定不加外层边界，改为强制打开各家自带的沙箱，只允许写卡片副本；Grok 的 `GROK_SANDBOX` 和 Claude 的 SDK 沙箱已实测有效。→ [02](issues/02-unattended-executors.md)、[08](issues/08-isolation-and-merge.md)

**接入范围**：以后要接入市面上大多数 coding agent（pi、DeepSeek Harness、Qoder、zcode……），不只 Codex、Claude Code、Grok（用户在 04 补充）。

**本次使用的技能**：grilling 类任务用 `/grilling` + `/domain-modeling`；界面用 `/prototype` 或 `/mockup`；research 按 `~/.claude/CLAUDE.md` 派 Grok，结论写到 `docs/research/`。

**偏好**：信任调度者，少写规则。只有防 agent 本身的事才做成硬约束，其余作为参考写进调度者的提示词，靠记录和回放让用户看得见。

**本地图不包含实际交付。**

**已有调研**：[参考项目对比](../../docs/research/helm-substrates.md)（底座调研）；参考项目功能对比见会话记录（Orca、orka、devteam skill、codex/grok plugin-cc、JAgents、dsh、open-grokbot、Software Factory）。

**冲突复核**（2026-10-22）：逐条处理了任务单之间的冲突，结论记在各单评论里：调度者不能暂停卡片，改用撤销派单加关卡依赖（07、10）；验收派单永远开新对话，没正常完成过执行派单的卡片不能标完成（07、09）；卡片状态推导顺序（05）；派单输出不精简、只压缩（01、11）；Claude 保留 Agent SDK（04）；隔离由 08 从头讨论；驱动与订阅实测拆成 [22](issues/22-driver-and-subscription-trial.md)，排在 06 之前；第一版先打通一种驱动（15）。

## Decisions so far

- [核心概念与术语](issues/01-core-concepts.md) — 项目 ⊃ 工作 ⊃ 卡片图 ⊃ 卡片 ⊃ 派单；对齐出工作说明（需求、边界、标准）；Agent 模板实例化为调度者（每项工作一个，06 改为任务型）和执行者；术语见 [GLOSSARY.md](../../GLOSSARY.md)
- [执行者无人值守运行方式](issues/02-unattended-executors.md) — 三者都能无头运行，卡住由运行层外部看门狗（超时、无输出）兜底，再续跑或改派；A4 被推翻，worktree 只隔开工作副本，需要外层边界
- [调度者能否用订阅额度运行](issues/03-subscription-billing.md) — A3 支持（限个人自用）：调度者和执行者都通过用户自己登录的官方 CLI 拉起，不代持凭证（"不嵌 SDK"已被 04 修订）
- [其他产品怎样处理派单结果、成果与实时状态](issues/16-results-and-outputs-research.md) — 支持"短结果交回、成果另存、进程状态由系统维护"；交回的应是执行者的完整最终回答，"缺信息"需要单独表达
- [调度者运行形态：长时会话还是持久化执行](issues/17-coordinator-runtime-form-research.md) — "pi durable" 是走 API key 的 Pi Durable，不适用；倾向短回合：被唤醒→读任务库→做一轮→退出，运行层给派单加幂等键（06 最终采用，每轮都新开）
- [参考产品的技术栈与运行层结构](issues/18-reference-runtime-stack-research.md) — 带运行层的参考产品多为 TS/Node；常见形态是"本地 HTTP 服务 + 普通子进程 + SQLite + SSE"；无头执行者都用普通 spawn 加进程组超时，重启后不接管、按 session id 续跑；只有 Orca 做了 LaunchAgent / systemd user 自启动
- [怎样以非终端方式与 CLI 交互，以及更多同类产品的做法](issues/19-interactive-drive-and-landscape-research.md) — 界面内对话走常驻协议进程（Codex app-server、Claude stream-json、Grok ACP），不用 PTY/tmux；执行者默认一次性 spawn（已被 04 推翻，见单内评论）；TS/Node、单运行层、SQLite、SSE 在 11 个新增产品里仍成立
- [ACP 能否作为接入各家 agent CLI 的统一通道](issues/20-acp-coverage-research.md) — 能：registry 43 家，pi/Qoder/DeepSeek Harness/Gemini 等原生或经适配器支持；v1 稳定覆盖多轮、一轮派单、取消、cwd/MCP 注入，权限由运行层代答；不覆盖中途追加和套餐额度；zcode 无 ACP（终端版见 21）
- [经 ACP 或其他非原生方式接入时，订阅套餐是否仍然有效](issues/21-subscription-via-acp-research.md) — 订阅取决于"直接拉起厂商的未修改程序 + 环境里没有压过订阅的 key"，与是否 ACP 无关；Claude 直接用 `claude` stream-json（ACP 适配器灰色；04 改为 Agent SDK 指向本机 `claude`，待 22 实测），Codex 直接用 `codex app-server`，Grok 用 `grok agent stdio`；GLM 用 Claude Code + 智谱端点或 `zcode --prompt --json`；DeepSeek 按量用 key；pi 只给 API key；封号风险低，撞限额要停不能换号绕过
- [技术栈与进程结构](issues/04-tech-stack.md) — TS/Node；每台机器一个 `helmd`（运行层，只监听本机），调度者每次唤醒一个会话（06 改为任务型）、执行者每次派单一个会话，都由管道拉起官方程序；驱动同 Todos：Claude 用 Agent SDK、Codex 用 app-server、其余走 ACP、一次性命令兜底；SQLite `~/.helm/`、React+Vite+SSE、用户级服务自启动、clone+`npm link`；v1 实测 Claude Code、Codex、Grok、DeepSeek
- [任务库数据模型与状态](issues/05-task-store-model.md) — 状态表+事件表同事务写，事件记执行者，步骤为库外输出的序号；每项工作一条对话（消息不可改 + 决策关卡单独成实体，确认工作说明和审核是固定关卡，审核正文即汇总报告）；卡片完成由调度者标记、需验收的须先通过，完成为终态、返工建修复卡片；依赖到位后才派单，不预派
- [驱动与订阅实测](issues/22-driver-and-subscription-trial.md) — 04 的驱动选择不变：Claude SDK 走本机登录、Codex 只改 sqlite 目录仍是 ChatGPT 登录且能续跑、一个 app-server 10 个 thread 真并行、Grok ACP 可取消和续跑；推翻一条：Codex `workspace-write` 下不能提交（交 08）；Grok 权限跟随用户全局配置，`allow_always` 按 cwd 落盘（交 07）；DeepSeek 默认路线要 API key，账号登录要选 `deepseek-account` 路线，只能 resume 不能 load
- [调度者生命周期](issues/06-coordinator-lifecycle.md) — 任务型：每次唤醒新开 CLI 会话（调度轮次），读运行层拼的启动简报（工作说明、卡片摘要、未决关卡、调度笔记、新事件、最近 20 条对话）处理完退出；事件排队合并投递，用户可打断；轮内靠 CLI 自动压缩兜底；失败重投，连败 3 次暂停；Claude Code、Codex 两个调度者模板，官方默认配置、不读本机全局配置（复查后执行者同样）
- [运行层硬约束与调度者工具集](issues/07-hard-constraints-and-tools.md) — 违规当场返回结构化错误并记事件；`helmd` 本机 HTTP MCP、按轮次发令牌限定所属工作（待 14 实测）；新建类工具带 `key` 去重；没正常完成过任何派单的卡片不能标完成；调度者对代码只读、执行者无 Helm 工具；补齐依赖、派单（每卡最多一个活动派单）、凭据、权限代答约束；对外动作与 Grok 全局放行交 08
- [隔离与合并](issues/08-isolation-and-merge.md) — 不加外层边界，helmd 强制打开各家自带的沙箱，只允许写卡片副本（Grok 设 `GROK_SANDBOX=workspace`，实测能压过全局 always-approve）；工作分支从基准 ref 开出，每张卡片一个 worktree，helmd 在派单结束后提交；卡片副本在第一次派单时开出；标记完成即 `--no-ff` 合进工作分支，冲突时拒绝、由修复卡片解决；调度者读 `_work`；审核被接受后 helmd 用 `git merge-tree` 预检、无冲突才合并到基准分支并推送，执行者的推送被拦；终态时删除副本和卡片分支

## Not yet specified

- 额度和成本：要不要在派单前看额度，额度用完时自动改派替补，按工作统计花费。已知（04、20、21）：ACP 读不到任何一家的套餐额度，只有 Codex app-server 能读；倾向撞上了再改派到别家，不能换同一家的第二个账号。
- 通知：需要审核或决策时，怎么通知用户（界面、系统通知、飞书……）。

## Out of scope

- 软件项目以外的工作类型：v1 只做"做软件项目"（Q11）。
- 关机后继续运行：只要求后台进程在时持续运行（Q13）。
- 基于 Orca 开发（方向 O，暂不采用）：依赖不是硬约束，没有对外 API，编排仍在实验阶段，运行时状态是全局的；worker 是交互式终端会话，无人值守时可能卡在提示上。重新考虑的条件：Orca 支持无头 worker，并提供稳定的对外 API。
- 执行者外层隔离（Seatbelt 外壳、独立系统用户、容器或 VM）：v1 只用各家自带的沙箱，外层方案会让执行者读不到订阅登录（[08](issues/08-isolation-and-merge.md)）。重新考虑的条件：出现越界事故，或要跑不可信的仓库。
- 固定工作流引擎（方向 W，暂不采用）：流程和分支写死在代码里，正是用户要摆脱的"编排写死"。重新考虑的条件：A1 实测不成立，调度者无法稳定地按任务库推进。固定流程以后可以做成模板，当作工具交给调度者调用。

## Global checks

- 已解决 5、10 张时（2026-10-22，一次覆盖）：见 Notes 的"冲突复核"，结论记在各单评论里。
- 已解决 15 张时（2026-10-22）：冲突 2 项、风险 4 项，均已决定。冲突：整体验收卡片因"没执行过不能完成"永远标不了完成 → 放宽为"没正常完成过任何派单"，副本改在第一次派单时建；04、07 正文过时 → 补修订。风险：验收通过后再改代码旧"通过"仍算数 → 改动一律走新卡片，08 的冲突处理改为修复卡片，不加约束；审核接受后合进基准分支会碰用户工作目录 → `git merge-tree` 预检，按是否检出分别合并，失败只报告；执行者读用户全局配置 → 执行者也只用模板配置，Codex、Grok 能否做到交 14；Claude 只读和越界拦截有漏洞 → 执行者固定 `permissionMode: 'default'`，调度者靠沙箱或去掉 Bash。改写：[04](issues/04-tech-stack.md)、[05](issues/05-task-store-model.md)、[06](issues/06-coordinator-lifecycle.md)、[07](issues/07-hard-constraints-and-tools.md)、[08](issues/08-isolation-and-merge.md)、[09](issues/09-acceptance.md)、[10](issues/10-human-touchpoints.md)、[14](issues/14-coordinator-trial.md)，以及 GLOSSARY、ADR 0003。
