session-id: 01a13188-bbf2-7483-aabe-f365e238cd30

任务 022 复检 2 已完成，**整体未通过**。原 S01–S18、R01–R07、N01、N02 全部重跑，**254/254 条通过，27/27 场景通过**；原 R02、N01、N02 的失败均已消失。补充检查 Q01 **72/90 条通过、18 条失败**，Q02 **30/30**、Q03 **6/6**。最终 **362/380 条通过，29/30 场景通过，208 张固定视口截图**。失败全部是 Q01 的连接锚点／图容器位移，五种操作的业务结果与各层滚动值检查均通过。只检查和记录，没有修改原型。

环境：Playwright **1.64.0**、本机 Chrome **154.0.8037.99** headless；默认 **1440×900 浅色**，保留原脚本的 375×812、760×812 和深色检查。静态服务为 `python3 -u -m http.server 60489 --bind 127.0.0.1 -d prototype`，页面只访问 `http://127.0.0.1:60489` 与内联 data URI，没有使用 8787。复用项目外 `/tmp/helm-006-playwright.cNUInN/node_modules/playwright`，浏览器临时配置位于项目外 `/var/folders/.../T/`，没有安装项目依赖。

脚本：[browser-check.mjs](../evidence/022/recheck-2/browser-check.mjs)；从复检 1 原样复制留存的 [browser-check-copied.mjs](../evidence/022/recheck-2/browser-check-copied.mjs) 与原文件逐字节相同。逐条断言：[assertions.txt](../evidence/022/recheck-2/assertions.txt)；原始几何和计算样式：[results.json](../evidence/022/recheck-2/results.json)；截图全集：[screenshots.txt](../evidence/022/recheck-2/screenshots.txt)。完整旧场景运行日志为 [run.log](../evidence/022/recheck-2/run.log)，补测为 [q-run.log](../evidence/022/recheck-2/q-run.log)，增加非零图内滚动后的 Q01 重跑为 [q01-scroll-rerun.log](../evidence/022/recheck-2/q01-scroll-rerun.log)。首次完整重跑和首次补测结果分别留存在 `required-rerun-results.json`、`q-initial-results.json`。

**Q01：真实操作与位置保持，FAIL**

1440px 下使用可见连接圆点的 `getBoundingClientRect()` 中心。真实拖动调用 `mouse.move/down/move/up`，移动 24 步，记录按下前、按下后、半程、命中目标、松开前、松开后、稳定后。表单／菜单操作先准备输入并滚动到提交按钮，随后在实际 mouse.down 前、down 后、up 后、下一帧、150ms 稳定后测量。测的是提交瞬间前后，准备阶段发生的主动滚动不混入提交位移。

连接锚点统一选不会被取消、不会改标签的起点卡；改标签的是另一张卡，取消的是第三张卡，新建也是另一张卡。因此未把被修改卡的正常布局变化或被删除的 DOM 当成稳定参照。表内位移是欧氏距离，要求仍严格为 **<2px**；实际均是向上移动。

桌面页面本身不溢出，scrollY 为 0，主区由 main 滚动。为真正覆盖非零页面滚动，另在原脚本已有的 **760×812** 窄屏环境将五种操作各测一次；通过 UI 创建四张额外草稿，使图高≥926px，提交前后实际 **scrollY=428、图内 scrollTop=30**。窄屏原型不提供可见拖动连接圆点，添加依赖使用真实鼠标点击“添加依赖到…”菜单；连接锚点按 SVG 卡片框的底边中心测量，它是这张单出边卡的实际竖向出线中心，不使用隐藏圆点的零矩形冒充可见位置。这一窄屏补测不作为“窄屏可拖拽”结论；桌面真实拖拽由原场景与 Q01 覆盖。

