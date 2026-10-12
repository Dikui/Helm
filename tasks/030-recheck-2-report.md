session-id: 01a13261-3d6a-7fc0-a5bd-4bc85445bbae

复检已完成，**Q01、Q02 均通过；完整重跑仍有 R07 两条失败**，均为375外层页面向下滚动后时间轴离开窗口。上一轮的目录选步后理由不可见、375页面顶部时间轴在窗口外，均已消除。未修改产品代码。

本次浏览器实际检查 **586 PASS / 2 FAIL**；另有S14的 **11 PASS历史证据查阅**。合并断言 **597 PASS / 2 FAIL**，不把复检1前四批的1310条结果重复计入本次重跑。最终[assertions.txt](../evidence/030/recheck-2/assertions.txt)、[console.txt](../evidence/030/recheck-2/console.txt)、[汇总与失败详情](../evidence/030/recheck-2/final-results.json)。

**环境与脚本**

2026-10-13，本机Chrome 154.0.8037.99 headless + Playwright；默认1440×900浅色，另测1024×900、375×812及原脚本要求的深色。静态服务 `http://127.0.0.1:57534`，仅绑定127.0.0.1，未使用8787。页面路由只允许该本地origin。Playwright模块在项目外/tmp，浏览器非持久化profile/缓存在系统临时目录 `/var/folders/zm/3n6r9htn6cz5h86nxgz0cnj80000gn/T`，未安装项目依赖。

复制复检1的browser-check.mjs、recheck.mjs及两份辅助probe到本次目录；执行[本批S脚本](../evidence/030/recheck-2/browser-check.mjs)、[R脚本](../evidence/030/recheck-2/recheck.mjs)和新增[Q脚本](../evidence/030/recheck-2/q-check.mjs)。三个入口均退出0，业务结论以断言为准；辅助probe未执行，相关行为已由S/R覆盖。原件哈希和复制说明见[copy-manifest.json](../evidence/030/recheck-2/copy-manifest.json)，差异见[copy-diffs](../evidence/030/recheck-2/copy-diffs)。仅作如下副本适配：输出链接改为本次目录；目录定位改为返工后的独立`.replay-directory-panel`；S14改为只读查阅复检1的回归证据并明确标记未重跑。未降低R07的原可见性要求，未修改原脚本与原证据。5份JS脚本全部`node --check`通过，见[syntax-check.json](../evidence/030/recheck-2/syntax-check.json)。

**Q01：三种宽度依次从目录选第1、8、15步**

**63 PASS / 0 FAIL**。项目B每个宽度按1→8→15顺序实际点击目录项；每次选择前故意把说明滚到底部，点击后不补做滚动或焦点操作。正文自动归顶；标题、完整组织理由在视口内，且不被任何滚动祖先裁切；图卡集合分别为3/6/10张，累计状态和当前变化标记均对应所选事件。焦点保留在所选原目录按钮，`aria-current="step"`，按钮在目录可视区内。

下表为窗口y坐标“标题 / 组织理由”，单位px；九份截图均已查看。

| 视口 | 结论与第1/8/15步坐标 | 截图 |
|---|---|---|
| 1440×900 | PASS；1：354.67–399.45 / 424.45–469.23；8：354.67–399.45 / 424.45–491.62；15：354.67–377.06 / 402.06–446.84 | [第1步](../evidence/030/recheck-2/Q01-1440-第1步.png)、[第8步](../evidence/030/recheck-2/Q01-1440-第8步.png)、[第15步](../evidence/030/recheck-2/Q01-1440-第15步.png) |
| 1024×900 | PASS；1：202.84–225.23 / 250.23–272.62；8：202.84–225.23 / 250.23–272.62；15：202.84–225.23 / 250.23–272.62 | [第1步](../evidence/030/recheck-2/Q01-1024-第1步.png)、[第8步](../evidence/030/recheck-2/Q01-1024-第8步.png)、[第15步](../evidence/030/recheck-2/Q01-1024-第15步.png) |
| 375×812 | PASS；1：454.97–499.75 / 522.75–567.53；8：454.97–499.75 / 522.75–589.92；15：454.97–477.36 / 500.36–567.53 | [第1步](../evidence/030/recheck-2/Q01-375-第1步.png)、[第8步](../evidence/030/recheck-2/Q01-375-第8步.png)、[第15步](../evidence/030/recheck-2/Q01-375-第15步.png) |

