session-id: 01a13145-ef9f-7dd3-a612-9c60f0e0601a

任务 022：原型 v7 第 1 批真实浏览器检查已完成，**检查未通过**。18 个场景中 15 个通过，S08、S09、S17 含失败项；最终 149/156 条断言通过、7 条失败。另有 favicon 404 控制台错误。只记录问题，没有修改原型代码。

已先读 `tasks/021-report.md`（含给 022 的提示）、021 数据模型说明，以及 `FEATURES.md` 1.2、1.3、10.3 和第 11 节项目 B。检查使用 Playwright 1.64.0 + 本机 Chrome 154.0.8037.99 headless；桌面 1440×900、浅色，窄屏 375×812，系统深色及侧栏切换均实测。静态服务是 `python3 -m http.server 63705 -d prototype`，仅访问 `http://127.0.0.1:63705`，没有使用 8787。Playwright 复用项目外的 `/tmp/helm-006-playwright.cNUInN/node_modules/playwright`，未安装项目依赖。

脚本：[browser-check.mjs](../evidence/022/browser-check.mjs)；逐行 DOM/几何断言：[assertions.txt](../evidence/022/assertions.txt)；完整计算样式、鼠标坐标、确认框、数据核对：[results.json](../evidence/022/results.json)。共 107 张场景截图；下表列主要截图，全部路径含长图分页见 [screenshots.txt](../evidence/022/screenshots.txt)。截图保持对应视口尺寸，用滚动页面、主区或状态列拍摄各段，不改 CSS、不隐藏页面内容。