| 操作 | 桌面 scrollY／main.scrollTop／图 scrollTop | 桌面锚点／图容器位移 | 已下滚页面 scrollY／图 scrollTop | 下滚页锚点／图容器位移 | 结论与截图 |
|---|---|---:|---|---:|---|
| 加依赖 | 0→0／172→172／0→0 | 0.00000／0.00000px | 428→428／30→30 | 514.76562／514.76562px | 桌面 PASS；下滚页 FAIL；[桌面](../evidence/022/recheck-2/Q01-desktop-add-dropped.png)、[下滚页](../evidence/022/recheck-2/Q01-page-scrolled-add-after.png) |
| 新建卡 | 0→0／0→0／0→0 | 335.53125／335.53125px | 428→428／30→30 | 335.53125／335.53125px | 两者 FAIL；[桌面](../evidence/022/recheck-2/Q01-desktop-create-after.png)、[下滚页](../evidence/022/recheck-2/Q01-page-scrolled-create-after.png) |
| 改标签 | 0→0／0→0／0→0 | 260.75000／260.75000px | 428→428／30→30 | 260.75000／260.75000px | 两者 FAIL；[桌面](../evidence/022/recheck-2/Q01-desktop-groups-after.png)、[下滚页](../evidence/022/recheck-2/Q01-page-scrolled-groups-after.png) |
| 删依赖 | 0→0／172→172／0→0 | 191.15625／191.15625px | 428→428／30→30 | 191.15625／191.15625px | 两者 FAIL；[桌面](../evidence/022/recheck-2/Q01-desktop-remove-after.png)、[下滚页](../evidence/022/recheck-2/Q01-page-scrolled-remove-after.png) |
| 取消卡 | 0→0／0→0／0→0 | 360.71875／360.71875px | 428→428／30→30 | 360.71875／360.71875px | 两者 FAIL；[桌面](../evidence/022/recheck-2/Q01-desktop-cancel-after.png)、[下滚页](../evidence/022/recheck-2/Q01-page-scrolled-cancel-after.png) |

所有阶段的 `scrollY`、`main.scrollTop`、图 `scrollTop/scrollLeft` 偏移均为 0，五种操作均实际生效。桌面加依赖在 main.scrollTop=172 时连同容器和连接圆点全程偏移 0，复现并确认了原 R02 的修复。其余四种桌面操作，以及五种下滚页面菜单操作，虽然滚动值不变，图的位置仍超过要求。

**新问题 Q01：提交关闭内联菜单时，整张图明显上移。** 改标签示例中，起点卡没有改动：提交前图 y=707.046875、连接点 y=798.546875；提交后分别 y=446.296875、537.796875，均上移 **260.75px**。页面 scrollY、main.scrollTop、图内 scrollTop 始终为 0。[提交前](../evidence/022/recheck-2/Q01-desktop-groups-before.png)／[提交后](../evidence/022/recheck-2/Q01-desktop-groups-after.png) 可直接核对。

每种失败位移都等于当前 `.flow-edit-menu` 的实际高度加上下外边距各 12px：新建 311.53125+24=335.53125px；改标签 236.75+24=260.75px；删依赖 167.15625+24=191.15625px；取消 336.71875+24=360.71875px；窄屏加依赖目标列表 490.765625+24=514.765625px。菜单在图之前参与文档排版，提交后消失；从 DOM 顺序、菜单量测及等量位移判断，位置变化来自菜单占位移除。补测没有注入样式、占位元素，也没有调用业务修改函数。此问题按 Q01 几何要求记失败，没有放宽断言。未发现其他新的可见空白框、通知重叠、卡片重叠或对比度问题。

**Q02：说明框实际显隐，PASS**

浅色和深色均测试空闲、自连被拒后、合法拖动成功后。每个阶段遍历所有 `.flow-drop-feedback` 及 rect，综合 `getBoundingClientRect()`、计算 display/visibility/opacity、`checkVisibility()` 判断，结果均为组及 rect **display=none、rect=0×0、checkVisibility=false**。CSS visibility 仍可能为 visible，但 display=none 使其实际不绘制；没有只依据 hidden 属性下结论。截图核对卡下没有空框。

截图：[浅色空闲](../evidence/022/recheck-2/Q02-light-idle.png)、[浅色拒绝后](../evidence/022/recheck-2/Q02-light-after-rejected.png)、[浅色成功后](../evidence/022/recheck-2/Q02-light-after-success.png)、[深色空闲](../evidence/022/recheck-2/Q02-dark-idle.png)、[深色拒绝后](../evidence/022/recheck-2/Q02-dark-after-rejected.png)、[深色成功后](../evidence/022/recheck-2/Q02-dark-after-success.png)。