另核对独立状态区`role=status`、`aria-live=polite`、`aria-atomic=true`及随选步同步的步号/标题/组织理由。此项验证DOM属性和文本，未声称实际读屏播报已经验证。几何、焦点、图状态和状态文本保存在[q-results.json](../evidence/030/recheck-2/q-results.json)。

**Q02：375×812顶部首屏及连续拖动**

**61 PASS / 0 FAIL**。A、B从页面顶部打开回放，也从普通看板文档底部切换：切换前scrollY分别为981、935，切换后实际`document.scrollingElement`及main均归顶。无需测试脚本再滚动，时间轴y=**378.58–410.58px**，当前标题及完整组织理由在812px首屏内；目录默认收起。

B连续拖动第1→8→4→15→1步，A第1→4→2→7→1步；每次mouse down→24次mouse move→mouse up，8次均到目标步，192个移动采样中原range保持连接并与当前DOM是同一元素。时间轴始终在首屏，事件标题/理由及图状态对应目标步。

截图：[B顶部打开](../evidence/030/recheck-2/Q02-375-b-页面顶部-打开.png)、[B从底部切换](../evidence/030/recheck-2/Q02-375-b-普通看板滚到底部-打开.png)、[B向前到8](../evidence/030/recheck-2/Q02-375-b-向前-第8步.png)、[B向后到4](../evidence/030/recheck-2/Q02-375-b-向后-第4步.png)、[B到右端15](../evidence/030/recheck-2/Q02-375-b-右端-第15步.png)、[B到左端1](../evidence/030/recheck-2/Q02-375-b-左端-第1步.png)；[A顶部打开](../evidence/030/recheck-2/Q02-375-a-页面顶部-打开.png)、[A从底部切换](../evidence/030/recheck-2/Q02-375-a-普通看板滚到底部-打开.png)、[A右端7](../evidence/030/recheck-2/Q02-375-a-右端-第7步.png)。Q02共12份截图，均已查看，其余在同目录。

**S01–S16重跑结果**

主脚本 **234 PASS / 0 FAIL**，其中223条为本次浏览器断言，11条为S14历史证据查阅。S14实际重新打开当前页面并保存[S14截图](../evidence/030/recheck-2/S14-全批回归上下文.png)，只读检查复检1的12个运行记录及10份汇总结果；没有启动前四批回归，也没有把旧结果称为本次重新执行。见[results.json](../evidence/030/recheck-2/results.json)、[运行日志](../evidence/030/recheck-2/browser-check-run.log)。

| 编号 | 结果 | 覆盖 |
|---|---|---|
| S01 | 30 PASS / 0 FAIL | B全15步、前后步、鼠标与键盘、播放/暂停和末步重播 |
| S02 | 13 PASS / 0 FAIL | 非颜色变化标记、组织理由、推断说明 |
| S03 | 8 PASS / 0 FAIL | 8个提交经只读git show核对 |
| S04 | 14 PASS / 0 FAIL | A全7步，示例标注 |
| S05 | 24 PASS / 0 FAIL | 各上下文入口、依据对象及Esc焦点 |
| S06 | 20 PASS / 0 FAIL | 结论、依据跳转、采纳/忽略和费用 |
| S07 | 1 PASS / 0 FAIL | 非预设问题说明、记录及零费用 |
| S08 | 9 PASS / 0 FAIL | 三类31项、编辑/启停/审核、角色与决策 |
| S09 | 9 PASS / 0 FAIL | 执行者与模型、能力及限制说明 |
| S10 | 8 PASS / 0 FAIL | 工具/经验、项目设置保存及决策 |
| S11 | 15 PASS / 0 FAIL | 14个侧栏入口与全站占位检查 |
| S12 | 30 PASS / 0 FAIL | A六行、B十一行演示逐项打开 |
| S13 | 6 PASS / 0 FAIL | A/B验收迁列后的Esc焦点 |
| S14 | 11 PASS / 0 FAIL（历史证据查阅） | 当前页面重新打开并截图；11条只查阅复检1回归证据，前四批未重跑 |
| S15 | 8 PASS / 0 FAIL | 375页面溢出与时间轴操作 |
| S16 | 28 PASS / 0 FAIL | 浅/深回放、问一下、打法库及执行者对比度 |

