session-id: 01a13251-b940-7153-b642-a879cdadab71

复检已完成，**整体未通过：R07 有可见性问题**。S01–S16 **234 PASS / 0 FAIL**；前四批 **1310 PASS / 0 FAIL / 4 项环境限制、未验证**；R01–R08 **237 PASS / 4 FAIL**。合并为 **1781 PASS / 4 FAIL / 4 LIMIT**。4条失败是事件目录切换在三种宽度的重复复现，加上一条窄屏外层滚动扩展检查；不是4个独立问题。未改代码。

最终 [断言](../evidence/030/recheck-1/assertions.txt)、[控制台](../evidence/030/recheck-1/console.txt)、[汇总及失败详情](../evidence/030/recheck-1/final-results.json)；本批 [results.json](../evidence/030/recheck-1/results.json)，补查 [r-results.json](../evidence/030/recheck-1/r-results.json)。初跑脚本错误保存在 initial-r，不混入最终统计。

**环境与方法**

2026-10-13，本机 Google Chrome 154.0.8037.99 headless + Playwright。默认1440×900、浅色；另测375×812、1024×900及深色。原型静态服务 `http://127.0.0.1:54451`，原生控件对照 `http://127.0.0.1:54452`，均绑定本地，未用8787。网络路由只允许各脚本对应本地服务。Playwright模块和浏览器临时缓存位于项目外 `/tmp`，没有安装项目依赖。

递归复制 evidence/030 中61个检查/辅助脚本与HTML，原件不动。[复制清单及原件SHA-256](../evidence/030/recheck-1/copy-manifest.json)、[路径差异](../evidence/030/recheck-1/copy-diffs)。执行030主检查和前四批12个入口，未运行旧目录的报告生成/管理脚本。主检查先执行S01–S13、S15–S16，待下层回归完成后执行S14；覆盖全部16个场景，未用旧结果代替重跑。所有60个JS检查脚本 `node --check` 通过，见 [syntax-check.json](../evidence/030/recheck-1/syntax-check.json)。

**R01–R08 对应八项返工**

| 编号 | 结论及实测 | 截图 |
|---|---|---|
| R01 | **PASS，30条**。B在1440/375各4次连续拖动：0→7向前、7→3向后、3→14右端、14→0左端（端点分成两次，覆盖要求的三类动作）。每次mouse down→24次move→mouse up，均到目标；240个移动采样中原滑块始终isConnected且与当前DOM是同一元素；图集合与累计状态一致。另测A两端。 | [1440向前](../evidence/030/recheck-1/R01-1440-向前.png)、[向后](../evidence/030/recheck-1/R01-1440-向后.png)、[右端](../evidence/030/recheck-1/R01-1440-到右端.png)、[左端](../evidence/030/recheck-1/R01-1440-到左端.png)；[375向前](../evidence/030/recheck-1/R01-375-向前.png)、[向后](../evidence/030/recheck-1/R01-375-向后.png)、[右端](../evidence/030/recheck-1/R01-375-到右端.png)、[左端](../evidence/030/recheck-1/R01-375-到左端.png) |
| R02 | **PASS，6条**。1440/375成员视图从诊断会话的“卡片详情”进入，暂停后Esc回相同data-focus-key的原成员按钮，详情关闭、焦点可见、暂停清单未展开。 | [1440](../evidence/030/recheck-1/R02-1440-暂停后Esc.png)、[375](../evidence/030/recheck-1/R02-375-暂停后Esc.png) |
| R03 | **PASS，14条**。当前v7同类“验收 · runtime 合并或登记”14px文字：深色正常/hover **10.839:1**，浅色 **8.037:1**；新建卡primary和新打法“通过”均≥4.5:1。旧“判为通过”已不属于当前v7，未把历史2.16:1日志算成当前computedStyle。 | [深色验收](../evidence/030/recheck-1/R03-dark-通过按钮.png)、[深色同类通过](../evidence/030/recheck-1/R03-dark-新打法审核.png)、[浅色](../evidence/030/recheck-1/R03-light-通过按钮.png) |
| R04 | **PASS，4条**。375真实8个收件箱标题均最多两行；短标题“技术可行性”“浏览器检查”、当前“市场调研”事项均1行。标题宽283px，说明在下方，页面无横向溢出。旧“竞品与市场规模调研”已更名，未声称浏览器里有该旧标题，也未注入替代数据。 | [R04-375-短标题.png](../evidence/030/recheck-1/R04-375-短标题.png) |
| R05 | **PASS，2条**。浏览器检查t2展开后可见method及“修正：t2只检查method；t3检查…修正链”。当前纠正的是检查对象。关联技术可行性t3另显示失败→通过→具体修正，标明复用34fb658历史原型示例，没有冒充新增真实执行记录。 | [t2修正](../evidence/030/recheck-1/R05-t2-修正记录.png)、[t3历史链](../evidence/030/recheck-1/R05-t3-历史修正链.png) |
| R06 | **PASS，145条**。A/B ×1440/1024/375×浅/深，覆盖132个全回放帧、12份普通图及1份详情依赖小图；累计926张渲染卡、6059个text。逐个读取getBBox及getBoundingClientRect，全部文字在卡框内，测试标签两侧≥12px；没有把SVG title的不可见说明当正文。完整几何在r-results的metrics。 | [B第11步](../evidence/030/recheck-1/R06-light-1440-b-回放11.png)、[B末步](../evidence/030/recheck-1/R06-light-1440-b-回放15.png)、[375深色普通图](../evidence/030/recheck-1/R06-dark-375-b-普通图.png)、[详情小图](../evidence/030/recheck-1/R06-详情依赖小图.png) |
| R07 | **部分通过，29 PASS / 4 FAIL**。图内顶部/中间/底部三处，1440/1024/375的时间轴、事件标题和组织理由均保持可见，图对应第15步且滑块身份不变；前提是将说明区滚回开头。实际从事件目录选步后正文仍停在目录底部，组织理由不可见，三宽均失败。另查375外层页面滚到顶部，时间轴在窗口外，见问题说明。 | 1440：[顶部](../evidence/030/recheck-1/R07-1440-图内-顶部.png)、[中间](../evidence/030/recheck-1/R07-1440-图内-滚动中.png)、[底部](../evidence/030/recheck-1/R07-1440-图内-底部.png)；375：[顶部](../evidence/030/recheck-1/R07-375-图内-顶部.png)、[中间](../evidence/030/recheck-1/R07-375-图内-滚动中.png)、[底部](../evidence/030/recheck-1/R07-375-图内-底部.png)；[目录后正文不可见](../evidence/030/recheck-1/R07-1440-目录切换说明.png)、[375外层顶部](../evidence/030/recheck-1/R07-375-页面顶部.png) |
| R08 | **PASS，7条**。三类5/12/14项；默认open=true/false/false。六角色章节表在1440首屏、分组前。模板和workflow可Tab/Enter展开；workflow编辑保存、启停后仍展开；第一组可折叠。S08另完整重跑审核和决策。 | [默认及角色表](../evidence/030/recheck-1/R08-默认分组与角色表.png)、[模板](../evidence/030/recheck-1/R08-展开第2组.png)、[workflow](../evidence/030/recheck-1/R08-展开第3组.png)、[折叠](../evidence/030/recheck-1/R08-折叠第一组.png) |

