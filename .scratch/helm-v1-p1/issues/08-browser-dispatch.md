# 08 — 浏览器派单

**What to build:** 调度者派单时标"需要浏览器"，`helmd` 为这次派单在沙箱外起一个 Playwright MCP，执行者通过自己的派单 MCP 端点拿到转发的浏览器工具，能打开它在副本里起的开发服务、截图；派单结束即关闭浏览器。见 [spec](../spec.md) 的"验收与浏览器"。

**Blocked by:** 04 — 执行派单主路径

**Status:** resolved

- [x] 执行派单和验收派单都可以标"需要浏览器"，记在派单上
- [x] Playwright MCP 用 HTTP 模式、`--isolated`、Playwright 自带 Chromium 有界面模式；锁定版本并按版本安装浏览器；用 127.0.0.1 时加 `--allowed-hosts`
- [x] 派单端点只转发检查所需的浏览器工具（navigate、snapshot、click、type、screenshot 等），不暴露 `browser_evaluate`、`browser_run_code_unsafe`；没标"需要浏览器"的派单拿不到浏览器工具
- [x] Playwright MCP 进程组记 pgid 和启动时间，派单任何方式结束都关闭
- [x] 起真实浏览器的测试与其余自动测试分开运行，不在沙箱里跑，禁止无头模式和系统 Chrome；验收时查看截图
- [x] 假执行者脚本在分配的端口起一个静态页，经转发工具打开并截图，截图内容与页面一致

## Comments

实现共用派单的 needsBrowser 标记、固定版本有界面 Chromium 的 HTTP MCP、检查工具白名单转发和进程组清理，使用假浏览器 MCP 验证静态页、截图响应及各类结束路径，并提供独立真实浏览器测试入口；本轮按用户要求未启动真实浏览器，验收派单入口与端口段分配分别待任务 07、05 合并，浏览器处理不按派单用途分支。
