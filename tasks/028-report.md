session-id: 01a131fd-2741-7370-8705-26f0fd790859

# 任务 028：原型 v7 第 4 批浏览器检查

**检查完成，未通过。** 本批 97 PASS / 7 FAIL；7 条失败归为两处产品问题。前 1–3 批回归（按本批预期适配）1132 PASS / 0 FAIL；4 项环境限制、未验证不计失败。仅检查，没有修改原型或旧证据。

环境：Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900、浅色，另查 375×812、760×900、深色。主服务 `http://127.0.0.1:55638`（静态目录 prototype）；原生控件对照 `http://127.0.0.1:55639`（静态目录 evidence/028）。两者只绑定 127.0.0.1，未使用 8787；页面请求按各自 origin 限制，只访问本地静态服务。依赖沿用项目外 `/tmp/helm-006-playwright.cNUInN/`，Chrome profile/缓存在系统临时目录。所有业务操作经 UI，evaluate 只读 DOM、Demo 数据、几何及滚动。

证据：[检查脚本](../evidence/028/browser-check.mjs)、[逐条断言](../evidence/028/assertions.txt)、[结果与几何/对比度/鼠标坐标](../evidence/028/results.json)、[控制台](../evidence/028/console.txt)、[全部本批截图路径](../evidence/028/screenshots.txt)、[环境](../evidence/028/environment.json)。Demo 的验证、测试、合并与成员修改是前端模拟，本次不宣称执行了真实模型或 Git 合并。

## 逐场景结果

长报告按固定视口分段截取；下表给出主要截图，主检查 115 张截图的路径见截图索引；另有 1 张原生控件对照截图，回归截图另随各份结果 JSON 保存。