**S01–S16完整重跑**

| 编号 | 结果 | 代表证据 |
|---|---|---|
| S01 | 30 PASS；B 全15步状态、拖动、前后步、自动播放/停止、末步重播和键盘通过。 | [S01-B-中间.png](../evidence/030/recheck-1/S01-B-中间.png) |
| S02 | 13 PASS；新增/变化/拆卡非颜色标记、提交和组织理由、推断标注。 | [S02-事件-11.png](../evidence/030/recheck-1/S02-事件-11.png) |
| S03 | 8 PASS；8个完整提交号、作者时间和说明均经只读 git show 核对。 | [git-show.json](../evidence/030/recheck-1/git-show.json)、[S03-提交-1.png](../evidence/030/recheck-1/S03-提交-1.png) |
| S04 | 14 PASS；A 全7步可回放，明确示例，无伪造提交号。 | [S04-A-事件-7.png](../evidence/030/recheck-1/S04-A-事件-7.png) |
| S05 | 24 PASS；项目、看板、详情、收件箱、时间线和具体消息的入口、对象上下文、Esc返回及 inert。 | [S05-卡片-对象.png](../evidence/030/recheck-1/S05-卡片-对象.png) |
| S06 | 20 PASS；三类结论、全部依据跳转、采纳/忽略、决策、顶栏答疑费用。 | [S06-采纳决策.png](../evidence/030/recheck-1/S06-采纳决策.png) |
| S07 | 1 PASS；非预设问题说明明确，记录保留且费用为零。 | [S07-非预设问题.png](../evidence/030/recheck-1/S07-非预设问题.png) |
| S08 | 9 PASS；5/12/14三类31项，启停、编辑保存、审核入库、六角色表和决策。 | [S08-角色与章节.png](../evidence/030/recheck-1/S08-角色与章节.png) |
| S09 | 9 PASS；执行者/模型分离、Codex能力五行、不能使用/提醒/即将支持。 | [S09-Codex能力.png](../evidence/030/recheck-1/S09-Codex能力.png) |
| S10 | 8 PASS；工具/经验字段、三项项目设置保存和决策。 | [S10-设置决策.png](../evidence/030/recheck-1/S10-设置决策.png) |
| S11 | 15 PASS；14个侧栏入口实际可达，全站无分批占位。 | [page-inventory.json](../evidence/030/recheck-1/page-inventory.json)、[S11-页面-01.png](../evidence/030/recheck-1/S11-页面-01.png) |
| S12 | 30 PASS；项目A六行、B十一行逐条打开并截图。 | [demo-inventory.json](../evidence/030/recheck-1/demo-inventory.json)、[S12-B11-回放图.png](../evidence/030/recheck-1/S12-B11-回放图.png) |
| S13 | 6 PASS；A/B状态列验收迁列后Esc回原卡且在视口内。 | [S13-b-Esc焦点.png](../evidence/030/recheck-1/S13-b-Esc焦点.png) |
| S14 | 11 PASS；前四批12个运行入口完成，10份最终结果1310 PASS/0 FAIL/4 LIMIT。 | [S14-全批回归上下文.png](../evidence/030/recheck-1/S14-全批回归上下文.png)、[regression-028/run-results.json](../evidence/030/recheck-1/regression-028/run-results.json) |
| S15 | 8 PASS；375回放、问一下、打法库、代理库、执行者无页面横向溢出；鼠标拖动和End可操作。 | [S15-375时间轴中间.png](../evidence/030/recheck-1/S15-375时间轴中间.png) |
| S16 | 28 PASS；浅/深回放与非颜色标记、问一下、打法库、执行者的文字和图形对比度均满足阈值。 | [S16-dark-回放变化标记.png](../evidence/030/recheck-1/S16-dark-回放变化标记.png)、[S16-dark-执行者.png](../evidence/030/recheck-1/S16-dark-执行者.png) |

