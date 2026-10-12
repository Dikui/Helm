session-id: 01a131cd-ae87-7de2-b80d-ee7d8d7c39b4

任务 026 浏览器检查已完成，**本次不通过验收**。17 个场景均有截图与断言；只记录问题，未修改原型代码。

环境：本机 Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900、浅色，另测 375×812、1024/760px 和深色。静态服务 `http://127.0.0.1:55626`，未使用 8787。页面请求限定本地静态服务；业务变化均通过 UI，evaluate 仅读取 DOM/Demo 数据、几何或滚动。Playwright 位于项目外 `/tmp/helm-006-playwright.cNUInN/`，Chrome 临时 profile 使用项目外系统临时目录。环境见 [environment.json](../evidence/026/environment.json)。

主检查 **167 PASS / 13 FAIL（180 条）**；完整汇总 **990 PASS / 19 FAIL（1009 条）**。19 条失败不是 19 个独立缺陷：4 条是原生下拉键盘未验证，5 条是回归失败的汇总断言，4 条对应同一新增卡片位移，其余 6 条是通知遮挡、暂停标记和窄屏溢出。

证据：[assertions.txt](../evidence/026/assertions.txt)、[console.txt](../evidence/026/console.txt)、[final-results.json](../evidence/026/final-results.json)、[截图全量清单](../evidence/026/screenshots.txt)。主脚本 [browser-check.mjs](../evidence/026/browser-check.mjs)，补测 [supplement.mjs](../evidence/026/supplement.mjs)。截图清单全部存在；已审阅本批截图索引图并放大核对代表性与失败截图。

每个场景的结论与截图如下；“通过”仅指该行断言，跨场景共享问题列在问题栏。