| 场景 | 断言 | 结论 | 截图 | 看到的问题 |
|---|---|---|---|---|
| S01 | 12 PASS / 0 FAIL | 信息带字段、六标签顺序及 ARIA 关联通过。六页均按原视口滚动截全；浅色验收和批注文字/图形对比度通过。 | [规格-1](../evidence/028/S01-规格-1.png)<br>[依赖-1](../evidence/028/S01-依赖-1.png)<br>[执行-1](../evidence/028/S01-执行-1.png)<br>[验收-2](../evidence/028/S01-验收-2.png)<br>[文件-2](../evidence/028/S01-文件-2.png)<br>[记录-2](../evidence/028/S01-记录-2.png) | 共性状态文案问题见问题 2。 |
| S02 | 8 PASS / 0 FAIL | 左右/上下方向键、首尾循环、Home/End 均切换正确；aria-selected 唯一、tabindex=0、焦点落活动标签；Esc 返回可见原入口。 | [ArrowRight](../evidence/028/S02-ArrowRight.png)<br>[ArrowLeft](../evidence/028/S02-ArrowLeft.png)<br>[Home](../evidence/028/S02-Home.png)<br>[End](../evidence/028/S02-End.png) | 无。 |
| S03 | 4 PASS / 0 FAIL | 创建独立新会话；代理、交叉代码审查方法、是否换模型（否）、提交、一次性副本、资料清单可见。材料不含执行日志；会话链接打开结论并能返回原链接。 | [新会话-2](../evidence/028/S03-新会话-2.png)<br>[验证会话](../evidence/028/S03-验证会话.png) | 无。 |
| S04 | 2 PASS / 0 FAIL | 进行中且无结论的成本报价申请被拒；窄屏溢出诊断的陈旧提交被拒并提示重新验证，状态未被错误推进。 | [无结论拒绝](../evidence/028/S04-无结论拒绝.png)<br>[陈旧提交拒绝-2](../evidence/028/S04-陈旧提交拒绝-2.png) | 无。 |
| S05 | 5 PASS / 1 FAIL | 成员申请按钮禁用；项目负责人验证后仍为进行中，申请成功才转待验收并进入收件箱；点击直接打开验收标签。 | [成员无申请入口](../evidence/028/S05-成员无申请入口.png)<br>[申请通过](../evidence/028/S05-申请通过.png)<br>[收件箱](../evidence/028/S05-收件箱.png)<br>[收件箱打开报告](../evidence/028/S05-收件箱打开报告.png) | 状态转换通过；验收区仍称“本卡仍在进行中”，见问题 2。 |
| S06 | 6 PASS / 0 FAIL | 从收件箱打开 B 浏览器检查：31/34 → 38/38；S10 对比度、S11 窄屏、S03 错误检查要求单列。验证结论及会话可打开；S03 修改前后及理由可见；审查对象实现与反向关系均可见。实现的核心改动入口打开对应 diff，被改过的登记测试单列。 | [浏览器检查报告-2](../evidence/028/S06-浏览器检查报告-2.png)<br>[浏览器检查报告-3](../evidence/028/S06-浏览器检查报告-3.png)<br>[浏览器检查报告-4](../evidence/028/S06-浏览器检查报告-4.png)<br>[验证结论链接](../evidence/028/S06-验证结论链接.png)<br>[核心改动diff](../evidence/028/S06-核心改动diff.png) | 报告正文检查通过；验收区共性文案见问题 2。 |
| S07 | 1 PASS / 0 FAIL | 从 A 收件箱打开技术可行性，“无法验证”在非通过项分组单列，附证据不足原因。 | [技术可行性-2](../evidence/028/S07-技术可行性-2.png)<br>[技术可行性-3](../evidence/028/S07-技术可行性-3.png) | 无法验证的业务项不是本次浏览器检查失败；验收区共性文案见问题 2。 |
| S08 | 6 PASS / 5 FAIL | 基线改变后的合并结果重跑：通过则已合并、产出版本 +1；不通过退回进行中、版本不增加，并要求重新验证。A 手动验收登记、版本 +1。 | [pass-before](../evidence/028/S08-pass-before.png)<br>[pass-after](../evidence/028/S08-pass-after.png)<br>[pass-状态文案](../evidence/028/S08-pass-状态文案.png)<br>[pass-Escape](../evidence/028/S08-pass-Escape.png)<br>[fail-before](../evidence/028/S08-fail-before.png)<br>[fail-after](../evidence/028/S08-fail-after.png)<br>[fail-Escape](../evidence/028/S08-fail-Escape.png)<br>[登记后](../evidence/028/S08-登记后.png) | 焦点丢到 BODY、Esc 无效，见问题 1；合并后文案错误，见问题 2。 |
| S09 | 8 PASS / 0 FAIL | 真实鼠标单行 4 与连续 12–14 行批注通过；气泡钉起始原行，范围标记正确。保存不发信；首次发回一请求一信，回进行中。成员修改后原提交/原文/批注保留；解决单行后第二次只发未解决多行。 | [单行编辑](../evidence/028/S09-单行编辑.png)<br>[鼠标多行选中](../evidence/028/S09-鼠标多行选中.png)<br>[多行编辑](../evidence/028/S09-多行编辑.png)<br>[原行4批注](../evidence/028/S09-原行4批注.png)<br>[原行12批注](../evidence/028/S09-原行12批注.png)<br>[首次发回](../evidence/028/S09-首次发回.png)<br>[单行已解决](../evidence/028/S09-单行已解决.png)<br>[第二次发回未解决项](../evidence/028/S09-第二次发回未解决项.png) | 无。 |
| S10 | 6 PASS / 0 FAIL | 从文件标签起只用键盘：Tab 到行 5；Home、方向键、Shift 扩选 2–3；A 输入；Ctrl+Enter 保存；Tab/Enter 发回。批注入库、回进行中，发回焦点仍在可见控件。 | [键盘编辑](../evidence/028/S10-键盘编辑.png)<br>[键盘发回](../evidence/028/S10-键盘发回.png) | 无。 |
| S11 | 4 PASS / 0 FAIL | 实现 Demo 3 处：7、9–10、11 行；逐条对照固定文字、原文、原提交、sentCount=1、resolved=true 与 DOM 气泡，均一致。 | [Demo-7](../evidence/028/S11-Demo-7.png)<br>[Demo-9](../evidence/028/S11-Demo-9.png)<br>[Demo-11](../evidence/028/S11-Demo-11.png) | 无。 |
| S12 | 5 PASS / 1 FAIL | 默认关闭；五条件勾选保存。诊断卡全部通过后申请即自动验收与合并，决策者 runtime 自动；实现因核心改动和负责人改测试两条不满足而进入收件箱，报告逐条提示。 | [默认关闭](../evidence/028/S12-默认关闭.png)<br>[启用五条件](../evidence/028/S12-启用五条件.png)<br>[自动合并状态文案](../evidence/028/S12-自动合并状态文案.png)<br>[自动验收合并](../evidence/028/S12-自动验收合并.png)<br>[未满足条件](../evidence/028/S12-未满足条件.png)<br>[未满足进入收件箱](../evidence/028/S12-未满足进入收件箱.png) | 自动行为通过；合并后文案仍称进行中，见问题 2。 |
| S13 | 7 PASS / 0 FAIL | 手动验收/打回为你，自动验收为 runtime 自动，合并/登记/合并失败退回为 runtime。DOM 决策页及各分支保存的数据均核对。 | [决策页](../evidence/028/S13-决策页.png)<br>[自动决策者](../evidence/028/S13-自动决策者.png) | 无。 |
| S14 | 1 PASS / 0 FAIL | 勾选框 16px；文字同一行、间距 ≤10px、中心差 ≤3px；勾选前后均截图。 | [筛选勾选框](../evidence/028/S14-筛选勾选框.png)<br>[勾选后](../evidence/028/S14-勾选后.png) | 无。 |
| S15 | 7 PASS / 0 FAIL | 复制前 3 批脚本运行；7 份结果 1132 PASS / 0 FAIL；4 项原生下拉键盘环境限制、未验证，不计失败。两处结构变化及一处汇总传播差异逐条解释并用适配副本复测。 | [回归检查上下文](../evidence/028/S15-回归检查上下文.png)<br>[native-select-control](../evidence/028/S15-native-select-control.png) | 无新增回归问题；预期变化详见下文。 |
| S16 | 7 PASS / 0 FAIL | 375×812：详情、验收报告、diff、批注编辑和气泡页面/面板均无横向滚动；真实鼠标完成保存及发回。补查 760px 报告同样通过。 | [窄屏详情-1](../evidence/028/S16-窄屏详情-1.png)<br>[窄屏报告-2](../evidence/028/S16-窄屏报告-2.png)<br>[窄屏报告-3](../evidence/028/S16-窄屏报告-3.png)<br>[窄屏diff](../evidence/028/S16-窄屏diff.png)<br>[窄屏编辑](../evidence/028/S16-窄屏编辑.png)<br>[窄屏保存](../evidence/028/S16-窄屏保存.png)<br>[窄屏发回](../evidence/028/S16-窄屏发回.png)<br>[760报告](../evidence/028/S16-760报告.png) | 稳定布局下无重叠、截断或溢出；入场动画测量误差已排除。共性状态文案见问题 2。 |
| S17 | 8 PASS / 0 FAIL | 深色验收报告、已解决/待核对批注、编辑框、自动条件设置均截图；文字 ≥4.5:1、抽查图形 ≥3:1；浅色自动设置补测通过。 | [深色验收报告-2](../evidence/028/S17-深色验收报告-2.png)<br>[深色已解决批注](../evidence/028/S17-深色已解决批注.png)<br>[深色未解决批注](../evidence/028/S17-深色未解决批注.png)<br>[深色批注编辑](../evidence/028/S17-深色批注编辑.png)<br>[深色自动设置](../evidence/028/S17-深色自动设置.png) | 对比度、布局无新增问题；验收区共性文案见问题 2。 |

