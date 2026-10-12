session-id: 01a131e4-fc65-76d0-9cd7-2d1278c786af

任务 026 复检 1 已完成，**本次复检通过**。S01–S17 完整重跑（含第 1、2 批），R01–R05 均通过；合计 **1129 PASS / 0 FAIL / 4 项环境限制、未验证**。S14 四个原生下拉框键盘筛选按任务要求不计失败；未宣称这些操作已验证。没有修改原型代码或旧证据。

环境：Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900、浅色；补测 375×812、760×812、1440×812 和深色。静态服务 `http://127.0.0.1:55628`，未使用 8787；独立原生控件对照使用 55629，两个服务都只绑定 127.0.0.1。所有页面请求限制在相应本地静态服务；浏览器 profile/缓存在系统临时目录，Playwright 依赖沿用项目外 `/tmp/helm-006-playwright.cNUInN/`。业务变化均经 UI，evaluate 仅用于读取 DOM/Demo 记录、测量几何或滚动。见 [environment.json](../evidence/026/recheck-1/environment.json)。

证据：[assertions.txt](../evidence/026/recheck-1/assertions.txt)、[console.txt](../evidence/026/recheck-1/console.txt)、[final-results.json](../evidence/026/recheck-1/final-results.json)、[全部截图路径](../evidence/026/recheck-1/screenshots.txt)。执行脚本：[browser-check.mjs](../evidence/026/recheck-1/browser-check.mjs)、[supplement.mjs](../evidence/026/recheck-1/supplement.mjs)、[rework-check.mjs](../evidence/026/recheck-1/rework-check.mjs)、[run-regression.mjs](../evidence/026/recheck-1/run-regression.mjs)。脚本复制来源及 SHA-256 见 [copied-script-manifest.json](../evidence/026/recheck-1/copied-script-manifest.json)，副本差异见 `script-diffs/`。

**R01–R05**

| 场景 | 结果与实测 | 代表截图 |
|---|---|---|
| R01 | **10 PASS / 0 FAIL**。通知产生后默认收起；展开为 static 文档流，占位不覆盖成员卡；单独关闭一条后未读计数保留；收起后正文不可见，与内容零相交。构造实际 4 条未读通知，全局只显示最近 3 条，逐条注明项目；A 页面只显示 A 通知。 | [R01-a-open.png](../evidence/026/recheck-1/R01-a-open.png)<br>[R01-a-recollapsed.png](../evidence/026/recheck-1/R01-a-recollapsed.png)<br>[R01-global-limit-3.png](../evidence/026/recheck-1/R01-global-limit-3.png)<br>[R01-a-cross-project.png](../evidence/026/recheck-1/R01-a-cross-project.png) |
| R02 | **6 PASS / 0 FAIL**。在初始没有暂停对象的项目 B 分别测试单卡和单成员：顶栏分别为 1 张卡/0 个成员、1 张卡/1 个成员（成员暂停关联卡也暂停）；展开明细显示“窄屏溢出诊断”和成员可读名；各自恢复后汇总消失。 | [R02-card-paused-details.png](../evidence/026/recheck-1/R02-card-paused-details.png)<br>[R02-session-paused-details.png](../evidence/026/recheck-1/R02-session-paused-details.png)<br>[R02-card-resumed.png](../evidence/026/recheck-1/R02-card-resumed.png)<br>[R02-session-resumed.png](../evidence/026/recheck-1/R02-session-resumed.png) |
| R03 | **28 PASS / 0 FAIL**。375×812，A/B 会话面板 clientWidth/scrollWidth 均为 374/374；滚到发消息区域后仍为 374/374，发消息容器 340/340。A/B 时间线主区 375/375、消息区 343/343、筛选区 341/341，首/末屏均无横向溢出；所有 button/select/input/textarea 水平边界均在视口内。 | [R03-a-composer.png](../evidence/026/recheck-1/R03-a-composer.png)<br>[R03-b-composer.png](../evidence/026/recheck-1/R03-b-composer.png)<br>[R03-a-timeline.png](../evidence/026/recheck-1/R03-a-timeline.png)<br>[R03-b-timeline.png](../evidence/026/recheck-1/R03-b-timeline.png) |
| R04 | **64 PASS / 0 FAIL**。760×812 页面已滚动、1440×812 主区已滚动；各自新建卡、改标签、删依赖、取消卡均真实生效。打开、切换、提交的立即/下一帧/80ms 稳定阶段，相对操作前图容器和参照连接点最大位移均为 0px，页面/主区/图内滚动差也为 0。保留 <2px 阈值；新建夹具覆盖 6/19 → 7/20。窄屏采用竖向出线点位置，桌面采用连接圆点中心。 | [R04-760-create-before.png](../evidence/026/recheck-1/R04-760-create-before.png)<br>[R04-760-create-after.png](../evidence/026/recheck-1/R04-760-create-after.png)<br>[R04-1440-create-before.png](../evidence/026/recheck-1/R04-1440-create-before.png)<br>[R04-1440-create-after.png](../evidence/026/recheck-1/R04-1440-create-after.png) |
| R05 | **16 PASS / 0 FAIL**。A 9、B 15 张成员会话卡，初始及各推进三轮后逐张检查：标题为代理名/卡名，无 session-*；没有重复四列列名的状态文字；每卡“示例”恰好一次，状态行无双前缀。A/B 团队每个成员区块最多一个示例；会话详情标题可读，内部身份仍在正文，派单/信件分别去重。已核对团队和详情截图。 | [R05-a-initial-members.png](../evidence/026/recheck-1/R05-a-initial-members.png)<br>[R05-b-initial-members.png](../evidence/026/recheck-1/R05-b-initial-members.png)<br>[R05-b-team.png](../evidence/026/recheck-1/R05-b-team.png)<br>[R05-b-session-detail-1.png](../evidence/026/recheck-1/R05-b-session-detail-1.png) |