**Q03：已有通知与拖动反馈，PASS**

先用 UI 新建卡生成“已生效”通知，并断言其确实可见；随后真实鼠标起拖，最后合法松开，浅色和深色各一轮。浅色起拖前通知为 (1169.234375,847.609375,254.765625,36.390625)，反馈隐藏；拖动时通知 `display=none`、实际 rect 为 0×0，反馈为 (1270,850.8125,154,33.1875)，两者矩形交集宽、高均为 **0**；结束后只见结果通知，反馈 rect=0×0。深色的互斥显隐及交集结果相同，没有用 z-index 或纯 DOM 状态替代几何检查。

截图：[浅色通知在先](../evidence/022/recheck-2/Q03-light-notice-before.png)、[浅色拖动中](../evidence/022/recheck-2/Q03-light-dragging.png)、[浅色结束](../evidence/022/recheck-2/Q03-light-after-success.png)、[深色通知在先](../evidence/022/recheck-2/Q03-dark-notice-before.png)、[深色拖动中](../evidence/022/recheck-2/Q03-dark-dragging.png)、[深色结束](../evidence/022/recheck-2/Q03-dark-after-success.png)。

**S01–S18、R01–R07、N01、N02 完整重跑**

全部通过；原场景断言描述、数量和阈值与复检 1 完全一致。下表给代表截图，每个场景的全部截图见 `screenshots.txt`，场景截图数及 PNG 尺寸核对见 [evidence-check.json](../evidence/022/recheck-2/evidence-check.json)。已查看 11 张截图联系表，并放大核对 R02、N01/N02 及 Q 的关键截图。联系表由已有截图缩放拼接供浏览，原截图保留固定视口。