## 产品问题（未修复）

1. **手动验收后焦点丢失，Esc 无法关闭详情。** 复现：打开 B 窄屏溢出诊断 → 全通过独立验证 → 项目负责人申请 → 模拟基线变更（分别重跑通过/不通过）→ 点击“验收 · runtime 合并或登记”。两条分支都使该按钮禁用；实际 activeElement 为 BODY，随后按 Esc，详情仍打开。共 4 条 FAIL。状态/版本/重跑结果均正确，问题在键盘收尾。截图：[通过后](../evidence/028/S08-pass-after.png)、[通过后 Esc](../evidence/028/S08-pass-Escape.png)、[失败退回后](../evidence/028/S08-fail-after.png)、[失败后 Esc](../evidence/028/S08-fail-Escape.png)。检查测量失败后点击显式关闭按钮恢复流程；没有把恢复动作当成 Esc 通过。

2. **验收说明没有随状态更新。** 验收区首段固定写“本卡仍在进行中，验证完成不会自动申请验收。”实际卡片已待验收或已合并，信息带/底层看板与该段矛盾。S05 待验收、S08 手动合并、S12 自动合并各 1 条 FAIL。截图：[待验收仍称进行中](../evidence/028/S05-申请通过.png)、[手动合并后](../evidence/028/S08-pass-状态文案.png)、[自动合并后](../evidence/028/S12-自动合并状态文案.png)。初始已验收/待验收 Demo 报告也有此共性文案；业务状态与收件箱数据本身同步。

