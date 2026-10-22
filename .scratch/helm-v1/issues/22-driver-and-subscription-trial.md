# 驱动与订阅实测

Type: prototype
Status: resolved
Labels: wayfinder:prototype
Map: [Helm v1 设计](../map.md)

## Question

[04](04-tech-stack.md) 选定的驱动有几个前提还没实测，推翻任何一个都要改 04，所以排在 [06](06-coordinator-lifecycle.md) 之前做。逐项实测并记录结果：

1. **Claude Agent SDK 扣订阅**：`pathToClaudeCodeExecutable` 指向本机 `claude`，清掉 `ANTHROPIC_*`，跑一轮，看计划用量条是否扣减。推翻条件：扣到 API 或 extra usage，就改用 `claude -p --input-format stream-json --output-format stream-json`。
2. **Codex app-server**：只设 `CODEX_SQLITE_HOME` 时 `account/read` 仍是 ChatGPT 登录；用旧对话 id `thread/resume` 能找回；同时起 10 个 Codex 执行者不撞锁。
3. **Grok**：`grok agent stdio` 选 `cached_token`、不设 `XAI_API_KEY` 时扣 SuperGrok；是否支持 `session/cancel`、`session/load` 或 `session/resume`。
4. **DeepSeek**：`dsh --profile acp` 只用 `DEEPSEEK_API_KEY` 能跑通一轮。
5. **无人值守设置按新驱动重新核对**：[02](02-unattended-executors.md) 的结论基于一次性命令。核对 app-server 的 `approvalPolicy`、ACP 权限代答、SDK `permissionMode` 下，执行者不会停下来等人，沙箱设置与 02 的分析是否一致；ACP 选 `allow_always` 是否会把授权写进 agent 自己的配置，影响用户在 Helm 以外的使用（决定 [07](07-hard-constraints-and-tools.md) 候选⑦能否用 `allow_always`）。
6. **Codex 在 worktree 里能否提交**：`workspace-write` 下 `.git` 只读，worktree 的 git 目录在主仓库里（来自 02，影响 [08](08-isolation-and-merge.md) 由谁提交）。

实测步骤见 [subscription-via-acp.md](../../../docs/research/subscription-via-acp.md) 的"实测办法"和 [codex-concurrency.md](../../../docs/research/codex-concurrency.md) 第 6 节。结果写进本单 Answer；推翻了前提的，在 04、07 或 08 留评论。

## Answer

2026-10-22 本机实测。版本：claude 2.1.300、Agent SDK 0.3.308、codex-cli 0.163.0、grok 1.0.52。所有被测进程都在干净环境里启动，只带 `PATH HOME USER LOGNAME SHELL TMPDIR`（本会话自身带着 `ANTHROPIC_BASE_URL` 和一批 `CLAUDE_CODE_*`，不清会污染结论）。脚本是一次性的，放在未提交的 `.scratch/prototype/helm-drivers/`。用户决定不看用量页，订阅归属按 `apiKeySource`、登录方式和环境变量下结论。

1. **Claude Agent SDK 扣订阅：成立（间接证据）**。`pathToClaudeCodeExecutable` 指本机 `claude`、`settingSources: []`，三轮的 init 消息都是 `apiKeySource: "none"`，环境里没有任何 `ANTHROPIC_*`，不可能走 API key。未直接核对计划用量条，是否记到 extra usage 仍无直接证据；Helm 跑起来后若计划条不动而 extra usage 增长，再按推翻条件改用 `claude -p` stream-json。
2. **Codex app-server：三项都成立**。
   - 只设 `CODEX_SQLITE_HOME` 时 `account/read` 为 `chatgpt` / `promax`；整轮实测约 25 个 turn，`account/rateLimits/read` 周用量 22% → 27%，credits 余额始终 0。新 sqlite 目录启动时自动 backfill（`state_5.sqlite` 约 7MB），`initialize` 约 5 秒。
   - 用 trial 里建的 thread id，在另一个**全新** sqlite 目录的新进程里 `thread/resume` 成功，追问上一轮内容答对。
   - 一个进程 10 个 thread 同时 `turn/start`（各跑 `sleep 8`）：10 条命令都在任一 `turn/completed` 之前开始，总 19 秒，真并行；10 个进程各用一个 sqlite 目录同时跑：全部 completed，总 31 秒，无锁错误。用户的桌面 managed daemon 同时在跑。
