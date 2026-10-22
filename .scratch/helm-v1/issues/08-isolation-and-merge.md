# 隔离与合并

Type: grilling
Status: open
Labels: wayfinder:grilling
Blocked by: 01, 02
Map: [Helm v1 设计](../map.md)

## Question

每张卡片的 worktree 从哪个 ref 开出来，什么时候清理？完成的分支怎么合并（谁来合、什么时候合、冲突怎么处理）？依赖前一张卡片的卡片，是在前一张单合并后的基础上开始，还是基于它的分支？A4 已被推翻（见 02）：要不要加一层外部边界（容器、VM，或按进程拆开家目录和凭证），加到什么程度？

## Comments

- 2026-10-21 来自 [04](04-tech-stack.md)：隔离方案要和订阅登录一起考虑。Claude 在 macOS 上把登录存在钥匙串里，Codex 存在 `~/.codex`，Grok 存在 `~/.grok`；按进程拆开家目录或放进容器，可能导致读不到登录。Claude Agent SDK 运行在 `helmd` 进程里，执行者如果放进容器，`pathToClaudeCodeExecutable` 要指向一个包装脚本（例如 `docker exec`）。多个 Codex 执行者共用 `~/.codex` 时的 SQLite 锁争用见 04 的 Q15。

- 来自 [05](05-task-store-model.md)（2026-10-21）：任务库模型没有包含 worktree、分支和合并状态，由本单补充。已有字段：成果的种类含"分支"，记路径或 ref；返工时新建修复卡片（不重开已完成的卡片），已放行的下游可能已基于原卡片的成果开工。

- 2026-10-22 冲突复核：外层边界不预设前提，由本单从头讨论。已知冲突：02 建议的容器、VM、按进程拆家目录和凭证，都会让执行者读不到订阅登录（Claude 在钥匙串，Codex 在 `~/.codex`，Grok 在 `~/.grok`），见 04 的评论。Codex 在 worktree 里能否提交由 [22](22-driver-and-subscription-trial.md) 实测。

- 2026-10-22 来自 [22](22-driver-and-subscription-trial.md)：Codex 在 `workspace-write` 下**一律不能提交**：普通仓库、worktree、git 目录加进 `writableRoots`、`--separate-git-dir` 改名，都被 Codex 沙箱拦下；`danger-full-access` 能提交。可选：helmd 在派单结束后替执行者提交，或给 Codex 放开沙箱（`SandboxPolicy` 有 `externalSandbox` 类型，表示由外层负责）。DeepSeek（dsh）默认 workspace-write，可写根是 cwd，`/private/tmp` 也可写，网络不受限，模式由 `DSH_PERMISSION_MODE` 环境变量决定。另：Grok 的 `allow_always` 授权按 cwd 记在 `~/.grok/sessions/` 下，worktree 路径若被复用，授权会被继承。

- 2026-10-22 来自 [07](07-hard-constraints-and-tools.md)：本单须兜住的条件：① 执行者没有 Helm 工具，只在自己的工作副本里读写代码，副本以外（用户真实项目目录、别的卡片的副本）由本单划边界；② 每张卡片同时最多一个活动派单，副本可按卡片分配；③ Grok 全局 `permission_mode = "always-approve"` 时不发权限请求，运行层代答拦不住，只能靠外层边界；④ push、开 PR、部署等对外动作运行层不逐条拦截，"谁能合并或推送到用户真实仓库"由本单定；⑤ 调度者对项目代码只读（Claude 关写工具、Codex `read-only` 沙箱），它读的是哪份副本也由本单定。
