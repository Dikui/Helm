session-id: 01a13160-e7fd-7943-bc8e-8915208a1714

任务 022 复检 1 已完成，**整体未通过**。S01–S18 完整重跑，18/18 场景、156/156 条原场景断言通过；R01–R07 为 6/7 场景通过，R02 在合法连接松开时失败。另发现两个显示问题，补充为 N01、N02。最终共 **250/254 条断言通过，4 条失败，160 张固定视口截图**。失败分别为 R02 一条、N01 两条、N02 一条。只检查、记录，没有修改原型代码。

已阅读任务要求指定的四份文件，包括返工报告“给浏览器复检的提示”。环境为 Playwright 1.64.0、本机 Chrome 154.0.8037.99 headless；默认 1440×900 浅色，补 375×812、760×812 和深色。静态服务命令 `python3 -m http.server 50763 -d prototype`，仅访问 `http://127.0.0.1:50763`；页面请求限定本地或 data URI。Playwright 复用项目外 `/tmp/helm-006-playwright.cNUInN/node_modules/playwright`，没有新增项目依赖，浏览器临时配置在项目外。

检查脚本：[browser-check.mjs](../evidence/022/recheck-1/browser-check.mjs)，从原 `evidence/022/browser-check.mjs` 复制后适配；原脚本与原证据均未修改。逐行断言：[assertions.txt](../evidence/022/recheck-1/assertions.txt)；详细坐标、颜色、数据与场景统计：[results.json](../evidence/022/recheck-1/results.json)；截图全集：[screenshots.txt](../evidence/022/recheck-1/screenshots.txt)；完整重跑日志：[run.log](../evidence/022/recheck-1/run.log)；补充日志：[supplement.log](../evidence/022/recheck-1/supplement.log)、[feedback-supplement.log](../evidence/022/recheck-1/feedback-supplement.log)。截图尺寸与完整性核对见 [evidence-check.json](../evidence/022/recheck-1/evidence-check.json)，所有场景都有截图和断言。

**R01–R07 逐项结论**

| 编号 | 结论与测量 | 截图路径 |
|---|---|---|
| R01 | **PASS**。真实鼠标合法、成环、自身各一次，另补重复依赖。拖动时遍历所有说明文字，与所有卡片的可见 SVG 文字矩形逐一比较，交集为 0；合法生效，三种拒绝均不改变数据。 | [R01-valid-dragging.png](../evidence/022/recheck-1/R01-valid-dragging.png)、[R01-cycle-dragging.png](../evidence/022/recheck-1/R01-cycle-dragging.png)、[R01-self-dragging.png](../evidence/022/recheck-1/R01-self-dragging.png)、[R01-duplicate-dragging.png](../evidence/022/recheck-1/R01-duplicate-dragging.png) |
| R02 | **FAIL**。按下、途中、到目标、松开前均偏移 0；合法连接松开后，起点连接点和图容器均向下 **74px**，超过 <2px。成环、自身全程 0。详见下文。 | [R02-valid-start.png](../evidence/022/recheck-1/R02-valid-start.png)、[R02-valid-dragging.png](../evidence/022/recheck-1/R02-valid-dragging.png)、[R02-valid-dropped.png](../evidence/022/recheck-1/R02-valid-dropped.png)、[R02-cycle-dragging.png](../evidence/022/recheck-1/R02-cycle-dragging.png)、[R02-self-dragging.png](../evidence/022/recheck-1/R02-self-dragging.png) |
| R03 | **PASS**。375/760×812 均：容器外框高 527.797px <812；clientHeight 526、scrollHeight 1929。原生滚轮使 scrollTop 0→430，页面 scrollY 不变，SVG 上移 430px；设置 scrollTop=100 也生效。整页宽分别 375/760，无横向滚动。 | [R03-375-top.png](../evidence/022/recheck-1/R03-375-top.png)、[R03-375-scrolled.png](../evidence/022/recheck-1/R03-375-scrolled.png)、[R03-760-top.png](../evidence/022/recheck-1/R03-760-top.png)、[R03-760-scrolled.png](../evidence/022/recheck-1/R03-760-scrolled.png) |
| R04 | **PASS**。重新加载，favicon 为 `data:,`。全部检查控制台 error、warning、未捕获异常、失败请求及 HTTP ≥400 均为 0。 | [R04-favicon-console-clean.png](../evidence/022/recheck-1/R04-favicon-console-clean.png) |
| R05 | **PASS**。B 13 卡，SVG 1130×954px；卡片 232.5px 宽、97–113px 高。看完主区最大滚动 **623px**，低于一屏半 1350px；首屏和滚动后两图覆盖全部 13 卡。可见字段完整，卡片无重叠、连线不穿非端点卡、端点最小间距 16px≥12px。 | [R05-first-screen.png](../evidence/022/recheck-1/R05-first-screen.png)、[R05-scrolled.png](../evidence/022/recheck-1/R05-scrolled.png) |
| R06 | **PASS**。A 承接评估 1 块；B 设计、开发、运行时设计、调研、缺陷各 1 块，与返工报告一致。每块显示组名并包住成员，不圈入别组卡。 | [R06-project-A.png](../evidence/022/recheck-1/R06-project-A.png)、[R06-project-B.png](../evidence/022/recheck-1/R06-project-B.png)、[R06-project-B-part2.png](../evidence/022/recheck-1/R06-project-B-part2.png) |
| R07 | **PASS**。新建“已生效”为 `notice-success`，绿字 rgb(22,92,51)、浅绿底 rgb(227,243,234)；自连拒绝为 `notice-error`，红字 rgb(155,44,33)、浅红底 rgb(251,230,227)。补深色两者对比截图。 | [R07-success.png](../evidence/022/recheck-1/R07-success.png)、[R07-error.png](../evidence/022/recheck-1/R07-error.png)、[R07-dark-success.png](../evidence/022/recheck-1/R07-dark-success.png)、[R07-dark-error.png](../evidence/022/recheck-1/R07-dark-error.png) |