| 场景 | 结论 | 主要截图路径 |
|---|---|---|
| S01 | PASS：默认依赖图 13 卡；按状态着色；五分组色块及缺陷三卡“示例”齐全。色块包含和几何检查通过。 | [S01-desktop.png](../evidence/022/S01-desktop.png)、[S01-all-groups.png](../evidence/022/S01-all-groups.png)、[S01-all-groups-part2.png](../evidence/022/S01-all-groups-part2.png)、[S01-all-groups-part3.png](../evidence/022/S01-all-groups-part3.png) |
| S02 | PASS：抽查实现、浏览器检查、v6 协作设计的六项字段，与数据一致，SVG 文字均在卡片内。 | [S02-b-implement.png](../evidence/022/S02-b-implement.png)、[S02-b-browser.png](../evidence/022/S02-b-browser.png)、[S02-b-collaboration.png](../evidence/022/S02-b-collaboration.png) |
| S03 | PASS：实现依赖 v2 功能规格，使用产出 v1、当前上游 v2；有“⚠ 上游已变”。 | [S03-upstream-changed.png](../evidence/022/S03-upstream-changed.png) |
| S04 | PASS：两个父卡分别折叠、展开，两个子卡消失并恢复。前后卡片无重叠，连线不穿过其他卡。 | [S04-before-part2.png](../evidence/022/S04-before-part2.png)、[S04-collapsed-part2.png](../evidence/022/S04-collapsed-part2.png)、[S04-expanded-part2.png](../evidence/022/S04-expanded-part2.png)、[S04-expanded-part3.png](../evidence/022/S04-expanded-part3.png) |
| S05 | PASS：13 卡各在匹配状态的一列。暂停、取消默认收起；用 A 的市场调研、不承接验证展开后内容可见。 | [S05-B-columns.png](../evidence/022/S05-B-columns.png)、[S05-B-all-columns-right2.png](../evidence/022/S05-B-all-columns-right2.png)、[S05-A-expanded-columns-right2.png](../evidence/022/S05-A-expanded-columns-right2.png) |
| S06 | PASS：开发、已验收、负责人、只看我要处理的四组筛选，两视图集合与数据一致，切换保留；组合条件取交集。 | [S06-group-graph.png](../evidence/022/S06-group-graph.png)、[S06-group-columns.png](../evidence/022/S06-group-columns.png)、[S06-status-graph.png](../evidence/022/S06-status-graph.png)、[S06-status-columns.png](../evidence/022/S06-status-columns.png)、[S06-owner-graph.png](../evidence/022/S06-owner-graph.png)、[S06-owner-columns.png](../evidence/022/S06-owner-columns.png)、[S06-mine-graph.png](../evidence/022/S06-mine-graph.png)、[S06-mine-columns.png](../evidence/022/S06-mine-columns.png) |
| S07 | PASS：成员与回放禁用，文字及 title 分别注明第 3、5 批。 | [S07-disabled-entries.png](../evidence/022/S07-disabled-entries.png) |
| S08 | FAIL（排版）：真实鼠标连接及决策记录均成功；拖动目标说明压住版本行，反馈出现时连接点下移。 | [S08-valid-dragging.png](../evidence/022/S08-valid-dragging.png)、[S08-valid-dropped.png](../evidence/022/S08-valid-dropped.png)、[S08-decision.png](../evidence/022/S08-decision.png) |
| S09 | FAIL（排版）：成环、自身都显示禁止样式和原因，未加依赖或决策；仍有说明文字重叠与连接点跳动。 | [S09-cycle-dragging.png](../evidence/022/S09-cycle-dragging.png)、[S09-cycle-dropped.png](../evidence/022/S09-cycle-dropped.png)、[S09-self-dragging.png](../evidence/022/S09-self-dragging.png)、[S09-self-dropped.png](../evidence/022/S09-self-dropped.png) |
| S10 | PASS：通过表单新建草稿入图；设计 → 缺陷的标签与色块立即变化。 | [S10-new-draft.png](../evidence/022/S10-new-draft.png)、[S10-changed-group.png](../evidence/022/S10-changed-group.png) |
| S11 | PASS：已验收的 v2 功能规格、进行中的窄屏溢出诊断均触发下游影响确认。取消不生效，保留输入；确认才改变并记录。 | [S11-b-spec-cancelled.png](../evidence/022/S11-b-spec-cancelled.png)、[S11-b-spec-confirmed.png](../evidence/022/S11-b-spec-confirmed.png)、[S11-b-defect-diagnose-cancelled.png](../evidence/022/S11-b-defect-diagnose-cancelled.png)、[S11-b-defect-diagnose-confirmed.png](../evidence/022/S11-b-defect-diagnose-confirmed.png) |
| S12 | PASS：取消窄屏溢出诊断，状态变已取消；窄屏溢出修复显示“⚠ 上游已取消”，原依赖保留。 | [S12-cancelled-card-and-downstream.png](../evidence/022/S12-cancelled-card-and-downstream.png)、[S12-cancelled-column.png](../evidence/022/S12-cancelled-column.png) |
| S13 | PASS：实际 Tab → Shift+F10/Enter → 方向键 → 添加依赖到 → Enter 完成连接；Esc 关闭并归还焦点。 | [S13-keyboard-menu.png](../evidence/022/S13-keyboard-menu.png)、[S13-keyboard-connected.png](../evidence/022/S13-keyboard-connected.png) |
| S14 | PASS：A 八卡、承接评估分组；交付、不承接均为普通卡，没有条件分支元素。 | [S14-project-A.png](../evidence/022/S14-project-A.png)、[S14-project-A-graph.png](../evidence/022/S14-project-A-graph.png) |
| S15 | PASS：点击看板打开详情。规格逐条带来源；依赖含上下游、使用版本、父子卡及产出历史；执行含两次尝试、31/34 → 38/38、019/020 会话。 | [S15-spec.png](../evidence/022/S15-spec.png)、[S15-dependencies-panel.png](../evidence/022/S15-dependencies-panel.png)、[S15-execution.png](../evidence/022/S15-execution.png)、[S15-browser-scores.png](../evidence/022/S15-browser-scores.png)、[S15-output-history.png](../evidence/022/S15-output-history.png)、[S15-b-sandbox-recheck-session.png](../evidence/022/S15-b-sandbox-recheck-session.png)、[S15-b-agent-team-session.png](../evidence/022/S15-b-agent-team-session.png) |
| S16 | PASS：六个页面都有内容与截图，无新增控制台 error/warning/异常；无席位安排、自主度设置表、流程变更请求、项目 C。 | [S16-inbox.png](../evidence/022/S16-inbox.png)、[S16-agents.png](../evidence/022/S16-agents.png)、[S16-experience.png](../evidence/022/S16-experience.png)、[S16-decisions.png](../evidence/022/S16-decisions.png)、[S16-memory.png](../evidence/022/S16-memory.png)、[S16-settings.png](../evidence/022/S16-settings.png) |
| S17 | FAIL：页面宽 375px，两视图无横向溢出、筛选控件包在页面内、状态列纵向排列、对比度达标；长依赖图无法在图内纵向滚动。 | [S17-narrow-graph-top.png](../evidence/022/S17-narrow-graph-top.png)、[S17-narrow-graph-all.png](../evidence/022/S17-narrow-graph-all.png)、[S17-narrow-changed.png](../evidence/022/S17-narrow-changed.png)、[S17-narrow-columns.png](../evidence/022/S17-narrow-columns.png)、[S17-narrow-columns-all.png](../evidence/022/S17-narrow-columns-all.png) |
| S18 | PASS：系统深色及侧栏明暗切换生效；依赖图分组和警告、状态列可见。桌面及补充窄屏深色对比度通过。 | [S18-dark-graph-all.png](../evidence/022/S18-dark-graph-all.png)、[S18-dark-upstream-changed.png](../evidence/022/S18-dark-upstream-changed.png)、[S18-dark-columns.png](../evidence/022/S18-dark-columns.png)、[S18-dark-columns-all-right2.png](../evidence/022/S18-dark-columns-all-right2.png)、[S18-narrow-dark-graph.png](../evidence/022/S18-narrow-dark-graph.png)、[S18-narrow-dark-columns-all.png](../evidence/022/S18-narrow-dark-columns-all.png) |