3. **Grok：取消、续跑成立；扣 SuperGrok 按间接证据成立**。`authMethods` 含 `cached_token`（读 `~/.grok/auth.json`），环境无 `XAI_API_KEY`。`agentCapabilities` 有 `loadSession`、`sessionCapabilities.resume/list/close`。一轮长命令 12 秒时发 `session/cancel`，返回 `stopReason: cancelled`；新进程 `session/load`、`session/resume` 都成功，追问暗号答对。
4. **DeepSeek：跑通，但不是靠 `DEEPSEEK_API_KEY`**（dsh 0.2.1-rc.2，ACP 自报 `deepseek-harness-acp` 0.0.1）。`initialize` 的 `authMethods` 为空。会话有两条模型路线：默认的 `deepseek-official`（`deepseek-v4-flash`）要 API key，环境和 `~/.dsh/.credentials.yaml` 都没有 key 时第一轮就报 `no API key for provider route`；另一条 `deepseek-account`（DeepSeek-V4.1-Flash、V4-Pro）用 `dsh web` 登录的 DeepSeek 账号（凭证在 `~/.dsh/.credentials.yaml` 的 `deepseek-account-platform`），`session/set_config_option` 选它之后一轮跑通。账号路线的计费方式本次没有查。能力：`sessionCapabilities` 有 `resume/list/close`，**没有 `loadSession`**（`session/load` 报 Method not found）；`session/cancel` 12 秒返回 `cancelled`；新进程 `session/resume` 找回会话，追问暗号答对。
5. **无人值守按新驱动核对**：
   - Codex：`approvalPolicy: "never"` 下全部实测零审批请求，与 02 的 `-a never` 一致。沙箱可在 `thread/start` 的 `sandbox` 或 `turn/start` 的 `sandboxPolicy` 设置，`writableRoots` 两处都生效。`SandboxPolicy` 另有 `externalSandbox` 类型（Codex 不自带沙箱，交给外层），供 08 参考。
   - Claude SDK：`bypassPermissions`（需 `allowDangerouslySkipPermissions`）直接执行；`dontAsk` 不等人、直接拒绝未预批工具（Bash、Write 被拒，任务没做成），执行者要用它就必须配 `allowedTools`；`default` + `canUseTool` 回调由运行层代答，回调被调用 1 次后执行成功。不传 `permissionMode` 时 SDK 默认 `auto`（分类器判定，判不了才走 `canUseTool`）。三种都不会停下等人。
   - Grok ACP：`grok agent stdio` **没有按会话设置权限模式的参数**，`session/new` 也不提供模式切换，权限跟随用户全局 `~/.grok/config.toml`（用户设了 `[ui] permission_mode = "always-approve"`，此时从不发权限请求）。临时去掉这一行后：cwd 内 `touch` 不请求权限；cwd 外 `rm` + `curl` 发出 `session/request_permission`（选项 `allow_always / allow_once / reject_once / reject_always`）。
   - DeepSeek ACP：默认 `DSH_PERMISSION_MODE=workspace-write`、审批 `ask`，可写根是 cwd。实测**从不发 `session/request_permission`**：cwd 外但在 `/private/tmp` 下的 `rm` 直接成功（临时目录可写），网络 `curl` 直接成功；家目录下 cwd 外的 `rm` 被沙箱挡住后，模型在回答里用文字反问"要不要用 danger-full-access 重试"，然后 `end_turn`。即：不会卡住，但会以一轮"正常结束、实际没做完、在问人"的形式停下，运行层只能从回答内容判断。
   - **`allow_always` 会落盘**，但按目录：写进 `~/.grok/sessions/<URL 编码的 cwd>/permission.toml` 的 `allowed_bash_commands`（整条命令和拆出的子命令）。`config.toml` 等全局配置不变。执行者 cwd 是一次性 worktree 时，不影响用户在自己项目里的使用；cwd 是用户真实项目目录时，授权会留下来。实测后 `config.toml` 已原样恢复（md5 一致）。
6. **Codex 在 worktree 里提交：推翻，`workspace-write` 下一律不能提交**。普通仓库根目录、worktree 都报 `index.lock: Operation not permitted`；把公共 git 目录加进 `writableRoots`（thread 级、turn 级都试过）仍失败；用 `--separate-git-dir` 把 git 目录改成不叫 `.git` 的路径并加进 `writableRoots`，仍失败。对照：`writableRoots` 对普通目录生效；`danger-full-access` 下提交成功。外层 shell 能写这些 `.git`，确认是 Codex 自己的沙箱拦的。所以 Codex 执行者要么不自己提交（由 helmd 在派单结束后提交），要么放开沙箱、另加外层边界。

**未确认**：Grok 取消后，正在跑的 `sleep 60` 子进程是否被杀掉（日志分辨不出）；Claude 是否记到 extra usage（见第 1 项）。

已在 [04](04-tech-stack.md)、[07](07-hard-constraints-and-tools.md)、[08](08-isolation-and-merge.md)、[11](11-persistence-and-recovery.md) 留评论。
