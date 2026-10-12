session-id: 01a13213-5247-7ff2-8cba-5ca94e654b54

任务 028 复检 1 已完成，只检查、未改代码。S01–S17：**104 PASS / 0 FAIL**；前三批回归：**1132 PASS / 0 FAIL / 4 项环境限制、未验证**。R01–R04：**56 PASS / 2 FAIL**；成员入口的 R01M 补查：**15 PASS / 0 FAIL**。两条最终失败属于同一处新发现：状态列卡片成功合并或登记后，Esc 虽回到原标题按钮，但按钮落在视口外。因此本次整体仍有问题，未判定全部通过。

环境沿用任务 028：Google Chrome 154.0.8037.99 headless + Playwright，默认 1440×900 浅色；原场景同时覆盖 375×812、760×900 和深色。主服务 `http://127.0.0.1:60379` 仅静态读取 prototype；原生控件对照服务 `http://127.0.0.1:60398` 静态读取本次证据目录；均只绑定 127.0.0.1，未用 8787。页面请求限制在对应本地 origin。Playwright 依赖沿用项目外 `/tmp/helm-006-playwright.cNUInN/`；所有 Chrome profile/缓存在项目外 `/tmp`，实际路径见 [browser-profile-sample.json](../evidence/028/recheck-1/browser-profile-sample.json)。业务操作只经 UI；evaluate 仅读取 DOM、状态和几何、等待绘制或滚动。验证、合并与成员修改仍是前端 Demo。

证据：[S01–S17 脚本](../evidence/028/recheck-1/browser-check.mjs)、[R01–R04 脚本](../evidence/028/recheck-1/supplement.mjs)、[成员入口焦点补查](../evidence/028/recheck-1/focus-members.mjs)、[全部最终断言](../evidence/028/recheck-1/assertions.txt)、[控制台汇总](../evidence/028/recheck-1/console.txt)、[结果总表](../evidence/028/recheck-1/final-results.json)、[完整截图索引](../evidence/028/recheck-1/screenshots.txt)。最终索引含 879 个截图文件，缺失 0 个；初跑与旧预期失败单独保留，不计入最终统计。

**R01–R04**

| 场景 | 结果 | 核对内容与证据 |
|---|---|---|
| R01 | 13 PASS / 2 FAIL | 状态列入口：手动合并通过、重跑失败退回、A 登记、真实鼠标批注打回，操作当下及下一帧均聚焦可见的 acceptance-outcome / annotation-outcome；摘要打回进入文件标签。所有分支 Esc 均关闭详情并回到原逻辑入口；成功合并与登记的入口在视口外，见新问题。[通过后焦点](../evidence/028/recheck-1/R01-手动验收-pass-focus.png)、[失败退回焦点](../evidence/028/recheck-1/R01-手动验收-fail-focus.png)、[批注打回焦点](../evidence/028/recheck-1/R01-批注打回-focus.png)。 |
| R01M | 15 PASS / 0 FAIL | 沿用原 028 的成员入口，重复以上四分支：结果控件可见，Esc 关闭、回到打开它的按钮，返回按钮也在视口内。[合并返回成员入口](../evidence/028/recheck-1/R01M-手动验收-pass-Escape.png)、[打回返回成员入口](../evidence/028/recheck-1/R01M-批注打回-Escape.png)。 |
| R02 | 7 PASS / 0 FAIL | 逐个读取实际状态，核对操作区说明与摘要一致，并分别截图，见下表。额外覆盖 A 登记及批注退回。 |
| R03 | 18 PASS / 0 FAIL | B 实现、B 浏览器检查、A 技术可行性：六标签首屏可见；默认状态行一份文字加编辑按钮，无输入框/保存按钮；点编辑出现输入框，保存后信息带与数据更新；收起移除输入框并回焦点，记录页保留历史入口。 |
| R04 | 18 PASS / 0 FAIL | 三张指定卡顺序均为摘要 → 完整报告及核心改动/负责人说明/改测试/合并结果 → 操作区。四态计数与数据一致，摘要有独立验证结论和非通过/核心改动/负责人改测试重点项。B 浏览器检查与 A 技术可行性待验收摘要直接有验收、打回；B 实现初始已验收，无待验收操作，符合条件。身份、代理及结果预设位于最后，并标演示用。[摘要](../evidence/028/recheck-1/R04-B浏览器检查-顺序-1.png)、[完整报告](../evidence/028/recheck-1/R04-B浏览器检查-顺序-2.png)、[末尾演示操作区](../evidence/028/recheck-1/R04-B浏览器检查-顺序-5.png)。 |