| 编号 | 结果／断言 | 结论 | 代表截图 |
|---|---|---|---|
| S01 | PASS 8/8 | 项目 B 默认依赖图；13 卡、五种分组色块、缺陷示例标记正确。 | [S01-desktop.png](../evidence/022/recheck-2/S01-desktop.png) |
| S02 | PASS 7/7 | 抽查实现、浏览器检查、v6 协作设计，标题、状态、负责人、分组、测试与版本字段和数据一致；几何无截断。 | [S02-b-implement.png](../evidence/022/recheck-2/S02-b-implement.png) |
| S03 | PASS 1/1 | 原型下游显示“⚠ 上游已变”，含文字和图标。 | [S03-upstream-changed.png](../evidence/022/recheck-2/S03-upstream-changed.png) |
| S04 | PASS 12/12 | 两张父卡折叠隐藏子卡，展开恢复；各阶段卡片不重叠、连线不穿非端点卡。 | [S04-expanded.png](../evidence/022/recheck-2/S04-expanded.png) |
| S05 | PASS 3/3 | 状态列每卡只出现一次；暂停、取消默认折叠且能展开。 | [S05-B-columns.png](../evidence/022/recheck-2/S05-B-columns.png) |
| S06 | PASS 5/5 | 开发、已验收、负责人、只看我要处理的筛选在两种视图间一致且保留。 | [S06-group-graph.png](../evidence/022/recheck-2/S06-group-graph.png) |
| S07 | PASS 2/2 | 成员与回放禁用，并注明第 3／5 批。 | [S07-disabled-entries.png](../evidence/022/recheck-2/S07-disabled-entries.png) |
| S08 | PASS 8/8 | 真实多步鼠标拖动加依赖生效，决策记录新增一条“你”的记录。 | [S08-valid-dragging.png](../evidence/022/recheck-2/S08-valid-dragging.png) |
| S09 | PASS 13/13 | 成环、自连有禁止样式和原因，不改依赖或决策。 | [S09-cycle-dragging.png](../evidence/022/recheck-2/S09-cycle-dragging.png) |
| S10 | PASS 2/2 | UI 新建草稿出现在图中；改分组标签后色块与标签更新。 | [S10-changed-group.png](../evidence/022/recheck-2/S10-changed-group.png) |
| S11 | PASS 8/8 | 进行中／已验收卡改标签弹影响确认，取消不改数据，确认才生效。 | [S11-b-spec-confirmed.png](../evidence/022/recheck-2/S11-b-spec-confirmed.png) |
| S12 | PASS 4/4 | 取消有下游的卡，状态变已取消，下游出现上游已取消告警，依赖历史保留。 | [S12-cancelled-card-and-downstream.png](../evidence/022/recheck-2/S12-cancelled-card-and-downstream.png) |
| S13 | PASS 6/6 | 真实 Tab、Shift+F10、Esc、Enter、方向键完成菜单与依赖连接。 | [S13-keyboard-connected.png](../evidence/022/recheck-2/S13-keyboard-connected.png) |
| S14 | PASS 7/7 | 项目 A 八张卡，承接评估分组，无条件分支元素。 | [S14-project-A.png](../evidence/022/recheck-2/S14-project-A.png) |
| S15 | PASS 10/10 | 详情显示带来源的规格、上下游／父子关系、产出历史及执行会话与实际检查分数。 | [S15-dependencies-panel.png](../evidence/022/recheck-2/S15-dependencies-panel.png) |
| S16 | PASS 19/19 | 六页冒烟有内容、无旧机制文字、无新增控制台异常。 | [S16-inbox.png](../evidence/022/recheck-2/S16-inbox.png) |
| S17 | PASS 20/20 | 375×812 无页面横向溢出；图内可滚动、状态列单列、筛选不溢出；对比度达标。 | [S17-narrow-graph-all.png](../evidence/022/recheck-2/S17-narrow-graph-all.png) |
| S18 | PASS 21/21 | 桌面／375px 深色图与状态列、侧栏明暗切换、文字和图形对比度达标。 | [S18-dark-graph-all.png](../evidence/022/recheck-2/S18-dark-graph-all.png) |
| R01 | PASS 25/25 | 合法、成环、自连、重复真实拖动；说明文字不与任何卡片可见文字重叠。 | [R01-valid-dragging.png](../evidence/022/recheck-2/R01-valid-dragging.png) |
| R02 | PASS 22/22 | 合法、成环、自连七阶段起点连接点及图容器偏移均 0px；合法提交主区 scrollTop 172→172、SVG 高 310→173px。 | [R02-valid-dropped.png](../evidence/022/recheck-2/R02-valid-dropped.png) |
| R03 | PASS 6/6 | 375／760px 图容器小于视口，原生 wheel 改图内 scrollTop，页面位置稳定；设置 scrollTop=100 生效。 | [R03-760-scrolled.png](../evidence/022/recheck-2/R03-760-scrolled.png) |
| R04 | PASS 2/2 | 重新加载后 favicon 为 data URI；完整重跑控制台及资源请求干净。 | [R04-favicon-console-clean.png](../evidence/022/recheck-2/R04-favicon-console-clean.png) |
| R05 | PASS 8/8 | 13 卡 SVG 1130×954px，看完主区最大滚动 623px；两张截图覆盖全部卡；字段完整、无重叠／穿卡，端点间距≥12px。 | [R05-first-screen.png](../evidence/022/recheck-2/R05-first-screen.png) |
| R06 | PASS 10/10 | A 承接评估 1 块；B 五组各 1 块，包住成员且不圈入别组。 | [R06-project-B.png](../evidence/022/recheck-2/R06-project-B.png) |
| R07 | PASS 12/12 | 浅／深色成功及错误通知样式不同，文字与业务结果正确。 | [R07-error.png](../evidence/022/recheck-2/R07-error.png) |
| N01 | PASS 7/7 | 空闲、自连拒绝结束后说明框实际不可见：display=none、0×0、checkVisibility=false。 | [N01-after-rejection.png](../evidence/022/recheck-2/N01-after-rejection.png) |
| N02 | PASS 6/6 | 已有通知在拖动期间收起，通知矩形 0×0，反馈 154×33.1875px，不相交。 | [N02-feedback-overlap-dragging.png](../evidence/022/recheck-2/N02-feedback-overlap-dragging.png) |

对比度口径保持文字≥4.5:1、图形／连线≥3:1。窄屏浅色最小文字／状态／分组／告警分别为图 6.489／6.183／6.512／7.565、列 6.489／6.183／5.572／6.315；深色桌面与窄屏分别为图 8.863／7.295／7.295／8.132、列 8.863／7.295／7.937／7.143。图形最小浅色 6.512、深色 7.067，均通过。