分组计数以**首分组标签**为准，第二标签仍在卡内版本行显示。A 总数 1、B 总数 5，没有拆分；B 的运行时设计四卡横排。S04 折叠、展开及 S10 改分组另验证色块和几何。

**S01–S18 重跑结果**

| 场景 | 结论 | 主要截图 |
|---|---|---|
| S01 | PASS：默认 B 依赖图 13 卡；状态着色、五组色块、缺陷三卡示例标记齐全。 | [S01-desktop.png](../evidence/022/recheck-1/S01-desktop.png)、[S01-all-groups-part2.png](../evidence/022/recheck-1/S01-all-groups-part2.png) |
| S02 | PASS：实现、浏览器检查、v6 协作设计的可见标题、状态、负责人、测试、双版本及分组均与数据一致。 | [S02-b-implement.png](../evidence/022/recheck-1/S02-b-implement.png)、[S02-b-collaboration.png](../evidence/022/recheck-1/S02-b-collaboration.png) |
| S03 | PASS：实现有“⚠ 上游已变”；依赖及使用产出版本与数据一致。 | [S03-upstream-changed.png](../evidence/022/recheck-1/S03-upstream-changed.png) |
| S04 | PASS：两父卡折叠隐藏子卡、展开恢复；无卡片重叠、连线穿卡及文字越界。 | [S04-before.png](../evidence/022/recheck-1/S04-before.png)、[S04-collapsed.png](../evidence/022/recheck-1/S04-collapsed.png)、[S04-expanded-part2.png](../evidence/022/recheck-1/S04-expanded-part2.png) |
| S05 | PASS：B 13 卡仅在匹配状态的一列；暂停、取消默认折叠，A 有内容的两列可展开。 | [S05-B-columns.png](../evidence/022/recheck-1/S05-B-columns.png)、[S05-A-expanded-columns-right2.png](../evidence/022/recheck-1/S05-A-expanded-columns-right2.png) |
| S06 | PASS：分组、状态、负责人、只看我要处理的四项及组合筛选，两视图集合一致且保留条件。 | [S06-group-graph.png](../evidence/022/recheck-1/S06-group-graph.png)、[S06-group-columns.png](../evidence/022/recheck-1/S06-group-columns.png)、[S06-mine-graph.png](../evidence/022/recheck-1/S06-mine-graph.png)、[S06-mine-columns.png](../evidence/022/recheck-1/S06-mine-columns.png) |
| S07 | PASS：成员、回放禁用，分别注明第 3、5 批。 | [S07-disabled-entries.png](../evidence/022/recheck-1/S07-disabled-entries.png) |
| S08 | PASS：真实鼠标连接生效、唯一新增“你”的决策；原检查的起拖稳定和说明不重叠通过。松开后的新增检查见 R02。 | [S08-valid-dragging.png](../evidence/022/recheck-1/S08-valid-dragging.png)、[S08-valid-dropped.png](../evidence/022/recheck-1/S08-valid-dropped.png)、[S08-decision.png](../evidence/022/recheck-1/S08-decision.png) |
| S09 | PASS：真实拖成环、自身均有禁止样式及原因，不增加依赖或决策。 | [S09-cycle-dragging.png](../evidence/022/recheck-1/S09-cycle-dragging.png)、[S09-self-dragging.png](../evidence/022/recheck-1/S09-self-dragging.png) |
| S10 | PASS：UI 新建草稿入图，设计改为缺陷后标签与色块立即变化。 | [S10-new-draft.png](../evidence/022/recheck-1/S10-new-draft.png)、[S10-changed-group.png](../evidence/022/recheck-1/S10-changed-group.png) |
| S11 | PASS：已验收、进行中卡改分组均提示下游；取消不生效且保留输入，确认才写入。 | [S11-b-spec-cancelled.png](../evidence/022/recheck-1/S11-b-spec-cancelled.png)、[S11-b-spec-confirmed.png](../evidence/022/recheck-1/S11-b-spec-confirmed.png)、[S11-b-defect-diagnose-confirmed.png](../evidence/022/recheck-1/S11-b-defect-diagnose-confirmed.png) |
| S12 | PASS：取消有下游的卡，依赖历史保留，下游显示“⚠ 上游已取消”。 | [S12-cancelled-card-and-downstream-part2.png](../evidence/022/recheck-1/S12-cancelled-card-and-downstream-part2.png)、[S12-cancelled-column.png](../evidence/022/recheck-1/S12-cancelled-column.png) |
| S13 | PASS：真实 Tab、Shift+F10、Esc、Enter、方向键完成菜单与连接；Esc 归还焦点。 | [S13-keyboard-menu.png](../evidence/022/recheck-1/S13-keyboard-menu.png)、[S13-keyboard-connected.png](../evidence/022/recheck-1/S13-keyboard-connected.png) |
| S14 | PASS：A 八卡、承接评估分组，没有条件分支控件。 | [S14-project-A.png](../evidence/022/recheck-1/S14-project-A.png)、[S14-project-A-graph.png](../evidence/022/recheck-1/S14-project-A-graph.png) |
| S15 | PASS：规格每条有来源；依赖含上下游、父子、使用版本及产出历史；执行保留尝试和会话出处。 | [S15-spec.png](../evidence/022/recheck-1/S15-spec.png)、[S15-dependencies-panel.png](../evidence/022/recheck-1/S15-dependencies-panel.png)、[S15-execution.png](../evidence/022/recheck-1/S15-execution.png)、[S15-browser-scores.png](../evidence/022/recheck-1/S15-browser-scores.png) |
| S16 | PASS：收件箱、代理库、经验库、决策记录、项目记忆、项目设置均有内容，无旧机制及新增控制台错误。 | [S16-inbox.png](../evidence/022/recheck-1/S16-inbox.png)、[S16-agents.png](../evidence/022/recheck-1/S16-agents.png)、[S16-experience.png](../evidence/022/recheck-1/S16-experience.png)、[S16-decisions.png](../evidence/022/recheck-1/S16-decisions.png)、[S16-memory.png](../evidence/022/recheck-1/S16-memory.png)、[S16-settings.png](../evidence/022/recheck-1/S16-settings.png) |
| S17 | PASS：375×812 两视图整页无横向滚动，筛选不溢出；图内可滚动，浅色文字/图形对比度达标。 | [S17-narrow-graph-top.png](../evidence/022/recheck-1/S17-narrow-graph-top.png)、[S17-narrow-graph-all-part3.png](../evidence/022/recheck-1/S17-narrow-graph-all-part3.png)、[S17-narrow-columns.png](../evidence/022/recheck-1/S17-narrow-columns.png) |
| S18 | PASS：系统深色和侧栏切换均生效；桌面及窄屏两视图对比度达标。 | [S18-dark-graph-all.png](../evidence/022/recheck-1/S18-dark-graph-all.png)、[S18-dark-graph-all-part2.png](../evidence/022/recheck-1/S18-dark-graph-all-part2.png)、[S18-dark-columns.png](../evidence/022/recheck-1/S18-dark-columns.png)、[S18-narrow-dark-graph-part3.png](../evidence/022/recheck-1/S18-narrow-dark-graph-part3.png) |

