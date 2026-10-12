session-id: 01a131a9-a79b-7963-aaaf-c04234e535e3

# 任务 024：原型 v7 第 2 批浏览器检查报告

检查完成，**本次验收未通过**：19 个场景中 18 个通过，S15 失败。本批 85 条断言：77 PASS、8 FAIL；8 条失败均对应非编辑模式下卡片浮层外点关闭后的焦点丢失。没有修改原型代码。

环境：本机 Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900、浅色，另测 375×812、1024×900、760×900 和深色。静态服务为 `python3 -m http.server 51985 --bind 127.0.0.1 -d prototype`。只访问本地服务。Playwright 复用 `/tmp/helm-006-playwright.cNUInN/node_modules/`，浏览器临时配置位于项目目录外。

已先读 023 报告及交接提示、023 任务、FEATURES.md 10.1/10.2/10.4/8.2/第 11 节项目 A。所有业务操作通过 UI，evaluate 只读取 DOM/数据、等待浏览器帧或滚动。访谈通过“重新演示”追加两轮；确认、修改和驳回各刷新回初始 Demo。仅有一组待批准新范围，修改与驳回在独立重置的页面中检查同一 Demo 提议。待验收检查跳转已有详情，完整验收界面属于第 4 批。

本批脚本：`evidence/024/browser-check.mjs`；最终断言：`evidence/024/assertions.txt`；原始测量：`evidence/024/results.json`；截图全清单：`evidence/024/screenshots.txt`。下表列主要截图，路径均相对仓库根目录。

