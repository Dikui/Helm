# 07 — 子进程环境白名单与独立的真实冒烟

**What to build:** Helm 拉起的 agent CLI 只拿到运行必需的环境变量，不再继承调用方环境里的其他变量；真实冒烟不管由谁、从哪里运行，结果都一样。来源：第一阶段真实冒烟和 2048 端到端都是从 Claude Code 桌面会话经 Codex 启动的，桌面会话的 `CLAUDE_CODE_*` 等变量一路传进 Helm 拉起的 `claude`，执行者因此多出 Artifact、DesignSync、PushNotification、SendMessage 等桌面端工具和 20 个桌面端 skill，`messaging_socket_path` 指向桌面会话的通信套接字，自动记忆也是开着的。见 [spec](../../helm-v1-p1/spec.md)"凭据：按模板管住子进程环境变量"和"不读本机全局配置"。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 调度者、执行者子进程的环境变量改为白名单：只传运行必需的变量（如 PATH、HOME、USER、LANG/LC_*、TMPDIR、代理变量）加 Helm 自己设置的变量；白名单每一项说明为什么需要
- [ ] 关掉 Helm 拉起的 Claude 会话的自动记忆（查 SDK 或 CLI 支持的方式；做不到就在报告里说明依据）
- [ ] 测试：父进程环境里放一个 `CLAUDE_CODE_*` 变量和一个任意变量，断言子进程拿不到
- [ ] `npm run test:real` 依次运行三套真实冒烟，并用只含最少变量的干净环境启动，不继承调用方环境
- [ ] 真实冒烟断言：执行者和调度者的初始化记录里没有 `messaging_socket_path`，可用工具只含 Helm 提供的工具和该角色允许的内置工具
- [ ] 在 Helm 仓库的 `AGENTS.md` 和 README 写明：改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，在沙箱外运行 `npm run test:real`