**检查脚本适配与断言变化**

1. S02 原来用整卡 `textContent` 核对字段，会把 SVG title 中的工具提示误算为可见文字。改为读取实际 text/tspan，排除 title 与隐藏菜单；首分组移到所属色块标题核对，第二标签仍要求卡内显示。标题、状态、负责人、测试和双版本仍与同一数据核对，没有减少字段要求。首次适配漏读 tspan，造成三条检查器假失败；已修正后完整重跑全部 S/R。初次日志保存在 `harness-initial.log`，最终结果不含这些假失败。
2. S08/S09 原来只检查说明与同卡 `.flow-meta,.flow-warning` 是否重叠，现扩大到说明与**所有卡片的全部可见文字**比较，包含标题、状态、负责人、版本、测试、父卡按钮及显示中的菜单。原起拖位置 <2px 标准保留；新增 R02 单独检查松开前后，保留 74px 真实失败，未放宽标准。
3. 几何检查只对实际可见文字要求包在卡片内，排除 `visibility:hidden` 的小菜单及带 hidden 的说明标签；拖动中的卡外说明由 R01 的相交检查覆盖。卡片不重叠、连线每 0.75px 采样不穿非端点卡、色块归属标准保留，R05 另外核对 ≥12px 端口间距。
4. 菜单由一直显示改成悬停/聚焦/编辑模式显示；S10/S11/S12 的 UI 准备步骤增加真实鼠标 hover 后点击小菜单，不改功能断言。S13 仍用真实键盘路径。
5. 原长图截图只滚页面或主区；窄屏现有图内滚动，截图分页改为滚动实际溢出容器的 scrollTop，并仍在原固定视口截图。没有使用会扩大视口的 locator 截图，也没有注入 CSS 或隐藏内容。无横向溢出时不额外生成横向分页。
6. S17 的 `scrollTop>0`、无整页横向溢出及筛选不溢出断言原样保留，现在通过；S18 和原对比度阈值未调整。R03 加入真实鼠标 wheel 和 760px 边界。原本验证字段的其他断言未豁免或降低要求。