**R01–R08重跑结果**

**239 PASS / 2 FAIL**。见[r-results.json](../evidence/030/recheck-2/r-results.json)、[运行日志](../evidence/030/recheck-2/recheck-run.log)。

| 编号 | 结果 | 覆盖 |
|---|---|---|
| R01 | 30 PASS / 0 FAIL | B在1440/375各4次、A两端连续拖动；图状态及原滑块身份 |
| R02 | 6 PASS / 0 FAIL | 1440/375暂停后Esc回成员原入口，焦点可见 |
| R03 | 14 PASS / 0 FAIL | 浅/深验收按钮及同类按钮正常/hover对比度 |
| R04 | 4 PASS / 0 FAIL | 375真实收件箱短标题、上下排列及无横向溢出 |
| R05 | 2 PASS / 0 FAIL | t2修正记录和t3历史修正链 |
| R06 | 145 PASS / 0 FAIL | A/B×三宽×浅深全部132回放帧、普通图及详情小图文字几何 |
| R07 | 31 PASS / 2 FAIL | 目录选步、图内三处滚动与页面顶部通过；375外层中间/底部失败 |
| R08 | 7 PASS / 0 FAIL | 5/12/14项分组、默认展开、六角色首屏和键盘编辑/启停 |

**新问题**

F01：**375外层页面向下滚动时，时间轴未保持在窗口内**。沿用复检1已有的R07外层页面扩展检查：B打开回放，选第15步，再让实际文档滚动到中间/底部。文档最大滚动899px，main自身无滚动范围。

| 位置 | document scrollY | 时间轴窗口y | 结果与截图 |
|---|---:|---|---|
| 顶部 | 0 | 378.58–410.58 | PASS；[顶部](../evidence/030/recheck-2/R07-375-页面顶部.png) |
| 中间 | 450 | −71.42–−39.42 | FAIL；[中间](../evidence/030/recheck-2/R07-375-页面滚动中.png) |
| 底部 | 899 | −520.42–−488.42 | FAIL；[底部](../evidence/030/recheck-2/R07-375-页面底部.png) |

这两条断言是同一问题的两个滚动位置。返工将窄屏回放提前后，首屏满足Q02；但外层向下滚动时控制器随页面离开视口，中间截图仍有事件标题/理由而时间轴已在上方，底部标题/理由也离开窗口。1440/1024外层三位置和三宽图内顶部/中间/底部检查均通过；因此问题记录为**外层页面滚动可见性**，不归因于图内滚动或目录切换，也不否定Q02页面顶部首屏的通过结果。其他场景未发现新增失败。本次仅记录，未改代码。

**控制台、清理与文件范围**

三份实际运行结果合计：**0条console、0条pageerror、0条requestfailed、0条HTTP≥400**；Q脚本未拦截到外部请求。服务访问日志见[server.log](../evidence/030/recheck-2/server.log)，不计为前端控制台。最终[console.txt](../evidence/030/recheck-2/console.txt)为“无”。

三个browser/context均已在finally关闭；本次静态服务PID 74498已关闭，端口57534连接被拒绝，进程检查无残留headless Chrome。缓存只在项目外系统临时目录，未清除原有共享Playwright模块或其他用户缓存。见[cleanup.json](../evidence/030/recheck-2/cleanup.json)。

范围核对12617个既有文件：无修改、无删除；新增仅`evidence/030/recheck-2/`和本报告，见[scope-check.json](../evidence/030/recheck-2/scope-check.json)。已有prototype五文件修改及029/030未跟踪文件均是本轮开始前的状态，本轮未更改其内容。

`git status --short`输出如下；完整`git status`另存[git-status-full.txt](../evidence/030/recheck-2/git-status-full.txt)，开始状态见[git-status-before.txt](../evidence/030/recheck-2/git-status-before.txt)。

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
?? tasks/029-rework-2-last-message.md
?? tasks/029-rework-2-report.md
?? tasks/029-rework-2.md
?? tasks/030-last-message.md
?? tasks/030-recheck-1-last-message.md
?? tasks/030-recheck-1-report.md
?? tasks/030-recheck-1.md
?? tasks/030-recheck-2-report.md
?? tasks/030-recheck-2.md
?? tasks/030-replay-browser-check.md
?? tasks/030-report.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
