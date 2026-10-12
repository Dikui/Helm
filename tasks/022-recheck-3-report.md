session-id: 01a13192-ae6b-78c0-a17a-177679d50650

# 任务 022 复检 3报告

复检结论：**原有 S／R／N／Q 场景 380/380 通过，Q01 的整图跳动已修复。补测 P01、P02、P04、P05、P06 通过，P03 发现两类焦点问题。** 最终共 670 条断言，662 PASS、8 FAIL；8 条失败归于下面两类问题，包含独立复现。只检查，没有修改原型代码。

环境：本地静态服务 `http://127.0.0.1:64005/`，`python3 -m http.server 64005 --bind 127.0.0.1 -d prototype`；真实 Chrome 154.0.8037.99／Playwright，无头模式。默认 1440×900 浅色；补测 760×812、375×812 及深色。浏览器依赖位于 `/tmp/helm-006-playwright.cNUInN/node_modules/playwright/index.mjs`，浏览器临时配置／缓存位于项目外系统临时目录。页面请求仅允许该本地服务和 data URI。

证据：[assertions.txt](../evidence/022/recheck-3/assertions.txt)、[console.txt](../evidence/022/recheck-3/console.txt)、[results.json](../evidence/022/recheck-3/results.json)；最终纳入 **383 张不同文件名的原视口截图**，完整清单见 [screenshots.txt](../evidence/022/recheck-3/screenshots.txt)。长图采用滚动分页截图，未修改 CSS、视口或业务数据来制造证据。

**新问题**

1. **P03-A：浮层外点击关闭后焦点丢失。** 新建、改标签、删依赖、取消卡、添加依赖五种浮层都能外点关闭，但 `document.activeElement.tagName` 最终为 `BODY`，未返回原按钮／卡片。原入口此时仍存在，因而不是筛选移除入口所致。复现：打开浮层→真实鼠标点击右侧背景 `(1380,30)`→读取焦点；五种均失败。又对新建和改标签在不同浮层外坐标复现，按下后、松开后、120ms 后都已关闭且焦点为 BODY。`P03-confirm-outside-create`、`P03-confirm-outside-groups` 的完整采样保存在 results.metrics。[P03-confirm-outside-create-before.png](../evidence/022/recheck-3/P03-confirm-outside-create-before.png)、[P03-confirm-outside-create-after.png](../evidence/022/recheck-3/P03-confirm-outside-create-after.png)、[P03-confirm-outside-groups-after.png](../evidence/022/recheck-3/P03-confirm-outside-groups-after.png)。这与外点 pointerdown 中恢复焦点、随后被浏览器默认焦点行为覆盖相符，属于原因推断，未作代码修改。

2. **P03-B：筛选移除取消卡后没有焦点回退。** 在分组“开发”、状态“草稿”筛选下，从待取消草稿卡的菜单用 Enter 取消，业务成功且卡片从筛选结果消失；浮层关闭后的焦点为 BODY。原卡片按钮与卡片都已从 DOM 移除。[P03-cancel-enter-return.png](../evidence/022/recheck-3/P03-cancel-enter-return.png)。对照：清空状态筛选再取消，原卡仍在图中，焦点正确返回它的菜单按钮，见 [P03-cancel-unfiltered-return.png](../evidence/022/recheck-3/P03-cancel-unfiltered-return.png)。关闭按钮及 Esc 的焦点返回全部通过。

**P01–P06 补测结果**

| 场景 | 结果 | 检查范围 |
|---|---|---|
| P01 | PASS 155/155 | 五操作 × 四滚动环境；打开、切子菜单、关闭、重开、提交自动关闭，操作后即时／下一帧／稳定后均采样。 |
| P02 | PASS 21/21 | 五操作紧邻实际入口、位于视口内；真实右侧／下侧边缘卡片分别左翻／上翻；有 dialog 角色和可访问标题。 |
| P03 | FAIL：53/61 通过 | 焦点进入、方向键、Enter、Esc、Tab／Shift+Tab 环绕、关闭按钮、成功提交均检查；8 条失败对应两类新问题。 |
| P04 | PASS 25/25 | 375×812 五操作均使用全宽底部面板，无横向溢出且可提交。 |
| P05 | PASS 14/14 | 桌面／375px 七种浮层，可见按钮矩形最小间距 6px（表单主按钮与关闭为 8px）。 |
| P06 | PASS 14/14 | 桌面／375px 七种深色浮层，标题、说明、标签、输入值、按钮文字最低 8.863:1。 |

