# Agent 不再运行在沙箱里，取代"只写本次运行目录"和"凭据禁读"

ADR 0022 定下的硬约束里，"只写本次运行目录"和"凭据禁读"靠各家 CLI 的沙箱实现：执行者只能写卡片副本或临时目录，调度者只能写调度者目录，`~/.ssh`、`~/.aws` 等凭据路径禁读。实际用下来挡掉的多是正常工作：Codex 下 `/tmp` 和 `$TMPDIR` 也只读，`mktemp`、测试临时文件、编译中间文件都会失败；主目录下的缓存（`~/.npm`、`~/.cache`、`~/Library/Caches`）只读，装依赖失败；Docker socket、在仓库外建构建目录、启动项目依赖的服务也都被挡（#13）。按工具一个个放行补不完。用户 2026-11-03 决定完全放开：四家 CLI 都以无沙箱模式启动，凭据禁读一并去掉，调度者和执行者用同一套权限。

- Claude：`permissionMode: 'bypassPermissions'`，不设 `sandbox`、`canUseTool` 和权限规则。
- Codex：`thread/start`、`thread/resume` 传 `sandbox: 'danger-full-access'`，`approvalPolicy: 'never'`，不再定义 `helm` 权限配置档。
- Grok：`GROK_SANDBOX=off`，Helm 不再维护 `~/.grok/sandbox.toml` 里的标记段（已有的标记段不再使用，可以手动删除）。
- DeepSeek：`DSH_PERMISSION_MODE=danger-full-access`；ACP 权限请求一律单次批准，包括 `sandbox_permissions` 提权请求。

保留的是不靠沙箱的部分：环境变量白名单、禁止推送的 git 配置和无效 `GH_TOKEN`、关闭自动记忆、禁用 Grok 子代理和后台工作流、派单结束时的进程清理、helmd 拒绝 Agent 调用会改变后续 Agent 行为的操作（ADR 0016）。这些在无沙箱时都只防误操作，Agent 想绕过就能绕过。工作流约定（调度者改代码交给卡片、执行者不提交不推送）写在提示词里。

## Consequences

- Agent 能读写本机任何文件，包括凭据和其他工作的副本；提示词注入后的 Agent 可以借联网工具把凭据发出去。只在信任所用模型和项目内容的机器上运行 Helm。
- 卡片副本仍是 Agent 的默认工作位置，合并和审核照旧；写到副本外的东西不进入工作分支，也不会被清理。
- 真实冒烟从"副本外写入被拒"改为"副本外写入成功"。

## Considered Options

- **每次派单给一个私有临时目录，`TMPDIR` 指向它**：解决临时文件，但缓存、Docker、仓库外构建目录仍要逐个补。
- **保留凭据禁读，只放开写入**：四家仍各维护一份沙箱配置，DeepSeek 本来就做不到禁读；用户选择不要。