除上述两项外，本次已检查画面未见重叠、内容截断、稳定布局横向溢出、批注丢失或对比度不足。

## 真实鼠标与键盘批注

S09 使用 `page.mouse.click`，先滚到实际可见行，读取 boundingBox 后在行内点击（不是调用业务函数或派发合成 DOM click）。第 4 行点击后写单行批注；第 12 行点击，按住 Shift，再点击第 14 行，松开 Shift，写连续三行批注。`results.json.metrics.mouse` 保留真实视口坐标。保存后，气泡父行号分别为 4 和 12，多行范围 12–14 都有批注标记，原提交与原文保存。首次发回只新增一个修改请求和一封信；模拟成员修改后单行核对解决，再次发回只含多行批注 ID。

S10 的准备动作是打开“文件”标签；从聚焦 diff 行开始，选择、输入、保存、发回全部用 page.keyboard。实际 Tab 到第 5 行，Home 到首行，方向键到第 2 行，Shift+方向键扩选第 3 行，A 打开编辑框，Ctrl+Enter 保存，Tab 到发回按钮后 Enter。S16 在 375px 同样完成实际鼠标批注和发回。

## 前 1–3 批回归及逐条判断

来源为 `evidence/026/recheck-1/`，执行副本位于 [regression-026](../evidence/028/regression-026/)。复制的 browser-check、supplement、rework-check 和递归的 regression-024 / regression-022 都已运行；来源 SHA-256 见 [复制清单](../evidence/028/regression-copy-manifest.json)，副本调整见 [差异清单](../evidence/028/regression-script-changes.json)。先保留原预期运行结果，再运行只改相关预期的适配副本；原型未修改。

| 原预期差异 | 观察与判断 | 新覆盖/复测 |
|---|---|---|
| 024 S08：review-a-tech 应聚焦 detail-close | 本批收件箱入口直接切到验收页，实际焦点 tab-acceptance。是任务要求的预期变化，非焦点丢失。原始 84 PASS / 1 FAIL 保存在 regression-024/raw-results.json。 | 适配目标及关闭分支为 tab-acceptance；S08 全部复测通过。028 S05 另断言验收标签选中。 |
| 026 S11：详情内 .preview-diff 应有增删行 | 文件页改为可批注的 .annotation-lines，增删行仍用 preview-diff-add/delete；抽屉仍保留 .preview-diff。旧断言查到 0，属于 DOM 结构变化。 | 适配只改详情增删行容器到 .annotation-lines，保留文件/基线/真实出处与 diff 抽屉断言；S11 全部通过。028 S06/S09/S11 检查核心 diff、原行和批注内容。 |
| 026 S15：下层 024 结果必须全通过 | 该失败只传播第一条旧焦点预期；不是另一处产品失败。原始 S11/S15 失败保存在 regression-026/raw-results.json。 | 在 024 适配完成后原样重跑 S15，5 个下层汇总均通过。028 S15 再核对全部 7 份结果。 |

其余原预期无需修改。复制脚本的截图索引改写到 028、environment.json 换本次端口，是执行基础设施调整，不是放宽断言。026 supplement 的原生控件 JSON 与截图已由本次真实对照重新生成，未沿用旧结论冒充新执行。

| 执行结果文件 | PASS | FAIL | 环境限制 |
|---|---:|---:|---:|
| [regression-026/regression-024/r-results.json](../evidence/028/regression-026/regression-024/r-results.json) | 74 | 0 | 0 |
| [regression-026/regression-024/regression-022/p-followup-results.json](../evidence/028/regression-026/regression-024/regression-022/p-followup-results.json) | 55 | 0 | 0 |
| [regression-026/regression-024/regression-022/p-results.json](../evidence/028/regression-026/regression-024/regression-022/p-results.json) | 235 | 0 | 0 |
| [regression-026/regression-024/regression-022/results.json](../evidence/028/regression-026/regression-024/regression-022/results.json) | 380 | 0 | 0 |
| [regression-026/regression-024/results.json](../evidence/028/regression-026/regression-024/results.json) | 85 | 0 | 0 |
| [regression-026/results.json](../evidence/028/regression-026/results.json) | 179 | 0 | 4 |
| [regression-026/rework-results.json](../evidence/028/regression-026/rework-results.json) | 124 | 0 | 0 |

