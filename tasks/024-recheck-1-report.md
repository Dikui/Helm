session-id: 01a131b6-4bfd-7a63-ae27-c66cf3ff109a

**任务 024 复检 1 报告**

复检通过：S01–S19 全部通过（85 条断言），R01–R03 全部通过（74 条断言），第 1 批完整回归 670/670 PASS。汇总 829 PASS、0 FAIL。未修改原型代码或已有证据。

环境与 024 一致：本机 Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900 浅色，另测 375×812、1024/760px 和深色。静态服务为 `python3 -m http.server 55654 --bind 127.0.0.1 -d prototype`，未使用 8787。页面请求仅允许本地服务（回归允许内联 data URI）；浏览器配置与缓存位于项目外的系统临时目录，实际路径见 [environment.json](../evidence/024/recheck-1/environment.json)。所有业务操作经 UI；evaluate 仅读取 DOM/Demo 数据、滚动或等待浏览器帧。

结果：[assertions.txt](../evidence/024/recheck-1/assertions.txt)、[console.txt](../evidence/024/recheck-1/console.txt)；完整截图清单：[screenshots.txt](../evidence/024/recheck-1/screenshots.txt)。主脚本 [browser-check.mjs](../evidence/024/recheck-1/browser-check.mjs) 从 024 复制，补测脚本 [supplement.mjs](../evidence/024/recheck-1/supplement.mjs)；第 1 批复制脚本及结果位于 `evidence/024/recheck-1/regression-022/`。

**R01–R03**

| 编号 | 结果与核对 | 截图 |
|---|---|---|
| R01 | PASS，38/38。普通浏览/编辑 × 鼠标/Tab+Enter × 卡片菜单/修改分组/添加依赖/管理连线，共 16 组；键盘子菜单也用方向键/Enter。外点 (260,10)，pointerdown、pointerup、100ms 后均关闭并回同一可见卡片，均非 BODY。另测两模式 Shift+F10/Esc 与菜单进入详情/Esc 返回。 | [R01-browse-keyboard-groups-outside.png](../evidence/024/recheck-1/R01-browse-keyboard-groups-outside.png)<br>[R01-edit-mouse-lines-outside.png](../evidence/024/recheck-1/R01-edit-mouse-lines-outside.png) |
| R02 | PASS，12/12。截图可直接读到侧栏“收件箱 · 全部项目”、顶栏“本项目收件箱”。A/B 初始全局 8、本项目 4；批准 B 的示例申请后全局 7、B 3、A 仍 4。数字同时与派生事项集合和实际收件箱列表项目来源计数核对一致。 | [R02-a-initial.png](../evidence/024/recheck-1/R02-a-initial.png)<br>[R02-b-processed.png](../evidence/024/recheck-1/R02-b-processed.png)<br>[R02-a-after-b-processed.png](../evidence/024/recheck-1/R02-a-after-b-processed.png) |
| R03 | PASS，24/24。A/B × 1440/1024/760/375px 项目页，项目预算、花费各出现一次，均在顶栏；“示例 · 元；非真实账单”仍在且只出现一次。无页面横向溢出。 | [R03-a-1440-project.png](../evidence/024/recheck-1/R03-a-1440-project.png)<br>[R03-b-1440-project.png](../evidence/024/recheck-1/R03-b-1440-project.png)<br>[R03-a-375-project.png](../evidence/024/recheck-1/R03-a-375-project.png) |

**完整重跑 S01–S19**