**前四批回归**

| 套件 | PASS | FAIL | 环境限制、未验证 |
|---|---:|---:|---:|
| 028 | 104 | 0 | 0 |
| 028-R | 58 | 0 | 0 |
| 028-M | 15 | 0 | 0 |
| 026 | 179 | 0 | 4 |
| 026-R | 124 | 0 | 0 |
| 024 | 85 | 0 | 0 |
| 024-R | 74 | 0 | 0 |
| 022 | 381 | 0 | 0 |
| 022-P | 235 | 0 | 0 |
| 022-followup | 55 | 0 | 0 |

12个运行入口均退出0，业务结果以上述断言为准。运行顺序及耗时见 [regression-028/run-results.json](../evidence/030/recheck-1/regression-028/run-results.json)、[regression-run.log](../evidence/030/recheck-1/regression-run.log)。前四批原生select对照本次重新运行：普通下拉ArrowDown/Enter后仍空值，列表控件为one；时间线member/card/group/type四项仅键盘切换记为 **环境限制、未验证**。selectOption过滤行为独立通过；range鼠标和Home/End/方向键实测通过，未把原生下拉限制推广到range。见 [regression-028/native-select-control.json](../evidence/030/recheck-1/regression-028/native-select-control.json)。

**本次脚本与断言调整，逐条说明**

1. 所有输出路径改为本复检目录，environment改为本次两个本地端口。旧脚本/旧证据不动。
2. S01/S02/S03/S12/S15/S16：回放说明现有“来源说明”和“事件目录”两个details，原 `.replay-controls summary` 不唯一。改为定位包含 `.replay-directory` 的details，且仅关闭时展开。原拖动、步数、事件、图集合与状态要求未变。
3. S08：分类标题h2改成details分组summary；计数依据改为 `.playbook-group[data-playbook-kind]`，仍要求5/12/14共31项。默认折叠不判为缺失，实际展开和操作由R08覆盖；S16计算当前可见文字，不把已按要求折叠内容当首屏可见。
4. 030主场景截图超时从默认6.5秒增至30秒，与原前四批副本一致；不改业务阈值。
5. 新R脚本初跑A拖动后的frame误用默认project-b，造成两条错误失败；改为读当前项目验证。R03初跑误要求诊断卡未独立验证时就有验收按钮；改为先验证、申请后检查实际按钮及对比度，没有绕过流程。
6. 新R05关联t3初跑按“失败”全文定位多个祖先details，并误要求note含连续“历史原型示例”；最终按明确t3证据ID，分别核对“失败”“通过”“修正：”“历史原型”可见原文。t2修正正文检查始终保留。
7. R07拆开两个真实状态：选择目录后的正文可见性保留三条FAIL；将说明滚回开头后，再独立验证图内三种滚动位置。初跑把目录底部位置直接作为图内滚动前置，9条重复失败归因到目录问题，未抹去该问题。375外层滚动由无滚动范围的#main改为实际document.scrollingElement，新增严格失败如实保留。

