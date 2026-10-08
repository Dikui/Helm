# 任务 001 返工 1：浏览器检查发现的两个界面问题

浏览器检查（tasks/002-report.md、evidence/002/）发现以下问题，请在 prototype/index.html 中修复。

## 问题 1：窄屏收件箱条目被挤压（见 evidence/002/S11-01-narrow-inbox.png）
≤ 760px 时，`.inbox-item` 的「阻塞上层…」提示（.impact）和状态 chip 与正文同排，正文列仅约 60px，短标题换成 3 行以上。
要求：窄屏下正文占满整行宽度；impact 提示与 chip 换到正文下方（可同一行左对齐展示），impact 文字允许换行。桌面布局保持不变。

## 问题 2：深色模式下实心按钮文字对比度不足（见 evidence/002/S10-02-dark-c1a.png）
深色模式中 `button.ok`（以及 `button.primary`、`.count` 等白字在 --ok / --accent / --bad 实色背景上的元素）对比度不足，实测 2.16:1。
要求：新增 `--on-accent`、`--on-ok`、`--on-bad` 之类的前景色变量（浅色模式为白色，深色模式为足够深的颜色），替换这些元素中硬编码的 `#fff`，使深浅两种模式下文字与背景对比度都 ≥ 4.5:1。禁用状态的按钮不作要求。

## 边界
- 只改 prototype/index.html，以及 evidence/001/ 下的证据文件。不改模拟数据和交互逻辑。
- 不改桌面浅色模式的视觉效果（白字保持白字）。

## 验证
- 重新运行 `node evidence/001/check.mjs`，全部通过，输出覆盖保存到 evidence/001/check-output.txt。
- 在 evidence/001/contrast-check.txt 中列出每个被修改元素在浅色 / 深色模式下的前景色、背景色和计算出的对比度。可以用 Node 脚本按 WCAG 公式计算。
- 不做浏览器检查，会另行安排复检。
- 在 evidence/001/report.md 末尾追加「返工 1」一节（中文），说明改动和验证结果。