抽查的具体值：实现＝已验收、前端工程师、开发、测试 2/2、规格 v2 · 产出 v1；浏览器检查＝待验收、浏览器检查员、开发、测试 2/3、规格 v2 · 产出 v0；v6 协作设计＝已验收、通用核对员、运行时设计 · 设计、测试 1/1、规格 v1 · 产出 v1。正常图中未发现卡片重叠、标题或元信息截断、连线穿过非端点卡片、分组色块包不住或圈进其他卡、警告只靠颜色等问题。

发现的问题：

1. **S08/S09，拖动说明文字重叠。** 草稿卡拖动时的“可连接”“禁止：连向自身／形成循环／重复依赖”和“规格 v1 · 产出 v0”占据同一行。真实文字矩形有交集，版本行难以辨认；放下后重叠消失。见 S08-valid-dragging.png、S09-cycle-dragging.png、S09-self-dragging.png。三次拖动对应三条失败断言。
2. **S08/S09，拖动开始时布局跳动。** `#board-drag-feedback` 从隐藏变为显示，图和连接点下移；鼠标按下坐标与反馈出现后的连接点中心相比，合法连接和自身连接各下移 27.1875px，成环连接下移 35.1875px。临时线终点在后续多步移动中能跟随鼠标（误差 <2px），但起拖时看板并不稳定。三条失败断言，精确坐标见 results.json 的 `*-mouse` 和 `*-anchor-shift`。
3. **S17，窄屏长图没有图内纵向滚动。** `.flow-canvas` 的 clientHeight 和 scrollHeight 均为 3527px，设置 scrollTop=100 后仍为 0；虽然 overflow 是 auto，容器与 SVG 一样高，实际只能滚整页。clientWidth/scrollWidth 均为 341px；整页 scrollWidth 与 innerWidth 均为 375px，所以没有横向溢出。见 S17-narrow-graph-all.png 及后续 part2–part5，另有一条失败断言。
4. **资源缺失。** 浏览器自动请求 `/favicon.ico` 返回 404，产生 console error。检查日志捕获三次，来自三个独立浏览器检查上下文；均为同一资源，主页面和四个 JS 文件成功加载。未修复。

真实拖拽操作：先经“＋ 新建卡”表单创建“022 鼠标起点”“022 鼠标终点”两张开发分组草稿，用分组＝开发、状态＝草稿让两卡同时出现在视口，点击“编辑看板”。从起点右侧圆连接点中心调用 `mouse.move`、`mouse.down`，分两个阶段各 `{steps:12}` 移至目标卡内部，共 24 步；在按钮按下期间拍 dragging 截图，然后 `mouse.up` 并拍 dropped。合法路径从 (503, 200.1875) 到 (398, 461.1875)，确认真实 SVG 命中、临时线、目标样式、立即出现的连线，以及唯一新增的“你”的决策，并打开决策记录页面核对。随后用相同鼠标动作从终点拖回起点形成环，再从起点拖回自身，确认禁止样式与中文原因、依赖集合及决策数完全不变。没有调用 `connectFlowNodes` 等应用函数或合成 pointer 事件代替操作。