主脚本差异见 [recheck-adaptations.diff](../evidence/030/recheck-1/recheck-adaptations.diff)；补查定位纠正见 [r-harness-corrections.diff](../evidence/030/recheck-1/r-harness-corrections.diff)、[r-harness-corrections-2.diff](../evidence/030/recheck-1/r-harness-corrections-2.diff)、[r-harness-corrections-final.diff](../evidence/030/recheck-1/r-harness-corrections-final.diff)。初跑断言及截图在 [initial-r](../evidence/030/recheck-1/initial-r)。本次没有新增前四批业务预期变更，继承030已审计的副本，逐项为：022 S07已开放回放；022 S16/024 S12,S13,S18及028 S12,S13,S17重名项目入口按侧栏定位；024-R R03排除“答疑预算”的项目预算计数；026-R R02仅清单关闭时展开；024 S17/026 S15/028 S15按真实下层结果汇总。上述检查全部重新执行，成员原入口焦点由R02另作严格断言。

**新问题**

F01：**选事件目录后，当前事件正文没有随选步回到可读位置（R07）**。B回放展开目录，点击第15步“v6功能规格成稿”：时间轴、当前标题及图已更新，但说明区仍保留目录底部scrollTop。1440为633px、1024为801px、375为1029px；组织理由的窗口top分别为−164.38/−424.20/−674.66px，被说明区裁掉。用户必须再向上滚说明区才能读当前理由。三个宽度各一条FAIL；截图 [R07-1440-目录切换说明.png](../evidence/030/recheck-1/R07-1440-目录切换说明.png)、[R07-1024-目录切换说明.png](../evidence/030/recheck-1/R07-1024-目录切换说明.png)、[R07-375-目录切换说明.png](../evidence/030/recheck-1/R07-375-目录切换说明.png)。手动滚回说明顶部后，图内滚动能保留时间轴、标题和理由，说明固定分区修复已生效；未将目录导致的正文不可见称为图内滚动失效。

F02：**375外层页面顶部的时间轴不在窗口内（扩展观察，R07一条FAIL）**。此宽度#main自身无滚动范围，实际滚动发生在文档。文档顶部scrollY=0时，导航、项目头部和筛选在回放工作区之前，range位于y=1033–1065px，超出812px窗口。中间和底部可见；在回放图内部滚动三处也均通过。这一条是对“保持可见”的更广外层检查，**不代表已经进入回放工作区后滑块不能操作**，也不与S15无横向溢出矛盾。截图 [R07-375-页面顶部.png](../evidence/030/recheck-1/R07-375-页面顶部.png)、[R07-375-页面滚动中.png](../evidence/030/recheck-1/R07-375-页面滚动中.png)、[R07-375-页面底部.png](../evidence/030/recheck-1/R07-375-页面底部.png)。

R01–R06、R08及五批业务回归未发现其他新失败。旧深色失败日志、31/34和t2/t3历史说明仍按历史证据展示，没有把它们当作当前产品失败。

**控制台、清理与范围**

最终13份控制台来源合计 **0条 console、0条 pageerror、0条 requestfailed、0条HTTP≥400**；原生select对照也是0。详情见 [console.txt](../evidence/030/recheck-1/console.txt) 和 [final-results.json](../evidence/030/recheck-1/final-results.json) 的console来源表。服务HTTP访问日志位于 [server.log](../evidence/030/recheck-1/server.log)，不作为前端控制台错误计数。

所有本次浏览器context/browser已关闭，各脚本finally正常完成；两个静态服务共用进程72711已关闭，两个端口连接检查均拒绝，无残留本次headless Chrome。缓存仅用项目外/tmp，不删除原先已有Playwright缓存。见 [cleanup.json](../evidence/030/recheck-1/cleanup.json)。

范围哈希核对11124个既有文件：无修改、无删除；新增仅本复检证据和本报告，见 [scope-check.json](../evidence/030/recheck-1/scope-check.json)。工作区原来就有prototype五文件修改和029/030相关未跟踪文件，本次未改变其内容，不能将已有状态说成本次只新增两行。

`git status --short` 输出如下（另存 [git-status.txt](../evidence/030/recheck-1/git-status.txt)；完整 `git status` 见 [git-status-full.txt](../evidence/030/recheck-1/git-status-full.txt)）：

```text
 M prototype/app.js
 M prototype/artifacts.js
 M prototype/board.js
 M prototype/data.js
 M prototype/index.html
?? evidence/029/
?? evidence/030/
?? tasks/029-last-message.md
?? tasks/029-replay-libraries.md
?? tasks/029-report.md
?? tasks/029-rework-1-last-message.md
?? tasks/029-rework-1-report.md
?? tasks/029-rework-1.md
?? tasks/030-last-message.md
?? tasks/030-recheck-1.md
?? tasks/030-replay-browser-check.md
?? tasks/030-report.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
