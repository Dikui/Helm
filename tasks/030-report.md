session-id: 01a13231-d93b-75d0-bae2-5f1bf3781d54

# 任务 030：第 5 批浏览器检查与五批整体回归

检查完成，**整体未通过**。主要问题是回放时间轴连续拖动失效；另发现暂停卡片后 Esc 焦点没有返回原入口。全程只检查，没有修改原型或受保护文件。

总计 **1545 PASS / 6 FAIL / 4 项环境限制、未验证**；重复复现同一问题会产生多条 FAIL，不代表同样多的独立问题。全部断言见 [assertions.txt](../evidence/030/assertions.txt)，结果与几何数据见 [final-results.json](../evidence/030/final-results.json)。030 主场景、控件对照、补查和前四批复制回归已汇总，初跑/旧预期未混入最终统计。

环境：Google Chrome 154.0.8037.99 headless + Playwright；默认 1440×900 浅色，另查 375×812 和深色。主静态服务 `http://127.0.0.1:65155` 只读 prototype；原生控件对照服务 `http://127.0.0.1:65158` 只读本次证据目录，未使用 8787。每个 context 拦截请求，只允许相应本地 origin；未接执行者、模型、外部服务。Playwright 依赖沿用 `/tmp/helm-006-playwright.cNUInN/`，Chrome profile/缓存在项目外 `/tmp`，实测进程路径见 [browser-profile-sample.txt](../evidence/030/browser-profile-sample.txt)。操作只经 UI；evaluate 仅读 DOM、状态、样式、几何或滚动，不调用业务函数。

脚本：[browser-check.mjs](../evidence/030/browser-check.mjs)、[run-regression.mjs](../evidence/030/run-regression.mjs)、[range-probe.mjs](../evidence/030/range-probe.mjs)、[pause-probe.mjs](../evidence/030/pause-probe.mjs)。本报告第一行使用当前 `CODEX_SESSION_ID`，与 `CODEX_THREAD_ID` 一致。

## 场景结论与截图

