# 任务 002 复检 1

任务 001 已按你的发现返工（见 evidence/001/report.md 的「返工 1」一节）：窄屏收件箱布局、深色模式实色按钮的前景色，以及浅色模式 --ok 微调为 #1f874c。

请复检：
1. 修正 S03 的断言：修正记录（correction）的检查对象是 t3 的 redteam 检查链，不是 t2。这是任务说明的错误，不是实现缺陷。t2 只需检查 method 可见。
2. 把检查脚本复制为 evidence/002/recheck-1/browser-check.mjs 并完成上述修正，然后对 S01–S11 全量重跑。截图、assertions.txt、console.txt 输出到 evidence/002/recheck-1/。不要覆盖 evidence/002/ 根目录下原有的证据。
3. S10 的对比度断言要覆盖深色和浅色两种模式下的 button.ok、button.primary、.count；S11 的可读性断言保持原阈值。

边界：与原任务相同。禁止修改 prototype/、src/、DESIGN.md 以及 tasks/ 下除本次报告以外的文件；完成后清理服务与浏览器进程。
报告（中文）：逐场景结论、与上次结果的差异，以及新发现的问题（没有则写"无"）。
