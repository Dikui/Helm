# 任务 020：调研 agent team 相关的开源方案（只调研，不写代码）

报告 `tasks/020-report.md` 的第一行写 `session-id: <你的会话 ID>`。

## 背景

Helm 正在从 v5 改为新的设计（还没有写成文档，要点如下）。v5 的问题是把多智能体之间怎么协作都写成了事先约定的规则，实际协作是动态的，约定兜不住。新设计的方向：

- **runtime 只做三件事**：维护一块共享看板，提供协作原语，守住几道硬关口。怎么分工、怎么协作，由团队在运行时决定。
- **卡片**（即 v5 的节点）：需求、边界、测试、依赖。看板就是依赖图，也是项目状态，可以随工作增长；成员可以拆卡、提议新卡，生效前要经过"规格批准"。
- **成员**：从代理库拉起的 agent 会话，由项目负责人拉起。卡片解锁后成员可以**认领**，项目负责人也可以直接指派。
- **原语**：开卡、拆卡、认领、申请验收；信箱（发消息、广播、等消息）；升级给人。
- **硬关口**：每张卡都走"规格批准 → 执行 → 独立验证 → 人验收 → 合并"，由 runtime 强制。
- **标签保证独立性**：数据带标签，runtime 记录每个会话读过哪些标签。消息也带上发件人读过的标签，投递前检查收件人能否读取。例如卡 X 的执行方发出的消息，不能投递给 X 的验证方；两者之间只能走"提交证据"和"没通过的项"两条格式固定的专用通道。
- **执行者**：目前只有 Codex CLI，以 `codex exec` 一次性进程运行。runtime 通过 stdio 的 MCP 服务给 agent 提供接口（关闭网络时，Codex 连 localhost 也访问不了，见任务 019 S09）。
- **最大的未知数**：一个正在运行的 Codex 会话，怎么在运行途中收到别人的消息。设想的做法是 agent 下一次调用 runtime 的 MCP 工具时，把待收消息拼进返回结果。

本任务调研现有开源方案能借鉴或复用什么。**只调研，不做 Codex 实测**；实测另开任务。

**先读：**
- `FEATURES.md` 的 1.17（代理库、席位与会话）、1.20（目录约束沙箱、管理者接口走 stdio）、第 5 节（执行者接口与 Codex 适配器）
- `research/codex-sandbox-recheck.md` 的汇总表和"对 Helm 设计的影响"

## 要做的内容

### 调研对象

**A 类：克隆仓库、读代码核实**（浅克隆到 `research/scratch-020/<项目名>/`，记录 commit hash）：

1. MCP Agent Mail：`https://github.com/Dicklesworthstone/mcp_agent_mail`，以及 Rust 版 `https://github.com/Dicklesworthstone/mcp_agent_mail_rust`
2. vibe-kanban：`https://github.com/BloopAI/vibe-kanban`
3. 把 Claude Code agent teams 移植到 OpenCode 的实现：出处是 `https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol`，从文章中找到代码仓库；找不到就写明，改为只读文章
4. gnap（用 Git 仓库当任务看板的 agent 协议）：先搜到官方仓库；搜不到就写明

**B 类：只读官方文档、README 或论文**：

5. Claude Code agent teams 官方文档 `https://code.claude.com/docs/en/agent-teams`（闭源，作为参考设计）
6. Anthropic cookbook《Async multi-agent orchestration》`https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration`
7. AgentRoom 论文 `https://arxiv.org/pdf/2608.23740`
8. Kangentic、Codeg（来自 `https://github.com/andyrewlee/awesome-agent-orchestrators` 等清单）
9. MetaGPT（共享消息池 + 订阅）、AutoGen / AG2 / Microsoft Agent Framework（群聊）
10. A2A 协议、Agent Client Protocol（ACP）
11. 按信息流标签控制 agent 的研究：Microsoft FIDES、Google DeepMind CaMeL

调研中发现其他明显相关的项目，可以补充，最多再加 5 个，放入 B 类。

### 每个项目要回答的问题

