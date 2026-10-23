# 01 — 实测：agent CLI 会话记录与用户日常使用隔离

**What to build:** 实测 Helm 拉起的每个 agent CLI 能否改用 Helm 专用主目录，让会话记录、配置和登录与用户在 Helm 之外的使用分开，并给出每家的做法。来源：第一阶段真实冒烟和 2048 端到端在用户的 `~/.claude/projects/` 下留下 36 个会话记录目录，混进用户的 Claude Code 历史。见 [spec](../../helm-v1-p1/spec.md) Out of Scope 第二阶段"会话记录隔离"。

**Blocked by:** None — can start immediately

**Status:** ready-for-human

- [ ] Claude Code：用 `CLAUDE_CONFIG_DIR` 指向专用目录后，会话记录只写在该目录；macOS 钥匙串里的订阅登录是否仍可用，不可用时用户在该目录登录一次后是否正常；Agent SDK 的续跑（按会话 id）是否正常
- [x] Codex：`CODEX_HOME` 指向专用目录后，app-server 的会话记录、`history.jsonl` 只写在该目录；在该目录登录一次后订阅计费正常；续跑正常
- [x] Grok、DeepSeek（dsh）：查明主目录位置和改法（环境变量或参数），能否隔离会话记录与登录
- [x] 每家确认用户自己的主目录在 Helm 运行前后没有新增会话记录，且 Helm 不读取、不复制凭据文件
- [ ] 结论写明每家的做法、需要用户做的一次性登录步骤和不可行项；在沙箱外实测，使用消耗小的模型

## Answer

2026-10-23 本机沙箱外实测。版本：claude 2.1.300、Agent SDK 0.3.308、codex-cli 0.163.0、grok 1.0.67、dsh 0.2.1-rc.2。被测进程只带 `PATH HOME USER LOGNAME SHELL TMPDIR LANG` 加各家主目录变量，专用目录为 `~/.helm/agent-homes/<cli>/`，工作目录是会话专用的临时目录。每家跑一轮"记住暗号 BLUEFOX"，再换新进程按会话 id 续跑问暗号。脚本是一次性的，放在未提交的 `.scratch/prototype/helm-drivers/home.mjs`。同类工具的做法和各家技术事实见 [agent-login-and-session-records.md](../../../docs/research/agent-login-and-session-records.md)。

| CLI | 主目录变量 | 会话记录 | 登录 | 续跑 |
|---|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` | `projects/<编码 cwd>/<id>.jsonl`、`.claude.json` 都只写在专用目录 | 钥匙串里的订阅登录不沿用，报 `Not logged in · Please run /login`。官方文档写明钥匙串条目按配置目录区分，没有共享开关 | 未测，需用户先在专用目录登录 |
| Codex | `CODEX_HOME` | sqlite、`sessions/`、skills 都只写在专用目录 | 空目录 `requiresOpenaiAuth`。把 `auth.json` 软链接到 `~/.codex/auth.json` 后 `account/read` 为 `chatgpt` / `promax` | 新进程 `thread/resume` 后答对暗号 |
| Grok | `GROK_HOME` | config、`sessions/`、logs 都只写在专用目录 | 空目录时 `authenticate cached_token` 一直不返回，且进程不理 SIGTERM，要 `kill -9`。把 `auth.json` 软链接到 `~/.grok/auth.json` 后认证成功 | 新进程 `session/resume` 后答对暗号 |
| dsh | `DSH_HOME` | 自动生成 `profiles/acp`，会话在 `sessions/<编码 cwd>/` | 空目录时没有账号路线、也没有 API key，第一轮报错。把 `.credentials.yaml` 软链接到 `~/.dsh/.credentials.yaml` 后可选 `deepseek-account` 路线 | 新进程 `session/resume` 后答对暗号 |

- **软链接**：三条链接在跑完后仍是链接，目标文件 inode 和修改时间都没变（本次没有触发令牌刷新）。刷新时是否仍写穿链接，按源码：Codex 文件模式用 `create + write + truncate` 原地写，Grok 有测试断言原子写入穿过软链接并保持链接；dsh 未查。Codex 若改用钥匙串模式（`cli_auth_credentials_store = keyring`），账号键含主目录哈希，链接不起作用。Helm 只建链接、不打开文件，不违反"不读、不存、不转发"。
- **复制不可行**：Codex 刷新令牌会轮换，旧令牌约一小时后失效，复制的两份必有一份坏掉；Orca、Paperclip 都踩过（见调研）。
- **用户主目录**：两轮实测前后，`~/.claude`、`~/.claude.json`、`~/.codex`（含 sqlite）、`~/.grok`、`~/.dsh` 里改动过的文件都不含工作目录路径、暗号或会话 id，`sessions/` 下没有新增条目；唯一命中的是调度者本会话自己的记录。默认目录的 `codex login status` 仍为 `Logged in using ChatGPT`。
- **关掉落盘不可行**：`persistSession: false`、`--no-session-persistence`、`codex exec --ephemeral` 等都会让按会话 id 续跑失效。

**用户一次性步骤**：Codex、Grok、dsh 不用登录，Helm 首次使用时在专用目录建凭据软链接即可。Claude 只能二选一：在专用目录登录一次（`CLAUDE_CONFIG_DIR=~/.helm/agent-homes/claude claude auth login`），或不设 `CLAUDE_CONFIG_DIR`、继续用默认目录、接受记录混进历史。据 [cmux #4255](https://github.com/manaflow-ai/cmux/issues/4255)，不设和设成 `~/.claude` 不一样，后者也会换钥匙串条目（未实测）。

**未完成**：Claude 一项待用户选定；若选登录，补测登录后跑一轮和 SDK 按会话 id 续跑。选定后改 spec 第二阶段"会话记录隔离"一条（现写"用户在这些主目录里自行登录一次"）。