| 场景 | 结论与检查内容 | 看到的问题 | 主要截图（均在 evidence/024/） |
|---|---|---|---|
| S01 | PASS；顶栏全部字段、项目收件箱 4/全局 8；暂停提示第 3 批；对话在右侧 | 无 | [S01-layout.png](../evidence/024/S01-layout.png) |
| S02 | PASS；看板可用宽度 756 → 1136 → 756px；页面与看板容器无横向溢出 | 无 | [S02-collapsed.png](../evidence/024/S02-collapsed.png)<br>[S02-expanded.png](../evidence/024/S02-expanded.png) |
| S03 | PASS；详情覆盖对话，底层 inert，关闭回 a-tech 原卡 | 无 | [S03-detail.png](../evidence/024/S03-detail.png)<br>[S03-return.png](../evidence/024/S03-return.png) |
| S04 | PASS；历史两轮四题，推荐答案/需求/边界/验收标准齐全；下一轮锁定；逐题、单题采纳、整轮采纳均显示答案 | 无 | [S04-history.png](../evidence/024/S04-history.png)<br>[S04-answered-round.png](../evidence/024/S04-answered-round.png)<br>[S04-second-round.png](../evidence/024/S04-second-round.png) |
| S05 | PASS；已确认五卡规格摘要，组织理由为“四个维度互不依赖，并行最快” | 无 | [S05-proposal-reason.png](../evidence/024/S05-proposal-reason.png)<br>[S05-confirmed-proposal.png](../evidence/024/S05-confirmed-proposal.png) |
| S06 | PASS；待批准新范围跳到对话提议；确认后交付准备、交付实施进入交付组，均待开工 | 无 | [S06-pending.png](../evidence/024/S06-pending.png)<br>[S06-jump.png](../evidence/024/S06-jump.png)<br>[S06-board-after-confirm.png](../evidence/024/S06-board-after-confirm.png) |
| S07 | PASS；改为“024 新交付准备”；空驳回理由被拒绝；修改和带理由驳回均写决策 | 无 | [S07-modified-board.png](../evidence/024/S07-modified-board.png)<br>[S07-modified-decision.png](../evidence/024/S07-modified-decision.png)<br>[S07-rejected-decision.png](../evidence/024/S07-rejected-decision.png) |
| S08 | PASS；仅四组；逐组点开事项，焦点到对应对话/详情/事项；追加预算后全局 8 → 7 | 无 | [S08-four-groups.png](../evidence/024/S08-four-groups.png)<br>[S08-jump-a-gate.png](../evidence/024/S08-jump-a-gate.png)<br>[S08-jump-review-a-tech.png](../evidence/024/S08-jump-review-a-tech.png)<br>[S08-jump-a-budget.png](../evidence/024/S08-jump-a-budget.png)<br>[S08-processed.png](../evidence/024/S08-processed.png) |
| S09 | PASS；市场调研上限与花费均 ¥12.20；B 对外申请和副作用状态不明有示例标记 | 无 | [S09-budget.png](../evidence/024/S09-budget.png)<br>[S09-hard-items.png](../evidence/024/S09-hard-items.png) |
| S10 | PASS；“来自卡「窄屏溢出诊断」的成员”；回答后事项移出收件箱 | 无 | [S10-question.png](../evidence/024/S10-question.png)<br>[S10-removed.png](../evidence/024/S10-removed.png) |
| S11 | PASS；A 为 a-tech/a-summary/a-market；B 为 b-browser/b-implement/b-defect-diagnose/b-defect-fix；图、列均与收件箱关联卡一致 | 无 | [S11-a-graph.png](../evidence/024/S11-a-graph.png)<br>[S11-a-columns.png](../evidence/024/S11-a-columns.png)<br>[S11-b-graph.png](../evidence/024/S11-b-graph.png)<br>[S11-b-columns.png](../evidence/024/S11-b-columns.png) |
| S12 | PASS；项目指令、项目要求、授权说明保存后显示日期与修改人“你”；新增三条修改前后决策 | 无 | [S12-instructions.png](../evidence/024/S12-instructions.png)<br>[S12-requirements.png](../evidence/024/S12-requirements.png)<br>[S12-authorization.png](../evidence/024/S12-authorization.png)<br>[S12-decisions.png](../evidence/024/S12-decisions.png) |
| S13 | PASS；从新建表单创建产品开发项目；默认不同模型审查、界面浏览器截图要求进入项目记忆 | 无 | [S13-default-form.png](../evidence/024/S13-default-form.png)<br>[S13-default-memory.png](../evidence/024/S13-default-memory.png) |
| S14 | PASS；决策者、理由、采纳情况/率；自己的决定无撤销按钮；两次撤销各保留原记录并新增记录；实现已验收→进行中、修复待开工→草稿 | 无 | [S14-implement-before.png](../evidence/024/S14-implement-before.png)<br>[S14-revoked-decision.png](../evidence/024/S14-revoked-decision.png)<br>[S14-implement-after.png](../evidence/024/S14-implement-after.png)<br>[S14-fix-before.png](../evidence/024/S14-fix-before.png)<br>[S14-fix-after.png](../evidence/024/S14-fix-after.png) |
| S15 | FAIL；新建卡浮层、详情外点关闭通过；筛选取消后的图/列焦点退到看板容器通过；卡片浮层外点关闭失败 | 非编辑模式下卡片菜单及修改分组/添加依赖/管理连线子菜单关闭后焦点落 BODY，详见下文 | [S15-mouse-node-open.png](../evidence/024/S15-mouse-node-open.png)<br>[S15-mouse-node-outside.png](../evidence/024/S15-mouse-node-outside.png)<br>[S15-keyboard-groups-outside.png](../evidence/024/S15-keyboard-groups-outside.png)<br>[S15-detail-outside.png](../evidence/024/S15-detail-outside.png)<br>[S15-filtered-graph.png](../evidence/024/S15-filtered-graph.png)<br>[S15-filtered-columns.png](../evidence/024/S15-filtered-columns.png) |
| S16 | PASS；从初始 B 用 Tab/Enter 切到 A，回答访谈、确认整组、打开详情、Esc 关闭全部只用键盘；关闭回交付准备卡 | 无 | [S16-keyboard-answer.png](../evidence/024/S16-keyboard-answer.png)<br>[S16-keyboard-detail.png](../evidence/024/S16-keyboard-detail.png)<br>[S16-keyboard-return.png](../evidence/024/S16-keyboard-return.png) |
| S17 | PASS（逐条更新旧预期后）；复制的三套第 1 批脚本共 670/670；原样结果和适配 diff 保留 | 原样 8 条失败属于旧预期/旧坐标；该套编辑态夹具未覆盖 S15 非编辑态缺陷 | [S17-regression-context.png](../evidence/024/S17-regression-context.png) |
| S18 | PASS；动画结束后对话、详情都是 x=0、375×812 全屏并有返回；收件箱和记忆页无横向滚动 | 无 | [S18-conversation.png](../evidence/024/S18-conversation.png)<br>[S18-detail.png](../evidence/024/S18-detail.png)<br>[S18-inbox-top.png](../evidence/024/S18-inbox-top.png)<br>[S18-inbox-bottom.png](../evidence/024/S18-inbox-bottom.png)<br>[S18-memory-top.png](../evidence/024/S18-memory-top.png)<br>[S18-memory-bottom.png](../evidence/024/S18-memory-bottom.png) |
| S19 | PASS；深色访谈/提议、收件箱、决策截图；实际文字 ≥4.5:1、抽查图形 ≥3:1；1024/760 额外布局检查 | 无 | [S19-dark-interviews.png](../evidence/024/S19-dark-interviews.png)<br>[S19-dark-proposal-reason.png](../evidence/024/S19-dark-proposal-reason.png)<br>[S19-dark-inbox.png](../evidence/024/S19-dark-inbox.png)<br>[S19-dark-decisions.png](../evidence/024/S19-dark-decisions.png)<br>[S19-dark-1024.png](../evidence/024/S19-dark-1024.png)<br>[S19-dark-760.png](../evidence/024/S19-dark-760.png) |