| 场景 | 断言结论与核对 | 看到的问题 | 截图（均在 evidence/026/） |
|---|---|---|---|
| S01 成员看板 | **PASS，9/9**。A 9、B 15 个成员会话；四列、唯一归列及每张卡的代理、负责卡、状态行、花费、待投递数、未读均与记录一致。 | 通知遮挡见 S06。 | [S01-a-members-board.png](../evidence/026/S01-a-members-board.png)<br>[S01-b-members-board.png](../evidence/026/S01-b-members-board.png)<br>[S01-b-unread-unknown.png](../evidence/026/S01-b-unread-unknown.png) |
| S02 会话详情 | **PASS，7/7**。预设输出、当前派单可见；底层 inert、Tab 循环、Esc/外点/关闭按钮回原会话卡；推进后输出追加并滚到底。 | 无（375px 内部溢出见 S16）。 | [S02-running-output.png](../evidence/026/S02-running-output.png)<br>[S02-focus-return.png](../evidence/026/S02-focus-return.png)<br>[S02-output-next-round.png](../evidence/026/S02-output-next-round.png) |
| S03 三视图筛选 | **PASS，11/11**。A/B 分别检查分组、状态、有效负责人、待我处理及组合筛选；卡集合去重一致；父卡折叠也一致。 | 无。 | [S03-a-graph-filtered.png](../evidence/026/S03-a-graph-filtered.png)<br>[S03-a-columns-filtered.png](../evidence/026/S03-a-columns-filtered.png)<br>[S03-a-members-filtered.png](../evidence/026/S03-a-members-filtered.png)<br>[S03-collapsed-parent.png](../evidence/026/S03-collapsed-parent.png) |
| S04 状态行 | **PASS，15/15**。所有初始卡片的状态行在三视图完整；编辑两行目标/约束后同步，SVG 文字在卡片边界内，无省略；决策有记录，完成后保留目标/约束。 | 无。 | [S04-edited-detail.png](../evidence/026/S04-edited-detail.png)<br>[S04-graph-updated.png](../evidence/026/S04-graph-updated.png)<br>[S04-columns-updated.png](../evidence/026/S04-columns-updated.png)<br>[S04-members-updated.png](../evidence/026/S04-members-updated.png)<br>[S04-decisions.png](../evidence/026/S04-decisions.png) |
| S05 按轮投递 | **PASS，5/5**。第 0 轮提问待投递，第 1 轮已投递，第 2 轮出现 28 人天/20% 缓冲回复并待投递，第 3 轮收到回复；信箱确认后已确认。 | 无。 | [S05-round-0-pending.png](../evidence/026/S05-round-0-pending.png)<br>[S05-round-1-delivered.png](../evidence/026/S05-round-1-delivered.png)<br>[S05-round-2-reply.png](../evidence/026/S05-round-2-reply.png)<br>[S05-round-3-delivered.png](../evidence/026/S05-round-3-delivered.png)<br>[S05-reply-confirmed.png](../evidence/026/S05-reply-confirmed.png) |
| S06 通知与未读 | **FAIL，8/9**。完成和需要你均产生通知，卡/会话标未读，计数按会话去重增加一；打开会话或卡片清除，可手动重新标未读；通知消失后关闭仍回可见入口。 | FAIL：固定通知遮挡成员字段和入口；A 页面仍显示 B 的通知，缺少项目来源说明。 | [S06-completion-unread.png](../evidence/026/S06-completion-unread.png)<br>[S06-manual-unread.png](../evidence/026/S06-manual-unread.png)<br>[S06-notification-return.png](../evidence/026/S06-notification-return.png)<br>[S06-needs-you-notification.png](../evidence/026/S06-needs-you-notification.png)<br>[S06-cross-project-notice.png](../evidence/026/S06-cross-project-notice.png) |
| S07 消息时间线 | **PASS，46/46**。遍历成员/会话、卡片、分组、六种类型的所有选项，逐项核对消息 ID 集合；无法送达有高亮和原因，消息均注明来自某个 agent。 | 无（375px 筛选溢出见 S16）。 | [S07-filter-member.png](../evidence/026/S07-filter-member.png)<br>[S07-filter-card.png](../evidence/026/S07-filter-card.png)<br>[S07-filter-group.png](../evidence/026/S07-filter-group.png)<br>[S07-filter-type.png](../evidence/026/S07-filter-type.png)<br>[S07-undeliverable.png](../evidence/026/S07-undeliverable.png) |
| S08 完成报告与状态不明 | **PASS，4/4**。实现、浏览器检查各两次派单，每次已结束派单各一份报告；原失败说明、31/34、38/38、S03 原断言说明保留。状态不明在卡片详情与成员卡突出，不补造完成报告。 | 无。 | [S08-b-implement-reports-2.png](../evidence/026/S08-b-implement-reports-2.png)<br>[S08-b-browser-reports-3.png](../evidence/026/S08-b-browser-reports-3.png)<br>[S08-unknown-member.png](../evidence/026/S08-unknown-member.png)<br>[S08-unknown-card.png](../evidence/026/S08-unknown-card.png) |
| S09 决策关卡 | **PASS，5/5**。320px 范围关卡在待回答；跳到问题并采纳答案后关闭、移出收件箱；下一轮诊断继续并完成。 | 无。 | [S09-waiting-inbox.png](../evidence/026/S09-waiting-inbox.png)<br>[S09-answered-gate.png](../evidence/026/S09-answered-gate.png)<br>[S09-continued.png](../evidence/026/S09-continued.png) |
| S10 记录标签 | **PASS，2/2**。上下文包的发了什么、没发什么及原因，相关消息、交接、发现、相关决策、两次派单列表齐全。 | 无。 | [S10-records-1.png](../evidence/026/S10-records-1.png)<br>[S10-records-2.png](../evidence/026/S10-records-2.png)<br>[S10-records-3.png](../evidence/026/S10-records-3.png)<br>[S10-records-4.png](../evidence/026/S10-records-4.png) |
| S11 文件标签 | **PASS，3/3**。实现文件路径、661c858 → eeac9ad 基线/出处、增删 diff 片段、合回记录显示；diff 抽屉可打开。 | 无；展示为已有真实 diff 片段，未声称完整工作区差异。 | [S11-files-1.png](../evidence/026/S11-files-1.png)<br>[S11-files-2.png](../evidence/026/S11-files-2.png)<br>[S11-files-3.png](../evidence/026/S11-files-3.png)<br>[S11-diff-drawer.png](../evidence/026/S11-diff-drawer.png) |
| S12 团队页 | **PASS，3/3**。成员代理配置、会话、当前卡、预算/花费、表现统计齐全；团队页暂停、恢复交付产能会话成功。 | 无。 | [S12-team-before.png](../evidence/026/S12-team-before.png)<br>[S12-team-paused.png](../evidence/026/S12-team-paused.png)<br>[S12-team-resumed.png](../evidence/026/S12-team-resumed.png) |
| S13 暂停与恢复 | **FAIL，19/21**。卡片、成员、项目分别暂停/恢复；轮次、输出、心跳、派单和收件投递冻结，恢复回原状态；都有决策。叠加范围逐个解除正确；预算事项未处理不能恢复，追加预算不自动恢复。 | FAIL：只暂停卡片或成员时顶栏没有暂停标记；项目暂停标记正常。 | [S13-card-paused.png](../evidence/026/S13-card-paused.png)<br>[S13-card-frozen.png](../evidence/026/S13-card-frozen.png)<br>[S13-card-resumed.png](../evidence/026/S13-card-resumed.png)<br>[S13-session-paused.png](../evidence/026/S13-session-paused.png)<br>[S13-session-frozen.png](../evidence/026/S13-session-frozen.png)<br>[S13-session-resumed.png](../evidence/026/S13-session-resumed.png)<br>[S13-project-paused.png](../evidence/026/S13-project-paused.png)<br>[S13-project-frozen.png](../evidence/026/S13-project-frozen.png)<br>[S13-project-resumed.png](../evidence/026/S13-project-resumed.png)<br>[S13-overlap-resumed.png](../evidence/026/S13-overlap-resumed.png)<br>[S13-pause-decisions.png](../evidence/026/S13-pause-decisions.png)<br>[S13-budget-blocked.png](../evidence/026/S13-budget-blocked.png)<br>[S13-budget-resumed.png](../evidence/026/S13-budget-resumed.png) |
| S14 键盘 | **FAIL，5/9**。全程 Tab/Enter/Esc 打开会话、关闭回原卡、暂停并恢复卡片通过。四个原生时间线下拉框方向键未能改变选择；独立原生控件对照同样复现，列表框对照能收到方向键。 | 未验证/FAIL：时间线键盘筛选受本机 headless 原生下拉行为限制，不能据此认定产品键盘缺陷，也不能宣称场景通过。 | [S14-keyboard-session.png](../evidence/026/S14-keyboard-session.png)<br>[S14-keyboard-timeline.png](../evidence/026/S14-keyboard-timeline.png)<br>[S14-keyboard-paused.png](../evidence/026/S14-keyboard-paused.png)<br>[S14-keyboard-resumed.png](../evidence/026/S14-keyboard-resumed.png)<br>[S14-native-select-control.png](../evidence/026/S14-native-select-control.png) |
| S15 第 1、2 批回归 | **FAIL，2/5**。复制并完整运行 024 复检主脚本、补测、其三套第 1 批回归；保留原样结果及差异。预期调整后仍有真实位移失败，详见下表。 | FAIL：760px 已滚动页面新建卡片提交后，原连接点与图容器各下移 27.1875px。 | [S15-regression-context.png](../evidence/026/S15-regression-context.png)<br>[S15-760-create-before.png](../evidence/026/S15-760-create-before.png)<br>[S15-760-create-after.png](../evidence/026/S15-760-create-after.png) |
| S16 375×812 | **FAIL，15/18**。A/B 成员看板纵排且无横向滚动；团队无横向滚动；会话全屏，有“关闭会话”返回入口，关闭回原卡。1024/760px 成员页无页面横向溢出。 | FAIL：A/B 会话内部可横向滚动，B 时间线的原生筛选控件超宽并被裁切；页面本身均为 375px。 | [S16-a-375-members.png](../evidence/026/S16-a-375-members.png)<br>[S16-b-375-members.png](../evidence/026/S16-b-375-members.png)<br>[S16-a-375-session.png](../evidence/026/S16-a-375-session.png)<br>[S16-b-375-session.png](../evidence/026/S16-b-375-session.png)<br>[S16-a-375-timeline.png](../evidence/026/S16-a-375-timeline.png)<br>[S16-b-375-timeline-filter-overflow.png](../evidence/026/S16-b-375-timeline-filter-overflow.png)<br>[S16-a-375-team.png](../evidence/026/S16-a-375-team.png)<br>[S16-b-375-team.png](../evidence/026/S16-b-375-team.png)<br>[S16-a-375-composer-overflow.png](../evidence/026/S16-a-375-composer-overflow.png)<br>[S16-b-375-composer-overflow.png](../evidence/026/S16-b-375-composer-overflow.png) |
| S17 深色模式 | **PASS，8/8**。成员看板、时间线、暂停、未读均截图；computedStyle 实测文字 ≥4.5:1、图形 ≥3:1，全部覆盖样本通过。 | 无对比度不足；通知遮挡仍存在，见 S06。 | [S17-dark-members.png](../evidence/026/S17-dark-members.png)<br>[S17-dark-timeline.png](../evidence/026/S17-dark-timeline.png)<br>[S17-dark-pause.png](../evidence/026/S17-dark-pause.png)<br>[S17-dark-unread.png](../evidence/026/S17-dark-unread.png)<br>[S17-dark-undeliverable.png](../evidence/026/S17-dark-undeliverable.png) |

