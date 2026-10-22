# 隔离与合并

Type: grilling
Status: resolved
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

## Answer

2026-10-22 与用户讨论定稿，两项待验证已在本机实测（脚本 `.scratch/prototype/helm-drivers/sandbox-probe.mjs`，未提交）。

**外层边界：不加。** helmd 为每个执行者强制打开它自带的沙箱，并只让它在卡片副本里写：

| 执行者 | 设置 |
|---|---|
| Codex | `workspace-write`（22 已测） |
| Claude SDK | `sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false }`，`canUseTool` 拒绝副本以外的 Write/Edit/MultiEdit/NotebookEdit |
| Grok | 环境变量 `GROK_SANDBOX=workspace`（可写 cwd、`~/.grok`、`/tmp`） |
| DeepSeek | 默认 `workspace-write`（22 已测，可写 cwd 和 `/private/tmp`） |

Seatbelt 外壳、独立系统用户、容器或 VM 都不做（见地图 Out of scope），理由：个人使用，参考产品（Conductor、Orca、orka、vibe-kanban、Codex app）也只用 worktree，外层方案会让执行者读不到订阅登录。已知可写范围超出副本的部分（各家的状态目录、`/tmp`）接受。

实测（2026-10-22，grok 1.0.67，claude 2.1.300 + Agent SDK 0.3.308；哨兵放在 `~/helm-sandbox-probe/`，cwd 是临时仓库的 worktree）：
- **Grok**：全局 `permission_mode = "always-approve"` 保持不变。设 `GROK_SANDBOX=workspace` 后，cwd 内写入成功，cwd 外的 `rm` 和重定向写入都报 `Operation not permitted`，整个过程没有权限请求。对照组不设沙箱，越界的删除和写入都成功了。**07 留下的 Grok 漏洞由此堵上**。
- **Claude SDK**：Bash 越界的 `rm` 和写入被沙箱拦下，报 `Operation not permitted`，且没有走到 `canUseTool`；Write 工具越界由 `canUseTool` 拒绝；副本内的 Bash 和 Write 都成功；网络可用（`curl` 返回 200）。
- 顺带发现：Grok 会加载用户全局的 hook（`curl` 被 `~/.grok/hooks` 里的大文件下载 hook 拦下）。执行者沿用用户的全局 hook，这次不处理。

**分支与副本**
1. 一个项目对应一个 git 仓库。确认工作说明时定下**基准 ref**，默认为当前分支 HEAD，只取已提交的内容，有未提交改动时提醒用户。helmd 从基准 ref 开出**工作分支** `helm/<工作>`。用户的分支在审核被接受之前都不动。
2. **卡片副本**：每张卡片一个 worktree，放在 `~/.helm/worktrees/<工作>/<卡片>`，分支为 `helm/<工作>/<卡片>`。在该卡片第一次执行派单时，从工作分支的当前末端开出，后续执行派单（返工、续跑）复用。
3. **提交**：每次执行派单结束后，helmd 把剩余改动提交一次，提交信息里写派单 id。执行者也可以自己提交，不禁止。这样绕开了 Codex `workspace-write` 不能提交的问题（22）。
4. **完成即合并**：调度者标记完成时，helmd 在同一个工具调用里把卡片分支以 `--no-ff` 合进工作分支，合并成功才算完成。有冲突时中止合并，卡片状态不变，工具返回结构化错误"与工作分支冲突"。调度者再派一次执行单（把工作分支合进卡片分支并解决冲突），然后重新标记完成。加上 05 的"依赖到位才派单"，下游卡片总是从已合并上游成果的工作分支开出。
5. **调度者副本**：每项工作有一个 `~/.helm/worktrees/<工作>/_work`，检出工作分支。helmd 在这里做合并，调度者轮次的 cwd 也在这里（只读）。
6. **真实分支与远端**：用户接受审核后，helmd 在本地把工作分支合进基准分支，再推送基准分支；冲突或推送失败时报告给用户，不重试。执行者不能推送：helmd 在执行者环境里用 `GIT_CONFIG_*` 设置 `url.<无效地址>.pushInsteadOf`，覆盖常见远端前缀（`git@`、`https://`、`ssh://`），并给一个无效的 `GH_TOKEN`。提示词也写明不推送、不部署。执行者有意绕过的情况不防。
7. **依赖与未入库文件**：Helm 不处理，执行者按提示词自己安装依赖。需要 `.env` 之类的密钥时提决策关卡。不提供项目初始化命令，避免把密钥复制进多个副本。
8. **清理**：卡片进入终态时，删除它的 worktree 和卡片分支。完成卡片的提交已经通过 no-ff 合并留在工作分支里；已取消卡片的提交随之丢弃，只留事件和派单输出。工作结束（审核被接受或工作取消）时，删除 `_work`。工作分支保留。

ADR：[0003 不加外层隔离，完成即合并到工作分支](../../../docs/adr/0003-own-sandboxes-and-work-branch.md)。术语"工作分支""卡片副本"已加入 GLOSSARY。已在 05、07、09、10、11 留评论。