| 场景 | 结论 | 截图路径 |
|---|---|---|
| S01 | **FAIL**。B 15 步的累计卡片集合及历史状态通过；前进、后退、播放实际推进、停止、末步重启、Home/方向键通过。连续拖动无法到目标，见 F01。开头/中间/结尾成功定位截图中，中间和结尾使用目录补定位，未将它算为拖动成功。 | [S01-B-开头.png](../evidence/030/S01-B-开头.png)、[S01-B-中间.png](../evidence/030/S01-B-中间.png)、[S01-B-结尾事件.png](../evidence/030/S01-B-结尾事件.png)、[S01-B-结尾图.png](../evidence/030/S01-B-结尾图.png)、[S01-B-暂停.png](../evidence/030/S01-B-暂停.png) |
| S02 | PASS。第 1/2/11/13 步核对＋新增、△刚变化、↳拆出子卡的实际文字、无障碍名称和虚线父子关系；当前事件显示完整提交、原说明、组织理由和推断标记。 | [S02-标记-1.png](../evidence/030/S02-标记-1.png)、[S02-标记-2.png](../evidence/030/S02-标记-2.png)、[S02-标记-11.png](../evidence/030/S02-标记-11.png)、[S02-事件-13.png](../evidence/030/S02-事件-13.png) |
| S03 | PASS。抽查第 1、2、4、6、8、11、14、15 步，运行只读 `git show -s --format=%H%x09%aI%x09%s <hash>`，完整哈希、作者时间和提交说明逐项一致；共 8 个不同提交。 | [S03-提交-1.png](../evidence/030/S03-提交-1.png)、[S03-提交-2.png](../evidence/030/S03-提交-2.png)、[S03-提交-4.png](../evidence/030/S03-提交-4.png)、[S03-提交-6.png](../evidence/030/S03-提交-6.png)、[S03-提交-8.png](../evidence/030/S03-提交-8.png)、[S03-提交-11.png](../evidence/030/S03-提交-11.png)、[S03-提交-14.png](../evidence/030/S03-提交-14.png)、[S03-提交-15.png](../evidence/030/S03-提交-15.png) |
| S04 | PASS。A 7 步均可回放、累计集合与状态正确，全部标示例，没有伪造提交号。 | [S04-A-事件-1.png](../evidence/030/S04-A-事件-1.png)、[S04-A-事件-4.png](../evidence/030/S04-A-事件-4.png)、[S04-A-事件-7.png](../evidence/030/S04-A-事件-7.png) |
| S05 | PASS。项目、看板、卡片详情、全局收件箱、时间线五处入口带正确对象；另查具体消息入口。背景 inert；Esc 关闭并返回各自入口。 | [S05-项目-对象.png](../evidence/030/S05-项目-对象.png)、[S05-看板-对象.png](../evidence/030/S05-看板-对象.png)、[S05-卡片-对象.png](../evidence/030/S05-卡片-对象.png)、[S05-收件箱-对象.png](../evidence/030/S05-收件箱-对象.png)、[S05-消息时间线-对象.png](../evidence/030/S05-消息时间线-对象.png)、[S05-具体消息-对象.png](../evidence/030/S05-具体消息-对象.png) |
| S06 | PASS。真实问题生成三类结论；全部 8 个依据实际点开：4 次日志高亮（31/33/10/33 行）、2 个尝试、2 个步骤。日志关闭回到答疑，尝试/步骤展开并滚动聚焦。提问/草稿不改卡；采纳后实现退回、旧验证失效、交接和上下文增加、决策者为你；顶栏答疑花费 ¥0.18。刷新另查忽略，不退回、不写采纳决策。 | [S06-回答-1.png](../evidence/030/S06-回答-1.png)、[S06-依据-0-0-日志31.png](../evidence/030/S06-依据-0-0-日志31.png)、[S06-依据-0-1-日志33.png](../evidence/030/S06-依据-0-1-日志33.png)、[S06-依据-0-2-日志10.png](../evidence/030/S06-依据-0-2-日志10.png)、[S06-依据-0-3-attempt-b-browser-1.png](../evidence/030/S06-依据-0-3-attempt-b-browser-1.png)、[S06-依据-0-4-workflow-browser-1-verify.png](../evidence/030/S06-依据-0-4-workflow-browser-1-verify.png)、[S06-采纳决策.png](../evidence/030/S06-采纳决策.png)、[S06-顶栏答疑费用.png](../evidence/030/S06-顶栏答疑费用.png)、[S06-忽略.png](../evidence/030/S06-忽略.png) |
| S07 | PASS。非预设问题显示“示例 · 原型只回答预设问题”，保留历史，费用零；无运行时报错。 | [S07-非预设问题.png](../evidence/030/S07-非预设问题.png) |
| S08 | PASS。5 组组合、12 个模板、14 个 workflow 模式，共 31 项；实际切换启停、编辑保存、通过待审核打法后增至 32 项；A 可独立切换，编辑/启停/审核均写决策，六角色章节表可见。 | [S08-启停.png](../evidence/030/S08-启停.png)、[S08-编辑保存.png](../evidence/030/S08-编辑保存.png)、[S08-审核通过.png](../evidence/030/S08-审核通过.png)、[S08-角色与章节.png](../evidence/030/S08-角色与章节.png)、[S08-打法决策.png](../evidence/030/S08-打法决策.png) |
| S09 | PASS。执行者与主模型是独立控件，改变模型保持 Codex CLI；三个待支持执行者选项禁用。0.160.1 的 I1/I2 部分测过待测、I4 已确认、I9 凭据及禁止动作未测待测，和规格一致；不能使用/只算提醒/三项即将支持均可见。 | [S09-执行者与模型选择.png](../evidence/030/S09-执行者与模型选择.png)、[S09-Codex能力.png](../evidence/030/S09-Codex能力.png)、[S09-即将支持.png](../evidence/030/S09-即将支持.png) |
| S10 | PASS。工具用途/权限/版本/依赖/绑定代理与验证方法字段齐全；经验库有搜索、标签、待审核。项目设置含代理/执行者/打法/预算/自动验收；预设指派规则、运行资源模板、禁止动作清单各实际编辑保存一处，三项均有决策。 | [S10-工具库.png](../evidence/030/S10-工具库.png)、[S10-经验搜索.png](../evidence/030/S10-经验搜索.png)、[S10-经验标签筛选.png](../evidence/030/S10-经验标签筛选.png)、[S10-预设指派规则-保存.png](../evidence/030/S10-预设指派规则-保存.png)、[S10-运行资源模板-保存.png](../evidence/030/S10-运行资源模板-保存.png)、[S10-禁止动作清单-保存.png](../evidence/030/S10-禁止动作清单-保存.png)、[S10-设置决策.png](../evidence/030/S10-设置决策.png) |
| S11 | PASS。14 个侧栏页面入口逐一到达；浏览器页面文本与全部五个原型源码文件未发现“第 N 批提供/实现/启用/开放”占位。页面清单见下文及 page-inventory.json。 | [S11-页面-01.png](../evidence/030/S11-页面-01.png)、[S11-页面-07.png](../evidence/030/S11-页面-07.png)、[S11-页面-14.png](../evidence/030/S11-页面-14.png) |
| S12 | PASS。029 对照表 A 6 行、B 11 行逐条打开，均有独立截图；真实记录与示例标注分清，见完整对照表。 | [S12-A05-workflow-2.png](../evidence/030/S12-A05-workflow-2.png)、[S12-B02-S03审查关系.png](../evidence/030/S12-B02-S03审查关系.png)、[S12-B11-回放图.png](../evidence/030/S12-B11-回放图.png) |
| S13 | PASS。B 窄屏溢出诊断：状态列→全部通过独立验证→申请→验收→Esc；A 技术可行性：状态列→登记→Esc。均回原卡标题按钮，目标在页面及全部滚动祖先的可见交集内。B 标题实测 x=1328、y=877.20，A x=1342、y=877.77；目标接近右下边缘，见整体观感。 | [S13-b-验收后.png](../evidence/030/S13-b-验收后.png)、[S13-b-Esc焦点.png](../evidence/030/S13-b-Esc焦点.png)、[S13-a-Esc焦点.png](../evidence/030/S13-a-Esc焦点.png) |
| S14 | 复制的前四批回归经预期适配后 **1310 PASS / 0 FAIL / 4 项环境限制、未验证**。原样差异及判断全部保存。额外真实 UI 补查发现 **1 FAIL**：成员视图暂停卡片后 Esc 返回同卡的另一入口，见 F02；所以本场景整体有问题。 | [S14-全批回归上下文.png](../evidence/030/S14-全批回归上下文.png)、[S14-pause-Esc-focus.png](../evidence/030/S14-pause-Esc-focus.png)、[S14-pause-first-click.png](../evidence/030/S14-pause-first-click.png)、[S14-pause-second-click.png](../evidence/030/S14-pause-second-click.png) |
| S15 | **FAIL（时间轴连续拖动）**。375×812 的回放、问一下、打法库、代理库、执行者页均无页面横向溢出，控件不越出视口；图内/能力表内滚动不算页面溢出。时间轴 End 和事件目录可操作，连续拖动失败，见 F01。 | [S15-375时间轴中间.png](../evidence/030/S15-375时间轴中间.png)、[S15-375时间轴结尾.png](../evidence/030/S15-375时间轴结尾.png)、[S15-375问一下-1.png](../evidence/030/S15-375问一下-1.png)、[S15-375打法库.png](../evidence/030/S15-375打法库.png)、[S15-375代理执行者模型选择.png](../evidence/030/S15-375代理执行者模型选择.png)、[S15-375执行者能力表.png](../evidence/030/S15-375执行者能力表.png) |
| S16 | PASS。浅深两色抽查回放控件、历史图的新增/变化/拆卡标记、答疑三类结论、打法库和执行者状态；用实际 computedStyle、SVG fill/stroke、合成背景计算，文字 ≥4.5:1，语义图形 ≥3:1。 | [S16-dark-回放变化标记.png](../evidence/030/S16-dark-回放变化标记.png)、[S16-dark-回放新增标记.png](../evidence/030/S16-dark-回放新增标记.png)、[S16-dark-回放拆卡标记.png](../evidence/030/S16-dark-回放拆卡标记.png)、[S16-dark-问一下-1.png](../evidence/030/S16-dark-问一下-1.png)、[S16-dark-问一下-2.png](../evidence/030/S16-dark-问一下-2.png)、[S16-dark-打法库.png](../evidence/030/S16-dark-打法库.png)、[S16-dark-执行者.png](../evidence/030/S16-dark-执行者.png) |