需要处理的问题：

1. **通知遮挡**：在 A 成员看板上，通知与两条费用/待投递信息及“不承接”会话标题入口相交；通知来自 B 的缺陷诊断/修复，未注明项目来源。通知固定显示且没有独立关闭入口，需要打开对应会话才能清掉。见 S06-cross-project-notice.png，交叠元素及文字保存在 results.json 的 cross-project-notification。
2. **卡片/成员暂停缺少顶栏标记**：卡片本身和会话原状态说明正确，冻结/恢复也正确，但 .project-topbar .pause-marker 为 0。026 S13 明确要求暂停时顶栏有明显标记；025 原实现说明只承诺项目暂停标记，本次按 026 验收记录失败。
3. **会话内部横向溢出**：375px 下 .session-detail 的 clientWidth=374，A scrollWidth=408（+34px），B=450（+76px）。发送消息的 #mail-recipient 原生 select 超宽；滚动到该区域会自动发生横向滚动。见 S16-*-375-composer-overflow/scrolled-right.png；面板初始宽度仍是 375px，不能把全屏几何通过等同于内部无溢出。
4. **B 时间线裁切**：#main clientWidth=375、scrollWidth=386；#timeline-member 右边缘 377px，#timeline-card 右边缘 385.5px，超出视口。overflow-x:hidden 隐藏了滚动条，实际内容仍被裁切。A 时间线及 A/B 团队、成员看板没有同类溢出。
5. **新增卡片位置跳动**：760×812、页面已 scrollY=300、图内 scrollTop=30，提交新卡前图容器 top=542.46875、参照连接点 y=668.46875，提交后分别变为 569.65625/695.65625；页面和图内滚动值没变，位移 27.1875px 持续到下一帧与稳定阶段。两套独立回归 Q01/P01 均复现，保留原 <2px 阈值，未放宽。新增工具条换行是可能原因，属于依据布局现象作出的推断。

