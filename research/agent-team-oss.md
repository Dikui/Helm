# Agent team 开源方案调研（任务 020）

查询日期：**2026-10-12（Asia/Shanghai）**；原始访问时间用 UTC ISO-8601 保存于 [urls.tsv](../evidence/020/urls.tsv)。只静态阅读源码、官方文档/README、论文；没有安装依赖、执行被调研代码、Codex 实测或启动其他 agent。

已先读 `FEATURES.md` 1.17、1.20、第5节，以及 `research/codex-sandbox-recheck.md` 汇总和设计影响。以下以本任务的新设计为目标：runtime 维护共享卡片图、协作原语与硬关口；会话身份由 runtime 绑定，接口走 stdio MCP；执行/验证不能经普通消息互相污染。网络关闭包括 localhost 的依据来自任务019 S09；它不证明任意 stdio 子进程都自动具有完整的沙箱配置。

**主要结论：没有核实到可原样嵌入且满足全部 Helm 约束的团队 runtime。** 信箱/看板与信息流控制分属不同方案。Anthropic cookbook 展示了下一工具返回夹带消息，OpenCode fork 展示了依赖图/认领/持久信箱，FIDES/CaMeL 提供保守标签传播依据。它们都不能替代下一任务对 `codex exec` 的收信实测。

## 证据与判定口径

- **已核实（代码）**：只表示记录 commit 上的静态实现已读，不表示运行测试通过；路径/行号链接固定到该 commit。
- **文档声称**：官方 README/产品文档/论文明确描述；B 类不读实现。许可证和活跃度以官方 LICENSE/README、GitHub API 为证据，不用第三方摘要作事实。
- **未能确认**：没有证据、范围不足或来源没承诺；不以“没搜到”推出绝对不存在。
- **有/部分/无**：按本任务的复合能力判断。“部分”注明缺失部分；①只有普通看板而没解锁不算“有”，⑥工作树/claim 也不等于 OS 强制锁，⑨保存 transcript 不等于确定性重放。
- 矩阵中 `〈代码〉` = **已核实（代码）**，`〈文档〉` = **文档声称**，`〈未知〉` = **未能确认**。每格的具体范围/证据见该项目十项表。B 类“无”仅用于官方样例明确不实现的功能。
- GNAP 虽按 A 类浅克隆，当前快照是规范/文档，没有可执行 runtime：能力实现均未能确认，规范内容另标文档声称。OpenCode 的三个 PR 分别克隆，各用各自 commit；未将未合并 PR 当作上游功能。

快照清单见 [repos.md](../evidence/020/repos.md)，少量源码摘录见 [code-index.md](../evidence/020/code-index.md)，API 原始响应见 [metadata/](../evidence/020/metadata/)，查找过程见 [searches.md](../evidence/020/searches.md)。scratch 删除后，固定 GitHub blob 链接与本地索引仍可核对。

## 汇总表

活跃度是查询时默认分支最新提交时间（UTC）与精确 stars；OpenCode 移植用作者 fork 的 tools 分支时间、fork stars。父项目/产品的活跃不能证明单一样例或功能的活跃。论文只有上传时间，stars 不用虚构为 0。许可证复用判断仅限文本约束，未推定 Helm 的未来分发方式。

| 项目 | 类别 | 许可证 | 活跃度（查询 2026-10-12） | 对 Helm 的价值 |
|---|---|---|---|---|

