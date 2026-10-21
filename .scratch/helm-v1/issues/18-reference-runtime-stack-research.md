# 参考产品的技术栈与运行层结构

Type: research
Status: resolved
Labels: wayfinder:research
Map: [Helm v1 设计](../map.md)

## Question

参考产品（Orca、orka、devteam skill、codex/grok plugin-cc、JAgents、dsh、open-grokbot、Factory Missions、vibe-kanban）分别用什么语言和框架实现？它们的运行层怎么组成：几个进程、谁拉起 agent 子进程、状态存在哪里、界面怎么拿实时状态、守护进程重启时子进程怎么处理、在 macOS 和 Linux 上怎么后台运行和自启动？结论交给 [技术栈与进程结构](04-tech-stack.md)。

## Answer

调研结论见 [reference-runtime-stack.md](../../../docs/research/reference-runtime-stack.md)（Grok，2026-10-21，一手来源）。

- **语言**：自带运行层、要拉起官方 CLI 的产品多数是 TypeScript/JavaScript 跑在 Node 上（Orca、JAgents、codex/grok plugin-cc、open-grokbot）；vibe-kanban 是 Rust 服务加 TS 网页，为了打成单一二进制；orka、devteam 是纯 Shell 加技能。
- **运行层三种形态**：① 界面进程 + 可重连的 PTY daemon（Orca、JAgents，为交互式终端）；② 一个本地 HTTP 服务 + 短命子进程，状态在 SQLite，界面用 SSE（vibe-kanban）；③ 没有运行层，调度者会话自己 spawn CLI（orka、plugin-cc、devteam）。
- **子进程**：无头执行者都用普通 spawn（不用 PTY、tmux），按进程组或 PID 杀进程树，加超时（orka `timeout --kill-after`）。主程序重启时没有产品重新接管普通子进程；中断后按 session id 续跑或重跑。
- **状态**：Orca、JAgents、vibe-kanban 都用 SQLite 放在用户数据目录；JAgents 用 Node 自带的 `node:sqlite`。
- **自启动**：只有 Orca 做了：`orca serve service install` 写 macOS LaunchAgent 或 Linux systemd user unit（Linux 登出后要开 lingering）。
- **对 04 的建议**：TS + Node；一个常驻运行层进程，每次派单一个普通子进程；SQLite 放用户数据目录；界面用 SSE；用户级服务自启动。推翻条件见调研文档。

## Comments