S11 的原生 confirm 由 Playwright `dialog` 事件读取实际正文，然后分别 dismiss/accept。正文有动作、受影响卡名及状态；完整证据见 [dialogs.txt](../evidence/022/dialogs.txt) 和 results.json 的 dialogs。原生确认框未出现在 headless 页面截图里，截图记录取消后保留输入及确认后的实际结果。键盘路径在完成测试用草稿准备后，只用真实 Tab、Shift+F10、Enter、方向键、Esc；不仅检查 handler。

对比度由浏览器 `getComputedStyle` 读取实际 SVG fill/stroke、HTML color/backgroundColor；按 WCAG sRGB 相对亮度计算。卡片正文按卡片底色，状态按标签底色，分组按区域/标签底色，图上警告按卡片底色，状态列警告按自己的底色；边界同时对比色块与画布，普通/活动连线和箭头对比画布及所有分组底色。文字要求 ≥4.5:1，图形/连线 ≥3:1，抽查没有不足。表中是每类最小值：

| 样式/视图 | 卡片文字 | 状态标签 | 分组标签 | 上游已变 | 图形/连线 |
|---|---:|---:|---:|---:|---:|
| 窄屏浅色图 | 6.489 | 6.183 | 6.512 | 7.565 | 6.512 |
| 窄屏浅色状态列 | 6.489 | 6.183 | 5.572 | 6.315 | —（无依赖线） |
| 桌面深色图 | 8.863 | 7.295 | 7.295 | 8.132 | 7.067 |
| 桌面深色状态列 | 8.863 | 7.295 | 7.937 | 7.143 | —（无依赖线） |
| 窄屏深色图 | 8.863 | 7.295 | 7.295 | 8.132 | 7.067 |
| 窄屏深色状态列 | 8.863 | 7.295 | 7.937 | 7.143 | —（无依赖线） |

控制台汇总：[console.txt](../evidence/022/console.txt) 有 3 条 error，全部为本地 favicon 404；warning 0、未捕获 JavaScript 异常 0。六页冒烟各自打开后没有新增 error/warning/异常。完整主检查日志见 run.log；supplement.log 补充状态列横向截图及逐页控制台断言；drag-supplement.log 补充拖动跳动几何断言。harness-first-run.log 保存了初次脚本将 `role=menuitem` 错定位为 button 的诊断；已修正检查脚本并完成相关场景，该定位失败不计为原型缺陷。长元素的 locator 截图会扩视口并触发原型重排，因此最终改成固定视口分页，初次无效截图已替换。

清理已完成：预检与正式/补充检查的浏览器均关闭；静态服务 PID 46630 已终止，63705 端口连接返回 ECONNREFUSED；进程检查没有残留本次 headless Chrome 或该端口的 Python 服务。复用的他方项目外 Playwright 缓存保留。见 [cleanup.json](../evidence/022/cleanup.json)。所有看板变动只在浏览器页面内存里，关闭页面即丢弃。

文件范围核对：开始前保存 [git-status-before.txt](../evidence/022/git-status-before.txt) 和受保护文件 SHA-256 清单；结束后核对没有修改或删除任何受保护的既有文件，包括 prototype、src、FEATURES/HANDBOOK/DESIGN、research、001–021 证据、其他任务文件及依赖清单。见 [scope-check.json](../evidence/022/scope-check.json)。本次写入仅 evidence/022/ 和 tasks/022-report.md。开始时原型/021 证据和报告已处于未提交状态；执行期间另出现他方任务说明 tasks/023-dialog-inbox.md，本次没有创建或修改。因此全仓库 git status 不能字面上只列 022；没有清除这些用户/他方文件来缩短输出。

最终 `git status --short`（与 evidence/022/git-status-after.txt 一致）：

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
?? tasks/022-board-browser-check.md
?? tasks/022-report.md
?? tasks/023-dialog-inbox.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