全部截图索引：[screenshots.txt](../evidence/030/screenshots.txt)；索引共 1066 个文件，缺失 0 个。16 个场景都有截图与断言，见 [evidence-check.json](../evidence/030/evidence-check.json)。长面板按实际视口分段滚动截图。

## 看到的问题

**F01：回放滑块连续拖动只改变一次，达不到拖动目标（S01、S15）。** 1440px 从第 1 步拖向第 8 步，实际第 2 步；从第 8 步拖向末步，实际第 9 步；从末步拖回开头，实际第 13 步。375px 从第 1 步拖向第 8 步也停在第 2 步。B 使用 24 次 move 的独立复现，从 value=0 拖到末端仍只有 value=1。相同 Chrome、相同动作下，无重绘的原生 range 对照到 value=14；原型 End 和点击轨道也可到 14，因此**不是 headless 原生键盘环境限制**。源码显示每次 oninput 都 seekReplay→render、替换整个 range，和“第一次移动后拖动失去目标”一致，这是基于源码与浏览器现象的归因推断。本次没有修复。

[S01-range-native-continuous-drag.png](../evidence/030/S01-range-native-continuous-drag.png)、[S01-range-prototype-continuous-drag.png](../evidence/030/S01-range-prototype-continuous-drag.png)、[S01-range-prototype-track-click.png](../evidence/030/S01-range-prototype-track-click.png)；数据：[range-probe.json](../evidence/030/range-probe.json)。

