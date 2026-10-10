# 任务 003：调研——执行编排的通用模板与动态生成

## 背景

Helm 是一个通用 ADE。每个项目是一张**项目流程**图，图中每个**节点**是一份「需求 · 边界 · 测试」项目，由一个执行代理负责交付，之后由核对、挑错席位在新上下文中独立复核，最后由人验收。

正在设计的新能力：节点内部可以使用**执行编排**（借鉴 Claude Code 的 dynamic workflows）。节点的主对话针对当前任务生成一份编排，由 **runtime**（Helm 的后台程序，不是代理，不做判断）执行：启动子代理、并行、流水线、循环、记录每一步结果、执行终止条件和上限、中断后恢复。执行者是 Codex CLI。

本任务**只做调研、只写文档**，为后续设计「各模式的通用模板 + 编排如何生成与执行」提供依据。

**先读这些文件：**
- `FEATURES.md`：当前功能规格 v3（其中"工作流"指项目流程图，"Hub"后续将改名为 runtime）
- `DESIGN.md`：早期设计，含架构和长任务纪律

## 待调研的模式清单

| 类 | 模式 |
|---|---|
| 结构 | 单步、顺序、并行汇总、批量清单（枚举 → 逐项处理 → 逐项验证）、分类分流 |
| 循环 | 生成-验证（直到测试通过）、指标优化（保留更好、回滚更差）、轮询等待 |
| 质量 | 对抗验证、多视角评审、生成后筛选（best-of-N）、竞赛比较 |
| 控制 | 人工关卡、对齐点、定时触发 |

## 要回答的问题

1. **已有实现**：下列项目如何表达和执行这些模式？每个给出：编排的表示形式（代码 / DSL / 图 / JSON）、核心原语、并行与循环怎么写、结构化输出、错误与重试、持久化与恢复、开源许可证。
   - Claude Code dynamic workflows（`agent()` / `parallel()` / `pipeline()`、限制、保存到 `.claude/workflows/`；官方文档和可信第三方资料，注明哪些细节来源不一致）
   - Anthropic claude-cookbooks 的 Building Effective Agents 示例（`anthropics/claude-cookbooks`）
   - OpenAI Agents SDK、Codex CLI 自身的多代理能力（本机 `codex features list` 显示 `multi_agent` 为 stable；`codex exec --output-schema`）
   - LangGraph（含 Send / map-reduce、checkpoint、interrupt）
   - Mastra workflows（`.then` / `.parallel` / `.branch` / `.foreach` / `.dowhile` 等）
   - Temporal 或其他持久化执行（durable execution）框架：确定性重放、幂等
   - 其他你认为相关的（例如 CrewAI Flows、AutoGen / AG2、Inngest AgentKit），最多再选 3 个
2. **编排如何生成**：比较三种方式——模型自由写代码、从模板选择并填参数、生成受约束的 JSON / DSL。各自的可控性、可审阅性、校验方式、安全性。已有项目分别用了哪种。
3. **编排如何安全执行**：如果编排是模型写的代码，有哪些沙箱方案（例如 Node `vm`、isolated-vm、QuickJS 等）及其限制；如何禁止编排脚本直接读写文件或执行命令。
4. **中断恢复与幂等**：步骤结果日志 + 重放、禁用 `Date.now()` / `Math.random()` 等做法；有副作用的步骤（提交、合并、发布）如何避免重复执行。
5. **逐个模式**：对上面清单里的每个模式，给出：找到的参考实现（链接）、建议的模板参数、终止条件与上限、每项结果状态（通过 / 失败 / 无法验证 / 未处理）如何产生、需要交给核对者的证据。
6. **给 Helm 的建议**：编排的表示形式、生成方式、沙箱方案、执行日志设计、`agent()` 如何映射到 `codex exec`（含 `--output-schema`、`resume`、`--json`），以及最小可行的模板集合（demo 先做哪几个）。

## 不要做的内容

- 不修改仓库中任何已有文件；不写实现代码、不安装依赖到项目中。
- 可以写小的试验脚本验证 Codex CLI 行为（例如 `--output-schema` 的效果），但放在 `research/scratch/` 下，调研完删除，不要提交。
- 不调用任何付费或需要登录的外部服务；不发布任何内容。
- 不确定的信息要明确标注"未核实"，不要编造 API 或参数。

## 交付物

1. `research/workflow-templates.md`（中文）：按上面 6 个问题组织，每个结论附来源链接（优先官方文档和源码），文末给出来源列表。
2. 篇幅控制：正文不超过约 600 行；比较类内容尽量用表格。

## 验收标准

- 6 个问题都有回答；第 5 条覆盖清单中全部 15 个模式（找不到参考实现的写"未找到"）。
- 第 1 条每个项目都有表示形式、原语、持久化与恢复、许可证四项。
- 每个事实性结论有来源链接；推断和建议与事实分开写，并标明是推断。
- 关于 Codex CLI 的结论若来自本机试验，写明命令和结果（`codex-cli 0.160.1`，可执行文件 `~/.codex/packages/standalone/current/bin/codex`）。
- `research/scratch/` 已清理；`git status` 中只新增 `research/workflow-templates.md`。

## 报告要求（中文）

写到 `-o` 指定的报告文件：完成情况、各问题的一句话结论、"未核实"的条目清单、对 Helm 的核心建议（不超过 5 条）、交付物路径。