1. 是什么、谁维护；许可证；活跃度（最近一次提交或发布的日期、star 数，注明查询日期）。
2. 按下面 10 项能力逐项填写"有 / 部分 / 无 / 未能确认"，并写明做法：
   - ① 共享任务清单或看板，任务之间有依赖、上游完成后自动解锁
   - ② 成员认领任务（拉取式），还是由协调者分派（推送式）
   - ③ 点对点消息
   - ④ 广播或分组
   - ⑤ **消息怎么送到正在运行的 agent**：轮询、拼进工具返回结果、续接时注入，还是别的方式。**对 Codex CLI 用的是哪种**，是否需要 agent 主动调用工具
   - ⑥ 文件冲突控制：提示性的（advisory），还是强制的；靠什么强制
   - ⑦ 人工参与：人能否旁观、插话、审批；有没有必须由人通过的关口
   - ⑧ 独立验证或信息隔离：有没有按角色或标签限制谁能看到什么
   - ⑨ 审计：消息和动作是否持久化、能否回放；存储方式
   - ⑩ 传输方式：stdio、HTTP、文件还是别的；网络关闭时能否工作
3. 对 Helm 的价值：**直接复用**（作为依赖或嵌入）/ **借鉴设计** / **无关**，附理由。直接复用的，还要说明许可证是否允许，以及和 Helm 约束的冲突（例如必须走 HTTP、需要改执行者的全局配置）。

A 类的结论要以代码为准，附文件路径和行号（基于记录的 commit）。文档里写的和代码实际行为不一致时，两者都写明。

### 判定口径

每条结论标明来源级别：**已核实（代码）**、**文档声称**、**未能确认**。不要把搜索摘要或第三方清单上的说法当作事实。

## 不要做的内容（边界）

- 不修改仓库中任何已有文件，不写 Helm 实现代码，不改 `FEATURES.md`。
- 写入范围：`research/scratch-020/`（结束时删除）、`research/agent-team-oss.md`、`evidence/020/`、`tasks/020-report.md`。
- **不运行被调研项目的代码**：不执行它们的安装脚本、`npx`、`pip install`、`cargo build`、一键安装器。MCP Agent Mail 的 Rust 版安装器会自动修改检测到的 coding agent 配置，**严禁运行**。
- 不修改 `~/.codex`、`~/.claude` 等全局配置，也不修改全局 Git 配置。
- 不调用 Codex 做实测，不启动其他 agent。
- 不发布、不提交任何内容到外部（不开 issue、不 star、不 fork）。
- 引用代码只摘录理解所需的几行，不整段复制。

## 交付物

1. `research/agent-team-oss.md`（中文）：
   - 汇总表：项目、类别（A / B）、许可证、活跃度、对 Helm 的价值；
   - 能力矩阵：项目 × 上面 10 项能力，每格写"有 / 部分 / 无 / 未能确认"，附来源级别；
   - 每个项目一节：做法说明、关键代码位置或文档链接；
   - 结尾"**对 Helm 设计的影响**"，逐条回答：
     ① 信箱：有没有能直接复用的实现；不能复用的话，数据模型（身份、线程、存储）借鉴谁；
     ② 运行中投递消息：现有方案对 Codex CLI 是怎么做的，有没有能用在"stdio MCP + `codex exec`"上的做法；
     ③ 文件冲突：有没有强制的做法，还是都只是提示；
     ④ 看板：依赖自动解锁、认领、状态流转借鉴谁；
     ⑤ 有没有按信息流标签控制可见性、可用于 agent 之间消息的实现或研究，标签怎么传播；
     ⑥ **给下一个实测任务的建议**：要测哪些用例才能确认 Codex 在运行途中能收到消息，每条写清做法和判定标准。
2. `evidence/020/`：
   - `repos.md`：克隆的仓库、URL、commit hash、克隆时间；
   - `commands.log`：执行过的主要命令；
   - 访问过的文档 URL 与访问时间。

## 验收标准

- 1–11 号对象都有结论，找不到的写明查找过程。
- A 类的每项能力结论都有代码位置（路径加行号）或明确标为"未能确认"。
- "对 Helm 设计的影响"六条都已回答，第⑥条至少给出 3 个可执行的用例。
- `research/scratch-020/` 已删除。
- `git status` 只新增 `research/agent-team-oss.md`、`evidence/020/`、`tasks/020-report.md`、`tasks/020-last-message.md` 和本任务说明（报告中附 `git status` 输出）。

## 报告要求（中文）

写到 `tasks/020-report.md`，第一行是 `session-id: <id>`。内容包括：完成情况；对 Helm 最有价值的 3 个发现；推荐直接复用或重点借鉴的项目及理由；未能确认的条目及原因；`git status` 结果；交付物路径。
