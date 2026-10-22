# 沙箱里的 coding agent 怎样做浏览器验收

调研日期：2026-10-22（Grok，一手来源）。为 [验收流程](../../.scratch/helm-v1/issues/09-acceptance.md) 查的；同日本机实测见 09 的答案。

## 摘要

Helm 不要让沙箱里的 shell 自己拉起 Chromium。验收浏览器应由执行者宿主进程外的 MCP，或由 Helm 自己在沙箱外启动。Codex CLI 与 Claude Code 的 Bash 沙箱官方都把本地 MCP 放在 shell 沙箱之外，这条路只在「没有再用 `srt`、`GEMINI_SANDBOX`、Grok 进程级沙箱把整个 CLI 包进去」时成立。macOS 上 Seatbelt 拒绝 Chromium 注册全局 Mach 端口，`--no-sandbox` 与 Playwright 的 `chromiumSandbox: false`（默认就是 false）都绕不过。并行 worktree 时，开发服务和浏览器 profile、CDP 端口都要按工作区分配，不要共用一个 Chrome 用户目录。

## 1. 沙箱内启动 Chromium / Playwright / Puppeteer

### Codex CLI（macOS Seatbelt）

在 `workspace-write` 里直接 `chromium.launch()` 不可行。Chromium 启动时要向 launchd `bootstrap_check_in` 注册全局 Mach 名 `org.chromium.Chromium.MachPortRendezvousServer.<pid>`，Seatbelt 基线策略没有 `(allow mach-register …)`，结果是 `Permission denied (1100)` 后 `SIGTRAP`。Issue 仍开放，2026-10 在 Codex CLI 0.162.1、Desktop 与 app-server 上仍能复现。

已验证无效的办法：`--no-sandbox`（Playwright 本来就会加）、Chrome Headless Shell、`--in-process-gpu`。`--single-process` 能出页面和截图，但是 Chromium 不支持的模式，不能当测试方案。配置和 permission profile 都没有「允许某条 Mach 注册」的开关。带 read-deny 的升级执行（`require_escalated`）仍可能留在 Seatbelt 里，同样失败。更早的 Puppeteer 失败是 Crashpad 写不了 `~/Library/Application Support/...`。

官方出路只有：把这条命令放到沙箱外（rules 的 `prefix_rule` `decision = "allow"`，或 `danger-full-access`），或走下面的 MCP。用户提过追加 `~/.codex/sandbox-extra.sb`，仓库里没有这个功能。

- https://github.com/openai/codex/issues/21292
- https://github.com/openai/codex/issues/8011
- https://github.com/openai/codex/issues/24742
- https://developers.openai.com/codex/rules
- https://developers.openai.com/codex/concepts/sandboxing
- https://developers.openai.com/codex/config-reference （`writable_roots`、`network_access` 默认 false、`exclude_tmpdir_env_var` / `exclude_slash_tmp`）

### Claude Code Bash 沙箱与 `@anthropic-ai/sandbox-runtime`

Bash 沙箱只包住 shell 及其子进程。从沙箱里的 shell 启动的 Chromium 会撞上同一个 `mach-register`。`allowMachLookup` 只允许查找已有服务，不能注册。Issue #210 仍开放。PR #598 加上 `network.allowMachRegister`，审阅者用 Playwright 自带 Chromium 实测：只开 register 会挂起，lookup 和 register 用同一前缀才行，而且名字必须是这块构建实际注册的 `org.chromium.Chromium.*`，不是 `com.google.chrome.for.testing.*`。PR 尚未并入，现在没有可用配置项。`--single-process` 在这条线上同样是临时绕过，多 worker 不稳定。

Bash 沙箱的正式出口是 `sandbox.excludedCommands`：匹配的命令无文件系统限制、也不走网络代理。失败后模型还可以申请 unsandboxed retry。macOS 上 `network.allowLocalBinding: true` 让沙箱内进程监听端口并连接本机任意端口。Linux / WSL2 上沙箱命令的 localhost 是该命令私有的，连不上宿主机上的开发服务，`allowLocalBinding` 无效。要访问宿主机服务，只能把这条命令排除出沙箱。