| 场景 | 结论与检查内容 | 主要截图 |
|---|---|---|
| S01 | PASS，5/5；顶栏字段、暂停提示、看板右侧对话及浅色对比度 | [S01-layout.png](../evidence/024/recheck-1/S01-layout.png) |
| S02 | PASS，4/4；对话收起后变宽、展开后恢复，无页面横向溢出 | [S02-collapsed.png](../evidence/024/recheck-1/S02-collapsed.png) |
| S03 | PASS，3/3；详情覆盖对话、底层 inert，关闭回原卡 | [S03-return.png](../evidence/024/recheck-1/S03-return.png) |
| S04 | PASS，6/6；两轮访谈、推荐答案/类型、逐题/整轮回答及下一轮锁定 | [S04-second-round.png](../evidence/024/recheck-1/S04-second-round.png) |
| S05 | PASS，2/2；已确认五卡的规格摘要及组织理由 | [S05-proposal-reason.png](../evidence/024/recheck-1/S05-proposal-reason.png) |
| S06 | PASS，3/3；新范围在待批准，跳到对应提议，确认后两卡进看板 | [S06-board-after-confirm.png](../evidence/024/recheck-1/S06-board-after-confirm.png) |
| S07 | PASS，4/4；修改标题、拒绝空驳回理由及两类决策记录 | [S07-rejected-decision.png](../evidence/024/recheck-1/S07-rejected-decision.png) |
| S08 | PASS，8/8；四组事项跳转、处理后移除且计数减一 | [S08-processed.png](../evidence/024/recheck-1/S08-processed.png) |
| S09 | PASS，2/2；市场调研上限与花费一致，B 硬约束标示例 | [S09-hard-items.png](../evidence/024/recheck-1/S09-hard-items.png) |
| S10 | PASS，2/2；成员提问注明来源，回答后移出收件箱 | [S10-removed.png](../evidence/024/recheck-1/S10-removed.png) |
| S11 | PASS，4/4；A/B 的“只看我要处理的”在依赖图和状态列均匹配收件箱关联卡 | [S11-b-columns.png](../evidence/024/recheck-1/S11-b-columns.png) |
| S12 | PASS，4/4；三项自然语言要求保存显示时间/修改人并写决策 | [S12-decisions.png](../evidence/024/recheck-1/S12-decisions.png) |
| S13 | PASS，1/1；产品开发新项目默认要求自动填入 | [S13-default-memory.png](../evidence/024/recheck-1/S13-default-memory.png) |
| S14 | PASS，5/5；决策信息、撤销保留原记录并新增，已验收/待开工状态分别回退 | [S14-implement-after.png](../evidence/024/recheck-1/S14-implement-after.png) |
| S15 | PASS，13/13；普通浏览模式各浮层鼠标/键盘外点回卡片/按钮；详情返回、图/列筛选取消焦点 | [S15-keyboard-groups-outside.png](../evidence/024/recheck-1/S15-keyboard-groups-outside.png) |
| S16 | PASS，4/4；全键盘回答、确认整组、详情打开与 Esc 返回 | [S16-keyboard-return.png](../evidence/024/recheck-1/S16-keyboard-return.png) |
| S17 | PASS，3/3；第 1 批三套脚本完整回归，最终 670/670 | [S17-regression-context.png](../evidence/024/recheck-1/S17-regression-context.png) |
| S18 | PASS，4/4；375×812 对话/详情全屏及返回，收件箱/项目记忆无横向滚动 | [S18-detail.png](../evidence/024/recheck-1/S18-detail.png) |
| S19 | PASS，8/8；深色访谈/提议/收件箱/决策及对比度，1024/760 布局 | [S19-dark-decisions.png](../evidence/024/recheck-1/S19-dark-decisions.png) |

**第 1 批回归与断言调整**

| 完整脚本 | 从 024 复制后首次结果 | 按返工要求调整后的完整结果 |
|---|---|---|
| browser-check.mjs | 380/380 | 380/380（断言无新增调整） |
| p-check.mjs | 224 PASS / 11 FAIL | 235/235 |
| p-followup.mjs | 49 PASS / 6 FAIL | 55/55 |

首次 17 条失败均实际回到同一卡片的可见 SVG 节点，只因旧断言优先比较原菜单按钮 onclick 而失败。返工明确允许回“卡片或触发按钮”，故仅对来源文字为“⋯”的卡片入口，改成相同 cardId 且 tag 非 BODY；新建卡/连线等其他按钮仍保留原 onclick 比较，筛选取消仍保留邻卡/空板逻辑。保留菜单关闭、焦点在浮层外检查。逐条调整如下：

| 脚本/场景 | 调整的原断言 | 新预期 |
|---|---|---|
| p-check / P03 | groups Esc 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | groups 外点 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | groups 提交 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | remove Esc 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | remove 外点 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | remove 提交 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | cancel Esc 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | cancel 外点 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | add Esc 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | add 外点 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-check / P03 | add 提交 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | groups 关闭按钮 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | remove 关闭按钮 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | cancel 关闭按钮 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | add 关闭按钮 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | groups 外点独立复现 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |
| p-followup / P03 | groups 输入框 Enter 关闭后焦点回到原触发卡片／按钮 | 同一可见卡片或触发按钮；不要求相同 onclick |

