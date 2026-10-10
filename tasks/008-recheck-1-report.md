完整复跑 S01–S18 一次：**307 PASS / 0 FAIL**。上次 4 条 FAIL 全部转为 PASS，其余 227 条保持通过；新增 76 条链接检查全部通过，没有新 FAIL。任务 A 回归未重跑。

[完整报告及证据索引](/Users/dikui/Project/Helm/evidence/008/recheck-1/report.md)。新截图、断言、控制台记录均保存到 `evidence/008/recheck-1/`，未覆盖原证据。

**各场景结果**

下表截图均位于 `evidence/008/recheck-1/`。共 33 张整页截图，另保留 33 张原生图。各场景看到的问题均为“无”。

| 场景 | 结论 | 截图文件 |
| --- | --- | --- |
| S01 | PASS：10 个分组，新增四组各有条目。 | `S01-inbox.png` |
| S02 | PASS：并行汇总、五步四态结果及两类异常验收报告齐全。 | `S02-market-orchestration.png` |
| S03 | PASS：计划 JSON、五条校验、步骤输入摘要与结构化输出可见。 | `S03-plan-checks-step.png` |
| S04 | PASS：第二次 38/38；首次 31/34，三项失败逐项列出；尝试字段齐全。 | `S04-01-second-attempt.png`、`S04-02-first-attempt-failures.png` |
| S05 | PASS：实现两次尝试及副作用状态不明示例可见。 | `S05-implementation-attempts.png` |
| S06 | PASS：重新规划进度为 2/2、100%。 | `S06-replanning-progress.png` |
| S07 | PASS：批准发现后新增节点进入流程并继承资料来源。初始无阻塞型发现，暂停依赖分支不适用。 | `S07-01-discovery-before.png`、`S07-02-new-node-sources.png`、`S07-03-project-flow.png` |
| S08 | PASS：记忆四类、废弃决策取代者齐全；新增指令合并到节点强制边界。 | `S08-01-memory-before.png`、`S08-02-boundary-before.png`、`S08-03-memory-after.png`、`S08-04-boundary-after.png` |
| S09 | PASS：待确认设计决策确认后显示有效。 | `S09-01-decision-before.png`、`S09-02-decision-active.png` |
| S10 | PASS：批准对象与示意哈希可见，批准后关卡步骤通过。 | `S10-01-gate-before.png`、`S10-02-gate-pass.png` |
| S11 | PASS：核对后标记完成成功，决策记录包含该决定。 | `S11-01-completed.png`、`S11-02-decision-record.png` |
| S12 | PASS：自主度默认值正确，设计决策与未知副作用始终由人。 | `S12-autonomy-defaults.png` |
| S13 | PASS：双模型配置齐全，内置模板默认值符合 FEATURES §5。 | `S13-agent-models.png` |
| S14 | PASS：项目预算、已用花费及节点花费正确。 | `S14-project-a-budget.png`、`S14-project-b-budget.png`、`S14-node-cost.png` |
| S15 | PASS：15 个模式，P0/P1/P2/后续分别为 6/3/5/1。 | `S15-orchestration-templates.png` |
| S16 | PASS：26 页、104 个可见状态术语扫描无禁用词；追加浅色链接检查。 | 无截图要求；`terminology-scan.json` |
| S17 | PASS：深色三页、原四类对比度及额外链接检查均通过。 | `S17-01-dark-inbox.png`、`S17-02-dark-market.png`、`S17-03-dark-memory.png`、`S17-04-dark-decisions-links.png` |
| S18 | PASS：窄屏三页无横向滚动或逐字换行，正文宽度达标，步骤图无重叠、溢出。 | `S18-01-narrow-inbox.png`、`S18-02-narrow-browser.png`、`S18-03-narrow-memory.png` |

**与上次相比**

深色项目记忆引用链接对比度由 **1.757:1 提升至 6.370:1**：

| 链接 | 原失败断言行 | 本次通过断言行 |
| --- | --- | --- |
| 功能规格 | 179 | 233 |
| 实现（Codex） | 180 | 234 |
| 浏览器检查 | 181 | 235 |
| 你审核 | 182 | 236 |

原文件为 `evidence/008/assertions.txt`，本次为 `evidence/008/recheck-1/assertions.txt`。全部 231 条原断言均匹配，没有遗漏或 PASS→FAIL；逐条对应保存在 `comparison.json`。

浅色记忆引用链接对比度从 9.398:1 变为 5.425:1，仍达标。

**额外链接对比度**

通过真实 DOM 的 `getComputedStyle` 测量颜色并合成背景，要求 ≥4.5:1。浅色覆盖全部含可见链接的 18 页；深色覆盖两个项目记忆、市场调研详情和决策记录。

| 页面 | 浅色最低值 | 深色最低值 | 结果 |
| --- | --- | --- | --- |
| 项目 A 记忆 | 5.011:1 | 6.370:1 | PASS |
| 项目 B 记忆 | 5.011:1 | 6.370:1 | PASS |
| 市场调研详情 | 5.011:1 | 6.986:1 | PASS |
| 决策记录 | 5.425:1 | 6.370:1 | PASS |

记忆页浅色最低值来自面包屑，正文引用链接为 5.425:1。完整测量保存在 `contrast-results.json`。

窄屏三页均满足 `scrollWidth=375 <= innerWidth=375`，最小正文宽度分别为 293、309、309px；没有逐字换行，编排三步纵排且无重叠、溢出。

**控制台、方式与清理**

使用 Chrome **154.0.8037.99**、Playwright **1.64.0**，无头浏览器；桌面 1440×900，窄屏 375×812。依赖沿用项目外安装，原检查脚本未修改，副本只适配目录并追加链接检查。

控制台 error、warning、未捕获异常及页面崩溃：**无**，`console.txt` 内容为“无”。仅访问本地服务，端口 54717，未使用 8787。

浏览器已关闭并断开连接；服务 PID 99285 已退出，端口无监听且可重新绑定。只写入复检目录及报告，1126 个原有文件校验均未变，原型与历史证据未修改。