键盘限制单列：Chrome headless 的原生折叠下拉，Tab 能到达，但 ArrowDown/Enter、Space/ArrowDown/Enter、Alt+ArrowDown 等均未改变值。独立 [native-select-fixture.html](../evidence/026/native-select-fixture.html) 对照亦不响应，size=3 列表框经两次 ArrowDown 成功选择 one；见 [native-select-control.json](../evidence/026/native-select-control.json)、[keyboard-probe-expanded.txt](../evidence/026/keyboard-probe-expanded.txt)。因此 S14 四条 FAIL 表示本环境未验证，需后续在能操作原生弹出菜单的浏览器核验。没有用 selectOption 替代“只用键盘”的要求。

回归结果与逐条判断：

复制源为 evidence/024/recheck-1/，目标为 evidence/026/regression-024/；原脚本以 original-*.mjs 保存，首次完整结果以 initial-*.json/txt 保存，所有改动有 *.mjs.diff。完整五套脚本各运行一次；只对预期变化或夹具修正场景定向重跑，其余完整结果保留。

| 脚本 | 首次完整结果 | 更新预期后结果 | 判断 |
|---|---:|---:|---|
| 第 1 批 browser-check | 376 PASS / 4 FAIL | 378 PASS / 2 FAIL | 成员入口和截图覆盖预期更新；Q01 两条实际位移失败保留 |
| 第 1 批 p-check | 232 PASS / 3 FAIL | 233 PASS / 2 FAIL | P02 夹具/视口边距修正；P01 两条实际位移失败保留 |
| 第 1 批 p-followup | 55/55 | 55/55 | 原预期通过 |
| 024 主 S01–S19 | 82 PASS / 3 FAIL | 83 PASS / 2 FAIL | S01 暂停占位改真实暂停；S17 两条是上述完整回归未全通过的汇总 |
| 024 补测 R01–R03 | 74/74 | 74/74 | 原预期通过；非编辑/编辑浮层回焦点、收件箱计数、预算去重均正常 |