S01–S19 的业务断言没有变化。S01 原来要求顶栏包含“收件箱”，新“本项目收件箱”仍符合；预算去重和示例说明由 R03 新增严格检查；S15 原来允许卡片/按钮，无需放宽。只更新截图记录目录。所有复制前脚本以 `original-*.mjs` 保留；本次 diff 为 `browser-check.mjs.diff` 和 `regression-022/*.mjs.diff`。首次回归结果/断言/日志以 `initial-*` 保留。

024 原本已经适配 v7 的以下预期，本次直接继承并重跑；对应旧差异副本为 `regression-022/inherited-final-*.diff`：

1. 回归主 S06：我要处理的集合从仅 b-browser 改为所有收件箱关联卡。
2. 回归主 S15：详情标题限定 `.card-detail h1`，避免覆盖详情下保留的主标题影响查询。
3. 回归主 S16：收件箱容器从 `.card` 改为 `.inbox-group`。
4. P02：真实右边缘夹具先收起新增的项目对话，仍检查左翻和间距。
5. P03：筛选取消导致原卡消失时回后邻/前邻卡或空板容器。
6. P-followup P03：groups 外点坐标从 (300,85) 改为非交互空白 (260,10)，仍检查 down/up/settled 的关闭和焦点。
7. P-followup P03：无筛选取消允许回原卡节点，而不是要求同一 onclick。

补测首次因脚本将“批准申请 · 示例记录”错写成精确“批准申请”而等待超时，已修正 UI 定位并完整重跑 R01–R03；未调整产品预期，首次输出保留在 `initial-r-*` 和 `initial-supplement-run.log`。

**新问题：无。** 已人工审阅本批与补测截图及索引图；未见新增重叠、非预期截断、页面横向溢出、焦点丢失或计数文案歧义。长看板/对话的内部滚动符合既有设计。

**对比度与控制台**

| 页面 | 文字样本/最低对比度 | 图形样本/最低对比度 |
|---|---:|---:|
| S01-浅色对话-contrast | 73 / 5.487:1 | 29 / 3.959:1 |
| S08-浅色收件箱-contrast | 29 / 5.572:1 | 17 / 3.959:1 |
| S19-深色对话-contrast | 73 / 7.418:1 | 29 / 5.704:1 |
| S19-深色收件箱-contrast | 38 / 7.937:1 | 22 / 5.704:1 |
| S19-深色决策-contrast | 58 / 7.937:1 | 7 / 6.370:1 |

抽查基于浏览器 computedStyle、透明背景合成和相对亮度计算；文字均 ≥4.5:1、图形均 ≥3:1。第 1 批浮层与看板对比度检查亦通过；仅表示覆盖样本及状态。

主检查、补测、三套回归（初次与最终）控制台均为“无”：0 error、0 warning、0 pageerror/未捕获异常、0 失败请求；回归 HTTP 监测没有 404 或其他 HTTP 错误。旧焦点预期失败和补测按钮选择器超时属于测试断言/定位问题，没有浏览器控制台异常。所有复制及新增 `.mjs` 已通过 `node --check`，结果见 `syntax-check.txt`。

**清理与范围**

全部检查脚本在 finally 关闭浏览器；静态服务 PID 60322 已停止，55654 端口不可连接。本任务浏览器/检查进程无残留；观察到的项目外浏览器临时 profile 已移除。详见 [cleanup.json](../evidence/024/recheck-1/cleanup.json)。

保护文件 SHA-256 对比：5041 个既有文件，修改 0、删除 0；范围外新增 0。只写本次证据目录及本报告。工作区开始时已有三个原型文件改动和多项未跟踪任务/证据；这些均保留，因此完整 git status 含原有内容。

最终 `git status --short`：

```text
 M prototype/app.js
 M prototype/data.js
 M prototype/index.html
?? evidence/023/
?? evidence/024/
?? tasks/023-dialog-inbox.md
?? tasks/023-last-message.md
?? tasks/023-report.md
?? tasks/023-rework-1-last-message.md
?? tasks/023-rework-1-report.md
?? tasks/023-rework-1.md
?? tasks/024-dialog-inbox-browser-check.md
?? tasks/024-last-message.md
?? tasks/024-recheck-1-report.md
?? tasks/024-recheck-1.md
?? tasks/024-report.md
?? tasks/025-members-mailbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