完整脚本差异见 [check-adaptations.diff](../evidence/022/recheck-1/check-adaptations.diff)，适配生成脚本为 `adapt-check.py`（只生成本复检目录脚本），补充场景源为 `r-scenarios.txt`。最终 `node --check` 通过。

**仍存在／新发现的问题**

1. **R02：合法连接松开后看板跳动。** 使用 UI 新建两张开发组草稿、筛选开发＋草稿、进入编辑模式，把卡片滚入同一视口后真实拖连。连接前两卡纵排，松开后变成横排，SVG 高 **310→173px**；改动记录同时多一条，主区 scrollHeight **1072→998px**，scrollTop 被浏览器从 **172 限制为 98px**。图容器 y **274.297→348.297**；起点连接点 y **365.797→439.797**，两者均向下 74px。按下到松开前位置稳定，说明起拖浮层问题已修；但本任务要求覆盖至松开，不能将此次位移判为通过。相同现象在 S08、R01、R02 的坐标记录中重复出现。见 `results.json` 的 `R02-valid-gesture` 和 R02 三张合法拖动截图。没有把连接后目标卡的正常拓扑重排当作测量点，失败测的是**起点连接点和整个图容器**。
2. **N01：编辑模式出现空白说明框。** 未拖动时，以及自连拒绝结束后，卡片下仍显示一个白色/深色空框。实际 `.flow-drop-feedback` 已有 hidden，但其 rect 的 computed display=`inline`、visibility=`visible`，`checkVisibility()` 为 true，尺寸 **224×22px**。DOM 状态与浏览器显示不一致；N01 两条断言失败。见 [N01-edit-idle.png](../evidence/022/recheck-1/N01-edit-idle.png)、[N01-after-rejection.png](../evidence/022/recheck-1/N01-after-rejection.png)，以及 `results.json` 的 `N01-empty-feedback`。R07 深色错误截图也可见空框。
3. **N02：完整拖动反馈覆盖已有通知。** 新建卡后的成功通知仍在右下角，开始合法拖动时反馈也出现在同一位置，遮住通知文字。通知矩形 x=1202.469、y=847.609、宽221.531、高36.391；反馈 x=1270、y=850.813、宽154、高33.188，两者右/下边均为1424/884，矩形相交。N02 一条断言失败。见 [N02-feedback-overlap-dragging.png](../evidence/022/recheck-1/N02-feedback-overlap-dragging.png)，数据为 `N02-floating-feedback`；R01 成环与自身拖动截图也有此现象。