| R02 状态 | 说明要点 | 截图 |
|---|---|---|
| 进行中 | 验证完成不会自动申请，仍由项目负责人申请 | [R02-进行中.png](../evidence/028/recheck-1/R02-进行中.png) |
| 待验收 | 已入收件箱，等待你或设定的自动条件验收 | [R02-待验收.png](../evidence/028/recheck-1/R02-待验收.png) |
| 已验收 | 等待 runtime 合并 | [R02-已验收.png](../evidence/028/recheck-1/R02-已验收.png) |
| 已合并 | 已合并并显示最新产出版本 | [R02-已合并.png](../evidence/028/recheck-1/R02-已合并.png) |
| 合并重跑失败退回 | 已退回进行中，明确基线改变、重跑不通过及重新验证原因 | [R02-合并失败被退回.png](../evidence/028/recheck-1/R02-合并失败被退回.png) |
| 批注退回 | 已退回进行中，说明未解决批注组成的修改请求 | [R02-批注被退回.png](../evidence/028/recheck-1/R02-批注被退回.png) |
| 已登记 | A 显示已登记及最新产出版本 | [R02-已登记.png](../evidence/028/recheck-1/R02-已登记.png) |

| R03 卡片 | 六标签 y / 底部实测（px） | 默认 / 编辑 / 保存截图 |
|---|---|---|
| B实现 | 481.89 / 518.28，均小于 900 | [默认首屏](../evidence/028/recheck-1/R03-B实现-默认首屏.png)、[编辑](../evidence/028/recheck-1/R03-B实现-编辑.png)、[保存](../evidence/028/recheck-1/R03-B实现-保存.png) |
| B浏览器检查 | 429.50 / 465.89，均小于 900 | [默认首屏](../evidence/028/recheck-1/R03-B浏览器检查-默认首屏.png)、[编辑](../evidence/028/recheck-1/R03-B浏览器检查-编辑.png)、[保存](../evidence/028/recheck-1/R03-B浏览器检查-保存.png) |
| A技术可行性 | 429.50 / 465.89，均小于 900 | [默认首屏](../evidence/028/recheck-1/R03-A技术可行性-默认首屏.png)、[编辑](../evidence/028/recheck-1/R03-A技术可行性-编辑.png)、[保存](../evidence/028/recheck-1/R03-A技术可行性-保存.png) |

**S01–S17 完整重跑**

| 场景 | 结果 | 核对内容 | 截图示例 |
|---|---|---|---|
| S01 | 12 PASS / 0 FAIL | 信息带、六标签结构与关联，浅色验收及批注对比度 | [S01 截图](../evidence/028/recheck-1/S01-规格-1.png) |
| S02 | 8 PASS / 0 FAIL | 方向键、Home/End、选中状态及 Esc 返回 | [S02 截图](../evidence/028/recheck-1/S02-ArrowRight.png) |
| S03 | 4 PASS / 0 FAIL | 独立新会话、代理/方法/模型/提交/资料；排除执行日志 | [S03 截图](../evidence/028/recheck-1/S03-新会话-1.png) |
| S04 | 2 PASS / 0 FAIL | 无验证结论与陈旧提交拒绝申请 | [S04 截图](../evidence/028/recheck-1/S04-无结论拒绝.png) |
| S05 | 6 PASS / 0 FAIL | 身份限制、申请待验收、收件箱及说明同步 | [S05 截图](../evidence/028/recheck-1/S05-成员无申请入口.png) |
| S06 | 6 PASS / 0 FAIL | 31/34 → 38/38、历史失败、验证链接、S03 修改及审查实现关系、核心 diff | [S06 截图](../evidence/028/recheck-1/S06-浏览器检查报告-1.png) |
| S07 | 1 PASS / 0 FAIL | A 技术可行性无法验证项单列并附原因 | [S07 截图](../evidence/028/recheck-1/S07-技术可行性-1.png) |
| S08 | 11 PASS / 0 FAIL | 合并成功版本 +1、失败退回、登记；焦点、Esc 与状态说明 | [S08 截图](../evidence/028/recheck-1/S08-pass-before.png) |
| S09 | 8 PASS / 0 FAIL | 真实鼠标单行/连续多行批注、原行锚点、发回、解决与只发未解决项 | [S09 截图](../evidence/028/recheck-1/S09-单行编辑.png) |
| S10 | 6 PASS / 0 FAIL | Tab、方向键扩选、A 编辑、Ctrl+Enter 保存、Enter 发回 | [S10 截图](../evidence/028/recheck-1/S10-键盘编辑.png) |
| S11 | 4 PASS / 0 FAIL | 实现三处 Demo 批注原行、内容及已解决状态 | [S11 截图](../evidence/028/recheck-1/S11-Demo-7.png) |
| S12 | 6 PASS / 0 FAIL | 默认关、五条件、自动验收决策者、条件不足保留收件箱、状态文案 | [S12 截图](../evidence/028/recheck-1/S12-默认关闭.png) |
| S13 | 7 PASS / 0 FAIL | 手动/自动验收、打回、合并与登记的记录和决策者 | [S13 截图](../evidence/028/recheck-1/S13-决策页.png) |
| S14 | 1 PASS / 0 FAIL | 勾选框与文字同一行、距离及大小 | [S14 截图](../evidence/028/recheck-1/S14-筛选勾选框.png) |
| S15 | 7 PASS / 0 FAIL | 读取本次七份回归结果，限制不计失败 | [S15 截图](../evidence/028/recheck-1/S15-回归检查上下文.png) |
| S16 | 7 PASS / 0 FAIL | 375 / 760 无页面横向溢出，窄屏可完成批注 | [S16 截图](../evidence/028/recheck-1/S16-窄屏详情-1.png) |
| S17 | 8 PASS / 0 FAIL | 深色验收、已解决/未解决批注、编辑及自动设置；对比度抽查 | [S17 截图](../evidence/028/recheck-1/S17-深色验收报告-1.png) |

