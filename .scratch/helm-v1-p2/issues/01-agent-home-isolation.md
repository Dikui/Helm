# 01 — 实测：agent CLI 会话记录与用户日常使用隔离

**What to build:** 实测 Helm 拉起的每个 agent CLI 能否改用 Helm 专用主目录，让会话记录、配置和登录与用户在 Helm 之外的使用分开，并给出每家的做法。来源：第一阶段真实冒烟和 2048 端到端在用户的 `~/.claude/projects/` 下留下 36 个会话记录目录，混进用户的 Claude Code 历史。见 [spec](../../helm-v1-p1/spec.md) Out of Scope 第二阶段"会话记录隔离"。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Claude Code：用 `CLAUDE_CONFIG_DIR` 指向专用目录后，会话记录只写在该目录；macOS 钥匙串里的订阅登录是否仍可用，不可用时用户在该目录登录一次后是否正常；Agent SDK 的续跑（按会话 id）是否正常
- [ ] Codex：`CODEX_HOME` 指向专用目录后，app-server 的会话记录、`history.jsonl` 只写在该目录；在该目录登录一次后订阅计费正常；续跑正常
- [ ] Grok、DeepSeek（dsh）：查明主目录位置和改法（环境变量或参数），能否隔离会话记录与登录
- [ ] 每家确认用户自己的主目录在 Helm 运行前后没有新增会话记录，且 Helm 不读取、不复制凭据文件
- [ ] 结论写明每家的做法、需要用户做的一次性登录步骤和不可行项；在沙箱外实测，使用消耗小的模型