P01 每个操作使用独立 UI 夹具；先创建参照起点、目标、待取消卡及三张范围卡，筛选为开发／草稿，进入编辑。删依赖先通过 UI 建立依赖。提交后的业务结果另行断言。桌面采样实际连接圆心；竖排图隐藏圆点，采样对应卡片的连线出口中心。使用不受取消操作移除影响的参照卡，测的是整图／参照锚点位移；业务连接导致目标卡重新布局并不等同于整图跳动。

| P01 环境 | 提交前滚动 | 图容器／参照连接点最大位移 | 截图示例 |
|---|---|---|---|
| 桌面未滚动 1440×900 | mainTop=0 | 0px／0px | [P01-desktop-groups-groups.png](../evidence/022/recheck-3/P01-desktop-groups-groups.png) |
| 桌面下滚 1440×900 | mainTop=110 | 0px／0px | [P01-desktop-scrolled-create-open.png](../evidence/022/recheck-3/P01-desktop-scrolled-create-open.png) |
| 页面下滚 760×812 | scrollY=508–890，图内 top=30 | 0px／0px | [P01-page-scrolled-remove-edge.png](../evidence/022/recheck-3/P01-page-scrolled-remove-edge.png) |
| 页面下滚 375×812 | scrollY=659–1082，图内 top=30 | 0px／0px | [P01-375-scrolled-add-targets.png](../evidence/022/recheck-3/P01-375-scrolled-add-targets.png) |

各操作的 before、open、子菜单、close、submit 图片均以 P01 开头。全部 20 组位置轨迹在 `results.metrics.P01-*-stability`。页面、主区与图内滚动各阶段差值同样为 0px。

P02 五种浮层均宽 380px，与最初触发按钮水平相隔 8px，子菜单保持原入口位置；内容过高时向上翻。右侧卡片按钮 x=1369、宽12，浮层 `[981,1361]`，左翻间隔 8px；下侧按钮 y=729.297、底746.297，浮层顶401.578、底746.297，向上对齐入口底边。所有实际矩形在视口内。[P02-right-edge-flip.png](../evidence/022/recheck-3/P02-right-edge-flip.png)、[P02-bottom-edge-flip.png](../evidence/022/recheck-3/P02-bottom-edge-flip.png)。

P03 使用真实 Tab 到达入口，用 Enter／Shift+F10 打开；方向键在菜单项间移动，Enter 进入子菜单和提交，输入框直接 Enter 也检查。焦点进入浮层，Tab 双向循环、Esc／关闭按钮返回均通过；外点关闭通过但返回失败。没有用 `.focus()` 或合成键盘事件代替用户路径。

| P04 面板 | 实际矩形 x / y / 宽 / 高（px） | 截图 |
|---|---|---|
| 新建卡 | 0 / 462.078 / 375 / 349.922 | [P04-create-bottom-panel.png](../evidence/022/recheck-3/P04-create-bottom-panel.png) |
| 改标签 | 0 / 536.859 / 375 / 275.141 | [P04-groups-bottom-panel.png](../evidence/022/recheck-3/P04-groups-bottom-panel.png) |
| 删依赖 | 0 / 606.453 / 375 / 205.547 | [P04-remove-bottom-panel.png](../evidence/022/recheck-3/P04-remove-bottom-panel.png) |
| 取消卡 | 0 / 459.281 / 375 / 352.719 | [P04-cancel-bottom-panel.png](../evidence/022/recheck-3/P04-cancel-bottom-panel.png) |
| 添加依赖到… | 0 / 305.234 / 375 / 506.766 | [P04-add-bottom-panel.png](../evidence/022/recheck-3/P04-add-bottom-panel.png) |

全部面板 bottom=812；高度不超过 85dvh。每种面板打开时 `document.documentElement.scrollWidth=body.scrollWidth=innerWidth=375`。

P05／P06 检查卡片菜单、新建表单、标签表单、管理连线、连线删除、取消菜单、依赖目标列表，两种宽度各检查一次。P05 保存按钮完整矩形与各层 overflow 裁剪后的可见矩形，比较实际可见部分，忽略完全未绘制的滚动列表条目。P06 使用 computedStyle 和实际背景逐层合成计算对比度，阈值保持文字 ≥4.5:1。

