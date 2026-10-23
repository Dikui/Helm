# 05 — Claude 专用主目录与模板可用性检查

**What to build:** Helm 拉起的 Claude 不再写进用户自己的 `~/.claude`：订阅模板用 `~/.helm/agent-homes/claude/`，API 模板用模板专用目录、读用户写在里面的 `settings.json`。`helmd` 检查每个模板能不能用，不可用的告诉调度者和用户原因，修好不用重启。见 [spec](../spec.md) 的"主目录与凭据""可用性检查"、[ADR 0004](../../../docs/adr/0004-agent-homes-and-cli-owned-credentials.md)。

**Blocked by:** 03 — 模板文件化与按驱动分派

**Status:** resolved

- [x] Claude 驱动按模板主目录设 `CLAUDE_CONFIG_DIR`：订阅模板 `~/.helm/agent-homes/claude/`，API 模板 `~/.helm/agent-homes/<模板 id>/`；API 模板的 `settingSources` 只读主目录里的用户设置，订阅模板仍为 `[]`
- [x] 子进程环境仍按白名单，只多出主目录变量；Helm 不打开主目录里的凭据和配置文件
- [x] 驱动接口新增可用性检查：Claude 订阅模板查专用目录登录状态，API 模板只查主目录和 `settings.json` 存在；不可用时给出原因和用户要运行的命令（如 `CLAUDE_CONFIG_DIR=~/.helm/agent-homes/claude claude auth login`）
- [x] `helmd` 启动时、每次派单和调度轮次用模板前检查；不可用的模板在 `list-agent-templates` 标原因，列进待处理事项并推送"需要用户处理"事件，同一原因只推一次
- [x] 派给不可用模板的派单被拒绝；调度者模板不可用时运行层暂停工作并通知用户；修好后不用重启即恢复
- [x] 主边界测试用假驱动按脚本报不可用，覆盖以上行为；驱动单元测试覆盖主目录变量和 `settingSources`
- [x] 沙箱外 `npm run test:real --cache /private/tmp/helm-npm-cache` 在专用主目录下通过（用户已在该目录登录）；跑完核对用户 `~/.claude/projects/` 没有新增目录

## Comments

已实现 Claude 专用主目录、CLI 登录/配置存在性检查及运行层通知去重、派单拒绝和暂停恢复；补齐假驱动/CLI 替身测试及真实冒烟隔离断言，真实冒烟留给调度者在沙箱外验收（运行层暂停后仍按第一版规则手动恢复工作）。

2026-10-23 沙箱外真实冒烟：browser、claude-executor、claude-coordinator、claude-skills 在专用主目录下全部通过（`test:real` 里的 Codex 两项归 08、09），`~/.claude/projects/` 前后 97 个目录一致。冒烟中发现并修复 `claude auth status` 不认 `--setting-sources`。
