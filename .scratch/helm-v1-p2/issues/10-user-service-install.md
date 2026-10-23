# 10 — 用户级服务自启动

**What to build:** 用户运行一次 `helm service install`，`helmd` 就成为开机自动启动、崩溃自动重启的用户级服务，服务里也能找到 `claude`、`codex` 并联网。见 [spec](../spec.md) 的"用户级服务"。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] macOS 写 LaunchAgent，Linux 写 systemd user unit 并提示开 lingering
- [ ] 服务配置写入安装时 shell 的 `PATH` 和代理变量；开机启动、崩溃自动重启；标准输出和错误写到 `~/.helm/logs/`
- [ ] 重新运行 install 会更新配置
- [ ] 这是本地程序命令，不经 HTTP 接口，不进操作定义
- [ ] 测试：在临时 `HOME` 下运行编好的 `helm`，`PATH` 里放 `launchctl`、`systemctl` 替身，断言生成的 plist 或 unit 内容和替身收到的参数
- [ ] Linux 在说明里标"未实测"