| 浮层 | 桌面／375px 最小间距（px） | 深色桌面／375px 最低文字对比度 | 深色截图（桌面／窄屏） |
|---|---|---|---|
| 卡片菜单 | 6／6 | 8.863／8.863 | [P06-1440-node-dark.png](../evidence/022/recheck-3/P06-1440-node-dark.png)／[P06-375-node-dark.png](../evidence/022/recheck-3/P06-375-node-dark.png) |
| 新建卡 | 8／8 | 9.708／9.708 | [P06-1440-create-dark.png](../evidence/022/recheck-3/P06-1440-create-dark.png)／[P06-375-create-dark.png](../evidence/022/recheck-3/P06-375-create-dark.png) |
| 改标签 | 8／8 | 9.708／9.708 | [P06-1440-groups-dark.png](../evidence/022/recheck-3/P06-1440-groups-dark.png)／[P06-375-groups-dark.png](../evidence/022/recheck-3/P06-375-groups-dark.png) |
| 管理连线 | 8／8 | 8.863／8.863 | [P06-1440-lines-dark.png](../evidence/022/recheck-3/P06-1440-lines-dark.png)／[P06-375-lines-dark.png](../evidence/022/recheck-3/P06-375-lines-dark.png) |
| 删依赖 | 8／8 | 8.863／8.863 | [P06-1440-remove-dark.png](../evidence/022/recheck-3/P06-1440-remove-dark.png)／[P06-375-remove-dark.png](../evidence/022/recheck-3/P06-375-remove-dark.png) |
| 取消卡 | 6／6 | 8.863／8.863 | [P06-1440-cancel-dark.png](../evidence/022/recheck-3/P06-1440-cancel-dark.png)／[P06-375-cancel-dark.png](../evidence/022/recheck-3/P06-375-cancel-dark.png) |
| 添加依赖到… | 6／6 | 8.863／8.863 | [P06-1440-add-dark.png](../evidence/022/recheck-3/P06-1440-add-dark.png)／[P06-375-add-dark.png](../evidence/022/recheck-3/P06-375-add-dark.png) |

**完整重跑结果**

