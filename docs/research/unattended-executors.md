# 执行者怎样无人值守运行

调研日期：2026-10-20。只使用当时能打开的官方文档、官方仓库 issue，以及本机一条无害探测。不重复 [helm-substrates.md](helm-substrates.md) 里已经写过的产品选型；这里只回答无头启动、会停下来的提示、沙箱、进度与卡死、按 id 续跑、官方记录的挂起，以及 A4。

本机探测：调研进程对 `/Users/dikui/.local/bin/grok`、`/Users/dikui/.local/bin/claude`、`/Users/dikui/.grok/bin`、`/Users/dikui/.codex/packages/standalone/current/bin/codex` 做 `stat`，全部返回 `Operation not permitted`（Errno 1）。因此没有 `--help` 或 `--version` 可贴。下面不把「二进制里可能有、但文档没写」的开关写成已证实。

## Codex CLI（`codex exec`）

一句话：无头入口是 `codex exec`（别名 `codex e`）。进度走 stderr，最终消息走 stdout；加 `--json` 后 stdout 变成 JSONL。默认沙箱是只读。

来源：[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)（页面标注 2026-10-20）、[Developer commands](https://learn.chatgpt.com/docs/developer-commands)（2026-10-20）、[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)、[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 1. 怎样启动

```text
codex exec --json --skip-git-repo-check \
  -C <worktree> \
  --sandbox workspace-write \
  -a never \
  -c 'sandbox_workspace_write.network_access=false' \
  -c 'sandbox_workspace_write.exclude_slash_tmp=true' \
  -c 'sandbox_workspace_write.exclude_tmpdir_env_var=true' \
  "任务单正文"
```

`-C` / `--cd` 设定工作目录。提示词可以是参数，也可以用 `codex exec -` 从 stdin 读整段提示。stdin 另有内容、同时又给了提示词参数时，提示词是指令，管道内容是附加上下文。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

同一页写明：`--full-auto` 已不再支持。要改文件就显式写 `--sandbox workspace-write`。要让越界动作走自动审查而不是人，用 `--approve-for-me`（别名 `--not-so-yolo`）。它固定成 on-request 加 workspace-write，并且和 `--sandbox`、`--yolo` 冲突。[Developer commands](https://learn.chatgpt.com/docs/developer-commands)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

其它和无人值守直接相关的开关：

| 开关 | 作用 |
| --- | --- |
| `--json` | stdout 改为 JSONL 事件 |
| `-o` / `--output-last-message` | 把最终消息写入文件，同时仍打印到 stdout |
| `--output-schema` | 最终回复要符合一份 JSON Schema |
| `--ephemeral` | 不把 session rollout 写到磁盘 |
| `--skip-git-repo-check` | 允许不在 git 仓库里跑 |
| `--ignore-user-config` | 不读 `$CODEX_HOME/config.toml` |
| `--ignore-rules` | 跳过用户和项目的 execpolicy `.rules` |
| `--dangerously-bypass-hook-trust` | 已启用的 hook 不再要求事先信任 |
| `--dangerously-bypass-approvals-and-sandbox` / `--yolo` | 不要审批，也不要沙箱 |
| `--add-dir` | 在主工作区之外再给写权限，可重复 |
| `--worktree` | 在 Codex 自己管的新 git worktree 里启动；`codex exec` 可用，且必须是本机执行 |

[Developer commands](https://learn.chatgpt.com/docs/developer-commands)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

登录：单次运行可在命令前加 `CODEX_API_KEY`。文档把 API key 当作自动化的默认做法；ChatGPT 账号路径才去碰套餐限速。不要把 `OPENAI_API_KEY` 或 `CODEX_API_KEY` 设成整份 CI job 的环境变量，因为同 job 里的仓库代码能读到它。ChatGPT 登录缓存在 `~/.codex/auth.json`（明文）或系统凭证库；使用中会在过期前自动刷新。无浏览器的 runner 要把刷新后的 `auth.json` 存回去，下次才能接着用。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[Authentication](https://learn.chatgpt.com/docs/auth)

配置了 `required = true` 的 MCP 服务器如果初始化失败，`codex exec` 直接报错退出，不会悄悄不带它继续。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

### 2. 什么会停下来等人

| 情况 | 文档里的行为 | 无人值守时怎么处理 |
| --- | --- | --- |
| 审批 | `--ask-for-approval` 当前只列 `on-request` 和 `never`。`on-request` 在沙箱内自动做，越界才问。`never` 不再为审批停下来，并在你设的约束里尽力完成 | 用 `-a never`。不要用会弹出审批的 `on-request`，除非客户端能代答 |
| 已退役的 `untrusted` | `approval_policy = "untrusted"` 已不再支持，留在配置里可以让客户端起不来 | 从 `config.toml`、profile、启动脚本里删掉。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security) |
| 自动审查仍可能把人叫回来 | `--approve-for-me` 把越界请求交给审查 agent。审查拒绝后，主 agent 被要求改走更安全的路径，或者停下来问用户 | 不想出现「问用户」，就用 `never`，接受越界动作不会被批准。[Auto-review](https://learn.chatgpt.com/docs/concepts/sandboxing/auto-review) |
| 目录信任 | `projects."<path>".trust_level` 为 `"trusted"` 或 `"untrusted"`。未信任会跳过项目里的 `.codex` 配置、hook 和 rules。文档还写：在你明确信任工作目录之前，Codex 可能以只读启动，例子包括 onboarding 提示 | 事先把 worktree 路径写成 `trusted`。没有读到 `codex exec` 专用的「跳过信任对话框」开关。若 onboarding 提示真的出现，无头进程没有人可答。[Config reference](https://learn.chatgpt.com/docs/config-file/config-reference)、[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security) |
| 不在 git 仓库 | 默认拒绝，理由是防止破坏性修改 | `--skip-git-repo-check`。git worktree 本身是仓库，正常不需要这个开关。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |
| Hook 信任 | 启用的 hook 默认要求已持久化的信任 | 自动化且已经审过 hook 来源时，加 `--dangerously-bypass-hook-trust`。[Developer commands](https://learn.chatgpt.com/docs/developer-commands) |
| 登录过期 | ChatGPT 会话在使用中自动刷新。登出后下次要重新登录。API key 不走这套刷新 | 自动化用 `CODEX_API_KEY`。若必须用 ChatGPT 登录，保留并回写 `auth.json`。[Authentication](https://learn.chatgpt.com/docs/auth) |
| 模型反问 | app-server 有实验性的 `tool/requestUserInput`（1 到 3 个问题）。CLI 页没有写 `codex exec` 遇到同类提问时是退出、拒绝，还是一直等 | 见下一节 app-server。CLI 这一条本次无法从文档判定 |
| 额度或限速 | 非交互页只说：要套餐限速就走 ChatGPT 登录，要按量计费就走 API key。没有写额度用尽时的退出码，也没有写会不会弹出交互提示 | 未能从已打开的页面判定。预检可以看登录文件是否还在，不能据此知道额度 |

`on-failure` 在配置参考里标为已废弃：交互用 `on-request`，非交互用 `never`。[Config reference](https://developers.openai.com/codex/config-reference) 旧页面仍可能出现 `--full-auto` 和 `untrusted`。以 2026-10-20 的非交互页和审批页为准。

### 3. 沙箱和写范围

三个沙箱级别：[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)、[Sandboxing](https://developers.openai.com/codex/concepts/sandboxing)

| 级别 | 边界 |
| --- | --- |
| `read-only` | 可以读。编辑和跑命令要审批 |
| `workspace-write` | 可在工作区内编辑并跑常规本地命令。网络默认关闭 |
| `danger-full-access` | 去掉文件系统和网络边界 |

`workspace-write` 的可写范围是当前工作区，加上 `/tmp` 这类临时目录，再加上 `sandbox_workspace_write.writable_roots` 和 `--add-dir`。可用 `exclude_slash_tmp`、`exclude_tmpdir_env_var` 把临时目录剔出可写根。网络用 `sandbox_workspace_write.network_access = true` 打开；另有实验性的 `features.network_proxy`，按域名 allow/deny，它本身不授予网络。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)、[Config reference](https://developers.openai.com/codex/config-reference)

可写根里仍有只读保护区：`<writable_root>/.git`（若是 gitdir 指针，解析后的 git 目录也保护）、存在时的 `.agents`、`.codex`、`.aws`。保护是递归的。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)

因此：cwd 设到某个 git worktree，再关掉临时目录和额外 writable root，写范围会收在这个 worktree 里，但 `.git` 仍是只读。需要写 `.git` 的命令（例如提交）越过沙箱边界，进入审批。`never` 不会停下来问，也没有读到「自动抬沙箱去完成提交」的说法。这次没有跑命令验证提交会失败还是被静默跳过。

`--yolo` 同时拿掉审批和沙箱，文档要求只放在外部已经加固的环境里。[Developer commands](https://learn.chatgpt.com/docs/developer-commands)

Windows 原生沙箱另有限制：挡不住 Everyone 已可写的目录；文档建议 WSL 或容器。macOS / Linux 写的是操作系统机制强制执行，这次没有打开 Seatbelt / Landlock 的实现页，不写具体 syscall 名单。[Windows](https://developers.openai.com/codex/windows)、[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)

Web 搜索默认走缓存索引。`--yolo` 或其它 full access 时，网页搜索默认改成实时抓取。`--search` 或 `web_search = "live"` 显式打开实时搜索，`"disabled"` 关掉。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)

### 4. 进度、结果、怎样算卡住

不加 `--json`：进度在 stderr，最终 agent 消息在 stdout。加 `--json`：stdout 是 JSONL，事件类型包括 `thread.started`、`turn.started`、`turn.completed`、`turn.failed`、`item.*`、`error`。item 覆盖 agent 消息、推理、命令、文件变更、MCP、网页搜索、计划更新。`thread.started` 里有 `thread_id`。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

文档没有给 `codex exec` 一张退出码表，也没有给「多久没有新事件就算卡死」的阈值。官方排障只写交互界面：先看是不是在等审批。[Troubleshooting](https://learn.chatgpt.com/docs/reference/troubleshooting)

监督方要自己做两件事：空闲计时（JSONL 多久没有新行），以及墙钟超时后杀掉进程。只看退出码不够，因为下面的 issue 记录过进程不再输出、CPU 接近 0、自己也不退出。

### 5. 按 id 续跑

```text
codex exec resume <SESSION_ID> "返工说明"
codex exec resume --last "返工说明"
codex exec resume --last --all "返工说明"
```

`<SESSION_ID>` 用上一轮 JSONL 里的 `thread_id`。`--last` 只在当前工作目录里找最近一次；`--all` 才跨目录。后面的提示词可选。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[Developer commands](https://learn.chatgpt.com/docs/developer-commands)

`--ephemeral` 不落盘，这种运行没有 id 可续。续跑接上的是会话，不是「已完成的工具副作用恰好一次」。

## Codex SDK 与 app-server

一句话：SDK 的 `run()` 阻塞到这一轮结束；要自己处理审批和逐项事件，用 app-server 的 JSON-RPC。

来源：[Codex SDK](https://developers.openai.com/codex/sdk)、[App Server](https://developers.openai.com/codex/app-server)。旧的 `codex mcp-server` 和独立二进制已删除。

### 启动和权限

TypeScript：`new Codex()`、`startThread()`、`thread.run(prompt)`，同一线程再 `run()` 就是续写。Python：`Codex` / `AsyncCodex`，`thread_start(sandbox=Sandbox.workspace_write)`，`thread.run(...)`。沙箱预设三个：`read_only`、`workspace_write`（工作区和已配置的 writable roots）、`full_access`。省略时用 app-server 的配置默认。传给 `run` / `turn` 的沙箱会变成这个线程后续轮次的默认。[SDK](https://developers.openai.com/codex/sdk)

app-server 在 `thread/start` 上带 `cwd`、`approvalPolicy`（示例是 `"never"`）、`sandbox`（示例是 `"workspaceWrite"`）。`turn/start` 可以按轮覆盖，其中 `sandboxPolicy` 能写：

```json
{
  "type": "workspaceWrite",
  "writableRoots": ["/Users/me/project"],
  "networkAccess": false
}
```

`approvalPolicy` 示例里还有 `"unlessTrusted"`。`externalSandbox` 的 `networkAccess` 取值是 `"restricted"` 或 `"enabled"`；`workspaceWrite` 的 `networkAccess` 仍是布尔。[App Server](https://developers.openai.com/codex/app-server)

审批是服务器发给客户端的 JSON-RPC 请求，不是 CLI 提示：

- 命令：`accept`、`acceptForSession`、`decline`、`cancel`，或带 execpolicy 修正的接受
- 文件变更：`accept`、`acceptForSession`、`decline`、`cancel`
- 另有 `item/permissions/requestApproval`（网络或文件系统权限子集）和实验性的 `tool/requestUserInput`

文档没有写这些请求的超时。客户端不回答，这一轮就停在请求上。无人值守的客户端要么用 `approvalPolicy: "never"` 让越界请求不要发出来，要么对每一种 server request 立刻 `decline`。把连接空挂着等于等人。[App Server](https://developers.openai.com/codex/app-server)

`thread/shellCommand` 在沙箱外、以完整权限跑，不继承线程的沙箱策略。文档要求只把它暴露给用户明确发起的命令。编排器不要拿它跑模型产生的命令。[App Server](https://developers.openai.com/codex/app-server)

### 进度和续跑

通知流包括 `item/started`、`item/completed`、`item/agentMessage/delta`、`turn/completed`。`turn/completed` 的 `turn.status` 是 `completed`、`interrupted` 或 `failed`。`command/exec` 有 `timeoutMs`；没有在 `turn/start` 的已读字段里看到整轮超时。[App Server](https://developers.openai.com/codex/app-server)

SDK 页展示的是 `run()` 返回 `finalResponse` / `final_response`。逐项事件在 app-server 通知里。这次没有在 SDK 页读到和 JSONL 等价的事件迭代器。

续跑：`codex.resumeThread(threadId)` 后再 `run()`。app-server 用 `thread/resume`，参数是之前记下的 `thread.id`。`thread/fork` 复制历史到新 id。`required = true` 的 MCP 初始化失败时，`thread/start` 和 `thread/resume` 都会失败。恢复本身不更新 `updatedAt`，下一次 `turn/start` 才更新。[SDK](https://developers.openai.com/codex/sdk)、[App Server](https://developers.openai.com/codex/app-server)

## Grok CLI

一句话：无头是 `grok -p`。工具审批和沙箱是两套开关。官方页面之间对 `-s` 的说明不一致；续跑以 Sessions 页和 CLI reference 的 `-r` 为准。

来源：[Headless](https://docs.x.ai/build/cli/headless-scripting)、[CLI reference](https://docs.x.ai/build/cli/reference)（页脚 2026-07-21）、[Sessions](https://docs.x.ai/build/features/sessions)（2026-07-21）、[Permissions](https://docs.x.ai/build/features/permissions)、[Sandbox](https://docs.x.ai/build/features/sandbox)、[Plan Mode](https://docs.x.ai/build/features/plan-mode)（2026-07-21）、[Enterprise](https://docs.x.ai/build/enterprise)（2026-08-10）、[Settings reference](https://docs.x.ai/build/settings/reference)（2026-10-10）。

### 1. 怎样启动

Headless 页列出的常用开关：`-p` / `--single`、`-m`、`-s` / `--session-id`、`-r` / `--resume`、`-c` / `--continue`、`--cwd`、`--output-format plain|json|streaming-json`、`--always-approve`、`--no-alt-screen`。脚本里再加 `--no-auto-update`，避免后台更新检查；也可以在 `~/.grok/config.toml` 的 `[cli]` 里设 `auto_update = false`。[Headless](https://docs.x.ai/build/cli/headless-scripting)

CLI reference 另外列出、Headless 表里没有的开关：`--effort`、`--allow` / `--deny`、`--sandbox`、`--max-turns`、`--no-plan`、`--no-subagents`、`--no-memory`、`--disable-web-search`、`-w` / `--worktree`、`--ref`、`--fork-session`。`--always-approve` 的别名是 `--yolo`。Claude 的这些名字也被接受为别名：`--allowedTools`、`--disallowedTools`、`--append-system-prompt`、`--system-prompt`、`--dangerously-skip-permissions`。[CLI reference](https://docs.x.ai/build/cli/reference)

`--prompt-file` 不在 Headless 页，也不在 CLI reference。本次未能执行二进制核对。任务说明记录本机曾经成功使用 `grok -s <uuid> ... --prompt-file <file>` 和 `--always-approve`。这只说明该二进制接受过这个用法，不是文档已列出的开关。

登录：CI 设 `XAI_API_KEY`。没有浏览器时用 `grok login --device-auth`。凭证优先级按模型是 `model.api_key`、`model.env_key`、活动会话令牌、`XAI_API_KEY`。[Enterprise](https://docs.x.ai/build/enterprise)、[CLI reference](https://docs.x.ai/build/cli/reference)

### 2. 什么会停下来等人

| 情况 | 文档里的行为 | 无人值守时怎么处理 |
| --- | --- | --- |
| 默认 Ask | 未允许的工具调用会提示 | 不要依赖默认。用 `--always-approve`，或企业页里的 `dontAsk` 加显式 allow |
| Auto | 分类器自动放行安全工具；危险工具仍可能提示。deny 规则和 hook 仍然有效 | 无人值守不够。危险工具仍可能停下来。[Permissions](https://docs.x.ai/build/features/permissions) |
| Always-approve | 自动批准工具调用。deny 规则和 PreToolUse hook 仍然有效。记住的「总是允许」挡不住 `rm`、`git push` 这类危险模式，除非另有显式 allow；always-approve 下这些会跑，除非你 deny | `--always-approve`。需要硬拒绝的命令写 `--deny`。[Permissions](https://docs.x.ai/build/features/permissions) |
| Plan 审批 | 规划结束后 TUI 打开计划预览。Auto 和 always-approve 都不跳过这个预览。空计划也会打开。计划模式一直开着，直到批准或退出。agent 可以自己进入计划模式，文档说这不是权限提示 | CLI 有 `--no-plan`。文档没有写 `-p` 没有 TUI 时，这个预览是拒绝、挂起，还是自动通过。无人值守应加 `--no-plan`，避免走到只在 TUI 里定义了按键的界面。[Plan Mode](https://docs.x.ai/build/features/plan-mode)、[CLI reference](https://docs.x.ai/build/cli/reference) |
| dontAsk | 没有显式 allow 的调用被静默拒绝。企业页把它和 `acceptEdits` 列为 CI / headless 用的模式 | 企业页示例命令在抓取时把模式开关的 flag 名吞掉了，只剩下值 `dontAsk`。CLI reference 没有列出这个名字。本次不猜测完整拼写。能确定的绕开方式是 `--always-approve` 加 `--deny`，或先在用户配置里设 `[ui] permission_mode`。[Enterprise](https://docs.x.ai/build/enterprise) |
| 项目 hook | 项目 `.grok/hooks/` 要先 `/hooks-trust`。这是 TUI 命令 | 文档没有写无头时会不会停下来问。未信任时不要假设项目 hook 已生效，也不要假设它会阻塞。[Skills, Plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces) |
| 登录 | ACP 示例在没有缓存令牌也没有 `XAI_API_KEY` 时失败，错误文本是先 `grok login` 或设置 key。浏览器登录和 device code 可刷新。外部 `auth_provider_command` 在 `GROK_AUTH_EXPIRED=1` 时必须马上退出或静默换票，不能等人输入；等人输入的那次是交互登录，最长 300 秒 | 无头用 `XAI_API_KEY`，或保证 refresh 路径不读 stdin。[Headless](https://docs.x.ai/build/cli/headless-scripting)、[Enterprise](https://docs.x.ai/build/enterprise) |
| 额度 | 这次打开的 Headless、CLI reference、Enterprise 页都没有写额度用尽时的退出码或交互提示 | 未能从已打开的页面判定 |
| 更新检查 | headless 和 ACP 会做后台更新检查 | `--no-auto-update` 或 `auto_update = false`。[Headless](https://docs.x.ai/build/cli/headless-scripting) |

`disable_bypass_permissions_mode = true` 只在 root 拥有的 `/etc/grok/requirements.toml`（或系统层）生效。它关掉 always-approve、`--yolo`、`--permission-mode bypassPermissions`、会话内切换，以及 `*` / `**` 这种全放行规则。用户自己的 `~/.grok/requirements.toml` 锁不住。[Enterprise](https://docs.x.ai/build/enterprise)

### 3. 沙箱

默认 `off`：读写和子进程网络都不限制。沙箱限制的是 agent 进程和它的子进程（Linux Landlock，macOS Seatbelt）。[Sandbox](https://docs.x.ai/build/features/sandbox)

| Profile | 读 | 写 | 子进程网络 |
| --- | --- | --- | --- |
| `off` | 不限制 | 不限制 | 允许 |
| `workspace` | 各处 | CWD、`~/.grok/`、临时目录 | 允许 |
| `devbox` | 各处 | 除 `/data` 外的顶层目录 | 允许 |
| `read-only` | 各处 | 只有 `~/.grok/` 和临时目录 | 文档写「阻止」，但 macOS 上是空操作 |
| `strict` | CWD 和系统路径 | CWD、`~/.grok/`、临时目录 | 同上，macOS 上是空操作 |

子进程网络的限制只在 Linux 强制执行。模型 API 和网页工具走进程内网络，不受「子进程网络」这项控制。内置 profile 不长期保护 `~/.ssh` 这类路径，要自己写 `deny`。`~/.grok/` 在沙箱 profile 里保持可写，以便会话落盘。[Sandbox](https://docs.x.ai/build/features/sandbox)

自定义 profile 在 `~/.grok/sandbox.toml` 或项目 `.grok/sandbox.toml`：`extends`、`restrict_network`、`read_only`、`read_write`（额外可写路径）、`deny`（内核级拒绝读和写/改名）。非空 `deny` 在沙箱能套上时由内核执行；Linux 上读拒绝还需要 bubblewrap。内置名字不能被自定义 profile 重定义。[Settings reference](https://docs.x.ai/build/settings/reference)

启用方式：`--sandbox workspace`、`[sandbox] profile`、`GROK_SANDBOX`。`requirements.toml` 可以压过 CLI。[Sandbox](https://docs.x.ai/build/features/sandbox)

要把写范围收到一个 worktree：`--cwd` 指到该 worktree，`--sandbox workspace` 或更严的自定义 profile，不要加指向仓库外的 `read_write`。即便如此，`~/.grok/` 和临时目录仍可写，读范围在 `workspace` 下仍是整个机器。macOS 上不能靠 `read-only` / `strict` 的「子进程网络：阻止」来断网。

`[sandbox] auto_allow_bash = true` 会在沙箱 profile 已经生效时跳过 bash 的权限提示。这是权限，不是另一层沙箱。[Settings reference](https://docs.x.ai/build/settings/reference)

### 4. 进度和卡死

- `json`：结束时一个 JSON 对象。Sessions 页的例子用 `jq -r '.sessionId'` 取 id。没有公开字段表
- `streaming-json`：事件到达就输出一行 JSON。文档没有事件类型表
- ACP `grok agent stdio`：JSON-RPC。`session/update` 里 `agent_message_chunk` 是正文增量；`session/prompt` 的返回里有 `stopReason`。示例客户端用 30 秒作为单次 RPC 超时，那是示例，不是产品超时。[Headless](https://docs.x.ai/build/cli/headless-scripting)、[Sessions](https://docs.x.ai/build/features/sessions)

没有读到退出码表，也没有读到「无输出多久算卡死」。Enterprise 写的是另一件事：推理 SSE 每个块的空闲超时默认 600 秒，HTTP 连接池空闲默认 90 秒（`GROK_POOL_IDLE_TIMEOUT_SECS`）。代理空闲要至少 10 分钟，否则长回复会被掐断。这可以表现为中途断流，不是一个可查询的「等待审批」状态。[Enterprise](https://docs.x.ai/build/enterprise)

监督方用 `streaming-json` 的空闲计时，加上 `--max-turns` 封顶轮数，再用自己的墙钟杀掉进程。`json` 要到结束才有一个对象，空闲只能靠进程还在、stdout 仍为空来判断。

### 5. 续跑

Sessions 页和 CLI reference：

- `-r <session-id>` 或 `--resume <session-id>` 续指定会话
- `--resume` 省略 id，或 `-c`，续当前目录最近一次
- `-s` / `--session-id` 只给新会话指定 UUID，不恢复旧会话
- 续跑时加 `--fork-session` 分叉成新 id

Headless 页仍写 `-s` 是 “Create or resume a named headless session”。两页日期都标 2026-07-21 的 Sessions / CLI reference 与 Headless 页互相矛盾。接入用 `-r` 续跑，用 `-s` 只表示「这次新会话要用这个 UUID」。[Sessions](https://docs.x.ai/build/features/sessions)、[CLI reference](https://docs.x.ai/build/cli/reference)、[Headless](https://docs.x.ai/build/cli/headless-scripting)

会话存在 `~/.grok/sessions/`，按工作目录索引。`/rewind` 会改磁盘文件；无头编排不要调用它。[Sessions](https://docs.x.ai/build/features/sessions)

官方公开 issue：Grok CLI 没有公开源码仓库。这次在 docs.x.ai 没有打开到一张「已知挂起」页，也没有找到官方 issue 跟踪。不补社区帖。

## Claude Code CLI（`claude -p`）

一句话：`-p`（`--print`）是非交互运行。从 v2.1.302 起，没指定权限模式的 `-p` 以 Manual（`default`）启动，需要审批的调用被拒绝，而不是弹出等你按键的对话框。真正不等人的写法还要另选模式。

来源：[Headless](https://code.claude.com/docs/en/headless)、[Permission modes](https://code.claude.com/docs/en/permission-modes)（页面内容写到 v2.1.302）、[Sandboxing](https://code.claude.com/docs/en/sandboxing)、[CLI reference](https://code.claude.com/docs/en/cli-reference)、[Sandbox environments](https://code.claude.com/docs/en/sandbox-environments)。

### 1. 怎样启动

```text
claude --bare -p "任务单正文" \
  --permission-mode dontAsk \
  --allowedTools "Read" "Edit" "Bash" \
  --output-format stream-json \
  --verbose \
  --add-dir <worktree>
```

`-p` 拒绝和 `--bg` 组合，也拒绝和「带任务描述的 `--cloud`」组合；`--cloud` 加会话 id 再加 `-p` 会往那个云会话排队然后退出。`--bare` 跳过 hook、技能、自定义命令、子代理、插件、MCP、自动记忆和 CLAUDE.md，并且不读 OAuth 和系统钥匙串，所以必须自备 `ANTHROPIC_API_KEY`（或 `--settings` 里的 `apiKeyHelper`）。文档建议脚本和 SDK 使用 `--bare`，并写它会在以后的版本里变成 `-p` 的默认。[Headless](https://code.claude.com/docs/en/headless)

不带 `--bare` 时，即使目录从未信任，`-p` 仍会跑项目 `.claude/settings.json` 里的 hook，并连接 `.mcp.json` 里的服务器。`-p` 不显示工作区信任对话框，也不显示每个 MCP 服务器的批准提示。[Headless](https://code.claude.com/docs/en/headless)

成功退出码 0，失败非 0。非法 flag 在启动前写到 stderr。运行中的失败（文档举的例子是缺少认证）把失败内容当作结果打到 stdout。SIGTERM 退出码 143，当前轮不记结果。stdin 管道上限 10MB，超过则非 0 退出。[Headless](https://code.claude.com/docs/en/headless)

预检登录可以不发起模型调用：`claude auth status` 已登录退出 0，未登录退出 1。JSON 的 `authMethod` 为 `none`、`claude.ai`、`oauth_token`、`api_key`、`api_key_helper` 或 `third_party`。[CLI reference](https://code.claude.com/docs/en/cli-reference)

### 2. 什么会停下来等人

| 情况 | 文档里的行为 | 无人值守时怎么处理 |
| --- | --- | --- |
| 信任目录 | `-p` 不弹信任对话框 | 不用处理对话框。副作用是未信任目录里的项目 hook 和 MCP 仍会跑，除非 `--bare`。[Headless](https://code.claude.com/docs/en/headless) |
| 默认权限 | v2.1.302 起，未指定模式的 `-p` 用 Manual。需要审批的调用被拒绝，除非 allow 规则、hook、`canUseTool`，或 `--permission-prompt-tool` | 想让它改代码：`--permission-mode dontAsk` 加 `--allowedTools`，或 `--permission-mode auto`。只跑 `-p` 会得到拒绝，不一定是挂起。[Permission modes](https://code.claude.com/docs/en/permission-modes) |
| dontAsk | 工作目录内的读，以及预先允许的工具可以跑。本来会提示的调用改为拒绝。已安装的 mod 仍可能批准其中一部分。AskUserQuestion、标记了 requiresUserInteraction 的 MCP、组织要求询问的 connector、网络路径上的读、针对关键路径的 `rm` / `rmdir`，即使写了 allow 也会拒绝 | CI 示例就是 `claude -p ... --permission-mode dontAsk --allowedTools ...`。[Permission modes](https://code.claude.com/docs/en/permission-modes) |
| auto | 分类器代替人审查。组织可以关掉。模型不支持或服务端临时关闭时，会话退回 Manual | `claude -p ... --permission-mode auto`。分类器不是隔离边界。[Permission modes](https://code.claude.com/docs/en/permission-modes)、[Sandbox environments](https://code.claude.com/docs/en/sandbox-environments) |
| bypassPermissions | `--dangerously-skip-permissions`。Linux 和 macOS 上，这个模式拒绝以 root 或 `sudo` 在公认沙箱之外启动。`-p` 里少数仍会提示的调用改为拒绝。进入该模式前的确认框可用 `skipDangerousModePermissionPrompt` 跳过 | 文档要求放在容器、VM 或 sandbox runtime 里，并且不要用 root。云会话忽略设置文件里的这个模式。[Permission modes](https://code.claude.com/docs/en/permission-modes)、[Settings reference](https://code.claude.com/docs/en/settings-reference) |
| Plan | 批准计划之前不让编辑 | 不要在无人值守任务上用 `--permission-mode plan`。批准步骤是给人的。[Permission modes](https://code.claude.com/docs/en/permission-modes) |
| 模型提问 | AskUserQuestion 在任何模式下都不会被自动批准。dontAsk 直接拒绝。SDK 若挂了 `canUseTool` 且不返回，执行会一直暂停 | CLI 无人值守用 dontAsk 或 `-p` 的默认拒绝。不要在 SDK 里留下不返回的回调。[Permission modes](https://code.claude.com/docs/en/permission-modes)、[User input](https://code.claude.com/docs/en/agent-sdk/user-input) |
| 后台任务把进程留住 | 主对话启动的后台命令（dev server、watch）会让 `-p` 一直等到命令自己结束，这 10 分钟上限不算它。`/loop` 的唤醒即使超过 10 分钟上限也会继续等。其它后台空闲等待默认 10 分钟后停掉，环境变量 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`，设为 0 表示不封顶 | 任务单不要启动长驻进程。监督方仍要有墙钟。stderr 是终端且已等了 5 秒时，会打印以 `Waiting for background work to finish` 开头的一行；json / stream-json 且 stdout 不是终端时，这行不打印，脚本读不到它。[Headless](https://code.claude.com/docs/en/headless) |
| 登录 | 缺少认证时，失败作为结果写到 stdout，退出码非 0。`--bare` 不使用订阅登录 | `--bare` 配 `ANTHROPIC_API_KEY`。交互登录是否过期，用 `claude auth status` 看，不发起模型调用。[Headless](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-reference) |
| 额度 | `--max-budget-usd` 到达上限时，不再等待剩余后台工作，而是停掉它们。没有读到「额度用尽会弹出确认」的句子 | 用预算开关封顶。用量数字在 `--output-format json` 的 `total_cost_usd` 里，续跑时这个数包含更早几轮，且是客户端估计。[Headless](https://code.claude.com/docs/en/headless) |

项目 `.claude/settings.json` 或 `.claude/settings.local.json` 里的 `defaultMode: "auto"` 和 `"bypassPermissions"` 不会生效。其它模式可以从设置文件生效。flag 优先于设置文件。[Permission modes](https://code.claude.com/docs/en/permission-modes)

### 3. 沙箱

Bash 沙箱只包住 shell、PowerShell 和 Monitor，以及它们启动的进程。Read、Edit、Write、WebFetch、WebSearch、hook、本地 MCP、LSP、状态栏命令、apiKeyHelper 都在沙箱外面。macOS、Linux、WSL2 可用；原生 Windows 上命令不进沙箱。文档写明：单独的 Bash 沙箱不够支撑完全无人值守；`--dangerously-skip-permissions` 必须再套容器、VM 或 sandbox runtime，否则文件工具和 hook 不受这层边界约束。[Sandboxing](https://code.claude.com/docs/en/sandboxing)、[Sandbox environments](https://code.claude.com/docs/en/sandbox-environments)

沙箱打开后的默认边界：

| 项 | 默认 |
| --- | --- |
| 写 | 工作目录、每用户临时目录、`--add-dir` / `permissions.additionalDirectories` 加进去的目录。受保护路径保持拒绝写 |
| 读 | 机器上的大部分位置，包括 `~/.ssh`、`~/.aws/credentials`，除非 `filesystem.denyRead` |
| 网络 | 没有直连。流量走本机代理，允许域名列表一开始是空的。新域名谁来批，取决于权限模式 |

`dontAsk` 拒绝沙箱外重试，也拒绝允许列表之外的域名（`strictAllowlist` 或 `allowManagedDomainsOnly` 打开时，任何权限模式都拒绝）。`bypassPermissions` 下，沙箱外重试不再提示。allow 规则若匹配该命令，沙箱外重试也会被自动批准。[Sandboxing](https://code.claude.com/docs/en/sandboxing)

`--add-dir` 给的是文件访问，不是把那个目录的配置、命令、agent 定义一并加载。`--bare` 对 `--add-dir` 是例外：会加载该目录 `.claude/skills/`，仍跳过 commands 和 agents。[Headless](https://code.claude.com/docs/en/headless)、[Sandboxing](https://code.claude.com/docs/en/sandboxing)

所以「cwd 是 worktree」只约束沙箱内 Bash 的默认写范围。文件工具要靠权限规则（`Edit` / `Write` 的路径模式、deny）另外收口。不收口的话，bypass 或一条宽的 allow 就能写到 worktree 外面。

### 4. 进度和卡死

`--output-format`：`text`（默认）、`json`（`result`、会话 id、费用）、`stream-json`（一行一个事件）。实时 token 要同时加 `--verbose` 和 `--include-partial-messages`。`--json-schema` 不合法时，进程以错误信息退出，结构化结果在 `structured_output`。[Headless](https://code.claude.com/docs/en/headless)

退出码：成功 0；失败非 0；SIGTERM 为 143；stdin 超过 10MB 为非 0。没有一张「限速 = 某个码」的表。

看起来像卡死、其实是文档里的等待：

- 主对话的后台命令不吃 10 分钟上限
- `/loop` 可以超过这个上限
- 工作目录被删掉时会话继续跑，shell 失败，`stream-json` 里有警告

空闲检测用 `stream-json` 的新行。墙钟仍然要有，因为后台命令可以让进程合法地长时间没有模型输出。`claude agents --json` 能列出后台会话；issue #64271 里出现过 `status: waiting`。`-p` 前台进程本身不靠这个命令来汇报。[CLI reference](https://code.claude.com/docs/en/cli-reference)、[Headless](https://code.claude.com/docs/en/headless)

### 5. 续跑

```text
claude -p "返工说明" --resume "$session_id"
claude -p "返工说明" --continue
```

`session_id` 来自 `--output-format json`。按 id 查找不限于当前目录，这台机器上任意项目的会话都能找到。也可以把会话 `.jsonl` 的绝对路径传给 `--resume`。`-r` 也接受会话名字。[Headless](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-reference)

v2.1.257 起，`--continue` 会打开已经结束的后台会话，不会打开仍在跑的后台会话。SIGTERM 之后再 resume，默认把被打断的那一轮留在原地，下一句提示才继续；要接着跑被打断的那一轮，设 `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`。[Headless](https://code.claude.com/docs/en/headless)

## Claude Agent SDK

SDK 和 `claude -p` 共用同一套权限模式。v2.1.302 起，`query()` 不设模式时也是 `default`：需要审批的调用被拒绝，除非 allow、hook、`canUseTool` 或 permission prompt tool。[Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)、[Permission modes](https://code.claude.com/docs/en/permission-modes)

`canUseTool` 不返回，执行就一直停着。文档写明回调可以无限期挂起。人不会马上回答时，应让 PreToolUse hook 返回 `defer`，进程退出，以后从已保存的会话续上。Python 的 `can_use_tool` 还要求流式模式，外加一个返回 `{"continue_": True}` 的 PreToolUse hook，否则流会在回调之前关掉。TypeScript 设 `permissionPrompts: 'none'`（v2.1.259 起）时不调用回调，hook 不决定就拒绝。[User input](https://code.claude.com/docs/en/agent-sdk/user-input)、[Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)

`dontAsk` 把本来要问的调用直接拒绝，不调用回调。`bypassPermissions` 在到达模式这一步的调用上自动批准，但 deny 规则、显式 ask 规则、hook、AskUserQuestion、需要用户交互的 MCP、针对关键路径的 `rm` / `rmdir` 仍然例外。`allowed_tools` 不能收窄 `bypassPermissions`：没列在 allow 里的工具会落到模式上，然后被批准。要禁用工具，用 `disallowed_tools`。`permissionMode: "bypassPermissions"` 时如果还传了 `canUseTool`，SDK 会发一次 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` 警告。[Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)

续跑是 `query()` 的选项，不是另一个进程子命令：[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

| 需求 | 选项 |
| --- | --- |
| 同一进程里多轮 | Python `ClaudeSDKClient`；TypeScript 后续调用 `continue: true` |
| 进程重启后续最近一次 | Python `continue_conversation=True`；TypeScript `continue: true`。按当前目录找最近会话 |
| 续指定会话 | 自己保存 session id，传给 `resume` |
| 另走一条分支 | `fork`，原会话不变 |
| 不落盘 | TypeScript `persistSession: false`。Python 用环境变量 `CLAUDE_CODE_SKIP_PROMPT_HISTORY` 抑制转录 |

会话持久化的是对话，不是文件系统。文件快照是另一份 file checkpointing 文档，这次没有把它当成崩溃恢复协议来用。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

进度：Python 用 `client.receive_response()` 迭代消息；TypeScript 用 `for await` 迭代 `query()`。工作目录中途被删时，`stream-json` 里有警告，和 CLI 相同。[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[Headless](https://code.claude.com/docs/en/headless)

打断：先 `interrupt()` 或 SIGINT，再停进程。直接 SIGTERM 会留下未完成的一轮。[Headless](https://code.claude.com/docs/en/headless)

## 官方 issue 里的挂起和锁

只列这次打开过页面，或检索摘录能对上官方仓库的条目。没有逐条核对是否已在更新的版本里修好，除非页面自己写了状态。

### Codex（openai/codex）

| Issue | 本次看到的状态 | 和无人值守的关系 |
| --- | --- | --- |
| [#34397](https://github.com/openai/codex/issues/34397) | 页面写着 Open。2026-07-20 开，评论称 0.144.6 仍能复现 | `codex exec` 在若干次工具调用之后不再产生输出。stderr 重复 `codex_models_manager`：`timeout waiting for child process to exit`，大约 185 秒一次。之后 CPU 接近 0，进程不退出、不报错。报告者用外部 15 分钟墙钟杀掉。同机 `curl` 访问 `chatgpt.com/backend-api/` 能在数秒内返回 |
| [#32160](https://github.com/openai/codex/issues/32160) | 本次没有打开页面核对开关状态。检索摘录日期 2026-07-10 | 残留进程占着 SQLite。app-server 报 `pool timed out while waiting for an open connection`，界面上的说法是 initialize handshake timed out。报告者的处理办法是停掉残留的 codex / chatgpt 进程 |
| [#26454](https://github.com/openai/codex/issues/26454) | 本次没有打开页面。检索摘录日期 2026-06-04 | 关掉窗口后主进程还在，或另一个 app-server 拿着 `~/.codex` 下的 `state_5.sqlite`、`logs_2.sqlite` 及 wal/shm。桌面因此打不开 |
| [#48593](https://github.com/openai/codex/issues/48593) | 本次没有打开页面。检索摘录日期 2026-09-27 | Windows `workspace-write` 在大工作区给写 ACE 时挂住，命令没有 stdout、stderr 和退出码。空目录和小目录几秒内成功 |
| [#7852](https://github.com/openai/codex/issues/7852) | 本次没有打开页面。检索摘录日期 2025-12-11 | 当时 `--full-auto` 和 `--sandbox workspace-write` 下 `codex exec` 不返回，子进程变成孤儿，JSONL 里 `exit_code` 保持 null。该 flag 后来被文档标为不再支持，不能据此说 2026-10 的 `workspace-write` 仍是这个故障 |
| [#26277](https://github.com/openai/codex/issues/26277) | 本次没有打开页面。检索摘录日期 2026-06-04 | Android/Termux 上 `flock` 返回不支持，`codex exec` 在 `acquire_app_server_startup_lock` 失败。和 macOS Helm 不直接相关，但说明启动路径上有一把文件锁 |

五个 Codex 进程共享一个 `~/.codex` SQLite 家目录。上面两条锁 issue 说明：隔离工作副本不等于隔离 Codex 自己的状态库。配置项 `sqlite_home` 可以改这个目录。[Config reference](https://learn.chatgpt.com/docs/config-file/config-reference)

### Claude Code（anthropics/claude-code）

| Issue | 本次看到的状态 | 和无人值守的关系 |
| --- | --- | --- |
| [#56540](https://github.com/anthropics/claude-code/issues/56540) | 打开页面：2026-06-03 因不活跃被关闭，原因是 not planned，不是写明已修复。2026-08-06 锁定 | 无 TTY 的父进程下，`claude -p --permission-mode bypassPermissions` 在一条消息里并行 5 个 Task 时，CPU 在涨但 stdout 10 分钟以上为空。单个 Task 能完成。同一 issue 还写：子代理扫进受 TCC 保护的目录时，launchd 没有 GUI 可以点允许，运行会停在那里 |
| [#64271](https://github.com/anthropics/claude-code/issues/64271) | 本次没有打开页面。检索摘录日期 2026-05-31 | `claude --bg` 即使 `--permission-mode acceptEdits` 也会停在子代理 Write 的权限提示上。`claude agents --json` 显示 `waiting`。没有非交互的回复命令；`attach` 需要 TTY。当前 Headless 页已写 `-p` 拒绝 `--bg`，所以这是后台会话路径，不是 `-p` 路径 |
| [#67268](https://github.com/anthropics/claude-code/issues/67268) | 本次没有打开页面。检索摘录日期 2026-06-10，标了 duplicate | headless 写 `.claude/` 下的路径会被当成敏感文件拒绝，即使 `permissions.allow` 写了同一路径。交互会话里同一路径可以经人批准后写。版本记录为 2.1.172 |
| [#37913](https://github.com/anthropics/claude-code/issues/37913) | 本次没有打开页面。检索摘录标了 enhancement、stale | 请求一个 `permissionRequestTimeout`，超时后自动拒绝。说明当时没有内置的「审批提示最多等 N 秒」。v2.1.302 的 `-p` 改为默认拒绝，和这条请求要解决的挂起不是同一条路径 |
| [#37797](https://github.com/anthropics/claude-code/issues/37797) | 检索摘录写 Closed as not planned。本次没有打开页面 | headless 加 Discord 频道时，权限提示仍堵在终端里。报告者写：即便 `--dangerously-skip-permissions`，插件级权限仍要交互批准。这是 2026-03 的报告，不能当成当前版本的行为 |

### Grok

未能找到官方公开 issue 跟踪。不把论坛或第三方仓库里的「挂起」写进来。

## A4：git worktree 加上执行者自带的沙箱，隔离够不够？

结论：推翻「够」。worktree 分开的是 git 工作副本。三家文档各自写明，沙箱参数还有工作副本以外的写路径、不受沙箱约束的工具，或共享的家目录状态。五路并行时，这些缺口会叠在一起。

支持的部分有，而且有限：

- 每个执行者的 cwd 是它自己的 worktree 时，仓库里的已跟踪文件不会和另一个执行者的工作副本互相覆盖。这是 git worktree 的作用，不是沙箱的作用。Codex 还可以用自己的 `--worktree`；Grok 有 `-w`；Claude 的后台会话删除时会提到 worktree 残留，但 `-p` 本身不创建 worktree。[Developer commands](https://learn.chatgpt.com/docs/developer-commands)、[CLI reference](https://docs.x.ai/build/cli/reference)、[CLI reference（Claude）](https://code.claude.com/docs/en/cli-reference)
- Codex `workspace-write` 把命令和文件变更的可写根限制在工作区加显式额外根，`.git` 在可写根内仍只读，网络默认关闭。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)
- Grok `workspace` 的写范围是 CWD、`~/.grok/` 和临时目录。CWD 若是 worktree，仓库外的普通路径不在默认写范围内。[Sandbox](https://docs.x.ai/build/features/sandbox)
- Claude Bash 沙箱的默认写范围是工作目录、每用户临时目录，以及额外加进去的目录。[Sandboxing](https://code.claude.com/docs/en/sandboxing)

推翻的依据：

1. Claude 的文件工具、hook、MCP 不在 Bash 沙箱里。官方写：单独的 Bash 沙箱不够用于完全无人值守；`--dangerously-skip-permissions` 必须再放进容器、VM 或 sandbox runtime。worktree 加 `--sandbox` 挡不住 Write/Edit 写到别的目录，也挡不住 hook 用用户权限跑。[Sandbox environments](https://code.claude.com/docs/en/sandbox-environments)、[Sandboxing](https://code.claude.com/docs/en/sandboxing)
2. Grok 的 `workspace` 仍可写 `~/.grok/`。五个 Grok 共享这一个目录，会话、配置和凭证都在里面。读范围是整个机器。macOS 上 `read-only` / `strict` 的子进程断网是空操作。进程内的模型 API 和网页工具不受子进程网络开关控制。内置 profile 不保护 `~/.ssh`。沙箱默认还是 `off`，不传 `--sandbox` 就没有这层。[Sandbox](https://docs.x.ai/build/features/sandbox)
3. Codex 的 `workspace-write` 默认还包括 `/tmp`（除非显式排除）。`.git` 只读意味着提交要越界，而 `never` 不会为人停下来，也没有读到自动越界。`--yolo` 则把沙箱整个拿掉。五个进程默认共享 `~/.codex` 的 SQLite；#32160 和 #26454 记录过残留锁让下一个进程在启动时超时。worktree 隔不开这把锁。[Agent approvals](https://learn.chatgpt.com/docs/agent-approvals-security)、[#32160](https://github.com/openai/codex/issues/32160)、[#26454](https://github.com/openai/codex/issues/26454)
4. 三家的「不要提示」都不等于「不能离开 worktree」。Codex `--approve-for-me` 在审查拒绝后仍可能停下来问用户。Grok always-approve 不跳过计划审批界面，且 deny 没写到的工具调用会执行。Claude auto 是分类器，不是文件系统边界；dontAsk 只是把越界请求拒绝掉，拒绝发生之前，读工具已经能读工作目录以外的大部分文件（Bash 沙箱的默认读，以及沙箱外的 Read 工具）。[Auto-review](https://learn.chatgpt.com/docs/concepts/sandboxing/auto-review)、[Plan Mode](https://docs.x.ai/build/features/plan-mode)、[Sandboxing](https://code.claude.com/docs/en/sandboxing)

还缺什么，所以不能把「不够」收成一张实测清单：

- 本机三个二进制都因 EPERM 没能跑 `--help`。没有在 worktree 里做一次「写父目录、写 `~/.ssh`、访问网络」的无模型探测。任务也不允许发起真实模型调用，所以沙箱是否按文档生效，这次没有实测。
- 没有打开 Codex macOS Seatbelt 的实现说明。Windows 的「挡不住 Everyone 可写目录」不能直接套到这台 Mac 上。
- Grok 没有官方 issue 库。计划模式在 `-p` 下是挂起还是自动跳过，文档只定义了 TUI 按键。
- Claude #56540 已关闭，但是因为不活跃，不是因为页面写了修复。并行子代理在无 TTY 下是否仍会无输出挂住，本次没有复测。
- 共享家目录能否用 `CODEX_HOME`、`sqlite_home`、独立的 `~/.grok`、独立的 Claude 配置目录拆开，文档里只明确读到 Codex 的 `sqlite_home` 和 `$CODEX_HOME`。Grok 和 Claude 的「每个 worktree 一个家目录」这次没有读到对应开关。

若目标只是「五个执行者不要改同一份工作副本」，worktree 加上 cwd，再加上各自的 workspace 写限制，文档上站得住。若目标是「一个执行者被提示带偏之后，仍然读不到密钥、写不到仓库外、打不了任意网络、也不会把共享状态库锁死」，文档上的这三层沙箱都不够，还要一层它们进不去的边界（容器、VM，或至少按进程拆开的家目录和凭证）。