若用 `srt claude` 把整个 Claude Code 包进 runtime，MCP、hooks、文件工具也进沙箱，Playwright MCP 会一起撞上 Mach 问题。Linux 上 runtime 用 bubblewrap。容器里再套 bubblewrap 需要 `enableWeakerNestedSandbox`，文档写明这会明显削弱隔离。

- https://code.claude.com/docs/en/sandboxing
- https://code.claude.com/docs/en/sandbox-environments
- https://github.com/anthropics/sandbox-runtime/issues/210
- https://github.com/anthropics/sandbox-runtime/issues/212
- https://github.com/anthropics/sandbox-runtime/pull/598
- https://github.com/anthropics/sandbox-runtime

### Gemini CLI（Seatbelt profiles）

开启 `gemini -s` / `GEMINI_SANDBOX` 时，整个 CLI 会重新进入 Seatbelt 或容器。内置浏览器代理读到 `SANDBOX=sandbox-exec` 且不是 `existing` 模式时，强制 `--isolated` 加 `--headless`：持久 profile 和 Seatbelt 的写限制冲突，isolated 用 tmpdir。容器沙箱里 `--autoConnect` 看不到宿主机 Chrome，改走 `--browser-url http://<host.docker.internal 的 IP>:9222`。并行 isolated 实例上限是 5。同一 persistent profile 不能并发，Chrome 会锁 profile。

自定义 profile：`SEATBELT_PROFILE`，文件为 `~/.gemini/sandbox-macos-<name>.sb` 或项目内 `.gemini/`。内置档有 `permissive-open`（默认，限制写、允许网络）到 `strict-*`。这是用户自己改策略的官方口子，仓库没有写明默认 profile 是否放行 `mach-register`。

用户自己加的本地 MCP（例如 Browser MCP）在 macOS 沙箱模式下会进 Seatbelt：关沙箱就好，开着则从别的 cwd 启动会失败，并且因为进程重启会把 MCP 拉起两次。

- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md
- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/browser/browserManager.ts
- https://github.com/google-gemini/gemini-cli/issues/3261
- https://github.com/google-gemini/gemini-cli/issues/4775
- https://github.com/google-gemini/gemini-cli/pull/25427

### Grok CLI

`GROK_SANDBOX=workspace`（以及 `--sandbox`）把沙箱加在整个 grok 进程上，不是按命令包一层。子进程继承文件系统限制。`workspace` 可写 CWD、`~/.grok/`、`/tmp`、`/var/tmp`，并写明网络对 `web_search` 和 MCP servers 开放。macOS 上子进程断网是空操作，只在 Linux 用 seccomp 切断子进程网络。文档没有 Chromium、Mach、Playwright 的条款，也没有「把某条命令排出沙箱」的开关。沙箱一旦加上不能在运行中放宽。

- https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md

### Linux 上的嵌套沙箱（各家通用，不是某一家的开关）

这和 macOS 的 Mach 失败不是同一件事。Playwright `chromiumSandbox` 默认 `false`，也就是默认带 `--no-sandbox`。Linux 上若打开 Chromium 自己的沙箱，需要非特权 user namespace（`clone` / `setns` / `unshare`）。Docker 默认 seccomp 不够，官方要求额外 seccomp，并以非 root 用户运行。Chromium 在容器里还建议 `--ipc=host`，否则共享内存不够会崩。以 root 启动会直接退出（crbug.com/638180）。Ubuntu 24.04 起 AppArmor 限制非特权 user namespace，Playwright 的 headless shell 没有 Chrome 那份 `userns` profile，报 `No usable sandbox!`。Chromium 自己的 Linux 沙箱用 namespace 和 seccomp-bpf，文档写明目前不用 Landlock。

Chrome DevTools MCP 的故障说明写得很直：MCP 客户端若用 macOS Seatbelt 或 Linux 容器把 MCP 服务器沙箱化，服务器就起不了需要自建沙箱的 Chrome。办法是对该服务器关掉沙箱，或 `--browser-url` 去连沙箱外已经开好的 Chrome。

