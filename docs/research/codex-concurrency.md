# 成熟产品怎样同时运行多个 Codex 实例

调研日期：2026-10-21（Grok，一手来源）。


Helm 不要让最多 5 个执行者外加调度者各起一个进程去共用 `~/.codex` 里的 SQLite。执行者收成一个 `codex app-server`，里面按 thread 并行；这个进程和调度者进程都继续用用户的 `CODEX_HOME`（登录和 rollout），各自用 `CODEX_SQLITE_HOME` 或 `-c sqlite_home=...` 把数据库挪走。这是 D，执行者内部再用 B。不要选 A 或 C。同一 thread 的两个 turn 不会并行。不同 thread 的 turn 能否在一个进程里同时打模型，源码和文档没有写死，要用本机试验推翻或确认。

## 1. 两个 SQLite 和 rollout

`state_5.sqlite`、`logs_2.sqlite` 这两个文件名在当前 main 是写死的。`CODEX_SQLITE_HOME` 这个环境变量名也在同一处。见 [codex-rs/state/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/lib.rs)、[codex-rs/state/src/sqlite.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/sqlite.rs)。文件名在 [95ca276](https://github.com/openai/codex/commit/95ca27637330722a2cc915499fa9c1204ddfc397) 被收成完整文件名，不再按版本号拼出来再删旧库。

同一 sqlite 目录里还有 `goals_1.sqlite`、`memories_1.sqlite`、`queue_1.sqlite`、`thread_history_1.sqlite`。见 [sqlite.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/sqlite.rs)。

**state_5.sqlite** 是线程索引和运行时状态，不是对话正文。初始 `threads` 表在 [0001_threads.sql](https://github.com/openai/codex/blob/main/codex-rs/state/migrations/0001_threads.sql)：

- `id`，`rollout_path`，`created_at`，`updated_at`
- `source`，`model_provider`，`cwd`，`title`
- `sandbox_policy`，`approval_mode`
- `tokens_used`，`has_user_event`，`archived`，`archived_at`
- `git_sha`，`git_branch`，`git_origin_url`

后续迁移在 [codex-rs/state/migrations/](https://github.com/openai/codex/tree/main/codex-rs/state/migrations)。目录列表本次看到 0001 到至少 0058，页面被截断，没有逐份打开，不列后来新增的全部表。`logs` 曾在这个库里，[0023_drop_logs.sql](https://github.com/openai/codex/blob/main/codex-rs/state/migrations/0023_drop_logs.sql) 把它删掉了。

**logs_2.sqlite** 是诊断日志，默认收到 TRACE。当前表在 [logs_migrations/0002_logs_feedback_log_body.sql](https://github.com/openai/codex/blob/main/codex-rs/state/logs_migrations/0002_logs_feedback_log_body.sql)：`id`，`ts`，`ts_nanos`，`level`，`target`，`feedback_log_body`，`module_path`，`file`，`line`，`thread_id`，`process_uuid`，`estimated_bytes`。写入过滤在 [log_db.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/log_db.rs) 的 `default_filter()`，默认 `LevelFilter::TRACE`。它不是会话记录。移走或重建它，issue 里的报告是线程还在。见 [#27741](https://github.com/openai/codex/issues/27741)、[#24001](https://github.com/openai/codex/issues/24001)。

**会话正文**是 `CODEX_HOME` 下的 JSONL，不在 sqlite 目录。常量是 `sessions` 和 `archived_sessions`。见 [rollout/src/lib.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/lib.rs)。目录形状是 `sessions/YYYY/MM/DD/rollout-<时间>-<thread-id>.jsonl`。见 [rollout/src/list.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/list.rs)。`thread/revert` 之后文件名可以变成 `rollout-<时间>-<thread-id>_<rollout-id>.jsonl`。见 [rollout/src/metadata.rs](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/metadata.rs)。

**`thread/resume` 靠 rollout 文件。** SQLite 只存选中的 `rollout_path`。解析顺序写在 [thread_rollout_resolver.rs](https://github.com/openai/codex/blob/main/codex-rs/thread-store/src/local/thread_rollout_resolver.rs)：

1. 还活着的 writer
2. SQLite 里的路径。SQLite 把线程标成 paginated 时，这条路径说了算，避免扫到 revert 之前的旧文件
3. SQLite 没有行，或标成 legacy 时，在 `CODEX_HOME` 下按文件名找
4. 需要时再找 `archived_sessions`

历史是把 JSONL 重放出来的。见 [rollout_reconstruction.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/rollout_reconstruction.rs)。文件不在时，错误是 `no rollout found for thread id`。见 [#53937](https://github.com/openai/codex/issues/53937)。非 ephemeral 线程的文件要到第一次 `turn/start` 才落盘，`thread/start` 当时还没有。见 [#31158](https://github.com/openai/codex/issues/31158)。

## 2. `sqlite_home`、`CODEX_HOME`、`log_dir`

[环境变量页](https://learn.chatgpt.com/docs/config-file/environment-variables)（本次打开的是 ChatGPT Learn 上的同一页）：

| 名字 | 默认 | 作用 |
| --- | --- | --- |
| `CODEX_HOME` | `~/.codex` | 配置、登录、日志、会话、skills、独立安装包。设了就必须已是目录 |
| `CODEX_SQLITE_HOME` | `CODEX_HOME` | SQLite 放哪。`sqlite_home` 配置优先。相对路径按当前工作目录解析 |

[配置参考](https://developers.openai.com/codex/config-reference) 写：`sqlite_home` 是 agent jobs 和可恢复运行时状态的 SQLite 目录；`log_dir` 是明文日志（例如 `codex-tui.log`），默认 `$CODEX_HOME/log`。`log_dir` 不是 `logs_2.sqlite`。`codex exec` 把消息打在输出里，不写那份 TUI 日志。见环境变量页。

当前加载顺序在 [config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)（页面标注 2026-10-19）：

```text
cfg.sqlite_home
  否则 CODEX_SQLITE_HOME
  否则 CODEX_HOME
```

`cfg` 是已经合并过的配置。合并层次在 [Config basics](https://developers.openai.com/codex/config-basic)：CLI 和 `--config`，然后 profile，然后项目 `.codex/config.toml`，然后用户 `config.toml`。`requirements.toml` 里也有 `sqlite_home` 字段，`apply_to_config` 在这次选择之前运行。它会不会盖过用户或 CLI，本次没有把那个函数读完。

登录文件是 `CODEX_HOME/auth.json`，不是 sqlite 目录。见 [login/src/auth/storage.rs](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/storage.rs) 的 `get_auth_file`。改 `sqlite_home` 之后，`auth.json` 仍从 `CODEX_HOME` 读。钥匙串模式由 `cli_auth_credentials_store` 决定，那也挂在 Codex home 上，不挂在 sqlite home 上。见 [config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs) 里 file / keyring 的注释。

维护者在 [#15410](https://github.com/openai/codex/issues/15410) 写：`CODEX_HOME` 是另一份独立家目录，含独立登录；刷新令牌是一次性的，复制 `auth.json` 不可靠。该 issue 于 2026-03-21 以 not planned 关闭。

分开 `sqlite_home` 之后，rollout 仍在原来的 `CODEX_HOME/sessions`。解析器第 3 步就是扫这个目录。SQLite 没有该行时，按 thread id 找文件这条路还在。[#34994](https://github.com/openai/codex/pull/34994) 写明 Codex home 和 SQLite home 可以分开，启动 backfill、线程列表、分页历史都走配置的 SQLite 目录。本次没有逐行核对：一个全新的 sqlite 目录会不会在启动时把旧 rollout 全部索引进去。因此：已知 thread id 的 `thread/resume`，文件还在原 `sessions` 里时，按上述顺序应当找得到。新库里的线程列表是否立刻完整，本次不写成已证实。

不要把 `sqlite_home` 写进共用的 `~/.codex/config.toml`。那会让桌面、CLI、扩展一起换目录。只给 Helm 的进程设 `CODEX_SQLITE_HOME`，或用 `-c sqlite_home=...`。

[#54599](https://github.com/openai/codex/issues/54599)（2026-10-16，本次检索仍是打开的问题描述）：`CODEX_HOME` 指到别处，而 thread 的 cwd 是 `$HOME` 时，`$HOME/.codex` 会被当成项目配置层。只改 `sqlite_home`、不改 `CODEX_HOME`，不走这条。

## 3. 一个 app-server 里的多个 thread

一条连接可以多次 `thread/start` / `thread/resume`。每个 thread 的 `thread/start` 能单独带 `cwd`、`approvalPolicy`、`sandbox`。`thread/resume` 接受同一类覆盖。`turn/start` 可以按轮再覆盖模型、cwd、sandbox、approval。见 [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) 和 [App Server 文档](https://developers.openai.com/codex/app-server)。`sandbox` 和 `permissions` 不要同时送。

同一 thread 同时只有一个 active turn。这个 thread 已经有 turn 时，再发 `turn/start` 会被 core 并进当前 turn，而不是再开一个并行 turn。见 [#36866](https://github.com/openai/codex/issues/36866)。跟进输入用 `turn/steer`，必须带对得上的 `expectedTurnId`。见同一份 README。

排队是按 thread 的。durable queue 按 thread 做 FIFO；并发处理者不能把同一条排队 turn 派两次。见 [#23618](https://github.com/openai/codex/pull/23618)。这不是「全进程一个队列」。

`thread/start` 从 2026-02 起改到后台任务，不再堵住同一条连接上的其它请求。见 [#13033](https://github.com/openai/codex/pull/13033)。

本次没有找到官方文档或测试写明：两个不同 thread 的模型 turn 在同一个进程里同时在跑，而不是内部再排成一列。协议允许两个 thread 同时处于已启动。这还不是「两个 turn 的时间重叠」已被证实。

VS Code 扩展：问题描述写，一个 extension host 起一个共用的 `codex app-server`，多个 session 挂在它下面。见 [#22832](https://github.com/openai/codex/issues/22832)、[#38537](https://github.com/openai/codex/issues/38537)。两个窗口是两个 app-server。见 [#38629](https://github.com/openai/codex/issues/38629)、[#37856](https://github.com/openai/codex/issues/37856)。扩展和桌面是两个进程，共用一个 `CODEX_HOME`。见 [#41085](https://github.com/openai/codex/issues/41085)。

桌面应用：进程树是一个 `codex app-server` 父进程。见 [#37672](https://github.com/openai/codex/issues/37672)。界面是多 thread。本次没有读到桌面源码。app-server 文档把富客户端例子写成 VS Code 扩展，没有写桌面内部实现。不能把「界面上多个 thread」写成「已证实一个进程里 turn 并行」。

另外，CLI 0.160.0 起，跑 `codex` 会再拉起一个常驻 `codex app-server --listen unix:// --managed-daemon`，和这次命令共用 `CODEX_HOME`。见 [#51961](https://github.com/openai/codex/issues/51961)。Helm 即使只起一个 app-server，旁边仍可能有这个 daemon、桌面和扩展。

## 4. 锁：#32160、#26454 和同类

2026-10-21 打开页面时，这两条都是 **Open**。页面上没有「已在某版本修复」的维护者结论。

| Issue | 页面状态 | 现象 | 报告里的处理 |
| --- | --- | --- | --- |
| [#32160](https://github.com/openai/codex/issues/32160) | Open（2026-07-10 开） | 残留进程占着 SQLite。app-server：`pool timed out while waiting for an open connection`。界面是 initialize handshake timed out | 停掉残留的 codex / chatgpt / node_repl / codex-computer-use |
| [#26454](https://github.com/openai/codex/issues/26454) | Open（2026-06-04 开） | 窗口关了，主进程还在，占着 `state_5.sqlite`、`logs_2.sqlite` 等。桌面打不开 profile | 先杀进程；不行再挪走过大的 `logs_2.sqlite`；再不行才 Windows Reset |

同类，本次没有逐条核对开关：

- [#30105](https://github.com/openai/codex/issues/30105)：macOS 上另一个 app-server 占着 `logs_2.sqlite`，桌面起不来。库本身 `integrity_check` 是 ok。空 `CODEX_HOME`、只放 state、只放 logs，单独都能初始化。
- [#27741](https://github.com/openai/codex/issues/27741)：`logs_2.sqlite` 太大，启动连接池超时。只挪走 logs 就能起来。
- [#21782](https://github.com/openai/codex/issues/21782)：扩展的 app-server 占着 `~/.codex` 的 SQLite，更新后的桌面拒绝启动。报告者写，更早的桌面用共享锁，可以共存。
- [#41085](https://github.com/openai/codex/issues/41085)：桌面和 VS Code 各一个 app-server，同一 `CODEX_HOME`。报告写 IPC 反复重选，WAL 因并发写无法 checkpoint。报告者希望每个 `CODEX_HOME` 只有一个 app-server。这是诉求，不是已实现的行为。
- [#35704](https://github.com/openai/codex/issues/35704)：旧代码在每个池连接上再跑 `PRAGMA journal_mode=WAL`，写的时候再开连接会堵住别的 `thread/resume`。当前 [sqlite.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/sqlite.rs) 已不再把 `journal_mode` 放进每个连接的 connect options。空库才执行一次 `PRAGMA journal_mode=WAL`。`busy_timeout` 是 5 秒，写池 `max_connections` 是 5，另有 `retry_on_busy`。注释写明另一个进程可能随后把库收成 WAL。#35704 是否已关，本次没有打开页面核对。

[migrations.rs](https://github.com/openai/codex/blob/main/codex-rs/state/src/migrations.rs) 写：允许较旧的二进制打开已被较新二进制迁移过的库，因为两者会并行跑。所以源码是按「多个进程共用一个库」写的，不是独占锁设计。用户侧仍然会在启动握手里超时。issue 里的办法是杀掉残留进程，或把过大的 `logs_2.sqlite` 挪走。没有一条维护者回复说「多个 Helm 进程共用 `~/.codex` 是支持的用法」。

同一 thread 还有另一把锁：`~/.codex/thread-writer-locks`。另一个 app-server 还握着 writer 时，新会话会看到 “This is open in another app”。见 [#37856](https://github.com/openai/codex/issues/37856)、[#41849](https://github.com/openai/codex/issues/41849)。这和 SQLite 启动锁不是同一件事。两个进程 resume 同一个 thread id 会撞上它。

## 5. 别的产品

| 产品 | 同时跑多个 Codex 时 | `CODEX_HOME` / `sqlite_home` | 锁 | 来源 |
| --- | --- | --- | --- | --- |
| Todos | 静态分析只看到驱动启动 `codex app-server --listen stdio://`。多个任务是一个进程还是各起一个，未找到 | 未找到 | 未找到 | 本仓库 `.scratch/tasks/19-research/todos-research.txt`，CLI 0.1.67 |
| Conductor | 一个任务一个 workspace（独立 worktree、分支、终端）。自带 Codex 可执行文件，也可以改用本机安装。进程是 app-server 还是 CLI，未找到 | 未找到 | 未找到 | [并行会话](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-codex-sessions)、[Harness](https://www.conductor.build/docs/reference/harnesses) |
| Superset | README 写多个 CLI agent，每个任务一个 git worktree。怎么拉起 Codex，未找到 | 未找到 | 未找到 | [superset-sh/superset](https://github.com/superset-sh/superset) |
| Emdash | 多个 agent，各自一个 git worktree，用本机已安装的 `codex`。spawn 参数未找到。它自己的库是 `emdash.db`，不是 Codex 的库 | 未找到 | 未找到 | [generalaction/emdash](https://github.com/generalaction/emdash) |
| vibe-kanban | 每次执行 spawn 一个 `npx -y @openai/codex@0.124.0 app-server`。多个 workspace 就是多个进程 | 读 `CODEX_HOME`，否则 `~/.codex`。用那里的 `auth.json` 和 `config.toml`。源码片段里没有设置 `sqlite_home` | 未找到 | [codex.rs](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/codex.rs) |
| Nimbalyst | 文档写 6 个以上 Codex / Claude 会话，用本机已登录的 Codex。spawn 方式未找到 | 未找到 | 未找到 | [文档](https://docs.nimbalyst.com/setup-nimbalyst/ai-provider-setup-and-notifications)、[仓库](https://github.com/nimbalyst/nimbalyst) |
| codex-plugin-cc | `spawn("codex", ["app-server"])`，stdio JSON-RPC。多个 job 是否共用这一个进程，本次没有把 companion 的调度读完 | 未找到 | 未找到 | [app-server.mjs 的 issue 引用](https://github.com/openai/codex-plugin-cc/issues/96) |
| Zed codex-acp | 本次没有重新打开适配器源码。既有调研写它 spawn 官方 `codex app-server`。一个 Zed 会话是不是一个进程，未找到 | 未找到 | 未找到 | 未找到本次新的一手页 |
| Codex 桌面 | 一个应用进程树里一个 app-server，界面多个 thread。和 VS Code、CLI 共用默认 `CODEX_HOME` | 2026-06-25 的 [#29953](https://github.com/openai/codex/issues/29953) 记录桌面把 SQLite 放在 `~/.codex/sqlite`，没带上这个环境的子进程会退回 `~/.codex` 再写出一套库。2026-10 的官方文档没有再写这个路径，不能当成仍然如此 | 与扩展、残留进程抢同一套库。见第 4 节 | [#37672](https://github.com/openai/codex/issues/37672)、[#41085](https://github.com/openai/codex/issues/41085)、[#29953](https://github.com/openai/codex/issues/29953) |
| Codex Cloud / GitHub | 未找到它们在用户本机同时起多个 app-server，或改 `CODEX_HOME` / `sqlite_home` 的说明 | 未找到 | 未找到 | 未找到 |

官方客户端自己的做法是：桌面一个 app-server，VS Code 每个 extension host 一个 app-server，两边共用 `CODEX_HOME`。这正是锁 issue 的复现条件。没有一家在本次读到的材料里，为每个任务复制一份登录。

## 6. 给 Helm 的建议

选 **D，执行者用一个 app-server 承载多个 thread（B 的用法）**。

具体是：

- 5 个执行者共用一个 `codex app-server`。每个执行者 `thread/start`，带自己的 `cwd`、`sandbox`、`approvalPolicy`。不要两个执行者 resume 同一个 thread。
- 调度者如果必须常驻，单独再起一个 app-server。
- 两个进程都不要改 `CODEX_HOME`。登录继续用用户现在的 `auth.json` 或钥匙串。
- 两个进程各设一个 sqlite 目录，用环境变量 `CODEX_SQLITE_HOME`，或启动参数 `-c sqlite_home=...`。不要写进 `~/.codex/config.toml`。
- 进程退出要收干净。旁边还可能有用户的桌面、扩展，以及 0.160 起的 managed daemon。

依据：

- 登录和 rollout 都挂在 `CODEX_HOME`，数据库挂在 sqlite home。这是源码里的分界，也是 [#24348](https://github.com/openai/codex/issues/24348)、[#31426](https://github.com/openai/codex/issues/31426) 里已经跑通的分法：共用 auth、config、sessions，SQLite 放到另一目录后，`app-server` 初始化能通过。
- A 正是 #32160、#26454、#30105、#21782 的失败条件。错开启动只能躲开残留进程，躲不开「桌面和 Helm 同时握着同一个 `logs_2.sqlite`」。
- C 被 [#15410](https://github.com/openai/codex/issues/15410) 否定：复制的刷新令牌会在任一侧刷新后失效。另外 [#54599](https://github.com/openai/codex/issues/54599) 会在 cwd 为家目录时把 `~/.codex` 当成项目配置。
- 纯 B、却仍用默认 sqlite 目录，Helm 的那一个进程还是和桌面、扩展抢同一套库。D 把 Helm 的库挪走，桌面启动不再等 Helm 的 `logs_2.sqlite`。
- 5 个进程收成 1 个，Helm 自己不再用 5 把 sqlite 锁。官方扩展也是一个进程里多个 session。

风险：

- 不同 thread 的 turn 是否真并行，还没被官方写明。若内部排队，5 个执行者会串行。
- 一个进程崩溃，5 个执行者一起没。
- rollout 仍写在共用的 `CODEX_HOME/sessions`。不同 thread id 是不同文件。同一 thread 被两个进程打开，会撞 `thread-writer-locks`。
- `auth.json` 仍是一份。多个进程同时刷新，[#30254](https://github.com/openai/codex/issues/30254) 报告过文件被写坏。这是 A/B/D 共有的，C 更差。
- 新 sqlite 目录里的线程列表可能要等 backfill。Helm 应自己记下 `thread.id`，不要靠新库的 `thread/list` 找旧会话。
- 桌面侧边栏会不会看到 Helm 的线程，取决于桌面会不会从 `sessions` 再索引。本次没有证实。
- `logs_2.sqlite` 的 TRACE 写入会落到 Helm 的 sqlite 目录，磁盘写入还在，只是不再堵住用户那份库。

推翻条件：

- 本机试验里，一个 app-server 上两个 thread 的 `item/*` 没有时间重叠，后一个要等前一个 `turn/completed`。那就不要把 5 个执行者塞进一个进程。改成每个执行者一个进程，仍然用 D，每个进程一个 sqlite 目录。不要改回 A，也不要改成 C。
- 分开 `sqlite_home` 之后，用旧 thread id `thread/resume` 得到 `no rollout found`，而文件明明在 `~/.codex/sessions`。D 的续跑假设不成立。
- 只改 `CODEX_SQLITE_HOME` 时 `account/read` 不再是 ChatGPT 登录。说明这份二进制没有从 `CODEX_HOME` 读登录，D 不能用。
- 官方若做成「一个 `CODEX_HOME` 只允许一个 app-server」，即使 sqlite 分开也拒绝第二个进程。那时执行者和调度者必须合成一个进程，或停下用户的桌面和 daemon。

本机实测（本次没有跑二进制；先前调研对本机 `codex` 的 `stat` 是 Operation not permitted）：

1. 看清现在谁占着库：`lsof ~/.codex/state_5.sqlite ~/.codex/logs_2.sqlite ~/.codex/sqlite/*.sqlite`。同时看有没有 `codex app-server` 和 `app-server daemon`。
2. 两个进程、同一套家目录。第二个在第一个 `turn/start` 之后做 `initialize`。若出现 `pool timed out` 或 handshake timeout，A 在这台机器上不成立。
3. 第二个进程只加 `CODEX_SQLITE_HOME=$HOME/.codex-helm-a`，`CODEX_HOME` 不变。`initialize` 应成功。`account/read` 的 `authMode` 应仍是 ChatGPT。`~/.codex/auth.json` 不应被复制。新目录里应出现 `state_5.sqlite` 和 `logs_2.sqlite`，用户原来的那两份不应被换走。
4. 用一个已有的 thread id 对这个新 sqlite 目录 `thread/resume`。成功才说明旧会话找得到。再看新库的 `thread/list` 是否包含它。列表缺失只说明 backfill 不完整，不说明 resume 失败。
5. 一个 app-server 上开两个 thread，cwd 不同，同时 `turn/start` 一个会跑几秒的命令。两边的 `item/started` 都出现在任一 `turn/completed` 之前，B 的并行才成立。同一 thread 上连续两个 `turn/start`，第二个应并进第一个，这是 [#36866](https://github.com/openai/codex/issues/36866) 的行为，不能当成两个执行者。

## 没能确认的

- 两个不同 thread 的 turn 在一个 app-server 进程里是否时间重叠。
- `requirements.toml` 的 `sqlite_home` 是否盖过 CLI `-c`。
- 全新 sqlite 目录启动时会不会把 `CODEX_HOME/sessions` 全部 backfill 进新库。
- 2026-10 的桌面是否仍把 SQLite 放在 `~/.codex/sqlite`。#29953 是 2026-06-25 的报告。
- #35704、#30105、#21782、#41085、#22832 今天是开还是关。只核对了 #32160 和 #26454，两者仍 Open。
- Todos、Conductor、Superset、Emdash、Nimbalyst、codex-plugin-cc 的多 job、Zed、Codex Cloud / GitHub：上表写「未找到」的格子，本次没有对应的源码或文档句子。