1. **022 S07**：旧“成员不可用并注明第 3 批”与本批启用成员冲突。更新为成员入口可打开四列；回放仍禁用且注明第 5 批。
2. **022 R05**：状态行增加卡片高度，初始首屏+末屏只能覆盖 9/13 卡；添加中间位置截图后覆盖 13/13。图高 1163px、完整查看最大滚动 996px，仍满足原 ≤1350px 限制；所有几何、端点间距、内容完整性断言保持。
3. **024 S01**：旧检查“暂停提示第 3 批”已失效。改检查项目实际 paused、顶栏项目暂停标记、恢复入口；本批 S13 另外覆盖冻结、恢复及决策。
4. **022 P02**：新增状态行改变节点高度，旧 helper 的 node.hover/click 在读取 anchor 后又滚动，旧 anchor=729.296875 与实际触发位置不同。更新为先 hover 节点、滚到实际菜单触发器再读取 anchor（883.296875）并直接点击；panel.bottom=888，按 viewport−12px 边距限制对齐。保留向上翻、固定浮层、视口内、可访问角色及原 2px 比较阈值；不据原夹具误差认定产品故障。
5. **022 Q01 / P01**：page-scrolled-create 各有 anchor、canvas 两条失败，均 27.1875px；不是新增状态行允许的静态高度变化，而是操作前后应稳定的参照位置变化，**真实回归，未更新阈值**。
6. **024 S17**：两个失败是 022 主/P 完整结果含真实失败的汇总，非另两个产品问题。未删掉检查、未将未全通过称为通过。

第 1 批更新预期后 **666/670**；第 2 批主及补测 **157/159**；合计回归 **823 PASS / 6 FAIL（829 条）**。

对比度及控制台：

| 深色抽查 | 文字样本 / 最低对比度 | 图形样本 / 最低对比度 |
|---|---:|---:|
| 成员看板 | 111 / 7.143:1 | 34 / 5.215:1 |
| 未读顶栏 | 8 / 7.418:1 | 3 / 6.986:1 |
| 暂停顶栏 | 9 / 7.295:1 | 4 / 6.986:1 |
| 时间线 | 116 / 7.143:1 | 24 / 6.370:1 |

基于真实浏览器 computedStyle、透明背景合成与相对亮度计算。抽查均满足文字 ≥4.5:1、图形 ≥3:1；仅代表覆盖样本。024 继承的浅/深色对话、收件箱、决策及第 1 批浮层对比度检查也通过。

主检查、补测及五套回归控制台 **无**：0 error、0 warning、0 pageerror、0 失败请求/HTTP 错误；原生控件对照日志亦无。所有 17 个 MJS（含原始副本）node --check 通过，git diff --check exitCode=0。

脚本定位修正记录：首次将会话底层 inert 检查错放在 #main，已改检查真正的 #session-base 和 #side；S09 首次误用“处理提问”按钮名，改实际事项按钮，并处理关闭项目对话会返回原收件箱的导航；补测 S02 轮次按钮有两个匹配，已限定会话面板。修正后对应场景通过；首次结果/异常截图保留，未将定位错误写成产品缺陷。“关闭会话”实际返回原卡，S16 没有额外要求按钮必须包含字面“返回”。

清理及范围：

静态服务 PID 61926 已 SIGTERM 终止；原生控件对照临时静态服务也在 finally 终止；55626/55627 端口连接均返回 ECONNREFUSED（61）。本次所有浏览器脚本在 finally 关闭 context/browser，工具返回的执行会话均结束；静态服务执行会话 exitCode=143。未删除其他会话的浏览器/缓存。见 [cleanup.json](../evidence/026/cleanup.json)。

保护文件 SHA-256 对比：**5708 个既有文件，修改 0、删除 0**。本任务写入范围只有 evidence/026/ 和 tasks/026-report.md。期间出现的 tasks/029-replay-libraries.md 由其他工作产生，本任务没有创建、修改或删除；scope-check.json 如实列为范围外并发新增。

“git status 只新增本任务证据和报告”无法按全局字面成立：开始时已有原型改动和任务 025 等未跟踪文件，期间又有外部新增任务。前后差异中本任务新增仅 evidence/026/ 和 tasks/026-report.md；保留既有工作，不为满足全局状态删除他人文件。见 [baseline-git-status.txt](../evidence/026/baseline-git-status.txt)、[scope-check.json](../evidence/026/scope-check.json)。

最终 git status --short：

```text
 M prototype/app.js
 M prototype/data.js
 M prototype/index.html
?? evidence/025/
?? evidence/026/
?? tasks/025-last-message.md
?? tasks/025-members-mailbox.md
?? tasks/025-report.md
?? tasks/026-members-browser-check.md
?? tasks/026-report.md
?? tasks/027-card-detail-acceptance.md
?? tasks/029-replay-libraries.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