- https://playwright.dev/docs/api/class-browsertype
- https://playwright.dev/docs/docker
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md
- https://pptr.dev/troubleshooting （Chrome DevTools MCP 引用的 Linux sandbox 说明）
- https://github.com/puppeteer/puppeteer/issues/12818
- https://github.com/chromium/chromium/blob/main/sandbox/linux/README.md

Windows 上 Codex 沙箱里的 headless Edge 同样起不来，沙箱外同一条命令可以。这是受限身份，不是 `--no-sandbox` 能修的：https://github.com/openai/codex/issues/52566

## 2. MCP 是否在 shell 沙箱之外

| 宿主 | 本地 stdio MCP 在哪 | 依据 |
|---|---|---|
| Codex CLI | shell 沙箱之外，有意如此 | 维护者 etraut-openai 在 #7635：「MCP servers are not run in the codex sandbox. This is by design.」2025-12 关闭为 not planned。服务器可声明 `codex/sandbox-state`，但进程本身不进 Seatbelt |
| Claude Code Bash 沙箱 | 之外。本地 MCP、command hooks、插件 monitor、LSP 以用户全权限运行 | https://code.claude.com/docs/en/sandboxing 的 “What runs outside the sandbox”；https://code.claude.com/docs/en/sandbox-environments |
| Claude Code 经 `srt` 包住整个进程 | 之内 | 同一篇 sandbox-environments：runtime 约束 tools、hooks 和 MCP。#210 的复现就是「用 srt 包 Playwright MCP」 |
| Gemini CLI，`GEMINI_SANDBOX` 开启 | 之内。CLI 先启动再 relaunch 进沙箱，MCP 会在沙箱进程里再起一次 | #4775、#3261；sandbox.md 的整进程沙箱 |
| Gemini CLI，只开 tool sandboxing、不开整进程沙箱 | 文档把隔离说成 `shell_exec` / `write_file` 这类工具调用，没有写 MCP 进程进 Seatbelt | https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md 的 “Tool sandboxing” |
| Grok，`workspace` 等非 off | 进程级沙箱盖住整个 grok 和它拉起的命令。workspace 说明里把 MCP 算进「允许网络」的对象，没有「MCP 在沙箱外」的句子 | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/18-sandbox.md |

因此：对 Codex 和「只开 Bash 沙箱」的 Claude Code，Playwright MCP / Chrome DevTools MCP 就是「沙箱内执行者使用浏览器」的官方形状。浏览器是宿主拉起的子进程，不在 shell 的 Seatbelt / bubblewrap 里。Playwright 官方安装就是 `codex mcp add` 或 `claude mcp add`，浏览器默认有界面，`--isolated` 用内存 profile，`--port` 可改成宿主机上的 HTTP MCP。

- https://playwright.dev/docs/getting-started-mcp
- https://playwright.dev/mcp/clients/other-clients
- https://playwright.dev/mcp/configuration/options
- https://playwright.dev/mcp/configuration/user-profile
- https://developer.chrome.com/docs/devtools/agents/get-started
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md

风险：

- 这个进程拥有用户权限，能读家目录、出网、起浏览器。Codex 维护者明确说这不是 bug。页面内容可以影响模型（提示注入）。Chrome 官方警告：连到已登录的浏览器等于代理用户本人。
- Playwright 文档把 `browser_run_code_unsafe` 标成等价于远程代码执行。`--allowed-origins` 挡不住重定向，官方写明它不是安全边界。
- 默认 profile 在 `~/Library/Caches/ms-playwright-mcp/`（macOS），按 workspace 目录哈希分开，但一个 profile 同时只能有一个浏览器，锁住就起不来。
- 若 Helm 再把整个 CLI 套进 `srt`、`GEMINI_SANDBOX` 或 Grok 的进程级 Seatbelt，这条「MCP 在外面」就不成立，macOS 上会回到第 1 节的 Mach 失败。这时应改成 Chrome 文档的 `--browser-url`：浏览器由 Helm 在沙箱外先启动。
- 沙箱内的执行者去连宿主机上的 HTTP MCP（`localhost:8931`）另有网络墙：Claude Linux 的沙箱 localhost 不是宿主机；Codex `workspace-write` 默认无出站网络。MCP 客户端必须在沙箱外，不能指望沙箱里的 curl 去打 CDP。