S01 六页分别有分段截图；长报告按原视口滚动截全，所有路径见截图索引。S09 使用真实 page.mouse.click：第 4 行单点，第 12 行单点后按 Shift 点击第 14 行选连续三行，写批注并保存；未调用业务函数或合成 DOM click。坐标及原提交/原文、发送前后数据在 results.json.metrics。

**前三批回归与断言调整**

| 套件 | PASS | FAIL | 环境限制 |
|---|---:|---:|---:|
| 026 | 179 | 0 | 4 |
| 026-R | 124 | 0 | 0 |
| 024 | 85 | 0 | 0 |
| 024-R | 74 | 0 | 0 |
| 022 | 380 | 0 | 0 |
| 022-P | 235 | 0 | 0 |
| 022-followup | 55 | 0 | 0 |

本次从 evidence/028/ 递归复制 23 个 MJS/HTML 文件，来源和 SHA-256 见 [copy-manifest.json](../evidence/028/recheck-1/copy-manifest.json)；既有脚本未改。使用 [run-all.mjs](../evidence/028/recheck-1/run-all.mjs) 完整执行各套件，024 适配副本另完整执行，026 新定位只复跑 S08，随后完整执行其 supplement；初次全套结果都已保留。全部执行退出码为 0，测试是否通过以断言为准。026 supplement 增补 16 条断言，最终 026 合计 179 PASS / 4 LIMIT。

本次调整逐条如下：

1. **026 S04 状态行编辑步骤**：原先直接填写常驻 #status-line-input；返工后输入框按需出现，所以先点击 #status-line-edit。保存、决策记录、依赖图/状态列/成员同步、文本完整及目标/约束保留断言全部保留。
2. **026 S08 状态不明告警定位**：告警从详情直接子元素移到 .card-detail-overview。把 .card-detail > .dispatch-unknown 改为 .card-detail-overview > .dispatch-unknown，保留数量为 1 并补可见性检查。026 主脚本初跑 162 PASS / 1 FAIL / 4 LIMIT 保存在 regression-026/before-overview-adaptation-results.json；截图 S08-unknown-card.png 显示实际突出告警，重跑整个 S08 后通过。
3. **028 S08、S12 截图与滚动定位**：验收入口及结果提示已移到顶部摘要，滚动对象从旧 .acceptance-actions 改为 .acceptance-summary；状态/版本、重跑、退回原因、焦点与 Esc、自动条件断言不变。
4. **基础设施调整**：截图路径改至本次目录，environment.json 换本次端口与会话；原生对照用 environment 的本地 origin，新增控制台和关闭记录。断言不变；差异见 [script-diffs](../evidence/028/recheck-1/script-diffs) 和 native-logging-adjustment.diff。
5. **028 S03 关闭辅助函数校正**：复制的 close() 在 Esc 关闭验证会话后，又因卡片详情仍存在而点击详情关闭按钮，导致检查误报未返回验证链接。记录关闭前是否存在会话，仅在原本没有会话时使用详情关闭回退。初次完整 S01–S17 的 103 PASS / 1 FAIL 保存在 before-close-helper-results.json；完整重跑 S03、依赖相同关闭路径的 S06、及补充回归汇总后的 S15，原来的卡片仍打开、原验证链接获焦点等断言未放宽。
6. **补测初始状态前提校正**：B 实现初始是 accepted，不是 review。R01 打回前改为通过 UI 修改产物 → 独立验证 → 申请验收；R04 对验收/打回入口按真实 review 状态断言。初跑及脚本保存在 initial-r/，差异在 [supplement-adjustments.diff](../evidence/028/recheck-1/supplement-adjustments.diff)。Esc 的“回原元素”与“返回后可见”拆开，后者的真实失败保留。

