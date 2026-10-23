# 10 — 用户级服务自启动

**What to build:** 用户运行一次 `helm service install`，`helmd` 就成为开机自动启动、崩溃自动重启的用户级服务，服务里也能找到 `claude`、`codex` 并联网。见 [spec](../spec.md) 的"用户级服务"。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] macOS 写 LaunchAgent，Linux 写 systemd user unit 并提示开 lingering
- [x] 服务配置写入安装时 shell 的 `PATH` 和代理变量；开机启动、崩溃自动重启；标准输出和错误写到 `~/.helm/logs/`
- [x] 重新运行 install 会更新配置
- [x] 这是本地程序命令，不经 HTTP 接口，不进操作定义
- [x] 测试：在临时 `HOME` 下运行编好的 `helm`，`PATH` 里放 `launchctl`、`systemctl` 替身，断言生成的 plist 或 unit 内容和替身收到的参数
- [x] Linux 在说明里标"未实测"

## Comments

实现本地 `helm service install`，生成并重载 LaunchAgent / systemd 用户服务，保存 PATH 和代理环境、配置自动重启及日志，并用临时 HOME 和服务管理器替身覆盖安装、更新及失败场景；Linux 未实测，真实系统安装留给沙箱外验收。