原生下拉框键盘：026 S14 的 member/card/group/type 四个筛选使用真实 Tab、ArrowDown、Enter 后值仍为空。独立原生对照同样操作，下拉框不改变，size=3 列表框改变为 one；见 [本次对照](../evidence/028/native-select-control.json)、[截图](../evidence/028/S15-native-select-control.png)。四项记“环境限制、未验证”，不计失败；不能据此宣称时间线原生下拉键盘筛选已验证。本批自定义标签和批注键盘路径均实际通过。

## 对比度、控制台与检查校正

从浏览器 computed style 读取前景色、背景和透明叠加，按 WCAG 相对亮度计算。正文、次要文字、标签、四态、批注气泡/已解决/待核对、选中行和编辑框抽查文字；有语义的控件边框/状态标记抽查图形，不把普通卡片装饰边框计为信息图形。关闭 details 的隐藏正文和禁用控件不纳入。此处是抽查，不声称量化了所有原生控件内部像素。

| 区域 | 文字样本 / 最低比值 | 图形样本 / 最低比值 |
|---|---:|---:|
| 浅色验收 | 101 / 5.572:1 | 27 / 3.959:1 |
| 浅色批注 | 115 / 5.572:1 | 28 / 3.959:1 |
| 深色验收报告 | 130 / 7.295:1 | 29 / 5.704:1 |
| 深色批注含已解决和编辑 | 117 / 7.143:1 | 31 / 5.704:1 |
| 深色自动设置 | 15 / 13.831:1 | 1 / 6.370:1 |
| 浅色自动设置 | 15 / 16.884:1 | 1 / 4.611:1 |

本批及回归控制台汇总：**0 console error、0 pageerror、0 requestfailed、0 HTTP ≥400；无其它控制台消息。** 各份控制台文件和 [console-summary.json](../evidence/028/console-summary.json) 均已核对。

初轮的脚本/测量校正保存在 [initial-results.json](../evidence/028/initial-results.json) 和执行日志：S04 最初选待开工卡，状态守卫先拒绝，改为进行中的 A 成本报价；项目设置入口实际在项目页按钮，修正侧栏定位；窄屏入场动画期间控件暂时右移约 25px，稳定 220ms 后复测，页面/面板 scrollWidth 始终分别为 375/375 和 760/760；批注编辑框 Esc 首次只取消编辑，之后用显式关闭按钮收尾。初次留下的 exception 截图作为排查证据保留，不计最终场景截图数。手动验收后的真实焦点问题另有失败断言保留，未归入脚本校正。

## 清理与写入边界

所有本次浏览器 context/browser 已由脚本 finally 关闭；主检查、回归 runner、各回归脚本和原生对照均执行结束。已终止自己启动的静态服务 PID 65384 / 65865；lsof 确认 55638 / 55639 无监听。见 [cleanup.json](../evidence/028/cleanup.json)。缓存和依赖在项目外，没有写入项目 node_modules。

保护范围的 **7387 个既有文件 SHA-256 前后无变化**，见 [scope-check.json](../evidence/028/scope-check.json)。本次只新增 evidence/028/ 和 tasks/028-report.md。开始时已有 prototype 两处改动、evidence/027 及其它未跟踪任务文件，因此全局 git status 不能只显示 028；没有删除或改动他人的工作。

本次状态增量：

```text
?? evidence/028/
?? tasks/028-report.md
```

最终 `git status --short` 原样输出（[开始状态](../evidence/028/git-status-before.txt)、[结束状态](../evidence/028/git-status-after.txt)、[增量](../evidence/028/git-status-delta.json)）：

```text
 M prototype/app.js
 M prototype/index.html
?? evidence/027/
?? evidence/028/
?? tasks/027-card-detail-acceptance.md
?? tasks/027-last-message.md
?? tasks/027-report.md
?? tasks/028-acceptance-browser-check.md
?? tasks/028-report.md
?? tasks/029-replay-libraries.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```