**F02：成员视图暂停卡片后 Esc 回到同卡的另一入口（S14 补查）。** 从 B 成员视图「窄屏溢出诊断」的「卡片详情」进入，点「暂停卡片」后 Esc，原成员卡详情按钮仍存在；实际焦点却落在顶栏暂停清单中的「窄屏溢出诊断」链接，清单随焦点揭示而展开。没有回到原逻辑入口。旧 026-R R02 因默认认为清单关闭，再点一次把它收起，innerText 变为空。本次只适配清单内容检查的展开前提，没有把返回入口问题算为通过；额外一条严格焦点断言保留 FAIL。

[S14-pause-Esc-focus.png](../evidence/030/S14-pause-Esc-focus.png)、[S14-pause-first-click.png](../evidence/030/S14-pause-first-click.png)、[S14-pause-second-click.png](../evidence/030/S14-pause-second-click.png)；DOM、原入口存在性和焦点：[pause-probe.json](../evidence/030/pause-probe.json)。

原型已标明的限制也实际可见：001/002 外层真实会话 ID 是「未记录」，不能核对不存在的历史记录；019/020 的真实会话 ID 可见。答疑回答、费用、采纳动作、库统计和设置保存都是页面内存 Demo，刷新重置。A 可行后交付新范围是独立后续情景，当前汇总仍待开工；执行者页是能力状态展示，没有进行真实能力测试。

## 第 11 节 Demo 对照