| 场景 | 结果 | 结论 | 截图示例 |
|---|---|---|---|
| S01 | PASS 8/8 | 项目 B 默认图；13 卡按状态着色，五分组色块与缺陷示例标记存在。 | [S01-desktop.png](../evidence/022/recheck-3/S01-desktop.png) |
| S02 | PASS 7/7 | 三卡字段与数据一致；实际 SVG 文字无截断、卡片无重叠、连线不穿卡。 | [S02-b-implement.png](../evidence/022/recheck-3/S02-b-implement.png) |
| S03 | PASS 1/1 | 下游原型卡显示带图标的“上游已变”。 | [S03-upstream-changed.png](../evidence/022/recheck-3/S03-upstream-changed.png) |
| S04 | PASS 12/12 | 两父卡折叠／展开正确，各阶段卡片、连线、色块几何通过。 | [S04-before.png](../evidence/022/recheck-3/S04-before.png) |
| S05 | PASS 3/3 | 状态列每卡唯一，暂停、取消默认折叠且可展开。 | [S05-B-columns.png](../evidence/022/recheck-3/S05-B-columns.png) |
| S06 | PASS 5/5 | 四种筛选在图／列视图一致且保留。 | [S06-group-graph.png](../evidence/022/recheck-3/S06-group-graph.png) |
| S07 | PASS 2/2 | 成员、回放禁用并标明第 3／5 批。 | [S07-disabled-entries.png](../evidence/022/recheck-3/S07-disabled-entries.png) |
| S08 | PASS 8/8 | 真实多步鼠标拖动加依赖，新增一条“你”的决策。 | [S08-valid-start.png](../evidence/022/recheck-3/S08-valid-start.png) |
| S09 | PASS 13/13 | 成环、自连有禁止样式和原因，不改变依赖／决策。 | [S09-cycle-start.png](../evidence/022/recheck-3/S09-cycle-start.png) |
| S10 | PASS 2/2 | UI 新建草稿、改标签和色块即时更新。 | [S10-new-draft.png](../evidence/022/recheck-3/S10-new-draft.png) |
| S11 | PASS 8/8 | 进行中／已验收卡出现影响确认；取消保持输入和数据，确认后生效。 | [S11-b-spec-cancelled.png](../evidence/022/recheck-3/S11-b-spec-cancelled.png) |
| S12 | PASS 4/4 | 取消有下游的卡，保留依赖历史并显示下游告警。 | [S12-cancelled-card-and-downstream.png](../evidence/022/recheck-3/S12-cancelled-card-and-downstream.png) |
| S13 | PASS 6/6 | 真实 Tab、Shift+F10、方向键、Enter 完成连接；Esc 返回卡片。 | [S13-keyboard-menu.png](../evidence/022/recheck-3/S13-keyboard-menu.png) |
| S14 | PASS 7/7 | 项目 A 八卡、承接评估分组，无条件分支界面。 | [S14-project-A.png](../evidence/022/recheck-3/S14-project-A.png) |
| S15 | PASS 10/10 | 详情含来源、上下游／父子关系、产出历史和真实会话／检查分数。 | [S15-spec.png](../evidence/022/recheck-3/S15-spec.png) |
| S16 | PASS 19/19 | 六页冒烟有内容，无旧机制文字或控制台异常。 | [S16-inbox.png](../evidence/022/recheck-3/S16-inbox.png) |
| S17 | PASS 20/20 | 375×812 图／列无页面横向溢出，图内可滚动；文字及图形对比度通过。 | [S17-narrow-graph-top.png](../evidence/022/recheck-3/S17-narrow-graph-top.png) |
| S18 | PASS 21/21 | 桌面／375px 深色图／列及模式切换通过，文字及图形对比度通过。 | [S18-dark-graph-top.png](../evidence/022/recheck-3/S18-dark-graph-top.png) |
| R01 | PASS 25/25 | 合法、成环、自连、重复真实拖动；反馈不与卡片可见文字重叠。 | [R01-valid-start.png](../evidence/022/recheck-3/R01-valid-start.png) |
| R02 | PASS 22/22 | 拖动七阶段连接点及图容器偏移均 <2px。 | [R02-valid-start.png](../evidence/022/recheck-3/R02-valid-start.png) |
| R03 | PASS 6/6 | 375／760px 图内容可经原生 wheel 和 scrollTop 滚动，页面位置稳定。 | [R03-375-top.png](../evidence/022/recheck-3/R03-375-top.png) |
| R04 | PASS 2/2 | favicon 为 data URI；完整重跑无资源／控制台异常。 | [R04-favicon-console-clean.png](../evidence/022/recheck-3/R04-favicon-console-clean.png) |
| R05 | PASS 8/8 | 原始 13 卡字段、端点间距、图高和翻页覆盖检查通过。 | [R05-first-screen.png](../evidence/022/recheck-3/R05-first-screen.png) |
| R06 | PASS 10/10 | A／B 分组各有一块，包住成员且不圈入其他组。 | [R06-project-A.png](../evidence/022/recheck-3/R06-project-A.png) |
| R07 | PASS 12/12 | 浅／深色成功与错误通知文字、样式、业务结果通过。 | [R07-success.png](../evidence/022/recheck-3/R07-success.png) |
| N01 | PASS 7/7 | 空闲和拒绝结束时说明框确实不绘制。 | [N01-edit-idle.png](../evidence/022/recheck-3/N01-edit-idle.png) |
| N02 | PASS 6/6 | 拖动期间通知收起，与反馈实际矩形不相交。 | [N02-feedback-overlap-start.png](../evidence/022/recheck-3/N02-feedback-overlap-start.png) |
| Q01 | PASS 90/90 | 桌面／760px 下滚五种提交均稳定；所有滚动、图容器及参照连接点位移 0px。 | [Q01-desktop-add-start.png](../evidence/022/recheck-3/Q01-desktop-add-start.png) |
| Q02 | PASS 30/30 | 浅／深色空闲、拒绝后、成功后反馈框均实际不可见。 | [Q02-light-idle.png](../evidence/022/recheck-3/Q02-light-idle.png) |
| Q03 | PASS 6/6 | 浅／深色起拖前通知可见，拖动中收起，结束后只显示结果通知。 | [Q03-light-notice-before.png](../evidence/022/recheck-3/Q03-light-notice-before.png) |

真实拖拽沿用原脚本：鼠标移动到连接圆心，down，再分 12+12 步移动至目标中心，up。记录按下前后、途中、到达目标、松开前后及稳定后坐标；所有业务操作经真实 UI，只读 DOM／数据、几何、计算样式及原生滚动用于检测。涉及影响确认时处理真实浏览器 dialog；正文和 accept/dismiss 见 [dialogs.txt](../evidence/022/recheck-3/dialogs.txt)。

**脚本复制与调整，逐条说明**

1. 完整复制复检 2 的检查脚本及辅助脚本到本目录。`browser-check-original.mjs` 与复检 2 的 `browser-check.mjs` 字节完全一致；原脚本和原证据未写入。执行副本的截图清单相对路径从 `recheck-2` 改为 `recheck-3`，输出由脚本自身目录决定。环境文件仅更新会话及端口。

2. Q01 的 page-scrolled 夹具：在设置图内 top=30 后，显式 `window.scrollTo(0,min(300,scrollHeight-innerHeight))`。固定浮层不再因表单位于文档流而自动触发页面滚动，首轮新建场景因 scrollY=0 未满足“提交前页面确实下滚”的前提。此次建立原定非零页面滚动状态；**所有原断言文字、数量、比较和 <2px 阈值均未改变**。适配后再次完整执行 S01–S18、R01–R07、N01–N02、Q01–Q03，380/380 通过；没有仅挑通过项覆盖。首轮 `initial-results.json`、`initial-assertions.txt`、`initial-run.log` 保留。具体差异见 [check-adaptations.diff](../evidence/022/recheck-3/check-adaptations.diff)。

