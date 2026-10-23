# 08 — Codex 执行者驱动

**What to build:** 调度者能把卡片派给 Codex 执行者：Codex 在卡片副本里写代码，`helmd` 在派单结束后提交；token、结束方式、续跑、skills、可用性都和 Claude 执行者一样可用，会话记录只写在 Helm 专用主目录。见 [spec](../spec.md) 的"Codex 驱动""主目录与凭据""skills 按模板挂载"。

**Blocked by:** 05 — Claude 专用主目录与模板可用性检查

**Status:** resolved

- [x] 每次派单一个 `codex app-server` 进程；`CODEX_HOME` 用专用主目录，`CODEX_SQLITE_HOME` 放在该派单的数据目录下
- [x] 订阅模板：`helmd` 首次使用时在 `~/.helm/agent-homes/codex/` 建 `auth.json` 软链接指向 `~/.codex/auth.json`，不打开源文件；源文件不存在时模板不可用。API 模板用 `~/.helm/agent-homes/<模板 id>/`，只查 `config.toml` 存在
- [x] `workspace-write`，可写根只有卡片副本，开网络；`approvalPolicy: never`；Helm MCP（带派单令牌）和转发的浏览器工具按会话配置，工具审批 `default_tools_approval_mode: approve`；`NO_PROXY` 含 `127.0.0.1,localhost`
- [x] 结束判定看 `turn/completed`；token 用 `thread/tokenUsage/updated` 的 `total`；额度用完按真实错误消息样本识别（API 余额不足、key 失效同样）；派单记 thread id 和 sqlite 目录，续跑用 `thread/resume`
- [x] fast 映射为 `service_tier="fast"`；模板的 `skills/` 经 `skills/extraRoots/set` 挂上
- [x] 内置模板 `codex-executor`
- [x] 驱动单元测试注入按脚本回放 JSON-RPC 的假 app-server，覆盖结束方式、token、额度用完样本、沙箱和 MCP 配置、`NO_PROXY`、fast、skills 调用
- [x] 主边界测试：Codex 执行派单以"额度用完"结束时调度者被唤醒改派；临时 `HOME` 下软链接建得正确
- [x] 沙箱外真 CLI 冒烟并入 `npm run test:real`：技术验证①执行者部分（"提交结论"和浏览器工具在同一端点工作）、③执行者副本外写入被拦、④专用主目录下不读 `~/.codex/config.toml`、`~/.codex/AGENTS.md`；token 记录、续跑、两个模板 skills 隔离；记下 `initialize` 耗时，超过约 15 秒按 spec 的推翻条件报告

## Comments

已实现 Codex 执行者 app-server 驱动、专用主目录与凭据软链接、token/结束方式映射、thread 续跑与 sqlite 路径记录、模板和 skills 注入，并补齐假 app-server 与主边界测试；真实 Codex 冒烟已并入 test:real，遵照本轮约束未运行，留给调度者在临时 HOME 的沙箱外环境验收。

2026-10-23：发现专用 CODEX_HOME 仍会泄漏读取 ~/.agents/skills 的 user 范围技能，现于每次 app-server 启动挂载模板后、thread 开始或续跑前，按 realpath 比较并通过 skills/config/write 关闭模板外 user 技能、恢复本模板技能，保留 repo/system 范围。

2026-10-23 沙箱外 Codex 真实冒烟通过（gpt-6-luna、low）：同端点浏览器与提交结论、副本外写入被沙箱拒绝、副本内写入、专用主目录不读个人配置、token、续跑同 session、两模板 skills 隔离、`~/.agents/skills` 干扰 skill 未出现；initialize 30–56 ms。登录软链接跑前跑后不变。冒烟改为软链接本机 `~/.codex/auth.json`、复用已装浏览器；ChatGPT 账号下 Codex 不支持 gpt-5.4-mini；Codex 经嵌套 exec 执行的命令不进 app-server 事件流，沙箱拒绝改从 `CODEX_HOME/sessions` 会话记录取证。