| 项目 | 029 对照条目 | 浏览器实际位置与截图 |
|---|---|---|
| A | 访谈 | 项目对话，两轮 Q1/Q2、推荐答案及第二轮验收标准；[S12-A01-访谈第一轮.png](../evidence/030/S12-A01-访谈第一轮.png)、[S12-A01-访谈第二轮.png](../evidence/030/S12-A01-访谈第二轮.png) |
| A | 提议与组织理由 | 已确认五卡提议及四维→汇总依赖图；[S12-A02-五卡提议.png](../evidence/030/S12-A02-五卡提议.png)、[S12-A02-四维依赖图.png](../evidence/030/S12-A02-四维依赖图.png) |
| A | 指派 | 市场调研执行及记录，预设规则、runtime 直接拉起；[S12-A03-runtime指派.png](../evidence/030/S12-A03-runtime指派.png)、[S12-A03-指派记录-1.png](../evidence/030/S12-A03-指派记录-1.png)、[S12-A03-指派记录-2.png](../evidence/030/S12-A03-指派记录-2.png)、[S12-A03-指派记录-3.png](../evidence/030/S12-A03-指派记录-3.png) |
| A | 按轮投递消息 | 时间线，按 0→1→2→3 轮实际推进，人天消息及投递状态；[S12-A04-消息轮0.png](../evidence/030/S12-A04-消息轮0.png)、[S12-A04-消息轮1.png](../evidence/030/S12-A04-消息轮1.png)、[S12-A04-消息轮2.png](../evidence/030/S12-A04-消息轮2.png)、[S12-A04-消息轮3.png](../evidence/030/S12-A04-消息轮3.png) |
| A | 卡内 workflow | 市场调研执行，三支并行、无法验证单列、单次模型汇总未处理；[S12-A05-workflow-1.png](../evidence/030/S12-A05-workflow-1.png)、[S12-A05-workflow-2.png](../evidence/030/S12-A05-workflow-2.png)、[S12-A05-workflow-3.png](../evidence/030/S12-A05-workflow-3.png)、[S12-A05-workflow-4.png](../evidence/030/S12-A05-workflow-4.png) |
| A | 授权说明 | 项目记忆授权、项目对话交付新范围提议、收件箱待批准；[S12-A06-授权说明.png](../evidence/030/S12-A06-授权说明.png)、[S12-A06-可行情景新范围.png](../evidence/030/S12-A06-可行情景新范围.png)、[S12-A06-收件箱待批准.png](../evidence/030/S12-A06-收件箱待批准.png) |
| B | 产出版本与上游影响 | 规格依赖页颜色 v1/v2、实现依赖页上游已变及不受影响；[S12-B01-产出版本.png](../evidence/030/S12-B01-产出版本.png)、[S12-B01-上游影响-1.png](../evidence/030/S12-B01-上游影响-1.png)、[S12-B01-上游影响-2.png](../evidence/030/S12-B01-上游影响-2.png)、[S12-B01-上游影响-3.png](../evidence/030/S12-B01-上游影响-3.png) |
| B | 合并前审查与两次尝试/S03 | 浏览器检查执行两次尝试及验收 S03 前后、合并前审查关系；[S12-B02-尝试1.png](../evidence/030/S12-B02-尝试1.png)、[S12-B02-尝试2.png](../evidence/030/S12-B02-尝试2.png)、[S12-B02-S03审查关系.png](../evidence/030/S12-B02-S03审查关系.png) |
| B | 避开冲突 | 决策 seed-serial，index.html 同文件冲突、后一张等前一张合并；[S12-B03-错开开工.png](../evidence/030/S12-B03-错开开工.png) |
| B | Codex 沙箱发现与补测子卡 | 沙箱设计记录/依赖→补测执行；019 会话；[S12-B04-发现-1.png](../evidence/030/S12-B04-发现-1.png)、[S12-B04-发现-2.png](../evidence/030/S12-B04-发现-2.png)、[S12-B04-父子卡.png](../evidence/030/S12-B04-父子卡.png)、[S12-B04-019会话.png](../evidence/030/S12-B04-019会话.png) |
| B | v6 协作设计拆子卡与结论回流 | 父卡记录/依赖、子卡执行；020 会话和结论回流；[S12-B05-父卡回流-1.png](../evidence/030/S12-B05-父卡回流-1.png)、[S12-B05-父卡回流-2.png](../evidence/030/S12-B05-父卡回流-2.png)、[S12-B05-拆子卡.png](../evidence/030/S12-B05-拆子卡.png)、[S12-B05-020会话.png](../evidence/030/S12-B05-020会话.png) |
| B | ADE 单卡调研写入记忆 | ADE 无父卡/依赖；项目记忆 workflow-templates.md 出处；[S12-B06-ADE单卡.png](../evidence/030/S12-B06-ADE单卡.png)、[S12-B06-项目记忆.png](../evidence/030/S12-B06-项目记忆.png) |
| B | 缺陷常驻分组 | 缺陷筛选，仅诊断→修复→回归三张示例；[S12-B07-缺陷三卡.png](../evidence/030/S12-B07-缺陷三卡.png) |
| B | 逐行批注 | 实现文件，第 2 次三条已解决批注、一次发回历史；[S12-B08-example-annotation-1.png](../evidence/030/S12-B08-example-annotation-1.png)、[S12-B08-example-annotation-2.png](../evidence/030/S12-B08-example-annotation-2.png)、[S12-B08-example-annotation-3.png](../evidence/030/S12-B08-example-annotation-3.png)、[S12-B08-一次发回历史.png](../evidence/030/S12-B08-一次发回历史.png) |
| B | 问一下 Demo | 31/34 问题、真实依据、示例退回草稿；[S12-B09-问一下-1.png](../evidence/030/S12-B09-问一下-1.png)、[S12-B09-问一下-2.png](../evidence/030/S12-B09-问一下-2.png)、[S12-B09-问一下-3.png](../evidence/030/S12-B09-问一下-3.png) |
| B | 执行者能力测试 | 执行者 Codex CLI 0.160.1 状态表，未测标待测；[S12-B10-执行者能力.png](../evidence/030/S12-B10-执行者能力.png) |
| B | 真实提交历史回放 | B 15 步回放事件及历史图；[S12-B11-回放事件.png](../evidence/030/S12-B11-回放事件.png)、[S12-B11-回放图.png](../evidence/030/S12-B11-回放图.png) |