3. P01–P06 为新增补测，不替代原断言。首轮 P05／P06 删除依赖夹具重复调用建立依赖，第二次目标已经变为“重复依赖”，导致四次 locator 超时；移除重复准备后完整重跑 P05、P06 两场景。此为补测脚本错误，业务判定及阈值未放宽。初始脚本／结果／日志以 `initial-p-*` 保留。

4. P05 初始将 overflow 列表中未绘制的条目完整矩形纳入比较，误计与“关闭菜单”重叠。按需求的“可见间距”改为逐层 overflow 裁剪计算，保存 fullRect 与可见 rect，排除完全裁掉的条目，实际可见按钮所有矩形对仍须 ≥4px，最终最低 6px。初始两条假失败及原始矩形保留在 `initial-p-results.json`；未豁免任何真实可见间距不足。

5. 将 P01 采样点进一步精确为桌面连接圆心／竖排连线出口中心，按四种环境重跑全部五操作；此前参照卡边界的采样保留在 `before-anchor-refinement-p-results.json`、`before-anchor-refinement-p-followup-results.json`。两轮位移均 0px，阈值不变。

6. P03 新增关闭按钮、输入框 Enter、无筛选取消对照，以及两次外点独立复现；**所有产品焦点失败均保留**。没有调整焦点返回要求来取得通过。最终原场景的“编号＋断言描述”集合与复检 2 的 380 条逐条一致，见 [evidence-check.json](../evidence/022/recheck-3/evidence-check.json)。

执行脚本：[browser-check.mjs](../evidence/022/recheck-3/browser-check.mjs)、[p-check.mjs](../evidence/022/recheck-3/p-check.mjs)、[p-followup.mjs](../evidence/022/recheck-3/p-followup.mjs)；合并／核验脚本为 [merge-results.py](../evidence/022/recheck-3/merge-results.py)、[verify-evidence.py](../evidence/022/recheck-3/verify-evidence.py)。所有本轮 MJS 的 `node --check` 通过。为了保留失败和追溯夹具调整，初始记录与最终汇总分开保存。原 S／R／N／Q 完整执行两次，补测执行后按上述原因重跑相应场景。

**控制台汇总**

[console.txt](../evidence/022/recheck-3/console.txt) 为“无”：error=0、warning=0、未捕获异常=0、HTTP≥400=0、失败资源请求=0、非本地页面请求=0，涵盖所有浏览器运行。首轮补测四次 locator 超时已在断言／日志中记录，是重复夹具准备造成的检查脚本异常；最终没有场景执行异常。最终 8 FAIL 都是实测焦点返回失败。

**清理与写入范围**

所有浏览器运行都在 finally 中 `await browser.close()` 后退出。静态服务已关闭，最终端口连接检查为 61／ECONNREFUSED；无本次浏览器、检查脚本、服务进程残留，项目外 Playwright 临时配置目录已自动移除。既有项目外 Playwright 安装保留。详见 [cleanup.json](../evidence/022/recheck-3/cleanup.json)。

开始前对允许路径以外 7585 个文件保存 SHA-256；结束核对修改、删除、新增，只允许 `evidence/022/recheck-3/` 和本报告。原型、FEATURES、HANDBOOK、research、旧任务／报告、旧证据均保持，工作区原有变更保留。核对结果见 [scope-check.json](../evidence/022/recheck-3/scope-check.json)。

**git status 输出**

本任务路径 `git status --short -- evidence/022/recheck-3/ tasks/022-recheck-3-report.md`：

```text
?? evidence/022/recheck-3/
?? tasks/022-recheck-3-report.md
```

完整 `git status --short`（起始状态见 git-status-before.txt，结束状态见 git-status-after.txt）：

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
?? tasks/021-rework-3-last-message.md
?? tasks/021-rework-3-report.md
?? tasks/021-rework-3.md
?? tasks/022-board-browser-check.md
?? tasks/022-last-message.md
?? tasks/022-recheck-1-last-message.md
?? tasks/022-recheck-1-report.md
?? tasks/022-recheck-1.md
?? tasks/022-recheck-2-last-message.md
?? tasks/022-recheck-2-report.md
?? tasks/022-recheck-2.md
?? tasks/022-recheck-3-report.md
?? tasks/022-recheck-3.md
?? tasks/022-report.md
?? tasks/023-dialog-inbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