R04 8 组完整坐标轨迹及 R03 控件边界保存在 `rework-results.json.metrics`；改标签、删依赖、取消卡各有同编号 before/open/submit/after 截图，不只检查新建。

**S01–S17 重跑**

| 场景 | 结论 | 代表截图 |
|---|---|---|
| S01 | **9 PASS / 0 FAIL**。A/B 四列及唯一归列、代理、负责卡、完整状态行、费用、待投递和未读与记录一致。 | [S01-a-members-board.png](../evidence/026/recheck-1/S01-a-members-board.png)<br>[S01-b-members-board.png](../evidence/026/recheck-1/S01-b-members-board.png) |
| S02 | **7 PASS / 0 FAIL**。预设输出、当前派单、inert、Tab 循环、Esc/外点/按钮回焦点；追加输出滚到最新。 | [S02-running-output.png](../evidence/026/recheck-1/S02-running-output.png)<br>[S02-output-next-round.png](../evidence/026/recheck-1/S02-output-next-round.png) |
| S03 | **11 PASS / 0 FAIL**。A/B 分组、状态、负责人、待我处理和组合筛选的三视图去重卡集合一致，父卡折叠一致。 | [S03-b-members-filtered.png](../evidence/026/recheck-1/S03-b-members-filtered.png)<br>[S03-collapsed-parent.png](../evidence/026/recheck-1/S03-collapsed-parent.png) |
| S04 | **15 PASS / 0 FAIL**。初始状态行、两行编辑后完整显示和三视图同步、决策记录及目标/约束保留。 | [S04-graph-updated.png](../evidence/026/recheck-1/S04-graph-updated.png)<br>[S04-members-updated.png](../evidence/026/recheck-1/S04-members-updated.png) |
| S05 | **5 PASS / 0 FAIL**。成本提问待投递→已投递→回复待投递→回复已投递→已确认。 | [S05-round-0-pending.png](../evidence/026/recheck-1/S05-round-0-pending.png)<br>[S05-round-2-reply.png](../evidence/026/recheck-1/S05-round-2-reply.png) |
| S06 | **9 PASS / 0 FAIL**。完成/需要你通知、未读去重计数、打开清除、重新标未读和通知返回焦点；遮挡/来源由 R01 加强。 | [S06-completion-unread.png](../evidence/026/recheck-1/S06-completion-unread.png)<br>[S06-cross-project-notice.png](../evidence/026/recheck-1/S06-cross-project-notice.png) |
| S07 | **46 PASS / 0 FAIL**。遍历成员、卡、分组及六消息类型的所有选项，消息 ID 集合逐项一致；无法送达高亮并说明原因、agent 来源完整。 | [S07-undeliverable.png](../evidence/026/recheck-1/S07-undeliverable.png) |
| S08 | **4 PASS / 0 FAIL**。实现/浏览器检查各两次派单各有完成报告，状态不明在成员卡及详情突出。 | [S08-unknown-member.png](../evidence/026/recheck-1/S08-unknown-member.png)<br>[S08-unknown-card.png](../evidence/026/recheck-1/S08-unknown-card.png) |
| S09 | **5 PASS / 0 FAIL**。待回答关卡进入收件箱，回答后关闭并移出，下一轮继续完成。 | [S09-answered-gate.png](../evidence/026/recheck-1/S09-answered-gate.png)<br>[S09-continued.png](../evidence/026/recheck-1/S09-continued.png) |
| S10 | **2 PASS / 0 FAIL**。上下文包、发了什么/没发什么及原因、消息、交接、发现、决策和派单齐全。 | [S10-records-1.png](../evidence/026/recheck-1/S10-records-1.png) |
| S11 | **3 PASS / 0 FAIL**。文件路径、基线与出处、增删 diff 和合回记录显示；预览抽屉正常。 | [S11-diff-drawer.png](../evidence/026/recheck-1/S11-diff-drawer.png) |
| S12 | **3 PASS / 0 FAIL**。团队字段齐全，暂停/恢复交付产能成员成功。 | [S12-team-paused.png](../evidence/026/recheck-1/S12-team-paused.png)<br>[S12-team-resumed.png](../evidence/026/recheck-1/S12-team-resumed.png) |
| S13 | **21 PASS / 0 FAIL**。卡、成员、项目暂停时输出/心跳/派单/投递冻结，恢复前状态，叠加范围逐个解除，预算恢复硬约束及决策保留；顶栏明细由 R02 加强。 | [S13-card-paused.png](../evidence/026/recheck-1/S13-card-paused.png)<br>[S13-session-paused.png](../evidence/026/recheck-1/S13-session-paused.png)<br>[S13-project-paused.png](../evidence/026/recheck-1/S13-project-paused.png) |
| S14 | **5 PASS / 0 FAIL / 4 环境限制、未验证**。键盘会话打开/关闭及单卡暂停/恢复通过；四个原生下拉键盘筛选为环境限制、未验证。独立原生控件仍为空值，列表框得到 one，不能据此认定产品缺陷。 | [S14-keyboard-timeline.png](../evidence/026/recheck-1/S14-keyboard-timeline.png)<br>[S14-native-select-control.png](../evidence/026/recheck-1/S14-native-select-control.png) |
| S15 | **5 PASS / 0 FAIL**。五套回归全部结束后重跑汇总，全部通过。原 Q01/P01 新建卡下移失败现为零位移，原阈值保持。 | [S15-regression-context.png](../evidence/026/recheck-1/S15-regression-context.png) |
| S16 | **18 PASS / 0 FAIL**。375px A/B 成员看板、全屏会话及返回、时间线、团队无横向溢出；另测 1024/760px。内部发信及筛选见 R03。 | [S16-b-375-session.png](../evidence/026/recheck-1/S16-b-375-session.png)<br>[S16-b-375-timeline.png](../evidence/026/recheck-1/S16-b-375-timeline.png) |
| S17 | **8 PASS / 0 FAIL**。深色成员、时间线、暂停、未读截图与 computedStyle 对比度抽查通过。 | [S17-dark-members.png](../evidence/026/recheck-1/S17-dark-members.png)<br>[S17-dark-pause.png](../evidence/026/recheck-1/S17-dark-pause.png) |