A 6 行、B 11 行均有至少一张截图；详细清单与断言见 [demo-inventory.json](../evidence/030/demo-inventory.json)。

## 全部可到达页面

侧栏 14 个入口：全局收件箱、项目 A、项目 B、全部项目、消息时间线、团队、打法库、代理库、执行者、工具库、经验库、项目记忆、项目设置、决策记录。项目页还有项目记忆/设置/消息时间线/团队按钮；全部项目有新建项目表单。项目 A/B 分别有依赖图、状态列、成员、回放四视图。卡片可进入规格、依赖、执行、验收、文件、记录六标签；项目对话、成员会话/信箱、问一下及其历史、只读产出物预览均由页面按钮打开。新建项目、成员会话和各类产出预览的交互由复制的前三批回归实际覆盖。

页面文本、入口与 view 对照：[page-inventory.json](../evidence/030/page-inventory.json)。

## 前四批回归结果与逐条判断

递归复制 `evidence/028/recheck-1/` 的 29 个检查/辅助脚本与 HTML 到 `evidence/030/regression-028/`。只改本次副本：路径、本次服务环境、预期及必要的定位。未执行会写旧报告/旧目录的 setup、write-report 等管理脚本。来源 SHA-256：[copy-manifest.json](../evidence/030/copy-manifest.json)；路径差异：[script-diffs](../evidence/030/script-diffs)；预期适配差异：[expectation-diffs](../evidence/030/expectation-diffs)。

| 套件 | 最终 PASS | FAIL | 环境限制、未验证 |
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

原样结果 **1265 PASS / 27 FAIL / 4 LIMIT**，保存于 [regression-raw](../evidence/030/regression-raw)、[raw-regression-summary.json](../evidence/030/raw-regression-summary.json)。没有称原样全通过。预期差异逐条判断：


| 原样失败 | 判断、适配和最终覆盖 |
|---|---|
| 022 S07（1 条） | 本批回放已开放，旧脚本要求禁用并写“第 5 批”。改成启用、无占位，并实际打开时间轴；S01–S04 覆盖真实行为。 |
| 022 S16；024 S12/S13/S18（4 条） | 本批新增项目页“项目记忆”按钮，与侧栏重名，旧全局按钮定位 strict mode 失配。副本按侧栏定位，原编辑、保存、决策、窄屏等断言保留。 |
| 028 S12、S13 场景异常、S17（3 条） | 同理，“项目设置”增加项目页入口导致旧全局定位不唯一；按侧栏定位后自动验收、决策、深色设置完整重跑。 |
| 028 S13 runtime 自动决策（1 条） | 前置 S12 被重名定位中断，未产生自动验收决策，依赖检查连带失败。修正定位后实际产生决策并通过，未删断言。 |
| 024-R R03，A/B ×1440/1024/760/375（8 条） | 原“预算 ¥”正则把新增“答疑预算 ¥”也算入，计数从 1 到 2。改成 `(?<!答疑)预算 ¥` 精确查项目预算，仍要求项目预算/执行花费各仅顶栏一处；S06 独立核对答疑费用。 |
| 026-R R02（1 条） | 暂停后焦点揭示已经打开清单，旧盲点 summary 会关闭它；改成检查 open、必要时才点开，列表内容、计数、恢复检查保持。返回入口改变作为 F02 独立 FAIL 保留。 |
| 024 S17（1 条）；026 S15（3 条）；028 S15（5 条） | 下层原样失败向上层汇总传播。按实际依赖顺序完整重跑下层后重新汇总，没有忽略业务失败。 |