**脚本适配与断言调整逐项说明**

1. 截图清单中的输出相对路径由 `recheck-1` 改为 `recheck-2`；文件输出仍由脚本自身目录决定。没有改原文件。
2. 原拖动位置采样增加只读 `window.scrollY`、main.scrollLeft、图 scrollTop/scrollLeft，为 Q01 提供数据；原 R02 等所有既有断言未改。
3. 插入 Q01–Q03 新场景，共 126 条新断言。Q01 新增各层滚动、稳定参照锚点及图容器位置的严格 <2px 检查，保留失败；Q02 新增几何、样式和浏览器可见性联合检查；Q03 新增“起拖前通知真实可见”前提和三个阶段的实际矩形检查。
4. Q01 首次窄屏两卡图太短，图内 scrollTop 只能为 0；为覆盖非零图内滚动，仅在新补测夹具中通过 UI 新建四张草稿，再重跑完整 Q01，并新增提交前 scrollY>0、图 scrollTop>0 的前提断言。原阈值及失败判断没有调整；原始补测结果与日志仍保留。最终五次窄屏提交前均为 scrollY=428、图 scrollTop=30。
5. 复检 1 的 254 条断言按“场景编号＋描述”逐条核对，集合完全相同；**没有豁免、删除、降低或改写任何既有断言**。适配差异见 [check-adaptations.diff](../evidence/022/recheck-2/check-adaptations.diff)，生成脚本为 `adapt-recheck-2.py`，新增场景源为 `q-scenarios.txt`。最终 `node --check` 通过。

原场景完整执行一次，随后利用原脚本已有的 SCENARIOS 功能追加 Q01–Q03，最后在扩大滚动范围后单独完整重跑 Q01；最终断言／结果合并在同一目录。原生影响确认走实际浏览器 dialog，正文与 accept/dismiss 记录见 [dialogs.txt](../evidence/022/recheck-2/dialogs.txt)。业务操作仅改变浏览器页面内存。

**控制台、清理、写入范围**

[console.txt](../evidence/022/recheck-2/console.txt) 为“无”：error 0、warning 0、未捕获异常 0、HTTP≥400 为0、失败请求0、被拦截的非本地页面请求0，包含完整重跑及两次补测。没有应用或检查脚本执行异常；Q01 的 18 条失败均是实测几何断言。

三次检查进程均执行 finally 中的 awaited browser.close() 后退出。服务 PID **56608** 已 SIGTERM 终止，60489 端口连接返回 **61/ECONNREFUSED**。进程检查无本次静态服务、检查脚本或 Playwright Chrome 残留；首轮临时浏览器配置目录已移除，项目外既有 Playwright 保留。见 [cleanup.json](../evidence/022/recheck-2/cleanup.json)。

开始前对允许范围外 **7316 个文件**保存 SHA-256；结束逐一核对，无修改、删除或范围外新增。原型、FEATURES、HANDBOOK、research、旧证据、旧报告／任务文件均保持。见 [scope-check.json](../evidence/022/recheck-2/scope-check.json)。本次只写 `evidence/022/recheck-2/` 与本报告，工作区开始时已有的未提交文件没有清理。

本次允许路径的 `git status --short -- evidence/022/recheck-2/ tasks/022-recheck-2-report.md`：

```text
?? evidence/022/recheck-2/
?? tasks/022-recheck-2-report.md
```

完整 `git status --short`（包含起始时已有状态；前后分别留存 `git-status-before.txt`、`git-status-after.txt`）：

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
?? tasks/021-rework-2-last-message.md
?? tasks/021-rework-2-report.md
?? tasks/021-rework-2.md
?? tasks/022-board-browser-check.md
?? tasks/022-last-message.md
?? tasks/022-recheck-1-last-message.md
?? tasks/022-recheck-1-report.md
?? tasks/022-recheck-1.md
?? tasks/022-recheck-2-report.md
?? tasks/022-recheck-2.md
?? tasks/022-report.md
?? tasks/023-dialog-inbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