**需修复的问题（只记录）**：S15 在 1440×900 浅色、项目 B、默认非编辑依赖图中，对“窄屏溢出诊断”用鼠标或 Tab/Enter 打开卡片菜单；也分别进入修改分组、添加依赖、管理连线；外点 `(260,10)` 的非交互空白区域。八种组合均在 pointerdown 时关闭浮层，pointerup 及等待 100ms 后活动元素仍为 `BODY`。此前 `(1380,30)` 也复现。完整三阶段焦点轨迹在 assertions.txt/results.json，八组开/关截图以 `S15-mouse-*`、`S15-keyboard-*` 命名。新建卡按钮浮层的两种入口及详情外点关闭都正确回焦点。

与第 1 批回归的差异：P03 夹具会点“编辑看板”，编辑模式下菜单按钮一直可见，因此它通过不能排除默认非编辑模式的失败。静态 CSS 显示 `.flow-card-menu` 默认 `visibility:hidden`，只有 hover/focus-within/编辑状态才显示；失去原 hover/focus 后尝试恢复隐藏按钮可能是原因（推断，未改代码）。除该焦点问题，截图审阅未发现额外重叠、文本不可读、非预期截断、页面横向溢出或文案不清；长对话和看板按设计内部滚动。

**第 1 批回归**：从 `evidence/022/recheck-3/` 原样复制并运行 `browser-check.mjs`、`p-check.mjs`、`p-followup.mjs`。原样结果依次为 368/371、233/235、52/55；v7 预期副本依次为 380/380、235/235、55/55，共 670 PASS、0 FAIL。主脚本原样详情场景提前异常，改查询后得以执行后续 9 条断言，故总数增加。原样脚本/结果带 `original-` 或 `browser-check-original`，最终适配差异为 `regression-022/final-*.diff`。仅改证据脚本；截图记录路径统一指向本次目录。