12 个运行入口全部执行并退出 0；测试通过以断言为准。独立 context 可并行，读取前批结果或追加前批结果的脚本保持依赖顺序。首次适配并行运行中，022 S01 一次截图超过旧 6.5 秒超时；保留该次结果，再仅对截图设 30 秒超时并复跑失败场景及依赖汇总，业务断言未变。相关记录见 screenshot-timeout-diffs、regression-first-adapted-summary.json、regression-followup-run.log。030 主脚本初跑也遇到定位/脚本问题：选项实际 ID 为 I9、暂停列需先展开、动态审核按钮移除后须以标题定位、对话按钮是“展开项目对话”等；初跑保存在 initial-main，修正只在检查脚本，最终重新执行相应场景。

原生下拉控件：同浏览器的独立原生 select，ArrowDown/Enter 后仍空值；列表控件可选 one。时间线 member/card/group/type 四项“仅键盘切换”均记 **环境限制、未验证**，没有记 PASS，也没有将其归为产品失败；selectOption 的实际过滤行为另外已测。range 的 Home/End/方向键通过，F01 经原生鼠标对照成立，与这四项限制不同。

原生对照：[native-select-control.json](../evidence/030/regression-028/native-select-control.json)；限制清单：[limitations.txt](../evidence/030/limitations.txt)。

## 对比度与控制台

030 浅深两色共 882 个文字样本、236 个语义图形样本；文字最低 **5.572:1**，图形最低 **3.938:1**。均达标。抽查基于实际计算样式，不宣称逐像素覆盖全站所有状态。回归继续覆盖前四批已有的对比度检查。

最终浏览器控制台汇总 0 条事件：console warning/error、pageerror、requestfailed、HTTP ≥400 均无记录；主检查、所有复制回归和两个独立探针均纳入 [console.txt](../evidence/030/console.txt)。旧预期的定位异常、截图超时是检查进程日志，单独保存，不冒充浏览器控制台错误。

## 清理与范围

两个本次静态服务（PID 69950、69973）均已停止，65155/65158 端口关闭。所有本次启动的浏览器/context 已 close；各套件 finally 的 cleanup 文件与进程核对见 [cleanup.json](../evidence/030/cleanup.json)。未关闭他人的服务/浏览器。

保护范围核对 **13222 个既有文件，修改 0、丢失 0**。本次新增仅 `evidence/030/` 与 `tasks/030-report.md`。初始工作区已有 prototype 四个修改、029 证据和多份任务说明未跟踪，全部保留；不能为满足字面上的干净 status 删除别人文件。基线和最终 status 对照见 [git-status-before.txt](../evidence/030/git-status-before.txt)、[git-status.txt](../evidence/030/git-status.txt)；文件哈希核对见 [scope-check.json](../evidence/030/scope-check.json)。

最终 `git status --short`：

```text
 M prototype/app.js
 M prototype/board.js
 M prototype/data.js
 M prototype/index.html
?? evidence/029/
?? evidence/030/
?? tasks/029-last-message.md
?? tasks/029-replay-libraries.md
?? tasks/029-report.md
?? tasks/030-replay-browser-check.md
?? tasks/030-report.md
?? tasks/031-orca-fork-survey.md
?? tasks/032-orca-fork-launch-check.md
```

## 整体观感

作为第一次打开的人，B 回放能解释返工、拆卡和调研回流，真实提交与推断分开标得清楚，答疑直接打开日志也有效。但默认先看到当前依赖图，回放作为主要 Demo 入口只在第四个视图按钮；顶栏、项目简介、两组入口、筛选和长回放事件先占满首屏，历史图需向下找，375px 更明显。上下滚动时事件说明与图容易分离，连续拖动失效会让人怀疑自己是否操作正确。

“卡片、成员、代理、执行者、步骤、尝试、派单、验收、合并/登记”同时出现，首次打开很难判断当前是在管理任务还是会话。A 的当前汇总待开工与“可行后交付”示例提议同时存在，虽然有说明，仍需仔细读才能理解时间关系。历史卡点击打开当前详情也需记住那行提示。B 001/002 会话“未记录”与后续真实 ID 并列，真实性边界解释足够诚实，但信息密度高。

打法库 31 项全量连续展开，代理设计表单在长代理列表之后，角色章节表在打法页末尾，定位“查看、调整、审核”各动作需要较多滚动。项目页按钮与侧栏同名方便直达，却让当前位置/所属项目不够突出。S13 返回虽已可见，目标标题贴着右下角，整屏大量空白与边缘卡片的关系不容易辨认；F02 更把人带到另一入口。以上仅记录观感，没有改布局、文案或交互。