| 1a MCP Agent Mail（Python） | A | MIT + OpenAI/Anthropic Rider（非普通 MIT） | 最近提交 2026-10-08T19:42:01Z；★ 2203；[API](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail)/[提交](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail/commits?per_page=1) | 借鉴设计；信箱模型，许可证有限制 |
| 1b MCP Agent Mail（Rust） | A | MIT + OpenAI/Anthropic Rider（非普通 MIT） | 最近提交 2026-10-12T12:10:50Z；★ 191；[API](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail_rust)/[提交](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail_rust/commits?per_page=1) | 借鉴设计；回执/幂等，许可证有限制 |
| 2 vibe-kanban | A | Apache-2.0 | 最近提交 2026-09-19T06:51:27Z；★ 28335；[API](https://api.github.com/repos/BloopAI/vibe-kanban)/[提交](https://api.github.com/repos/BloopAI/vibe-kanban/commits?per_page=1) | 借鉴设计；审批与工作区分层 |
| 3 OpenCode agent teams 移植 PR | A | MIT | 最近提交 2026-02-10T23:18:16Z；★ 3；[API](https://api.github.com/repos/ugoenyioha/opencode)/[提交](https://api.github.com/repos/ugoenyioha/opencode/commits?sha=feature/team-tools&per_page=1) | 借鉴设计；动态 DAG/claim，未合并 |
| 4 GNAP（Git-Native Agent Protocol） | A | MIT | 最近提交 2026-03-17T21:12:21Z；★ 86；[API](https://api.github.com/repos/farol-team/gnap)/[提交](https://api.github.com/repos/farol-team/gnap/commits?per_page=1) | 借鉴设计；四实体，只有规范 |
| 5 Claude Code agent teams | B | 闭源；文档不是软件开源许可 | 闭源；团队最近发布未能确认；★ 不适用 | 借鉴设计；闭源参考，动态团队 |
| 6 Anthropic Async multi-agent orchestration | B | MIT（cookbooks；SDK另查依赖许可） | 最近提交 2026-10-10T09:24:54Z；★ 53371；[API](https://api.github.com/repos/anthropics/claude-cookbooks)/[提交](https://api.github.com/repos/anthropics/claude-cookbooks/commits?per_page=1) | 借鉴设计；工具返回夹带消息 |
| 7 AgentRoom | B | 论文 CC-BY-4.0；实现软件许可未能确认 | arXiv v1 2026-08-24；代码仓库/★ 未能确认 | 借鉴设计；小原语与 advisory 实验 |
| 8a Kangentic | B | AGPL-3.0 | 最近提交 2026-10-12T02:59:52Z；★ 127；[API](https://api.github.com/repos/Kangentic/kangentic)/[提交](https://api.github.com/repos/Kangentic/kangentic/commits?per_page=1) | 借鉴设计；终端旁观/消息来源边界 |
| 8b Codeg | B | Apache-2.0 | 最近提交 2026-10-11T03:37:59Z；★ 3916；[API](https://api.github.com/repos/spacering-net/codeg)/[提交](https://api.github.com/repos/spacering-net/codeg/commits?per_page=1) | 借鉴设计；Codex 主动反馈检查 |
| 9a MetaGPT | B | MIT | 最近提交 2026-01-21T10:12:32Z；★ 70818；[API](https://api.github.com/repos/FoundationAgents/MetaGPT)/[提交](https://api.github.com/repos/FoundationAgents/MetaGPT/commits?per_page=1) | 借鉴设计；结构化订阅路由 |
| 9b AutoGen（Microsoft） | B | 代码 MIT；文档 CC-BY-4.0 | 最近提交 2026-04-06T22:35:32Z；★ 61375；[API](https://api.github.com/repos/microsoft/autogen)/[提交](https://api.github.com/repos/microsoft/autogen/commits?per_page=1) | 借鉴设计；typed message/状态，维护模式 |
| 9c AG2 | B | Apache-2.0；原继承代码保留 MIT 归属 | 最近提交 2026-10-11T09:12:50Z；★ 4991；[API](https://api.github.com/repos/ag2ai/ag2)/[提交](https://api.github.com/repos/ag2ai/ag2/commits?per_page=1) | 借鉴设计；HubArbiter/WAL/视图 |
| 9d Microsoft Agent Framework | B | MIT | 最近提交 2026-10-12T12:13:49Z；★ 14076；[API](https://api.github.com/repos/microsoft/agent-framework)/[提交](https://api.github.com/repos/microsoft/agent-framework/commits?per_page=1) | 借鉴设计；FIDES middleware/恢复 |
| 10a A2A | B | Apache-2.0 | 最近提交 2026-10-12T09:23:29Z；★ 26119；[API](https://api.github.com/repos/a2aproject/A2A)/[提交](https://api.github.com/repos/a2aproject/A2A/commits?per_page=1) | 借鉴设计；远程 Task/context；当前适配价值低 |
| 10b Agent Client Protocol（ACP） | B | Apache-2.0 | 最近提交 2026-10-12T11:38:56Z；★ 4417；[API](https://api.github.com/repos/agentclientprotocol/agent-client-protocol)/[提交](https://api.github.com/repos/agentclientprotocol/agent-client-protocol/commits?per_page=1) | 借鉴设计；执行者会话协议；将来 SDK 候选 |
| 11a Microsoft FIDES | B | MIT（教程仓库） | 最近提交 2025-05-30T16:17:45Z；★ 120；[API](https://api.github.com/repos/microsoft/fides)/[提交](https://api.github.com/repos/microsoft/fides/commits?per_page=1) | 借鉴设计；上下文标签保守传播 |
| 11b Google DeepMind CaMeL | B | Apache-2.0（实现仓库） | 最近提交 2025-06-20T13:59:27Z；★ 404；[API](https://api.github.com/repos/google-research/camel-prompt-injection)/[提交](https://api.github.com/repos/google-research/camel-prompt-injection/commits?per_page=1) | 借鉴设计；可信控制/不可信数据分开 |
| 补1 multi-CaMeL（Can CaMeLs Talk?） | B | 论文 CC-BY-4.0；代码许可/仓库未能确认 | arXiv v1 2026-10-05；代码仓库/★ 未能确认 | 借鉴设计；跨 agent 保留来源与能力 |

## 能力矩阵

| 项目 | ① | ② | ③ | ④ | ⑤ | ⑥ | ⑦ | ⑧ | ⑨ | ⑩ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1a MCP Agent Mail（Python） | 未能确认〈未知〉 | 未能确认〈未知〉 | 有〈代码〉 | 有〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 有〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 有〈代码〉 |
| 1b MCP Agent Mail（Rust） | 未能确认〈未知〉 | 未能确认〈未知〉 | 有〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 有〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 有〈代码〉 |
| 2 vibe-kanban | 部分〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 未能确认〈未知〉 | 部分〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 未能确认〈未知〉 | 部分〈代码〉 | 部分〈代码〉 |
| 3 OpenCode agent teams 移植 PR | 有〈代码〉 | 有〈代码〉 | 有〈代码〉 | 有〈代码〉 | 有〈代码〉 | 未能确认〈未知〉 | 部分〈代码〉 | 部分〈代码〉 | 部分〈代码〉 | 部分〈代码〉 |
| 4 GNAP（Git-Native Agent Protocol） | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 |
| 5 Claude Code agent teams | 有〈文档〉 | 有〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 6 Anthropic Async multi-agent orchestration | 无〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 有〈文档〉 | 有〈文档〉 | 无〈文档〉 | 部分〈文档〉 | 无〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 7 AgentRoom | 部分〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 有〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 8a Kangentic | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 |
| 8b Codeg | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 |
| 9a MetaGPT | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 部分〈文档〉 |
| 9b AutoGen（Microsoft） | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 |
| 9c AG2 | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 部分〈文档〉 |
| 9d Microsoft Agent Framework | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 有〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 10a A2A | 部分〈文档〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 10b Agent Client Protocol（ACP） | 未能确认〈未知〉 | 部分〈文档〉 | 部分〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 未能确认〈未知〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 |
| 11a Microsoft FIDES | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 | 部分〈文档〉 | 部分〈文档〉 |
| 11b Google DeepMind CaMeL | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 |
| 补1 multi-CaMeL（Can CaMeLs Talk?） | 未能确认〈未知〉 | 部分〈文档〉 | 有〈文档〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 未能确认〈未知〉 | 有〈文档〉 | 未能确认〈未知〉 | 部分〈文档〉 |

①共享任务及依赖自动解锁；②拉取认领/推送分派；③点对点；④广播/分组；⑤投递正在运行的 agent（尤其 Codex）；⑥文件冲突；⑦人参与/关口；⑧独立验证/信息隔离；⑨持久审计/回放；⑩传输与禁网。⑤“有”只说明该项目自身 agent，不能跨执行者类推。


## 1a MCP Agent Mail（Python）（A）

Jeffrey Emanuel（Dicklesworthstone）维护的项目内异步信箱、线程、文件预约服务。当前 LICENSE 的附加限制优先于 MIT 正文；GitHub API 也只识别为 NOASSERTION。[LICENSE:1–44](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/LICENSE#L1-L44)

维护/许可与活跃度：MIT + OpenAI/Anthropic Rider（非普通 MIT）；最近提交 2026-10-08T19:42:01Z；★ 2203（2026-10-12 查询；[官方仓库](https://github.com/Dicklesworthstone/mcp_agent_mail)、[元数据](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail)、[提交](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 未找到任务依赖图与自动解锁实现；Message、FileReservation 是通信/预约模型，不能当作任务卡。 |
| ② 认领/分派 | 未能确认 | 未能确认 | register_agent 注册身份，并不是原子认领任务。未核实任务认领/分派 API。 |
| ③ 点对点 | 有 | 已核实（代码） | send_message 的 sender、to/cc/bcc、thread_id 支持定向通信；[src/mcp_agent_mail/app.py:7132–7149](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L7132-L7149)。身份不是单纯相信名字：fetch_inbox 还验证注册 token/会话。[src/mcp_agent_mail/app.py:9667–9684](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L9667-L9684) |
| ④ 广播/分组 | 有 | 已核实（代码） | broadcast=true 展开项目内成员，按 contact_policy 最佳努力过滤并报告跳过者；不是无条件送达。[src/mcp_agent_mail/app.py:7306–7339](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L7306-L7339)、[src/mcp_agent_mail/app.py:7876–7887](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L7876-L7887) |
| ⑤ 运行中投递 | 部分 | 已核实（代码） | 核心是 agent 主动 fetch_inbox（默认不带正文），也有返回 inbox 的启动/线程宏。[src/mcp_agent_mail/app.py:9592–9604](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L9592-L9604)、[src/mcp_agent_mail/app.py:10067–10084](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L10067-L10084)。Codex 集成脚本生成 PostToolUse hook：curl HTTP 检查未读数量，输出 additionalContext 提醒，再要求 agent 调 fetch_inbox 读正文。[scripts/hooks/check_inbox.sh:87–115](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/scripts/hooks/check_inbox.sh#L87-L115)、[scripts/hooks/check_inbox.sh:160–172](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/scripts/hooks/check_inbox.sh#L160-L172)。仅核实生成逻辑；Codex exec 是否消费该 hook 未能确认。 |
| ⑥ 文件冲突 | 部分 | 已核实（代码） | TTL/exclusive/glob 预约对代码仓库只是 advisory；可选 pre-commit/pre-push guard 阻止相应 Git 操作，但可绕过，不能阻止直接写文件。服务自身 archive 路径另有冲突检查。[src/mcp_agent_mail/app.py:11730–11749](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L11730-L11749)、[src/mcp_agent_mail/guard.py:309–320](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/guard.py#L309-L320)、[src/mcp_agent_mail/app.py:5526–5538](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L5526-L5538) |
| ⑦ 人工参与 | 有 | 已核实（代码） | HTTP Human Overseer 页面可旁观、发指令；这是人工入口，不是每张任务卡必经的人验收关口。[src/mcp_agent_mail/http.py:3598–3624](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/http.py#L3598-L3624)、[src/mcp_agent_mail/http.py:3643–3671](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/http.py#L3643-L3671) |
| ⑧ 独立验证/隔离 | 部分 | 已核实（代码） | 收信鉴权、会话身份、contact_policy 限制收发；未找到“读过标签 → 给所有输出加标签”的 IFC 或执行/验证专用通道。[src/mcp_agent_mail/app.py:5231–5280](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L5231-L5280)、[src/mcp_agent_mail/app.py:7671–7684](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L7671-L7684)。不能用 topic 当安全标签。 |
| ⑨ 审计回放 | 部分 | 已核实（代码） | SQLite 模型存消息、recipient/read/ack、线程；Git archive 存可查看的历史并支持历史 inbox 快照。不能据此保证全部动作事件可确定性重放。[src/mcp_agent_mail/models.py:76–115](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/models.py#L76-L115)、[src/mcp_agent_mail/config.py:434](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/config.py#L434)、[src/mcp_agent_mail/storage.py:2980–2998](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/storage.py#L2980-L2998) |
| ⑩ 传输/禁网 | 有 | 已核实（代码） | 有原生 serve-stdio，日志重定向 stderr；也有 Streamable HTTP。stdio 邮件核心不需要 localhost；选用的 Codex hook 另走 curl HTTP，禁网时不适用。只核实传输源码，未做沙箱实测。[src/mcp_agent_mail/cli.py:1245–1281](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/cli.py#L1245-L1281) |

**对 Helm：**借鉴设计：项目/agent/会话、thread、recipient 独立 read/ack、租约、历史查看有价值；不推荐直接嵌入当前版本。许可证限制涉及向 OpenAI/Anthropic 及其关联/代表提供或允许访问软件/衍生物，不能将“使用 Codex”简单等同于已经被允许或已经被禁止；授权适用未能确认。另需替换可自报 project/agent 的接口形状、增加 runtime 绑定身份和 IFC。

文档/代码差异：旧 Codex notify 脚本仍留在仓库，但已标 deprecated；作者说其输出不会进模型上下文，这是该项目注释的声称，本任务未核验 Codex 源码/执行。新脚本改装 PostToolUse；同时其注释中的“Agent Mail 不支持广播”旧提示与当前 broadcast=true 分支不一致。以当前实现为准。[scripts/hooks/codex_notify.sh:2–12](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/scripts/hooks/codex_notify.sh#L2-L12)、[scripts/integrate_codex_cli.sh:188–200](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/scripts/integrate_codex_cli.sh#L188-L200)、[src/mcp_agent_mail/app.py:2710–2717](https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/src/mcp_agent_mail/app.py#L2710-L2717)


## 1b MCP Agent Mail（Rust）（A）

同一维护者的 Rust 重写，含 MCP、数据库、archive、TUI/Web UI、guard。不是 Python 版本每个特性的同义替代；许可证附加限制相同。[LICENSE:1–44](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/LICENSE#L1-L44)

维护/许可与活跃度：MIT + OpenAI/Anthropic Rider（非普通 MIT）；最近提交 2026-10-12T12:10:50Z；★ 191（2026-10-12 查询；[官方仓库](https://github.com/Dicklesworthstone/mcp_agent_mail_rust)、[元数据](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail_rust)、[提交](https://api.github.com/repos/Dicklesworthstone/mcp_agent_mail_rust/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 未核实依赖任务清单/自动解锁；reservation、build-slot、proof gate 不等于 Helm 卡片图。 |
| ② 认领/分派 | 未能确认 | 未能确认 | 未核实任务拉取认领。身份注册及文件租约存在，但不是任务 claim。 |
| ③ 点对点 | 有 | 已核实（代码） | send_message_routed 处理 sender、to/cc/bcc、thread/topic、幂等 key；定向消息创建和 recipient 在同一 DB 事务。[crates/mcp-agent-mail-tools/src/messaging.rs:3046–3065](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L3046-L3065)、[crates/mcp-agent-mail-tools/src/messaging.rs:3741–3765](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L3741-L3765) |
| ④ 广播/分组 | 部分 | 已核实（代码） | 明确拒绝 broadcast=true；支持显式多收件人及 project:<slug> 共享信箱：消息只存一次，各成员分别读取，没有 fan-out。[crates/mcp-agent-mail-tools/src/messaging.rs:3108–3112](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L3108-L3112)、[crates/mcp-agent-mail-tools/src/messaging.rs:886–901](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L886-L901) |
| ⑤ 运行中投递 | 部分 | 已核实（代码） | agent 主动 fetch_inbox；send/reply 同步写 .signal，再清除 signal 的逻辑只说明唤醒外部观察器，不说明注入模型。[crates/mcp-agent-mail-tools/src/messaging.rs:5028–5040](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L5028-L5040)、[crates/mcp-agent-mail-tools/src/messaging.rs:3838–3865](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L3838-L3865)、[crates/mcp-agent-mail-tools/src/messaging.rs:5303–5318](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L5303-L5318)。未确认 Rust 版对 Codex exec 有无需工具调用的实时投递；不能把 TUI 的实时更新当作 agent 收信。 |
| ⑥ 文件冲突 | 部分 | 已核实（代码） | 预约声明 advisory；冲突查询有权威 DB 快照，guard 可用于 edit/commit/push 检查但有 warn/bypass，非 OS 写隔离。[crates/mcp-agent-mail-tools/src/reservations.rs:1–8](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/reservations.rs#L1-L8)、[crates/mcp-agent-mail-tools/src/reservations.rs:1397–1405](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/reservations.rs#L1397-L1405)、[crates/mcp-agent-mail-guard/src/lib.rs:486–506](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-guard/src/lib.rs#L486-L506) |
| ⑦ 人工参与 | 有 | 已核实（代码） | Web Human Overseer 可发消息并记录操作来源；未确认必须人验收后才能合并。[crates/mcp-agent-mail-server/src/mail_ui.rs:5728–5741](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-server/src/mail_ui.rs#L5728-L5741)、[crates/mcp-agent-mail-server/src/mail_ui.rs:5946–5969](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-server/src/mail_ui.rs#L5946-L5969) |
| ⑧ 独立验证/隔离 | 部分 | 已核实（代码） | 有 session identity 绑定冲突拒绝，但无绑定的路径仍允许，token 可另作授权；不是 runtime 启动时不可更改的席位。没有核实 IFC 标签传播。[crates/mcp-agent-mail-tools/src/session_identity.rs:196–245](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/session_identity.rs#L196-L245) |
| ⑨ 审计回放 | 部分 | 已核实（代码） | SQLite 持久消息+recipient、archive、幂等键和发送回执；archive 的 Git 提交有异步 coalescer，不能把 DB 成功即解释为 Git 已提交。全部动作确定性重放未确认。[crates/mcp-agent-mail-tools/src/messaging.rs:3741–3765](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-tools/src/messaging.rs#L3741-L3765)、[crates/mcp-agent-mail-storage/src/lib.rs:1471–1527](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-storage/src/lib.rs#L1471-L1527) |
| ⑩ 传输/禁网 | 有 | 已核实（代码） | run_stdio 初始化 DB/后台服务后启动 stdio transport；也有 HTTP。本地核心具备禁 agent 网络时使用 stdio 的结构，运行是否全部满足沙箱仍待实测。安装器检测并同步 Codex HTTP/global 配置，与 Helm 的配置约束有冲突。[crates/mcp-agent-mail-server/src/lib.rs:1830–1854](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-server/src/lib.rs#L1830-L1854)、[crates/mcp-agent-mail-server/src/lib.rs:1902–1903](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/crates/mcp-agent-mail-server/src/lib.rs#L1902-L1903)、[install.sh:7109–7159](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/blob/dcef3743c5a6b60a3eb392e3c1ba9426e23428a3/install.sh#L7109-L7159) |

**对 Helm：**借鉴设计：DB 与 archive 双写、幂等键、投递回执和共享 mailbox 值得比较；不推荐直接依赖当前版本（同样的许可证适用未知、身份/IFC 缺口）。安装器本任务只读，未执行；复用不应走会修改全局配置的安装路径。

差异：Python 当前可广播，Rust 当前代码拒绝 broadcast=true；Rust 的 project mailbox 是读取同一条存储记录，不能据其存在改写为“实现了 broadcast fan-out”。


## 2 vibe-kanban（A）

BloopAI 维护的编码 agent 工作区、任务看板和人类审阅 UI。调研当前 main 快照，不用旧 release 猜当前行为。

维护/许可与活跃度：Apache-2.0；最近提交 2026-09-19T06:51:27Z；★ 28335（2026-10-12 查询；[官方仓库](https://github.com/BloopAI/vibe-kanban)、[元数据](https://api.github.com/repos/BloopAI/vibe-kanban)、[提交](https://api.github.com/repos/BloopAI/vibe-kanban/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 已核实（代码） | 有共享 issue、blocking relationship；已确认建/删关系，不确认上游完成后自动解锁并启动下游。[crates/mcp/src/task_server/tools/issue_relationships.rs:15–70](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/issue_relationships.rs#L15-L70) |
| ② 认领/分派 | 部分 | 已核实（代码） | issue assignee 是 user_id，可通过工具分派；orchestrator 可创建会话并推送 prompt。未核实 agent 自身原子拉取 claim。[crates/mcp/src/task_server/tools/issue_assignees.rs:40–49](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/issue_assignees.rs#L40-L49)、[crates/mcp/src/task_server/tools/issue_assignees.rs:100–119](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/issue_assignees.rs#L100-L119)、[crates/mcp/src/task_server/tools/sessions.rs:255–301](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/sessions.rs#L255-L301) |
| ③ 点对点 | 部分 | 已核实（代码） | orchestrator 可指定 session 发 follow-up prompt，是协调者→成员定向启动/续接，不是持久 agent mailbox。任意成员→成员信箱未确认。[crates/mcp/src/task_server/tools/sessions.rs:255–301](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/sessions.rs#L255-L301) |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未核实 agent 之间的广播/分组消息工具；tokio::broadcast 的日志/UI事件不能算团队广播。 |
| ⑤ 运行中投递 | 部分 | 已核实（代码） | Codex 适配器启动 app-server，发送 turn/start、thread resume；用户排队消息等待执行结束，再 start_queued_follow_up。agent 不必主动收信工具，但不是运行中注入。[crates/executors/src/executors/codex.rs:453](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/executors/src/executors/codex.rs#L453)、[crates/executors/src/executors/codex/client.rs:145–169](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/executors/src/executors/codex/client.rs#L145-L169)、[crates/local-deployment/src/container.rs:612–654](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/local-deployment/src/container.rs#L612-L654)。队列每 session 只有一条，新消息会覆盖。[crates/services/src/services/queued_message.rs:31–55](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/services/src/services/queued_message.rs#L31-L55) |
| ⑥ 文件冲突 | 部分 | 已核实（代码） | 独立 worktree/branch 避免通常的同目录覆盖；创建锁防 runtime 同时创建同一 worktree。不是禁止 agent 访问别人的 OS 权限边界，也不能避免合并语义冲突。[crates/worktree-manager/src/worktree_manager.rs:59–108](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/worktree-manager/src/worktree_manager.rs#L59-L108) |
| ⑦ 人工参与 | 部分 | 已核实（代码） | 工具审批桥记录审批并等待用户结果，用户可看日志/发 follow-up；未确认 Helm 所需每卡五阶段的必经人验收。[crates/services/src/services/approvals/executor_approvals.rs:40–60](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/services/src/services/approvals/executor_approvals.rs#L40-L60)、[crates/services/src/services/approvals/executor_approvals.rs:100–126](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/services/src/services/approvals/executor_approvals.rs#L100-L126) |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | 未核实按读取历史传播安全标签或独立验证可见范围；单独会话/worktree 不是该证明。 |
| ⑨ 审计回放 | 部分 | 已核实（代码） | SQLite 持久化会话/执行 JSONL 日志。排队队列本身在内存；“查看历史”不保证完整事件重放。[crates/db/src/lib.rs:72–86](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/db/src/lib.rs#L72-L86)、[crates/db/src/models/execution_process_logs.rs:8–14](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/db/src/models/execution_process_logs.rs#L8-L14)、[crates/services/src/services/queued_message.rs:31–36](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/services/src/services/queued_message.rs#L31-L36) |
| ⑩ 传输/禁网 | 部分 | 已核实（代码） | MCP 外层是 stdio，handler 内部 reqwest 访问 backend HTTP；Codex app-server JSON-RPC 通过进程管道。若 MCP 子进程同样禁网，内层 HTTP 会成为阻点；若 runtime 把桥放可信域，可另行解决，尚未验证。[crates/mcp/src/bin/vibe_kanban_mcp.rs:2–42](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/bin/vibe_kanban_mcp.rs#L2-L42)、[crates/mcp/src/task_server/mod.rs:49–75](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/mod.rs#L49-L75)、[crates/mcp/src/task_server/tools/issue_relationships.rs:62–67](https://github.com/BloopAI/vibe-kanban/blob/d5cbb5380fa0b32e98ef9b8d987f63decce4be3a/crates/mcp/src/task_server/tools/issue_relationships.rs#L62-L67) |

**对 Helm：**借鉴设计：审批 waiter、工作区/会话/执行记录分层有价值。Apache-2.0 允许带 NOTICE/许可证义务的代码复用，但完整引入会带 HTTP backend、Git worktree 和 app-server，均偏离当前 stdio MCP + codex exec + runtime 独占 Git 的边界；无推荐直接嵌入模块。


## 3 OpenCode agent teams 移植 PR（A）

作者 Ugo Enyioha 的 OpenCode fork。文章指向 anomalyco/opencode #12730（core）、#12731（tools/routes）、#12732（TUI）。GitHub API 显示三者 closed、merged_at=null；分别浅克隆，不能把官方 dev 活跃度或 stars 当此实现活跃度。下面 core/tools 结论固定在 #12731 head；TUI 单独用 #12732。

维护/许可与活跃度：MIT；最近提交 2026-02-10T23:18:16Z；★ 3（2026-10-12 查询；[官方仓库](https://github.com/ugoenyioha/opencode)、[元数据](https://api.github.com/repos/ugoenyioha/opencode)、[提交](https://api.github.com/repos/ugoenyioha/opencode/commits?sha=feature/team-tools&per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 有 | 已核实（代码） | TeamTask 存状态、assignee、depends_on；complete 调 resolveDependencies，blocked→pending。注意 cancelled 也满足依赖，而且不存在/自引用依赖会被过滤；Helm 不应照搬这些成功口径。[packages/opencode/src/team/events.ts:48–55](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/events.ts#L48-L55)、[packages/opencode/src/team/index.ts:920–954](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/index.ts#L920-L954) |
| ② 认领/分派 | 有 | 已核实（代码） | claim 在 Storage.update 写锁内校验 pending、未指派和已解决依赖，再设 in_progress/assignee；spawn 可 claim_task，lead 可指定任务。锁是同进程 util/Lock，并非跨独立 OS 进程一致性的证明。[packages/opencode/src/team/index.ts:888–914](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/index.ts#L888-L914)、[packages/opencode/src/storage/storage.ts:179–187](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/storage/storage.ts#L179-L187)、[packages/opencode/src/tool/team.ts:132–140](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/tool/team.ts#L132-L140) |
| ③ 点对点 | 有 | 已核实（代码） | team_message 从 ctx.sessionID 查团队和 fromName，再送指定 teammate/lead；调用方不能通过工具参数自报 from。[packages/opencode/src/tool/team.ts:260–285](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/tool/team.ts#L260-L285) |
| ④ 广播/分组 | 有 | 已核实（代码） | 逐个写 active 成员 inbox 并注入，排除 sender，含 lead；记录 inbox/inject 阶段失败，允许部分成功。[packages/opencode/src/team/messaging.ts:75–139](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L75-L139) |
| ⑤ 运行中投递 | 有 | 已核实（代码） | 先 JSONL 持久 inbox，再插 synthetic user message 到 OpenCode 会话；busy 不强行重启，loop 下一迭代重读会话；idle autoWake；恢复按 inboxMessageId 去重。接收方不用主动读信工具。该方式控制 OpenCode 自身 loop，未提供 Codex CLI 适配，不能移植结论到 codex exec。[packages/opencode/src/team/messaging.ts:47–69](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L47-L69)、[packages/opencode/src/team/messaging.ts:210–227](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L210-L227)、[packages/opencode/src/team/messaging.ts:241–256](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L241-L256)、[packages/opencode/src/session/prompt.ts:282–286](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/session/prompt.ts#L282-L286) |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 未核实按团队文件所有权限制写文件的实现；Storage/Inbox 的锁只保护 runtime 数据，不能算项目文件冲突控制。 |
| ⑦ 人工参与 | 部分 | 已核实（代码） | TUI 可旁观成员与任务并切换会话；plan-approval 可禁 write/bash，lead 工具批准后解禁。lead 是 agent，未强制要求人批准规格/验收/合并。[packages/opencode/src/tool/team.ts:456–493](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/tool/team.ts#L456-L493)；[TUI dialog-team.tsx:59–78](https://github.com/ugoenyioha/opencode/blob/51d82c90e3cdb2e641c14fa0d4c129c229116078/packages/opencode/src/cli/cmd/tui/component/dialog-team.tsx#L59-L78)。 |
| ⑧ 独立验证/隔离 | 部分 | 已核实（代码） | 成员工具权限与 plan 模式有 role 限制；消息不附读取标签，synthetic user 注入也不是保密隔离。独立验证 IFC 未核实。[packages/opencode/src/team/index.ts:420–444](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/index.ts#L420-L444)、[packages/opencode/src/team/messaging.ts:299–319](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L299-L319) |
| ⑨ 审计回放 | 部分 | 已核实（代码） | 团队/任务 JSON，inbox JSONL（read 会重写），恢复扫描 session metadata。cleanup 会删除 inbox/config/tasks，不能视为不可变审计；完整动作回放未确认。[packages/opencode/src/team/inbox.ts:20–43](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/inbox.ts#L20-L43)、[packages/opencode/src/team/inbox.ts:78–95](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/inbox.ts#L78-L95)、[packages/opencode/src/team/index.ts:695–714](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/index.ts#L695-L714) |
| ⑩ 传输/禁网 | 部分 | 已核实（代码） | OpenCode 同进程调用 + 文件，另有 HTTP team routes；并非一个现成 stdio MCP 服务。团队协调本身可本地，不代表模型执行完全离线。[packages/opencode/src/team/messaging.ts:1–8](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/team/messaging.ts#L1-L8)、[packages/opencode/src/server/routes/team.ts:11–59](https://github.com/ugoenyioha/opencode/blob/ac51be23566a49ffc7c26da02163bda4db4a554f/packages/opencode/src/server/routes/team.ts#L11-L59) |

**对 Helm：**借鉴设计：最贴近动态团队的任务/信箱内核；MIT 许可适合有条件抽取，但实现紧耦合 Bun、OpenCode Session/Bus/Storage，且 PR 未合并，不推荐直接依赖 fork。特别借鉴先持久化再投递、发信身份从会话绑定、恢复去重；任务硬关口、跨进程事务与 IFC 需要 Helm 自己守住。

文章/代码差异：文章称实现跨 dev 上三个 PR，不等于已合入 dev；API 是未合并。#12732 分支只有 TUI，#12731 有 core/tools，分别核验而不是将三个 head 混写成单个 commit。


## 4 GNAP（Git-Native Agent Protocol）（A）

Farol Labs / farol-team 维护的 Git 协作规范。已浅克隆；快照实际只有 README、ONBOARDING、CLAUDE、网页/SVG等文档，未找到可执行 runtime。下面规范能力均标“文档声称”，不能升格为代码核实；它不是 IETF 同名授权协议。

维护/许可与活跃度：MIT；最近提交 2026-03-17T21:12:21Z；★ 86（2026-10-12 查询；[官方仓库](https://github.com/farol-team/gnap)、[元数据](https://api.github.com/repos/farol-team/gnap)、[提交](https://api.github.com/repos/farol-team/gnap/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：tasks/*.json 有 state、parent、blocked、reviewer；没有依赖边集与自动解锁实现。[README.md:182–245](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L182-L245) |
| ② 认领/分派 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：assigned_to 推送负责人，ready 留待接手；未定义防止两 agent 同时认领的原子事务。[README.md:201–215](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L201-L215)、[README.md:233–245](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L233-L245) |
| ③ 点对点 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：messages/*.json 的 from/to、thread/read_by。[README.md:314–355](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L314-L355) |
| ④ 广播/分组 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：to=["*"] 为广播、channel 为话题；规范未实现授权分组。[README.md:338–355](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L338-L355) |
| ⑤ 运行中投递 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：heartbeat：pull、读任务/消息、工作、commit/push、sleep；Codex 只被列为兼容 runtime，未提供运行中 CLI 注入适配或无需主动读取的通道。[README.md:39–55](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L39-L55)、[README.md:366–401](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L366-L401) |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：标准 Git merge；冲突 pull+rebase+retry push，属于事后冲突解决，非写前锁/系统强制。[README.md:380–386](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L380-L386) |
| ⑦ 人工参与 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：human 与 ai 是一等 Agent type，reviewer 状态可表示审阅；没有不可绕过的人批准关口。[README.md:141–173](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L141-L173)、[README.md:233–245](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L233-L245) |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | tags 是自由标签，不是 IFC；未核实按角色/标签隔离规范与实现。 |
| ⑨ 审计回放 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：Git history 审计、Run 记录 attempts/cost/commits；依赖参与者正常提交，不能确保 agent 所有动作被记录或历史不可改写。[README.md:249–306](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L249-L306)、[README.md:357–386](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L357-L386) |
| ⑩ 传输/禁网 | 未能确认 | 未能确认 | 实现未能确认；规范文档声称：文件+git push/pull；可离线工作后同步，但跨机更新仍需网络。给 agent Git 写权限与 Helm runtime 独占 Git 冲突。[README.md:39–55](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L39-L55)、[README.md:390–401](https://github.com/farol-team/gnap/blob/2571f5574a0e28001638030222ad7f8bb65b57f7/README.md#L390-L401) |

**对 Helm：**借鉴设计：Agent/Task/Run/Message 四实体、任务和尝试分开、历史可追溯；不要直接采用 agent 可写 Git 的协议执行方式。MIT 允许规范引用/改编，但本仓库没有已核实可嵌入实现。

查找差异：搜索摘要里旧 board/todo→doing→done 不是当前规范事实；当前使用 .gnap/tasks/*.json + state。A 类验收例外：所有执行能力均未能从代码确认，表里实现能力均未能确认，同时列固定 commit 文档声称的规范。


## 5 Claude Code agent teams（B）

Anthropic 的原生多会话团队。仅读查询日官方文档；不能给闭源运行细节打代码核实标签。闭源产品无本项目可查询的 OSS stars；最近团队实现提交/发布未能确认。

活跃度/许可：闭源；文档不是软件开源许可；闭源；团队最近发布未能确认；★ 不适用（2026-10-12 查询）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 有 | 文档声称 | 共享 pending/in_progress/completed，未解决依赖不可 claim，上游完成自动解锁 [官方出处](https://code.claude.com/docs/en/agent-teams#assign-and-claim-tasks)。 |
| ② 认领/分派 | 有 | 文档声称 | lead 指派或成员自主接下一未指派且解锁的任务，file locking 防重复认领 [官方出处](https://code.claude.com/docs/en/agent-teams#assign-and-claim-tasks)。 |
| ③ 点对点 | 有 | 文档声称 | 按 teammate 名称 SendMessage，用户也可直接对成员发言 [官方出处](https://code.claude.com/docs/en/agent-teams#talk-to-teammates-directly)。 |
| ④ 广播/分组 | 部分 | 文档声称 | 当前页要求给每个收件人各发一条以联系全队；没有据此确认独立 broadcast 原语 [官方出处](https://code.claude.com/docs/en/agent-teams#inter-agent-communication)。 |
| ⑤ 运行中投递 | 有 | 文档声称 | 自动投递，不需要 lead 轮询；mailbox JSON 文件持久，停止的 in-process 成员可在原 session 恢复并以消息开新 prompt。运行中插入的具体调度边界闭源未确认；不是 Codex CLI 方案 [官方出处](https://code.claude.com/docs/en/agent-teams#how-agent-teams-work)。 |
| ⑥ 文件冲突 | 部分 | 文档声称 | 任务 claim 的 file lock 仅防任务抢占；文档建议避免成员改同一文件，没承诺文件写强制锁 [官方出处](https://code.claude.com/docs/en/agent-teams#avoid-file-conflicts)。 |
| ⑦ 人工参与 | 部分 | 文档声称 | 用户旁观/直接聊天/处理权限请求；当前文档说 plan approval 会在 lead session 自动批准，不是强制人工审批，更不等于五阶段验收 [官方出处](https://code.claude.com/docs/en/agent-teams#have-teammates-plan-before-implementing)。 |
| ⑧ 独立验证/隔离 | 部分 | 文档声称 | 每成员独立上下文/权限，auto mode 审查 agent 消息来源；没有会话读取 taint 标签的独立验证承诺 [官方出处](https://code.claude.com/docs/en/agent-teams#permissions)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | 本地 teams/tasks/inboxes 文件、会话 transcript；发信只有写 mailbox 成功才报告 sent。完整审计重放未确认 [官方出处](https://code.claude.com/docs/en/agent-teams#architecture)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | 团队本地文件/in-process 或分屏；底层模型请求另需服务网络。不能据此证明禁网 Codex 的 stdio 接口 [官方出处](https://code.claude.com/docs/en/agent-teams#architecture)。 |

**对 Helm：**借鉴设计：自动依赖解锁、拉取+指派、会话独立、发信写失败可见；闭源不可直接嵌入。特别要把 agent plan approval 与人的规格/验收分开。

版本注意：不要沿用旧介绍里的“lead 审完 plan 才批准”或独立 broadcast 描述；本次官方页面明确写自动 plan approval、逐收件人发送。只说明查询日文档，未核验产品实际行为。


## 6 Anthropic Async multi-agent orchestration（B）

Anthropic 的 SDK/asyncio 教学样例：固定 N 成员或动态 subagents。页面不实现领域任务；源码示例只作为文档阅读，没有执行。

维护/许可与活跃度：MIT（cookbooks；SDK另查依赖许可）；最近提交 2026-10-10T09:24:54Z；★ 53371（2026-10-12 查询；[官方仓库](https://github.com/anthropics/claude-cookbooks)、[元数据](https://api.github.com/repos/anthropics/claude-cookbooks)、[提交](https://api.github.com/repos/anthropics/claude-cookbooks/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 无 | 文档声称 | 本样例没有卡片/依赖状态机；status 只表示 agent 活跃/空闲/结束 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ② 认领/分派 | 部分 | 文档声称 | lead create_subagents 推送任务/角色，未提供任务 claim [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ③ 点对点 | 有 | 文档声称 | Hub.post(sender, recipients, content) 送每个成员 inbox [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ④ 广播/分组 | 有 | 文档声称 | recipient_ids 多个成员；可显式全员列表，无授权群组 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑤ 运行中投递 | 有 | 文档声称 | drain inbox 并拼进该轮最后一个 tool_result；wait_for_message 用 Event 等待，示例 timeout 60 秒。接收方需发生工具调用但不必专门轮询；生成 end_turn 时不再 drain。仅 Anthropic API，不证明 Codex exec [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑥ 文件冲突 | 无 | 文档声称 | 样例不操作领域文件，也无锁/沙箱 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑦ 人工参与 | 部分 | 文档声称 | 实时 print trace 可旁观；没有人工审批工具/必经验收 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑧ 独立验证/隔离 | 无 | 文档声称 | Hub 不传播安全标签，也不隔离执行与验证 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | 内存 inbox/status/TRACE 和 stdout；无持久消息事务/重放 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | 同进程 asyncio Hub + Anthropic API；不包含 stdio MCP，模型调用依赖网络 [官方出处](https://platform.claude.com/cookbook/patterns-agents-async-multi-agent-orchestration)。 |

**对 Helm：**借鉴设计：本任务最直接对应“拼进工具返回”的参照。MIT 有利于改编少量数据流思路，但原样 loop 是 Anthropic API、不是 Codex adapter；无需把 SDK agent 框架引入 Helm。

边界：样例宣称 ANY tool 返回可附消息，因为它控制整条工具 dispatch loop；Helm 只控制自己的 MCP 工具，不能直接给 Codex 的 shell/web 等其他工具返回附加消息。


## 7 AgentRoom（B）

Seonglae Cho（Holistic AI）与 Donghyun Lee（UC Berkeley）的并发编码研究；arXiv v1 提交 2026-08-24。作者页显示 Jun.2026，与 arXiv 上传时间口径不同。查阅 PDF/摘要/作者页未确认官方代码仓库，stars/实现最新提交未能确认。

活跃度/许可：论文 CC-BY-4.0；实现软件许可未能确认；arXiv v1 2026-08-24；代码仓库/★ 未能确认（2026-10-12 查询）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | 共享 room_state 包含文件 claim、成员状态、消息；没有带上游自动解锁的任务 DAG（§2.1–2.3） [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ② 认领/分派 | 部分 | 文档声称 | agent 拉取式 claim 文件，再自由选工作；不等于认领任务卡 [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ③ 点对点 | 未能确认 | 未能确认 | 论文公开工具列表以 broadcast/read 为主，点对点信箱未能确认。 |
| ④ 广播/分组 | 有 | 文档声称 | room_broadcast 追加 room JSONL log，各成员 read/state 读取（§2.1–2.3） [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | 明确要求子任务间轮询 room 更新；包含 Codex CLI 0.120.0 实验，但没证明 runtime 主动注入正在运行的 Codex。工具正文需 agent 主动调用 [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ⑥ 文件冲突 | 部分 | 文档声称 | atomic claim 保持 cooperative mutual exclusion；提示层 advisory，未 claim 的写仍进入 CRDT；字符收敛不等于语义冲突消除（§2.2） [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ⑦ 人工参与 | 未能确认 | 未能确认 | 论文实验有评分者/运行日志，不等于人实时插话、审批或必经验收；未确认人工产品接口。 |
| ⑧ 独立验证/隔离 | 部分 | 文档声称 | 实验有跨模型 judge；没有按 IFC 标签控制共享 room 可见性的机制。只证明评估安排，不证明席位隔离（§2.5） [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | append-only room JSONL/归档实验日志可分析，不确认所有文件/动作可恢复重放 [官方出处](https://arxiv.org/pdf/2608.23740)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | MCP stdio/NDJSON 被论文明确提及（§4.4 协议兼容性）；CRDT 共享文件系统底层网络边界、禁网工作能力未确认 [官方出处](https://arxiv.org/pdf/2608.23740)。 |

**对 Helm：**借鉴设计：少量原语即可形成动态协作，structured claim 冲突比聊天里自称占文件可靠；CRDT 共享写与 Helm 每卡私有工作区、独立验证相冲突，不推荐直接采用共享 workspace。


## 8a Kangentic（B）

Kangentic 团队维护的桌面 kanban/多 CLI 控制台；拖卡触发会话，可按列配置执行者、权限、上下文交接。

维护/许可与活跃度：AGPL-3.0；最近提交 2026-10-12T02:59:52Z；★ 127（2026-10-12 查询；[官方仓库](https://github.com/Kangentic/kangentic)、[元数据](https://api.github.com/repos/Kangentic/kangentic)、[提交](https://api.github.com/repos/Kangentic/kangentic/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | 共享 kanban 列/流程，未确认任务依赖 DAG 自动解锁；列迁移与并发排队不是依赖调度 [官方出处](https://github.com/Kangentic/kangentic)。 |
| ② 认领/分派 | 部分 | 文档声称 | 人拖卡/配置列触发 agent，MCP 可建任务移动卡；未确认 agent 原子认领解锁卡 [官方出处](https://kangentic.com/features/agent-orchestration/)。 |
| ③ 点对点 | 有 | 文档声称 | kangentic_send_session_message 定向另一任务 session [官方出处](https://kangentic.com/features/agent-orchestration/)。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未确认团队 broadcast/group 原语。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | 向 native CLI terminal 发送类似 paste 的消息；忙碌者回合结束才读，deliverWhen=idle 可延后。文档覆盖 Codex 等 CLI，但没有承诺 codex exec 进程中注入；消息正文不标注来自 agent [官方出处](https://kangentic.com/features/agent-orchestration/)。 |
| ⑥ 文件冲突 | 部分 | 文档声称 | 每任务可 worktree 隔离；不是 OS 禁读/禁写、不是合并语义安全 [官方出处](https://github.com/Kangentic/kangentic)。 |
| ⑦ 人工参与 | 有 | 文档声称 | 嵌入终端可旁观和输入、权限模式按列；固定五阶段人工关口未确认 [官方出处](https://github.com/Kangentic/kangentic)。 |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | 可读别人 transcript/steer，未确认验证信息隔离或读取标签传播。 |
| ⑨ 审计回放 | 部分 | 文档声称 | 本地 DB、session/activity/transcript；消息尝试记录 delivered/queued/refused/failed，完整动作回放未确认 [官方出处](https://kangentic.com/features/agent-orchestration/)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | CLI/PTY + MCP（官方说明调用方 session stamped 到 MCP URL，含本地服务边界）；未确认纯 stdio 或禁 localhost 后所有功能 [官方出处](https://kangentic.com/features/agent-orchestration/)。 |

**对 Helm：**借鉴设计：人机旁观、队列与多执行者 adapter 边界；AGPL 有额外分发/网络服务源代码义务，且终端交互、工作树、会话互读偏离 Helm，不推荐直接嵌入。


## 8b Codeg（B）

Spacering / spacering-net 维护的多执行者工作台。名称搜索同时出现 nobug-project/codeg；该副本查询 stars=0，官方 README/文档指向 spacering-net，本文以该主仓库为准。

维护/许可与活跃度：Apache-2.0；最近提交 2026-10-11T03:37:59Z；★ 3916（2026-10-12 查询；[官方仓库](https://github.com/spacering-net/codeg)、[元数据](https://api.github.com/repos/spacering-net/codeg)、[提交](https://api.github.com/repos/spacering-net/codeg/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | to-do board、独立 branch/worktree、运行/Review；未确认依赖自动解锁 [官方出处](https://github.com/spacering-net/codeg)。 |
| ② 认领/分派 | 部分 | 文档声称 | 用户建 to-do 或主 agent @ 委派，多 agent 独立 session；未确认拉取 claim [官方出处](https://github.com/spacering-net/codeg)。 |
| ③ 点对点 | 部分 | 文档声称 | 同任务主 agent 与 subagent 会话协作、live feedback 定向 session；任意 peer mailbox 未确认 [官方出处](https://github.com/spacering-net/codeg)。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未确认持久团队广播/分组原语。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | Codex 的 Send note for next check 要 agent 主动调用 check_user_feedback；会话启动前需 companion+Live feedback 打开，提示其定期检查。普通 send 排队，真正 Insert into current turn 当前只给 Claude Code 指定 adapter 版本。用 ACP 适配器，未确认 codex exec 路径 [官方出处](https://docs.codeg.app/guide/workspace#fork--steer)。 |
| ⑥ 文件冲突 | 部分 | 文档声称 | to-do 单独 worktree/branch、审 diff、Git 检查完成；非强制文件写边界 [官方出处](https://github.com/spacering-net/codeg)。 |
| ⑦ 人工参与 | 有 | 文档声称 | 结构化 UI/权限 prompt/Review 人接受 diff 后落地；是否对所有入口强制人审未确认 [官方出处](https://github.com/spacering-net/codeg)。 |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | “Claude 写/Codex 审”只是分工示例；未确认 read taint 或独立验证通道。 |
| ⑨ 审计回放 | 部分 | 文档声称 | 可搜索会话、历史 transcript、导出 Markdown/HTML，未确认完整审计事件存储/重放语义 [官方出处](https://docs.codeg.app/guide/workspace)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | agent 用 ACP；桌面/自托管 HTTP server/docker、companion MCP；README 不证明整个 Codex 反馈链是禁网 stdio [官方出处](https://github.com/spacering-net/codeg)。 |

**对 Helm：**借鉴设计：明确区分 queue、agent 自愿检查与真正 turn 注入；不要把“steer”按钮视为所有 CLI 都支持立即送达。Apache-2.0 可条件复用，但工作台/ACP companion 不能直接满足当前 exec 窄接口。


## 9a MetaGPT（B）

FoundationAgents / DeepWisdom 社区的软件公司式多 agent 框架；SOP/role/action 和 Environment 消息路由。

维护/许可与活跃度：MIT；最近提交 2026-01-21T10:12:32Z；★ 70818（2026-10-12 查询；[官方仓库](https://github.com/FoundationAgents/MetaGPT)、[元数据](https://api.github.com/repos/FoundationAgents/MetaGPT)、[提交](https://api.github.com/repos/FoundationAgents/MetaGPT/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | 角色按 Action/SOP 响应上游消息，未证明共享卡片 DAG 与自动解锁 [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |
| ② 认领/分派 | 部分 | 文档声称 | 输入类型订阅预定义工作，示例 A 分拆/B处理/C汇总/D审阅；不是 runtime 原子 claim [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |
| ③ 点对点 | 有 | 文档声称 | Message.send_to 可指定角色，sent_from/cause_by 区分来源 [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |
| ④ 广播/分组 | 有 | 文档声称 | Environment 按订阅广播；rc.watch 订阅 cause_by/action 类型 [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | Environment 驱动 role run，消息队列供下一轮 observe/react；需要自己掌握框架 loop，未确认 Codex CLI 适配/运行中进程注入 [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 未从已读官方通信文档/README 确认强制文件锁。 |
| ⑦ 人工参与 | 未能确认 | 未能确认 | 需求输入不等于运行中人工审批；必经人关口和插话能力未核实。 |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | watch/send_to 是路由订阅，未确认访问控制；订阅标签不等于 IFC 安全标签。 |
| ⑨ 审计回放 | 未能确认 | 未能确认 | 已读材料说明 Message/Environment，无全量动作审计存储及回放保证。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | Python Environment 方法/内存消息，LLM provider API；没有直接 stdio MCP + Codex CLI 通信链 [官方出处](https://docs.deepwisdom.ai/main/en/guide/in_depth_guides/agent_communication.html)。 |

**对 Helm：**借鉴设计：结构化消息的 id/cause_by/sent_from/send_to、订阅过滤；不照搬固定 SOP，且不要把订阅实现当作保密权限。


## 9b AutoGen（Microsoft）（B）

Microsoft 发起，当前官方 README 声明维护模式，社区维护，不新增功能，建议新项目考虑 Agent Framework。API 的 root license=CC-BY 不代表代码只能 CC；README 与 LICENSE-CODE 明确代码 MIT。

维护/许可与活跃度：代码 MIT；文档 CC-BY-4.0；最近提交 2026-04-06T22:35:32Z；★ 61375（2026-10-12 查询；[官方仓库](https://github.com/microsoft/autogen)、[元数据](https://api.github.com/repos/microsoft/autogen)、[提交](https://api.github.com/repos/microsoft/autogen/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 群聊/GraphFlow 不自动等价于带 card ownership 的看板；本调研未确认拉取看板依赖解锁。 |
| ② 认领/分派 | 部分 | 文档声称 | round-robin/selector/handoff 按 speaker 或流程推送发言；没有任务 claim 证明 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)。 |
| ③ 点对点 | 有 | 文档声称 | Core send_message 请求响应，按 AgentId 定向 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/message-and-communication.html)。 |
| ④ 广播/分组 | 有 | 文档声称 | Core publish_message + topic/subscription，AgentChat 共享群聊上下文 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/message-and-communication.html)。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | Core runtime queue/handler dispatch；AgentChat 在 run loop 给被选 agent 上下文。框架内运行，不是往外部正在执行的 Codex exec stdin 推消息；Codex CLI 未确认 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/message-and-communication.html)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 工具 code executor/container 能隔离执行环境，但已读通信材料不证明团队文件冲突强制控制。 |
| ⑦ 人工参与 | 部分 | 文档声称 | 队伍可包含 user proxy/人输入，运行流可旁观；必经人验收未确认 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)。 |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | topic/subscription 与 agent context 不是 IFC，未确认执行验证信息隔离。 |
| ⑨ 审计回放 | 部分 | 文档声称 | team/agent save_state、load_state，状态字典可存文件/DB；存储由应用负责，不是内建全动作不可变审计 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | Python Core 进程内 runtime，也有分布式组件；不具备已确认的 stdio MCP + exec 接收适配 [官方出处](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/framework/message-and-communication.html)。 |

**对 Helm：**借鉴设计：typed message、direct request/reply 与 publish/subscribe 分开、显式保存恢复；直接引入框架会替换当前执行模型，且项目已维护模式。


## 9c AG2（B）

AG2 社区维护的 AutoGen 衍生框架。查询日 README 区分 AG2 Classic（autogen/GroupChat）与新版 AG2 Network；不能拿旧 GroupChat 文档解释全部当前实现。

维护/许可与活跃度：Apache-2.0；原继承代码保留 MIT 归属；最近提交 2026-10-11T09:12:50Z；★ 4991（2026-10-12 查询；[官方仓库](https://github.com/ag2ai/ag2)、[元数据](https://api.github.com/repos/ag2ai/ag2)、[提交](https://api.github.com/repos/ag2ai/ag2/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | Network workflow/TransitionGraph 是通信流，未确认共享任务依赖看板自动解锁。 |
| ② 认领/分派 | 部分 | 文档声称 | Classic manager 选 speaker；新版 channel adapter 决定 dispatch/handoff，无任务 pull-claim 证明 [官方出处](https://github.com/ag2ai/ag2)。 |
| ③ 点对点 | 有 | 文档声称 | 新版 conversation/consulting 双方通道，Envelope 的 sender/audience/causation；Classic direct chat [官方出处](https://docs.ag2.ai/docs/user-guide/network/overview/)。 |
| ④ 广播/分组 | 有 | 文档声称 | discussion 多成员轮流，workflow 条件 handoff；Classic GroupChat 广播发言 [官方出处](https://github.com/ag2ai/ag2)。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | Hub/client link 投递 Envelope 并调度 Agent；LocalLink 同进程双向队列，WsLink 跨进程。未确认 Codex CLI exec 途中适配 [官方出处](https://docs.ag2.ai/docs/user-guide/network/overview/)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 通信框架未从这些官方资料确认强制文件冲突控制。 |
| ⑦ 人工参与 | 部分 | 文档声称 | README 有 human-in-loop/审批样例；不是全部任务必过的人验收 [官方出处](https://github.com/ag2ai/ag2)。 |
| ⑧ 独立验证/隔离 | 部分 | 文档声称 | 新版 Rule 有 access lists/channel allowlists，adapter 有 view policy；不是会话历史标签传播 [官方出处](https://docs.ag2.ai/docs/user-guide/network/overview/)。 |
| ⑨ 审计回放 | 有 | 文档声称 | 新版 Hub 权威状态、audit/WAL、可回放 channel transcripts；具体持久介质/跨 DB 一致性未在已读页确认。Classic 不可推定同样保证 [官方出处](https://docs.ag2.ai/docs/user-guide/network/overview/)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | LocalLink 同进程，WsLink WebSocket；与 stdio MCP 不同，禁网只能考虑进程内 local，模型仍另需网络 [官方出处](https://docs.ag2.ai/docs/user-guide/network/overview/)。 |

**对 Helm：**借鉴设计：新版 HubArbiter 在 open/send/dispatch 前决定、HubListener 事后观测、Envelope 因果链和视图；比 Classic GroupChat 更贴近 runtime 边界，但未经代码核实，不推荐现阶段直接依赖。


## 9d Microsoft Agent Framework（B）

Microsoft 当前 agent/workflow 框架。官方文档包括群聊 manager、checkpoint 恢复、人参与和可选 Python FIDES。B 类仅文档，不能作为当前包实际 behavior 的代码证据。

维护/许可与活跃度：MIT；最近提交 2026-10-12T12:13:49Z；★ 14076（2026-10-12 查询；[官方仓库](https://github.com/microsoft/agent-framework)、[元数据](https://api.github.com/repos/microsoft/agent-framework)、[提交](https://api.github.com/repos/microsoft/agent-framework/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | graph workflow 有执行依赖，群聊用 manager；不是自由增卡/审批/认领看板 [官方出处](https://github.com/microsoft/agent-framework)。 |
| ② 认领/分派 | 部分 | 文档声称 | manager select next agent 和 request 推送发言，可自定义 selection [官方出处](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)。 |
| ③ 点对点 | 部分 | 文档声称 | manager 向选中 participant 发请求，另有 handoff；任意对等信箱语义未确认 [官方出处](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)。 |
| ④ 广播/分组 | 有 | 文档声称 | 群聊 broadcast response 给 participants，可定制 history/filter [官方出处](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | 框架 loop/workflow executor 事件 dispatch；未确认 Codex CLI exec 的运行中接收 [官方出处](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/group-chat)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 群聊/安全文档不证明并行 agent 文件写的系统级互斥。 |
| ⑦ 人工参与 | 有 | 文档声称 | human-in-loop/工具审批、checkpoint 继续；不是自动实现每卡人验收合并关口 [官方出处](https://github.com/microsoft/agent-framework)。 |
| ⑧ 独立验证/隔离 | 有 | 文档声称 | Python FIDES 工具 middleware：integrity+confidentiality，敏感工具调用前政策判断、可选变量隔离；未证明覆盖任意 Codex shell/file 读取 [官方出处](https://learn.microsoft.com/en-us/agent-framework/agents/security)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | checkpoint/time-travel、manager 状态回调及 FIDES 每调用政策日志；具体保存后端由配置/应用负责 [官方出处](https://github.com/microsoft/agent-framework)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | SDK in-process+provider API，MCP client 可使用服务器；不等于 stdio runtime 能接管外部 exec 会话 [官方出处](https://github.com/microsoft/agent-framework)。 |

**对 Helm：**借鉴设计：IFC middleware 对敏感 sink 在调用前守关、checkpoint 与事件边界。MIT 适合限定模块复用，但 Python SDK context/工具链不同于 Codex 黑盒，暂不推荐整体依赖。


## 10a A2A（B）

Google 发起、Linux Foundation A2A 项目维护的远程 agent 互操作协议。Agent Card 是服务能力公告；Task 是远端请求生命周期，不是 Helm 项目卡片。

维护/许可与活跃度：Apache-2.0；最近提交 2026-10-12T09:23:29Z；★ 26119（2026-10-12 查询；[官方仓库](https://github.com/a2aproject/A2A)、[元数据](https://api.github.com/repos/a2aproject/A2A)、[提交](https://api.github.com/repos/a2aproject/A2A/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 部分 | 文档声称 | Task/context/artifact/status 有任务生命周期，但无项目依赖 DAG 自动解锁 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ② 认领/分派 | 部分 | 文档声称 | client SendMessage 给 remote agent 请求，属于 push；无原子认领共享卡片 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ③ 点对点 | 有 | 文档声称 | message 到 remote agent，task/context 关联连续会话 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 协议未提供团队成员注册和 broadcast/group ownership 的确定语义。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | GetTask/ListTasks 轮询、SubscribeToTask/stream 更新、HTTP push webhook；这些是客户端收到服务事件，模型何时消费仍由服务实现。没有 codex exec 注入保证 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 不控制远端 agent 的项目文件冲突。 |
| ⑦ 人工参与 | 部分 | 文档声称 | input-required/auth-required 支持交互或授权，最终由客户端提供；不是必须人验收的协议关口 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ⑧ 独立验证/隔离 | 部分 | 文档声称 | 认证/授权、opaque agent 内部数据；未定义读过数据的 IFC label 跨消息传播 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | Task history/artifacts 可查询；持久存储/审计回放归服务实现，不由协议指定数据库 [官方出处](https://a2a-protocol.org/latest/specification/)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | 标准 bindings JSON-RPC、gRPC、HTTP+JSON/REST，支持流和 webhook；没有标准 stdio binding，custom binding 另作实现 [官方出处](https://a2a-protocol.org/latest/specification/)。 |

**对 Helm：**借鉴设计：任务状态、context/task/message/artifact 分层和流式事件；当前 Helm 本地禁网 exec 场景无需引入远端协议，不推荐用 A2A 代替本地信箱。


## 10b Agent Client Protocol（ACP）（B）

Agent Client Protocol 社区（Zed/JetBrains 等）维护的客户端↔编码 agent 会话协议。不是 IBM/BeeAI 另一个 Agent Communication Protocol。

维护/许可与活跃度：Apache-2.0；最近提交 2026-10-12T11:38:56Z；★ 4417（2026-10-12 查询；[官方仓库](https://github.com/agentclientprotocol/agent-client-protocol)、[元数据](https://api.github.com/repos/agentclientprotocol/agent-client-protocol)、[提交](https://api.github.com/repos/agentclientprotocol/agent-client-protocol/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 协议会话/计划更新不是共享任务依赖看板。 |
| ② 认领/分派 | 部分 | 文档声称 | client session/prompt 推送任务；无 agent claim 项目任务机制 [官方出处](https://agentclientprotocol.com/protocol/prompt-turn)。 |
| ③ 点对点 | 部分 | 文档声称 | client-agent prompt/updates 双向；不是 agent-agent peer mail 路由 [官方出处](https://agentclientprotocol.com/protocol/prompt-turn)。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 标准接口不定义团队成员广播或授权群组。 |
| ⑤ 运行中投递 | 部分 | 文档声称 | session/prompt 发起回合，session/update 给客户端流式事件；cancel 可终止回合，完成后再 prompt。核心协议不证明忙碌 agent 必须支持中途新 prompt/steer，更不证明普通 codex exec 支持 ACP [官方出处](https://agentclientprotocol.com/protocol/prompt-turn)。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 客户端 fs read/write 可被仲裁，但 agent 可以拥有自身文件工具；协议本身不保证团队文件互斥。 |
| ⑦ 人工参与 | 有 | 文档声称 | session/request_permission 询问客户端，客户端可展示人；可旁观 updates，是否必须人过关由 client policy 决定 [官方出处](https://agentclientprotocol.com/protocol/prompt-turn)。 |
| ⑧ 独立验证/隔离 | 未能确认 | 未能确认 | 未确认基于读取历史的 IFC；MCP 配置/权限请求不是传播标签。 |
| ⑨ 审计回放 | 部分 | 文档声称 | session load/history 有能力协商，客户可记事件；协议没有内建审计 DB/确定性重放 [官方出处](https://agentclientprotocol.com/protocol/overview)。 |
| ⑩ 传输/禁网 | 有 | 文档声称 | JSON-RPC UTF-8 newline framing 的 stdio；Streamable HTTP 是 draft，可自定义 transport。stdio 可免 localhost，但模型 API 网络是另一层 [官方出处](https://agentclientprotocol.com/protocol/transports)。 |

**对 Helm：**借鉴设计：执行者 start/load/prompt/cancel/update/permission 的能力协商最贴近 FEATURES 第5节。协议 schema/SDK 是将来可选依赖，Apache-2.0 在许可层允许，当前未核实适配包依赖许可与 codex exec 契约，故暂不列“已可直接复用”。


## 11a Microsoft FIDES（B）

Microsoft Research 等作者的 Securing AI Agents with Information-Flow Control（2025）与官方教程 notebook。维护者包括 Manuel Costa、Boris Köpf 等；FIDES 论文、教程和当前 Agent Framework 集成需分开判定。

维护/许可与活跃度：MIT（教程仓库）；最近提交 2025-05-30T16:17:45Z；★ 120（2026-10-12 查询；[官方仓库](https://github.com/microsoft/fides)、[元数据](https://api.github.com/repos/microsoft/fides)、[提交](https://api.github.com/repos/microsoft/fides/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 研究对象是安全 planner，不提供动态团队任务看板。 |
| ② 认领/分派 | 未能确认 | 未能确认 | 没有已确认的团队任务 claim/assign 原语。 |
| ③ 点对点 | 未能确认 | 未能确认 | 教程/论文不是 agent mailbox 实现。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未确认团队 broadcast/group 原语。 |
| ⑤ 运行中投递 | 未能确认 | 未能确认 | 未确认 Codex CLI 会话途中投递；研究控制自建 planner/model/tool loop。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | IFC 限制数据流/敏感动作；未确认其提供并行项目文件冲突锁。 |
| ⑦ 人工参与 | 部分 | 文档声称 | trusted user/安全政策及受信任揭示/解密可介入；不是项目人验收流程 [官方出处](https://arxiv.org/html/2505.23643v2)。 |
| ⑧ 独立验证/隔离 | 有 | 文档声称 | 数据有 integrity 与 readers confidentiality，LLM 输出取输入上下文标签的保守 join，tool args/results/变量继续传播，在敏感 call 前判 policy；hide/reveal 减少上下文污染（§4–6） [官方出处](https://arxiv.org/html/2505.23643v2)。 |
| ⑨ 审计回放 | 部分 | 文档声称 | 形式模型包含状态/动作与标签，教程提供 evaluated 输出；生产消息审计数据库/恢复重放未确认 [官方出处](https://github.com/microsoft/fides)。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | 官方 notebook 演示自建 API planner，测试 Azure OpenAI；不是直接 stdio MCP gateway。框架集成另见9d [官方出处](https://github.com/microsoft/fides)。 |

**对 Helm：**借鉴设计（优先）：最接近 Helm 的“会话读过什么决定以后输出可流向谁”。MIT 研究原型有助理解标签代数，但不直接替换 Codex；Helm 要将 send_message/broadcast/证据通道都做成受政策约束的 sink。

传播细节（文档声称）：完整性采用更低信任；保密 readers 组合取交集（权限越来越窄），也可在 Helm 用禁读集合取并集作等价保守表示。LLM 是黑盒时对全上下文保守传播。论文显式区分 integrity 的非干扰与 confidentiality 的 explicit secrecy，未承诺隐藏所有控制流/时间侧信道。 [论文§4.1–4.4](https://arxiv.org/html/2505.23643v2)。


## 11b Google DeepMind CaMeL（B）

Edoardo Debenedetti、Ilia Shumailov 等的 Defeating Prompt Injections by Design（2025）；代码放 google-research，不是 camel-ai 的角色扮演框架。

维护/许可与活跃度：Apache-2.0（实现仓库）；最近提交 2025-06-20T13:59:27Z；★ 404（2026-10-12 查询；[官方仓库](https://github.com/google-research/camel-prompt-injection)、[元数据](https://api.github.com/repos/google-research/camel-prompt-injection)、[提交](https://api.github.com/repos/google-research/camel-prompt-injection/commits?per_page=1)）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 没有已确认的团队看板依赖调度。 |
| ② 认领/分派 | 未能确认 | 未能确认 | 没有已确认的任务认领原语。 |
| ③ 点对点 | 未能确认 | 未能确认 | 原论文主要是单 agent 安全解释器，未确认团队信箱。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未确认原方案提供团队广播。 |
| ⑤ 运行中投递 | 未能确认 | 未能确认 | 未确认 codex exec 运行中接收；其执行模型是 P-LLM 产程序、自定义解释器执行。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 安全 sink 可以限制文件动作，但未确认并行文件互斥/claim。 |
| ⑦ 人工参与 | 部分 | 文档声称 | 政策拒绝时可提示人确认特定工具执行；不是每卡强制人验收 [官方出处](https://arxiv.org/html/2503.18813v1)。 |
| ⑧ 独立验证/隔离 | 有 | 文档声称 | P-LLM 看可信指令，Q-LLM 处理不可信数据且没有工具；解释器为值保留 provenance/capabilities、跟踪派生依赖，并在工具 sink 检查；STRICT 模式加强隐式依赖 [官方出处](https://arxiv.org/html/2503.18813v1)。 |
| ⑨ 审计回放 | 未能确认 | 未能确认 | 研究评测轨迹不等于生产消息/动作持久审计与回放。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | Python 解释器+模型/工具 API，原官方实现并非 stdio MCP 邮件服务 [官方出处](https://github.com/google-research/camel-prompt-injection)。 |

**对 Helm：**借鉴设计（优先）：值的来源、可读主体及派生结果能力传播、可信控制与不可信数据分通道。Apache-2.0 允许条件复用实现，但会重写当前 Codex 执行模型，不能直接嵌入 CLI 得到隔离保证。


## 补1 multi-CaMeL（Can CaMeLs Talk?）（B）

2026-10-05 预印本，James Peters-Gill、Avi Semler、Henning Bartsch、Ilia Shumailov、Christian Schroeder de Witt。唯一额外 B 类对象；论文声称发布实现，但已读论文/摘要未确认可归属的官方仓库，stars 与代码最近提交未能确认。

活跃度/许可：论文 CC-BY-4.0；代码许可/仓库未能确认；arXiv v1 2026-10-05；代码仓库/★ 未能确认（2026-10-12 查询）。

| 能力 | 判定 | 来源级别 | 做法与限制 |
|---|---|---|---|
| ① 看板依赖解锁 | 未能确认 | 未能确认 | 不是任务依赖看板方案。 |
| ② 认领/分派 | 部分 | 文档声称 | hierarchical agent-as-tool 的上游调用下游，推送式；无共享 claim [官方出处](https://arxiv.org/html/2610.05640v1)。 |
| ③ 点对点 | 有 | 文档声称 | agent-as-tool 调用区分 message 与 opaque variables，明确跨 agent 的指令/数据两通道 [官方出处](https://arxiv.org/html/2610.05640v1)。 |
| ④ 广播/分组 | 未能确认 | 未能确认 | 未确认群组广播原语。 |
| ⑤ 运行中投递 | 未能确认 | 未能确认 | 未确认 Codex CLI 途中收信；论文在受控 CaMeL loops 内实现。 |
| ⑥ 文件冲突 | 未能确认 | 未能确认 | 不提供已确认文件冲突锁。 |
| ⑦ 人工参与 | 未能确认 | 未能确认 | 未确认必经人工审批/项目验收流程。 |
| ⑧ 独立验证/隔离 | 有 | 文档声称 | 指出单 agent CaMeL 保证不自动组合；runtime 禁止工具派生值进入可信 message 指令通道，variables 跨边界保留 capabilities/provenance（§IV） [官方出处](https://arxiv.org/html/2610.05640v1)。 |
| ⑨ 审计回放 | 未能确认 | 未能确认 | benchmark artifact 不等于生产信箱动作审计回放。 |
| ⑩ 传输/禁网 | 部分 | 文档声称 | 受控 agent-as-tool 数据协议，未确认 stdio MCP 传输或禁网 CLI adapter [官方出处](https://arxiv.org/html/2610.05640v1)。 |

**对 Helm：**借鉴设计（优先）：直接支持 Helm 普通信箱继承污染、格式固定证据/失败项通道需受控降密而非自然语言洗白。不能宣称每个成员单独安全即可保证团队安全。


## 对 Helm 设计的影响

以下“建议/推导”是针对 Helm 的设计判断，**不是已核实的外部项目能力**；外部事实的级别沿用前述项目表。

### ① 信箱：直接复用与数据模型

**没有确认能原样直接复用的信箱依赖。** Agent Mail 的 Python/Rust 两版已有 stdio、定向信、线程与存储（已核实〔代码〕，见1a/1b），不能以“只支持 HTTP”否定它；真正缺口是当前许可证附加限制、与 Helm 不同的注册/身份授权模型、没有已确认的会话读取标签传播。Rust 的安装路径还会同步 coding agent 全局配置，不能用于 Helm。OpenCode fork 的 MIT 比较适合参考或未来抽取，但 Session/Bus/Bun/Storage 紧耦合且 PR 未合并，未确认可独立嵌入模块。

建议独立实现小型 runtime 信箱，借鉴项目/成员/会话身份分层、thread/reply、recipient 与 read/ack 分开（Agent Mail），任务与一次执行尝试分开（GNAP），先持久化后投递及按 message-id 恢复去重（OpenCode）。在 Helm 中 agent 配置是模板、member 是项目成员、session 是某次独立上下文，不能用可自报的姓名代替 runtime 绑定的 session identity。消息至少需 message-id、project、sender-session、recipient-session/成员集合、card-id、thread-id、时间/序号、正文、继承的标签、channel 类型；每收件人的 queued/delivered/ack 状态单独保存。群发先逐收件人判权限再落投递记录，拒绝项要可审计。

建议 SQLite 或等价事务存储作为 runtime 私有权威数据源；不要让 agent 直接写 JSONL/数据库/Git。发信与创建投递项同事务，响应成功不等于模型已消费。把持久“待投递”、已经返回工具结果、agent 明确 ack 分开；崩溃时允许同 message-id 重送并要求接收方幂等，不能借“队列清空”声称 exactly-once。Git/JSONL 可作为审计导出，不能反过来成为 agent 可改的授权状态。

### ② 运行中投递：对 Codex CLI 的已有做法

| 已有路径 | 证据级别 | 对 Codex 的真实范围 | 对 `stdio MCP + codex exec` 的判断 |
|---|---|---|---|
| Agent Mail `fetch_inbox` | 已核实（代码） | agent 主动取正文；Python hook 用 HTTP 检查数量并产生 PostToolUse `additionalContext` 提醒 | 原生 stdio 取信逻辑可参考；HTTP hook 禁网不适合，Codex exec 消费 hook 尚未实测 |
| vibe-kanban queue/follow-up | 已核实（代码） | Codex app-server，执行结束后新 turn/resume；单条内存排队 | 可借鉴续接兜底；不能当作 exec 同一运行中投递证据 |
| OpenCode synthetic user | 已核实（代码） | OpenCode 内部改 session，下一 loop 读取；idle 唤醒 | Helm 没有 Codex 内部 loop/持久会话写接口，不可直接照搬 |
| Kangentic terminal paste | 文档声称 | native CLI 的终端输入，忙碌 agent 通常回合结束才读 | PTY/native 交互，不证明一次性 exec stdin 可随时加消息 |
| Codeg live feedback | 文档声称 | Codex 必须主动 `check_user_feedback`；立即 insert 当前仅特定 Claude adapter | 可借鉴主动 checkpoint；协议/伴随服务是否 stdio 尚未确认 |
| Anthropic cookbook piggyback | 文档声称（包括样例） | 在自己的 API dispatch loop 把 inbox 加到最后一个 tool_result，不是 Codex | **最值得实测的做法**：runtime MCP response 附待收消息；接收方必须调用 runtime 工具 |
| AgentRoom room_read/state | 文档声称（论文） | 有 Codex CLI 实验，规定子任务之间主动轮询 | stdio MCP 形状匹配，但未展示被动推入运行中上下文 |

建议 runtime 对它提供的**每个允许返回数据的 MCP 工具**统一附消息 envelope：业务结果、messages、delivery cursor 分开；先做标签/可见性判断，再序列化返回。阻塞 `wait_messages` 可在 idle 时减少空轮询，也必须先检查 backlog 再等待，避免事件重置丢唤醒。只在调用 runtime 工具时检查，不能把 cookbook 的 ANY tool 扩大到 Codex 的 shell/web 等内建工具。

这个方案保证的最多是“下一次 runtime 工具返回时有机会送达”；工具从未调用、模型长时间生成、agent 正跑外部工具或已经结束时，延迟没有上界。团队约定在拆卡/认领/提交证据/工作检查点调用 runtime，可增加机会，但强时限取消/升级仍应由 runtime 直接掌控进程生命周期。MCP 通知进入客户端/UI不等于进入模型上下文；当前没有核实的证据可以把它当可靠唤醒机制。

### ③ 文件冲突：有强制机制，但范围有限

已核实的 Agent Mail guard 能阻断选定 Git 操作，runtime 数据更新也有锁；这些都是**作用点有限**的强制机制，有 bypass 或不覆盖直接文件写。其代码仓库预约仍 advisory。AgentRoom 明确依赖提示层合作，CRDT 只保证字节/字符状态收敛（文档声称）。vibe-kanban/Kangentic/Codeg 用 worktree 分离通常的写入目标，不是禁止跨目录读取/写入（分别代码/文档级）。因此不能说“全都是提示”，也没有确认能直接替代 Helm 沙箱的团队文件锁。

建议保留每卡/每次验证的独立导出目录、系统读写约束和 runtime 独占提交/合并。文件 lease 可辅助成员发现潜在重叠与主动协调，不能作安全边界；最终合并必须依据基线和验收产物检查冲突。task claim 原子锁、mailbox 写锁、文件权限、合并冲突检查解决的是四个不同问题，报告与实现都应分开记录。任务019已给出的目录禁读证据继续适用其限定范围，不能由这里的源码阅读扩大到所有平台。

### ④ 看板：依赖解锁、认领与硬关口

OpenCode tools 分支（已核实〔代码〕）最直接：共享任务状态、depends_on、写锁 claim、complete 重新计算 blocked→pending；Claude 官方文档（文档声称）也提供自动依赖解锁和拉取/指派并存。GNAP 的 Agent/Task/Run/Message 与 retry 不终结任务的模型适合借鉴，但只有规范，没找到原子 claim runtime。vibe-kanban 有 blocking relationship，不足以证明自动依赖调度。

建议 Helm 从这些方案借鉴机制，保留自己的成功条件：依赖解锁依据由批准的卡片规格与 runtime 状态定义，通常应依赖已验收/合并的产物，不能直接以“执行者自报 completed”解锁。开/拆卡先形成提议，批准后才改变生效图；检验未知依赖、自环、环和更改规格后的影响。claim 必须在 runtime 事务中比较版本和 owner 并更新，不依赖进程内锁保护多个 MCP 子进程；负责人指派也走同一事务。

**不要照搬 OpenCode 的 cancelled 视作依赖成功、过滤不存在依赖、任意 complete 就结束任务。** Helm 必须区分未批准、待依赖、可认领、执行、待独立验证、待人验收、可合并/已合并、退回/取消；状态转换由硬关口和证据决定，成员只能请求，不得直接跳到 merged。Claude 的计划批准、框架的可选审批、worktree UI 的 Review 都未确认等价于本任务要求的五阶段强制链。

### ⑤ 信息流标签：研究有依据，现成 CLI 实现仍未确认

FIDES（文档声称，论文§4–6）与 CaMeL（文档声称）确实提出数据来源/可读主体及派生结果标签传播和调用前政策检查。当前 Microsoft Agent Framework 官方文档还有 Python FIDES middleware，但它接管的是自己的 content/tool chain，不能推定覆盖 Codex 的所有文件读取与 shell。只有 MetaGPT cause_by、Agent Mail topic、GNAP tags 或框架订阅可见视图，不构成读取污染传播。

建议 Helm 用会话级保守 taint：读入资料/工具返回/收到消息时，对读取标签取并集；之后该会话产生的普通消息、卡片提议、描述/摘要、附件及链接元数据都继承，收件人政策在序列化/投递**之前**检查。用 readers 表示则保密主体集合相交；转发、改写、广播、摘要不能清除标签。同一会话续接或上下文压缩不会抹掉曾读标签。换验证席位需要新会话及独立目录权限，不能用“换名字/角色”降密。

MCP 返回时 runtime 知道所返回内容的标签；**任意 shell/file 读取不是天然可观察**。因此还需按可读目录/上下文包给会话预先保守赋予相应最大标签，或确保全部敏感读取走可审计接口。模型 stdout 工具事件不完整的背景来自任务019/FEATURES；不能指望模型自报“读了什么”维持独立性。runtime 私有数据库、label policy 与审计导出必须不在 agent 可读写范围。

新增的 [multi-CaMeL 论文§IV](https://arxiv.org/html/2610.05640v1)（文档声称）直接研究 agent 边界：可信自然语言 instruction 与 opaque variables/data 分开，保留 capabilities/provenance，并在 runtime 禁止工具派生数据进入可信指令通道。对 Helm 的推导是，`提交证据`/`没通过的项` 要有明确 schema、字段允许的来源/降密规则、目标产物版本和 runtime 批准权；**格式固定本身不自动保证可安全降密**，自由文本字段仍可污染。普通消息应保留“来自 agent”的来源，不能像终端 paste 一样洗成用户授权。标签政策负责隔离，schema/人批准负责有限解密，两者都应留下审计。

这不是已证明适用于所有 Codex 工具的形式安全保证。保守会话标签会过度限制协作，控制流/时序/任务状态等隐式泄露也不能据 FIDES 的 explicit secrecy 保证直接排除；需要明确 Helm 的威胁模型与哪些降密是授权的。本任务未运行研究实现或攻击实验。

### ⑥ 给下一个实测任务的建议

以下只是建议，**本任务未实施任何用例**。建议用自编最小 stdio MCP 服务/外部调度脚本模拟其他成员发信，不安装这些被调研项目；每轮固定 Codex 二进制版本/模型/argv、禁网权限配置、独立工作目录；MCP 参数从启动时绑定身份，不让测试 agent 自报席位。记录 MCP 请求/完整响应/时间、消息状态、进程事件、工具记录与最终产物。发送内容采用 agent 事先不知道的随机 marker，别在初始 prompt 中泄露。不要仅凭 UI 显示、CLI exit 0 或工具返回文本出现 marker 判定模型已消费。

| 用例 | 做法 | 判定标准 |
|---|---|---|
| T1 非信箱工具返回夹带 | 启动一次 `codex exec`，先调用 runtime 的 `get_card`。外部脚本在收到第一次调用后入队随机指令；下一次 `claim_card`/`get_card` 的结果附 envelope（不要求 `fetch_inbox`）。要求后续产物按该随机指令变化 | 同一 PID/session、未退出/resume、在明确 tool response 之后生成符合随机指令的动作/产物，证明运行中读取；保存工具和产物时间。若只在最终总结复述消息则不足以证明及时改变行为 |
| T2 阻塞等信与竞态 | `wait_messages` 先查 backlog，再等待；分别在请求前、刚开始等、timeout 边界发信；加无消息 timeout 对照，继续同一 exec | 已有消息立即返回；等待中消息能唤醒并被下一行为使用；无消息返回规范 timeout；边界无丢消息，消息最终可按 id ack。Codex/MCP timeout 或取消必须记录，不能死等 |
| T3 完全不调用 runtime 的负对照 | agent 完成一次 runtime 调用后，进入长 shell 工具或连续生成且不再调用 runtime；期间外部脚本发消息，与 T1 相同 marker | 在没有新的 runtime result 时，不宣称 piggyback 已送达；明确延迟直到下一 runtime 调用，或进程退出后仍 pending。若观察到送达，必须定位另外的已启用 hook/通知/客户端注入来源 |
| T4 原始 MCP notification | 与 T1 同配置，单独在 stdout 发送客户端支持的标准 notification（严格合法 JSON-RPC），不附在工具 result；对照组在工具 response 内附 marker | 只有通知 marker 引发同一运行中后续行为才算模型可见；只出现在协议日志/UI不算。客户端拒绝/忽略、不触发上下文须如实记录。该通道默认不能作可靠设计前提 |
| T5 多工具/多消息与确认 | 在连续或并行 runtime 调用之间入队多条序号不同消息，包含一次响应后断连、重试和明确 ack；测试分页/cursor、广播部分拒绝 | 不丢消息、不重复执行有副作用动作；重送保留同 id，ack 前状态可恢复；“已返回”与“已 ack”分开。能定位重复读取及其原因，不能因 drain 后队列空便判 exactly-once |
| T6 退出/中断后的兜底 | 消息在自然 end_turn 前后或 SIGTERM 前后入队；用同 UUID resume（另轮进程）传递仍待收消息；不可把这一轮当 T1 成功 | 正确标为“续接时投递”，原会话标签/消息状态延续，无重复副作用；自然结束前未取出的消息不消失；恢复失败有显式升级路径 |
| T7 标签、转发与专用通道 | 构造 exec-X、verify-X、另一成员的假标签；发直达、摘要转发、广播、附件/链接、上下文压缩后转发；另以固定 schema 提交产物证据与失败项 | verify-X 从普通渠道拿不到 exec-X marker，违规在返回正文前拒绝并审计；中转/压缩不洗标签。专用渠道只放行批准 schema/产物版本/字段，无自由文本越权；测试消息预览、数量等元数据是否按政策过滤 |
| T8 项目级 hook 备选 | 独立假项目中用自编最小 PostToolUse hook，测试 plain stdout 与 additionalContext；运行中外部入队，hook 从允许的本地文件/stdio中介检查，禁用 HTTP；不改全局配置。再用 legacy notify 作单独对照 | 分开判“hook 是否触发”“客户端是否把结果进模型”“agent 是否再取正文”。若 only提醒，则记录正文仍需主动工具；plain/notify 没消费不能宣称成功。配置被信任/未信任两组分别记录 |

优先执行 **T1、T2、T3、T6、T7**，先确认最小方案与失败边界；T4/T8 仅在要寻找无需专用工具检查的备选时追加。测试中若对网络权限、hook 支持或配置信任的条件有所改变，作为独立组，不把一个组的成功推广到禁网组。网络测试只服务于所用传输条件，不再次混入本任务调研结论。
