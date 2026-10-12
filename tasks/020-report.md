session-id: 01a13029-7a46-7ad2-b77a-8f5b3018d583

# 任务 020 调研报告

完成日期：2026-10-12（Asia/Shanghai）。**已完成静态调研，未做 Codex 实测、未启动其他 agent、未运行被调研项目代码。**

## 完成情况

- 覆盖任务 1–11 全部对象，分别展开 Python/Rust Agent Mail、四种群聊框架、两个协议和两项 IFC 研究；额外只补充 multi-CaMeL，合计 **19 个条目**。
- A 类浅克隆共 **7 份快照**：Agent Mail 两版、vibe-kanban、GNAP，以及 OpenCode core/tools/TUI 三个 PR 分支。URL、完整 commit、克隆时间见 evidence/020/repos.md。
- OpenCode 原文找到了三个 PR；它们均关闭且未合并，报告按作者 fork 的实际分支核实，没有当作已入上游。GNAP 官方仓库也已找到，但只有规范/文档，十项实现能力明确未能确认。
- 主文档有许可证/维护者/活跃度汇总、19×10 能力矩阵、各项目十项做法、固定 commit 路径和行号、六项 Helm 设计影响与 **8 个**建议实测用例。
- 静态检查核对 **94 个**固定 commit 文件/行号链接，无越界/缺文件；A 类每个非未知能力均有代码来源。保存官方元数据、访问 URL/时间、命令记录、少量源码摘录与结构化结论。
- 临时克隆及文档下载目录已删除；没有修改已有文件、全局配置或全局 Git 配置，没有外部发布/提交。

## 对 Helm 最有价值的三个发现

1. **“下一次工具返回夹带消息”有直接设计参照，但 Codex exec 行为仍需实测。** Anthropic cookbook 明确 drain inbox 后追加到 tool_result；Helm 只能给自己的 MCP 工具返回附加，agent 不调用 runtime 时无法保证投递延迟。Codeg 的 Codex 反馈也明确依赖主动检查，vibe-kanban 则是 app-server 的回合结束后续接。
2. **动态看板原语已有实现，硬关口仍要 Helm 自己强制。** OpenCode fork 实现依赖解锁、写锁认领、持久信箱和恢复去重；但 cancelled 满足依赖、过滤未知依赖、agent 自行 complete 等行为不符合 Helm 的验收/合并要求。其工具层从 sessionID 推导发件人身份值得借鉴。
3. **标签必须跨会话边界保留，普通消息不能洗成用户授权。** FIDES 为黑盒 LLM 输出保守继承上下文标签；CaMeL 跟踪值的来源和派生依赖。multi-CaMeL 进一步指出单个 agent 安全并不保证团队安全，需在 runtime 分开可信指令和数据通道。固定证据 schema 本身也不能自动降密；shell 读取需目录范围的保守标签或可观测接口。

这些发现的代码/文档证据及推导边界均见主文档，没有把论文实验推广成 Helm 已通过的验证。

## 推荐复用/重点借鉴

**当前不推荐原样嵌入任何完整团队 runtime。** 优先借鉴 cookbook 的 piggyback/wait、OpenCode 的动态 DAG/claim/持久后投递、FIDES/CaMeL/multi-CaMeL 的标签与安全通道；Agent Mail 的 thread、recipient/read/ack、幂等/回执数据模型有参考价值。

Agent Mail 两版当前 LICENSE 都是带 OpenAI/Anthropic Rider 的 MIT 文本，不能按普通 MIT 推荐直接依赖；对具体 Helm 使用/分发的授权适用未能确认。两版都有 stdio，不能错误地将复用障碍归因于“只有 HTTP”。Rust 安装器会检测/同步 coding agent 全局配置，本任务严禁路径没有执行。

OpenCode 是 MIT，但未合并且耦合自己的 Session/Bus/Bun；vibe-kanban、Codeg 是 Apache-2.0，但分别依赖 app-server/HTTP 工作台或 ACP companion，和当前 exec 窄接口不同；Kangentic 是 AGPL-3.0，且使用 native CLI/PTY。ACP 的 schema/SDK 可作为将来执行者接口候选，尚未确认 codex exec 适配契约，因此未列为已经可直接复用。

## 未能确认及原因

所有 Codex 运行中收信、hook/notification 模型可见性、禁网条件和 exactly-once 保证都没有在本任务实测；这是任务明确边界，不以第三方集成脚本或 UI 状态替代验证。

GNAP 没有 runtime 实现；AgentRoom 与 multi-CaMeL 未从已读论文/摘要/作者出处确认官方实现仓库、软件许可和 stars。Claude Code 是闭源，最近团队功能发布与内部投递调度未能确认。其他未知/部分能力主要因为官方资料没承诺相应机制，或源码只体现路由、提示锁、工作树、可选审批而非 Helm 的强制边界。具体缺项如下（编号对应主文档能力表）：

| 项目 | 明确标为未能确认的能力 | 原因/完整范围 |
|---|---|---|
| 1a MCP Agent Mail（Python） | 1、2 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 1b MCP Agent Mail（Rust） | 1、2 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 2 vibe-kanban | 4、8 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 3 OpenCode agent teams 移植 PR | 6 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 4 GNAP（Git-Native Agent Protocol） | 1、2、3、4、5、6、7、8、9、10 | 仓库只有规范；实现十项均无源码可核实 |
| 7 AgentRoom | 3、7 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 8a Kangentic | 4、8 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 8b Codeg | 4、8 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 9a MetaGPT | 6、7、8、9 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 9b AutoGen（Microsoft） | 1、6、8 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 9c AG2 | 1、6 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 9d Microsoft Agent Framework | 6 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 10a A2A | 4、6 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 10b Agent Client Protocol（ACP） | 1、4、6、8 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 11a Microsoft FIDES | 1、2、3、4、5、6 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 11b Google DeepMind CaMeL | 1、2、3、4、5、6、9 | 证据范围不足；每项已查出处和缺口见主文档同名节 |
| 补1 multi-CaMeL（Can CaMeLs Talk?） | 1、4、5、6、7、9 | 证据范围不足；每项已查出处和缺口见主文档同名节 |

“部分”单元还包括更细限制：vibe-kanban blocking link 的自动解锁、AG2 WAL 的具体存储介质、框架审批是否必经、ACP 是否支持忙碌时中途 prompt 等，都未被推定为“有”。下任务优先 T1/T2/T3/T6/T7，以最小 stdio 服务验证主动工具返回收信、等待竞态、无工具负对照、续接兜底和标签隔离。

## 交付物

- [主调研](../research/agent-team-oss.md)
- [仓库快照](../evidence/020/repos.md)、[命令](../evidence/020/commands.log)、[文档 URL/时间](../evidence/020/documents.md)、[精确 GET 时间](../evidence/020/urls.tsv)
- [少量源码摘录](../evidence/020/code-index.md)、[官方 API 原始响应](../evidence/020/metadata/)、[查找过程](../evidence/020/searches.md)、[静态检查结果](../evidence/020/verification.json)
- [任务最后消息](020-last-message.md)

## git status

以下为临时目录删除、交付物全部写入之后的实际 `git status --short`；已有未跟踪的任务说明为开始时已有文件。`git diff --name-only` 为空。

```text
?? evidence/020/
?? research/agent-team-oss.md
?? tasks/020-agent-team-oss-research.md
?? tasks/020-last-message.md
?? tasks/020-report.md
```