未发现其他卡片重叠、可见文字截断、连线穿卡、分组圈入别组、筛选溢出或对比度回归。以上问题仅记录，未修复。

真实拖动均调用 Playwright `mouse.move/down/move/up`，按住期间分两段各 12 步移动，在开始、目标途中和松开后截图；未调用应用连接函数或派发合成 pointer 事件。连接点和图容器按下前、按下后、半程、到目标、松开前、松开后、稳定后共七阶段记录。原生影响确认通过实际 dialog 读取正文后分别 dismiss/accept；完整正文见 [dialogs.txt](../evidence/022/recheck-1/dialogs.txt)。所有业务改动均仅存在浏览器页面内存。

对比度使用 getComputedStyle 的真实 fill/stroke、color/backgroundColor，按 WCAG sRGB 计算；文字≥4.5:1，分组边界、连线和箭头≥3:1。保持原口径，最小值如下：

| 模式与视图 | 卡片文字 | 状态标签 | 分组标签 | 上游已变 | 图形/连线 |
|---|---:|---:|---:|---:|---:|
| 窄屏浅色图 | 6.489 | 6.183 | 6.512 | 7.565 | 6.512 |
| 窄屏浅色状态列 | 6.489 | 6.183 | 5.572 | 6.315 | 无依赖线 |
| 桌面深色图 | 8.863 | 7.295 | 7.295 | 8.132 | 7.067 |
| 桌面深色状态列 | 8.863 | 7.295 | 7.937 | 7.143 | 无依赖线 |
| 窄屏深色图 | 8.863 | 7.295 | 7.295 | 8.132 | 7.067 |
| 窄屏深色状态列 | 8.863 | 7.295 | 7.937 | 7.143 | 无依赖线 |

**控制台与清理**

[console.txt](../evidence/022/recheck-1/console.txt) 内容为“无”：error 0、warning 0、未捕获异常 0、HTTP ≥400 为0、失败请求0。包含完整重跑及新问题补查；favicon 不再请求缺失文件。

所有本次浏览器均在 finally 中关闭，静态服务 PID **50348** 已 SIGTERM 终止，**50763** 端口连接返回 **61/ECONNREFUSED**。进程检查无本次 Python 服务、检查脚本或 Playwright headless Chrome 残留。项目外既有 Playwright 缓存保留；没有项目内浏览器缓存或业务数据落盘。详见 [cleanup.json](../evidence/022/recheck-1/cleanup.json)。

**写入范围与 git status**

开始时已有 prototype 改动、021/022 的证据与报告、多份任务说明处于未提交状态，见 [git-status-before.txt](../evidence/022/recheck-1/git-status-before.txt)。本次保留这些文件，没有清理他人工作。开始前对允许范围外 **7116 个既有文件**保存 SHA-256，结束后逐一核对修改、删除、新增；本次文件变化只在 `evidence/022/recheck-1/` 与本报告。范围核对见 [scope-check.json](../evidence/022/recheck-1/scope-check.json)。原型、原 022 脚本与证据及其他任务文件哈希均未改变。

本次允许路径的 `git status --short -- evidence/022/recheck-1/ tasks/022-recheck-1-report.md`：

```text
?? evidence/022/recheck-1/
?? tasks/022-recheck-1-report.md
```

完整 `git status --short`（包含起始时已有状态）：

```text
 M prototype/index.html
?? evidence/021/
?? evidence/022/
?? prototype/app.js
?? prototype/artifacts.js
?? prototype/board.js
?? prototype/data.js
?? tasks/021-board-data-model.md
?? tasks/021-last-message.md
?? tasks/021-report.md
?? tasks/021-rework-1-last-message.md
?? tasks/021-rework-1-report.md
?? tasks/021-rework-1.md
?? tasks/022-board-browser-check.md
?? tasks/022-last-message.md
?? tasks/022-recheck-1-report.md
?? tasks/022-recheck-1.md
?? tasks/022-report.md
?? tasks/023-dialog-inbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