| 原样失败 | 判断与本次副本调整 |
|---|---|
| 主 S06：只看我要处理的只期待 b-browser | v7 应包含所有收件箱关联卡；改期待集合为 inboxItems 的 cardIds，保留两视图一致及筛选保留断言。 |
| 主 S15：#main h1 匹配两项并触发 strict mode | 覆盖详情保留底板是预期布局；标题查询限定 .card-detail h1 并 trim，后续规格/依赖/尝试/真实会话全部通过。 |
| 主 S16：收件箱必须有 .card | 新收件箱为 .inbox-group；只调整收件箱容器查询，保留文本、无旧机制、控制台断言。 |
| P02：原“右边缘”卡坐标 x=993，未左翻 | 加对话后旧夹具不再靠近视口右边缘；仅此边缘案例收起对话，恢复真实右边缘条件，仍验证视口内与左翻间距。 |
| P03：筛选取消后必须回已消失的按钮 | 原卡取消后退出 draft 筛选；改为取消前顺序的后邻/前邻卡（空板回容器），符合 023 明确修复要求。 |
| P-followup P03 两条：groups 外点(300,85)后又有菜单、未回原入口 | 新布局/滚动下旧坐标触发另一个可交互目标；移到非交互空白(260,10)，保留 down/up/settled 全阶段关闭及回焦点断言，编辑模式下通过。 |
| P-followup P03：无筛选取消要求同一 onclick | 实际回同一卡的卡片节点，符合“卡片或按钮”；只在此案例改为同一 cardId，保留浮层关闭、焦点在浮层外断言。 |

回归其余 S01–S18、R01–R07、N01/N02、Q01–Q03、P01–P06 均通过，包括实际 SVG 几何/连线穿卡采样、子卡折叠、状态列、依赖拖拽和非法依赖、新建/分组/取消、真实来源、窄屏/深色、浮层滚动稳定性与间距。全部具体断言、测量和截图在 `evidence/024/regression-022/`，各场景摘要在对应 results.json。

**对比度**：按真实 computedStyle 取文字/边框颜色，沿 DOM 祖先合成透明背景，计算 WCAG 相对亮度比。数值为所抽查元素最低值；不代表每个可能状态的全量审计。

| 页面 | 文字样本/最低值 | 边框图形样本/最低值 |
|---|---:|---:|
| 浅色对话 | 73 / 5.487:1 | 29 / 3.959:1 |
| 浅色收件箱 | 29 / 5.572:1 | 17 / 3.959:1 |
| 深色对话 | 73 / 7.418:1 | 29 / 5.704:1 |
| 深色收件箱 | 38 / 7.937:1 | 22 / 5.704:1 |
| 深色决策 | 58 / 7.937:1 | 7 / 6.370:1 |

**控制台**：本批及三套回归（原样与适配）console.txt 均为“无”；0 error、0 warning、0 pageerror/未捕获异常、0 失败请求、0 favicon 404。旧断言和本批初始选择器错误为检查脚本异常，不是浏览器控制台异常。初始测量误把带右侧 padding 的 board-content 全宽当可用宽度，已改测 board-surface；窄屏详情第一次在 150ms 滑入动画中测得 x=25，等待 250ms 后 x=0，本次不将动画中间帧误报成布局缺陷。初始记录保存在 `initial-*`，最终 assertions.txt 没有选择器异常。四个最终检查脚本 `node --check` 均通过。

**清理与范围**：静态服务已正常退出，51985 已不可连接；各脚本 finally 关闭 context/browser，没有本任务 node/server 或 Playwright Chrome 残留。详见 `evidence/024/cleanup.json`。保护文件 SHA-256 对比：已有文件修改 0、删除 0；本任务仅写 evidence/024/ 和本报告。开始时工作区已有 023 的三个原型文件改动、evidence/023/ 和若干任务文件；检查期间另外出现 `tasks/025-members-mailbox.md`，本任务未创建或修改它。因此完整 git status 并非只有本任务两项；保留他人文件，没有为满足字面状态要求清除它们。范围证据为 `protected-before.json`、`scope-check.json`、前后 git-status 文件。

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
?? tasks/024-dialog-inbox-browser-check.md
?? tasks/024-report.md
?? tasks/025-members-mailbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