## 3. 同类产品怎么做浏览器验收

都是「浏览器不进 coding agent 的 shell 沙箱」，分三种。

**本机应用自己持有浏览器，agent 用工具去开。**

- Codex app：应用内浏览器和 Browser 插件。本地开发服务、文件预览、公开页；点击、输入、截图、只读页面 JS。登录站和扩展走系统浏览器或 Codex Chrome 扩展，不走应用内浏览器。Computer Use 是另一路，操作桌面，需要屏幕录制和辅助功能权限。https://developers.openai.com/codex/app/browser https://developers.openai.com/codex/app/computer-use
- Orca（onorca.dev）：每个 worktree 一块嵌入的 Chromium，标签按 worktree 分开。agent 用 `orca snapshot` / `orca click` / `orca fill` 驱动同一扇窗口。远端 workspace 默认在本机渲染、流量走远端主机。https://www.onorca.dev/docs/browser/overview
- Conductor：本地 workspace 是 git worktree，Run 脚本和终端在该目录。预览是应用里的 URL（`preview_urls`），不是 agent 在沙箱里起浏览器。https://www.conductor.build/docs/reference/settings/reference https://www.conductor.build/docs/concepts/git-worktrees
- Vibe Kanban：workspace 带分支、终端、开发服务。预览面板是产品内置浏览器，扫日志里的 URL 再加载，人用 DevTools 和点选组件。文档没有写 agent 在沙箱内启动 Playwright。https://vibekanban.com/docs/browser-testing https://vibekanban.com/docs/workspaces/preview https://github.com/BloopAI/vibe-kanban

**每个任务一台远端机器，浏览器和开发服务都在那台机器里。**

- Codex cloud：每任务一个容器。安装阶段有网，agent 阶段默认断网，可按环境打开。浏览器验收不是 CLI Seatbelt 那条路。https://developers.openai.com/codex/cloud/environments https://developers.openai.com/codex/cloud/internet-access
- Jules：任务在 Google Cloud VM 里克隆仓库。2025-08-07 起基础镜像带 Playwright，要求它验证前端时会渲染并回传截图。https://jules.google/docs/changelog/2025-08-07/ https://blog.google/innovation-and-ai/models-and-research/google-labs/jules/
- Cursor Cloud Agents：每 agent 一台隔离 VM，可装 Chrome / Chromium。产物是 PR 上的截图、录像、日志，人也可以接管远端桌面。自托管 worker 用 `--computer-use` 显式打开，macOS 驱动已登录桌面，Linux 可共享桌面。https://cursor.com/blog/agent-computer-use https://cursor.com/help/ai-features/background-agents https://cursor.com/docs/cloud-agent/self-hosted/computer-use.md
- Devin：会话有自己的机器和浏览器。测试模式在桌面里跑应用、录屏、把视频附在消息上。2.2 起是该会话的 Linux 桌面，不进用户本机沙箱。https://docs.devin.ai/work-with-devin/testing-and-recordings https://cognition.ai/blog/introducing-devin-2-2
- OpenHands：默认 Docker sandbox，agent 和浏览器都在容器里。镜像的 browser capability 安装 Chromium，并设置 `CHROMIUM_FLAGS=--no-sandbox --disable-dev-shm-usage --disable-gpu`。`extra_ports=True` 时宿主机 `host_port+2` 是 VNC。这是容器内浏览器，不是 Seatbelt 内浏览器。https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-agent-server/openhands/agent_server/docker/Dockerfile

**云端会话明确做不到。** Claude Code on the web 的出站代理不支持浏览器需要的 HTTPS CONNECT，Playwright 下载域名也不在放行列表。本地 Bash 沙箱和这个云沙箱不是同一套限制。https://github.com/anthropics/claude-code/issues/11791 https://github.com/anthropics/claude-code/issues/15583