**完整回归**

| 套件 | 结果 |
|---|---|
| 026 | 176 PASS / 0 FAIL / 4 环境限制、未验证 |
| 026-R | 124 PASS / 0 FAIL |
| 024 | 85 PASS / 0 FAIL |
| 024-R | 74 PASS / 0 FAIL |
| 022-main | 380 PASS / 0 FAIL |
| 022-p | 235 PASS / 0 FAIL |
| 022-followup | 55 PASS / 0 FAIL |

**调整过的断言与定位（逐条）**

1. **S01 主字段**：旧文本必须含“会话”，新卡以可读标题直接打开会话、独立按钮改成“卡片详情”。副本改为要求“卡片详情”，状态行/花费/待投递要求不变；补测仍逐字段核对代理、卡、费用、待投递、未读及列与记录一致。首次旧文本断言失败保存在 `initial-main-*`。
2. **S01/S04 补测状态行**：成员卡改用一次小“示例”标记，数据原文仍有“示例 ·”。仅去掉展示标记后比较完整状态正文；图和状态列的原始正文要求保持；不允许隐藏目标、约束或省略状态内容。
3. **S04/S06/S08/S10/S11/S13/S14 详情定位**：成员卡原卡名按钮改为“卡片详情”，副本仍在相同 data-card-id/data-session-id 下点击入口；S12 团队不再显示内部会话 ID，改以“交付产能”定位相同成员区块。业务、焦点和状态断言不变。
4. **S06 通知入口与遮挡**：旧通知直接可点，现为默认收起的 details；点击通知前先展开。跨到 A 后 B 通知应被过滤，允许通知容器不存在，存在时检查实际可见矩形；原零重叠要求保持。R01 另实测展开、独立关闭、收起、条数上限及来源。
5. **024 S01 项目暂停标记**：旧要求 .pause-marker 总数恰好 1；返工后同时有“项目已暂停”及暂停汇总。改为“项目已暂停”标记恰好 1，继续要求实际 project.paused 和恢复入口；不限制合法汇总标记数。
6. **S14 原生下拉键盘**：四项仍执行 Tab/ArrowDown/Enter 并保存空值及焦点，结果改记 LIMIT“环境限制、未验证”，不计 PASS 或 FAIL。独立原生控件对照重新运行，没有沿用旧结果。
7. **新增 R02 夹具修正**：最初误写对象名“缺陷诊断”，实际卡名为“窄屏溢出诊断”。改为读取同一 card ID 的真实标题进行明细比较；6 项重测通过。首次两条夹具失败保存在 `initial-rework-*`，未当作产品问题。
8. **S15 执行依赖**：主检查先运行时三套子回归还未写出结果，原脚本记“尚未结束”。五套完整回归 exitCode=0 后重新执行 S15，5 条汇总通过；首次依赖未完成输出保留于 `initial-main-*`。
9. **继承 026 已说明的回归预期**：022 S07 启用成员四列且回放仍注明第 5 批；022 R05 加中间截图覆盖 13/13 卡、保持原图高/几何要求；022 P02 在实际菜单触发器滚入后读 anchor，保留 8px 间距/2px 阈值。024 S01 的真实暂停预期沿用并按第 5 项收窄标记定位。所有这些都从 026 更新副本完整重跑；没有重新使用旧结果。
10. **路径与汇总**：脚本的环境/输出/截图路径重定向到本复检目录，aggregate 根目录增加一层并纳入 R01–R05 和 LIMIT 分类；不改变产品预期。Q01/P01/R04 的 <2px、横向溢出、对比度、消息与冻结等阈值没有放宽。

