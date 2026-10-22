# 执行者无人值守运行方式

Type: research
Status: resolved
Labels: wayfinder:research
Map: [Helm v1 设计](../map.md)

## Question

Codex CLI/SDK、Grok CLI、Claude Code CLI/Agent SDK 怎样在无人值守下启动和运行？需要查清：会让它们停下来等人输入的情况（信任目录、权限确认、额度提示、反问等）以及关闭办法；沙箱和权限参数；怎样判断卡住了（超时、无输出）；怎样拿到结构化进度和结果；怎样按 session id 续跑。顺带核对 A4：worktree 加上各自的沙箱参数，隔离是否足够。已有材料：`docs/research/helm-substrates.md`。

## Answer

调研结论见 [unattended-executors.md](../../../docs/research/unattended-executors.md)（Grok，2026-10-20，一手来源；本机二进制因权限未能跑 `--help`，未做真实调用）。

- **三个执行者都能无头运行**：Codex 用 `codex exec --json -a never --sandbox workspace-write`（`--full-auto` 已废弃）；Grok 用 `grok -p`（或本机实测可用的 `--prompt-file`），加 `--always-approve --no-plan`；Claude 用 `claude -p`，v2.1.302 起默认拒绝未批准的工具调用，需要改代码时用 `dontAsk` 或 `auto` 权限模式。
- **会停下来等人的情况**：目录信任或 onboarding、hook 信任、登录过期、模型反问（Codex app-server 有 `requestUserInput`）、额度用尽（行为未写明）、Grok 的计划审批。办法是事先信任 worktree 路径、关闭计划模式、用 API key 或回写登录文件。文档覆盖不了的部分，由**运行层的外部看门狗**兜底：墙钟超时、长时间无输出就判定卡住，杀掉进程后按 session id 续跑或改派。Codex #34397 记录了不退出也不报错的挂起，Claude #56540 记录了无 TTY 时并行子代理没有输出。
- **进度与续跑**：三者都有 JSON 或流式事件输出，都能按 session 或 thread id 续跑。
- **A4：推翻**。worktree 加 cwd 只能保证"五个执行者不改同一份工作副本"。Claude 的文件工具和 hook 不在 Bash 沙箱里；Grok 的 workspace 模式仍可写 `~/.grok/`，读范围是整台机器；Codex 默认可写 `/tmp`，五个进程共用 `~/.codex` 的 SQLite，锁残留会让后续进程启动超时。要防"被提示带偏的执行者读到密钥、写到仓库外、锁死共享状态"，还需要一层它们进不去的边界：容器或 VM，至少要按进程拆开家目录和凭证。交给 [隔离与合并](08-isolation-and-merge.md) 决定。
- **待实测**：Codex `workspace-write` 下 `.git` 只读，worktree 里能否提交，文档没有写清（会影响谁来提交）。并入 [调度者实测](14-coordinator-trial.md) 或 08 一起验证。

## Comments

- 2026-10-22 冲突复核：本单的无人值守参数和沙箱分析都基于一次性命令（`codex exec`、`grok -p`、`claude -p`）。04 已改为 Claude Agent SDK、`codex app-server`、ACP，对应的设置（`approvalPolicy`、ACP 权限代答、SDK `permissionMode`）以及"Codex `workspace-write` 下 worktree 能否提交"并入 [22](22-driver-and-subscription-trial.md) 实测。
