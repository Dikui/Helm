# 执行者只用自带沙箱；卡片完成即合并到工作分支

02 的结论是 worktree 不够、需要外层边界。我们最后没有加外层边界，而是由 helmd 强制打开每家自带的沙箱，让执行者只能写自己的卡片副本：Codex `workspace-write`，Claude SDK `sandbox` 加 `canUseTool`，Grok `GROK_SANDBOX=workspace`，DeepSeek `workspace-write`。实测表明，在用户全局 `always-approve` 的情况下，Grok 也拦得住 cwd 外的写入。容器、VM、独立系统用户都会让执行者读不到订阅登录，个人使用的威胁也不值得这份代价。

git 流程是：工作分支 `helm/<工作>` 从基准 ref 开出；每张卡片在自己的 worktree 和分支里做；helmd 在每次执行派单结束后提交（Codex 沙箱里不能提交）；调度者标记完成时，helmd 把卡片分支 `--no-ff` 合进工作分支，冲突就拒绝完成，由调度者派单解决。"完成"等于"已合并"，下游卡片总是从含有上游成果的工作分支开出。审核被接受后，helmd 合并到基准分支并推送；执行者的推送被环境变量拦住。详见 [隔离与合并](../../.scratch/helm-v1/issues/08-isolation-and-merge.md)。

## Considered Options

- **Seatbelt 外壳**（macOS `sandbox-exec`，Codex 改用 `externalSandbox`）：只能用于 macOS，Linux 要另写 bubblewrap，钥匙串登录还要实测。重新考虑的条件：出现越界事故，或要跑不可信的仓库。
- **容器 / VM / 独立系统用户**：读不到订阅登录。
- **下游基于上游的卡片分支开工**：返工和取消会让下游的基础失效，合并顺序也变复杂。