**新问题：无。** 本轮检查范围内未发现新的产品缺陷。S14 保留四项环境限制、未验证，不将其记为产品问题或已验证。已审阅本批九张截图索引图，并放大核对通知、暂停明细、375px 发信/时间线、760px 新建前后及团队/会话详情。索引见 `review-sheets.json`。

**控制台与对比度**

主检查、R01–R05、五套回归、原生控件对照：0 error、0 warning、0 pageerror/未捕获异常、0 失败请求/HTTP 错误。`console.txt` 汇总为“无”；各套原始控制台文件保留。

| 深色抽查 | 文字样本数 / 最低对比度 | 图形样本数 / 最低对比度 |
|---|---|---|
| 深色成员 | 111 / 7.143:1 | 34 / 5.215:1 |
| 深色未读顶栏 | 14 / 7.418:1 | 6 / 6.370:1 |
| 深色暂停 | 23 / 7.295:1 | 12 / 6.370:1 |
| 深色时间线 | 129 / 7.143:1 | 31 / 6.370:1 |

实测覆盖样本均满足文字 ≥4.5:1、图形 ≥3:1；第 1、2 批原有浅/深色和浮层对比度检查全部通过。18 个 MJS 的 `node --check` 全通过；`git diff --check` exitCode=0。

**清理与写入范围**

所有浏览器套件 finally 已完成 context/browser 关闭；五套回归子进程全部 exitCode=0。静态服务 PID 63672 已 SIGTERM 终止，原生控件服务也在 finally 终止；55628/55629 均返回 ECONNREFUSED。浏览器临时 profile 在项目外，未删除已有 Playwright 依赖或其他会话缓存。见 [cleanup.json](../evidence/026/recheck-1/cleanup.json)。

保护文件 SHA-256：开始时 6505 个既有文件，修改 0、删除 0；范围外新增：无。本次只写入 `evidence/026/recheck-1/` 和本报告，原型及所有旧证据内容未变。见 [scope-check.json](../evidence/026/recheck-1/scope-check.json)。

工作区开始时已有原型改动、025/026 等未跟踪证据和任务文件；完整 git status 因而不只列本任务。保留已有工作，本次新增报告和复检子目录。基线见 [baseline-git-status.txt](../evidence/026/recheck-1/baseline-git-status.txt)。

**git status --short 输出**

```text
 M prototype/app.js
 M prototype/data.js
 M prototype/index.html
?? evidence/025/
?? evidence/026/
?? tasks/025-last-message.md
?? tasks/025-members-mailbox.md
?? tasks/025-report.md
?? tasks/025-rework-1-last-message.md
?? tasks/025-rework-1-report.md
?? tasks/025-rework-1.md
?? tasks/026-last-message.md
?? tasks/026-members-browser-check.md
?? tasks/026-recheck-1-report.md
?? tasks/026-recheck-1.md
?? tasks/026-report.md
?? tasks/027-card-detail-acceptance.md
?? tasks/029-replay-libraries.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