继续沿用任务 028 已登记的预期变化：024 S08 从收件箱进入待验收卡，焦点为 tab-acceptance（旧预期 detail-close），关闭分支也针对验收标签；本次旧预期完整跑出 84 PASS / 1 FAIL，保存在 regression-026/regression-024/raw-results.json，适配副本完整复跑 85 PASS。026 S11 详情 diff 改为 .annotation-lines，仍核对增删行、基线与来源、diff 抽屉；026 S15 在下层适配结果完成后汇总。未新增业务预期放宽。

四项原生时间线下拉筛选的纯键盘路径仍记为 **环境限制、未验证**，不计失败。新跑的原生对照中，普通下拉 ArrowDown/Enter 后仍为空，列表变为 one；见 [native-select-control.json](../evidence/028/recheck-1/native-select-control.json) 和 [S15-native-select-control.png](../evidence/028/recheck-1/S15-native-select-control.png)。控件通过 selectOption 的功能检查不能代替纯键盘验收。

**新问题**

状态列入口在成功合并/登记后，Esc 返回焦点对象正确，但该卡片已迁入另一列，页面没有把新位置滚入视口。B 窄屏溢出诊断合并后，原标题按钮矩形约 x=1610、y=1973.20；A 技术可行性登记后约 x=1610、y=850.38，均超出 1440×900 的可见范围。对应两条 FAIL 是返回后的可见性，不是 BODY 焦点丢失或 Esc 关闭失败；成员入口四分支全通过。

复现：项目状态列 → 打开 B 窄屏溢出诊断 → 独立验证全部通过 → 项目负责人申请 → 摘要验收 → Esc；A 技术可行性直接摘要验收登记后 Esc。证据：[B 返回后截图](../evidence/028/recheck-1/R01-手动验收-pass-Escape.png)、[A 返回后截图](../evidence/028/recheck-1/R01-手动登记-Escape.png)、r-results.json 的 R01 返回焦点矩形。仅记录，未修改原型。除此之外，本次完成范围未发现其他新增产品问题。

**控制台、清理与范围**

最终主检查、补测、成员补查、七份回归及原生对照日志共 0 条：console error / warning、pageerror、requestfailed、HTTP ≥400 均为 0；无其它控制台消息。各套件 console 文件保留，根目录 console.txt 汇总。初跑补测与旧预期运行也未出现页面控制台异常，脚本定位/状态前提错误另见初跑日志。

全部浏览器由 finally 关闭；检查 runner 与补跑进程均已结束。已停止自启服务 PID 66994 / 67010，60379 / 60398 无监听，无本次 headless Chrome 或 node 检查残留；见 [cleanup.json](../evidence/028/recheck-1/cleanup.json)。依赖与缓存始终在项目外。脚本 node --check：27 个 MJS，失败 0。

范围检查：开始时 12050 个既有文件 SHA-256 全部核对；变更 0、删除 0、许可目录外新增 0。原型、文档、研究、旧证据及其他任务文件没有被本次改写。基线已有 prototype/app.js、prototype/index.html 的修改及 evidence/027、028 等未跟踪文件；git status 不能单独展示已未跟踪 evidence/028 内的新增，故用哈希和允许目录检查补充确认。见 [scope-check.json](../evidence/028/recheck-1/scope-check.json)、[git-status-before.txt](../evidence/028/recheck-1/git-status-before.txt)。

本次结束时 git status 输出：

```text
On branch main
Your branch is ahead of 'origin/main' by 28 commits.
  (use "git push" to publish your local commits)

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   prototype/app.js
	modified:   prototype/index.html

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	evidence/027/
	evidence/028/
	tasks/027-card-detail-acceptance.md
	tasks/027-last-message.md
	tasks/027-report.md
	tasks/027-rework-1-last-message.md
	tasks/027-rework-1-report.md
	tasks/027-rework-1.md
	tasks/028-acceptance-browser-check.md
	tasks/028-last-message.md
	tasks/028-recheck-1-report.md
	tasks/028-recheck-1.md
	tasks/028-report.md
	tasks/029-replay-libraries.md
	tasks/031-orca-fork-survey.md
	tasks/032-orca-fork-launch-check.md

no changes added to commit (use "git add" and/or "git commit -a")
```