## 4. 并行 worktree 的端口和资源

通行做法是编排器分配端口，每个工作区一块浏览器状态，而不是让沙箱里的进程抢 `localhost:3000` 或同一 Chrome profile。

- Conductor：每个本地 workspace 拿到 `CONDUCTOR_PORT` 起的 10 个端口。Run 脚本写 `--port "$CONDUCTOR_PORT"`，预览 URL 用 `http://localhost:$CONDUCTOR_PORT` 和 `$((CONDUCTOR_PORT + 1))` 到 `+9`。云 workspace 没有这个变量。`run_mode = concurrent` 允许多 workspace 同时跑；`nonconcurrent` 会先停掉别的 run。多个进程要用同一进程组，方便一起收掉。https://www.conductor.build/docs/reference/environment-variables https://www.conductor.build/docs/reference/scripts https://www.conductor.build/docs/guides/how-to-run
- Playwright MCP：默认 profile 路径含 workspace 目录哈希，不同目录自然分开。一个 profile 不能被两个浏览器同时用。并行验收用 `--isolated`（内存 profile，不落盘）。HTTP 模式默认端口 8931，多实例必须改 `--port`。`--shared-browser-context` 会让多个 HTTP 客户端共用一个 context，并行 worktree 不该开。https://playwright.dev/mcp/configuration/user-profile https://playwright.dev/mcp/configuration/options
- Gemini 浏览器代理：persistent / existing 发现实例占用就报错，要求改 isolated 或串行。isolated 最多 5 个，每个临时 profile。https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/agents/browser/browserManager.ts
- Chrome DevTools MCP：同一个调试端口不能有第二个客户端。`--autoConnect` 超时的条目之一就是「已经有别的 MCP 连着」。https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md
- Orca：标签和会话按 worktree 过滤，切 worktree 恢复该树的标签。https://www.onorca.dev/docs/browser/overview
- OpenHands：每个对话一个容器时，端口在宿主机上是映射出来的。`extra_ports` 约定 VS Code 为 `host_port+1`、VNC 为 `host_port+2`。固定宿主机端口要用 host network，否则并行容器会抢或随机映射。https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox https://docs.openhands.dev/openhands/usage/sandboxes/docker
- Cursor、Jules、Devin、Codex cloud：一任务一 VM 或一容器，端口冲突留在那台机器内部，不和本机其他 agent 抢。

本机还要算资源：每个 Chromium 是一套多进程。Gemini 把并行浏览器卡在 5。Conductor 用端口段而不是无限起服务。开发服务若必须单实例，用 `nonconcurrent`，不要靠沙箱去抢端口。

## 未查到或不确定

- Codex 官方没有「Linux Landlock 下 Playwright 失败」的维护者结论。Landlock 会限制子进程能写的路径，但是否还用 seccomp 禁掉 `unshare`，公开文档和已读 issue 没有写死。
- Grok 的 Seatbelt 策略文本没有公开到「是否允许 `mach-register`」。只知道整个进程进沙箱、`/tmp` 可写、macOS 不断子进程网络。workspace 下能不能真的拉起 Chromium，没有官方实测。
- DeepSeek dsh 没有官方沙箱与浏览器文档。能找到的是第三方插件，不当成依据。
- Codex `workspace-write` 在 `network_access = false` 时，本机 `bind` / 连接 `127.0.0.1` 是否放行，配置参考只写了出站网络，没有单独的 localhost 条款。
- sandbox-runtime PR #598 在本次抓取时仍开着，未合并。合并后 Claude 的 `srt` 路径才会有 `allowMachRegister`，而且必须和 `allowMachLookup` 成对、前缀匹配实际浏览器。
- Gemini 默认 `permissive-open` 能否在不开 isolated 的情况下跑通 Playwright，仓库只写了浏览器代理自己的绕行，没有承诺用户 shell 里的 `npx playwright test`。
- Vibe Kanban 的预览是给人看的内置浏览器。没有官方说明 agent 能以 CDP 驱动这块预览。
