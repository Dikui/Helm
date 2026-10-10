# 任务 004：实测 Codex CLI 作为编排步骤执行器的行为

## 背景

Helm 计划由 runtime 执行节点内的编排：每个 `agent()` 步骤对应一次独立的 `codex exec`，靠 `--output-schema` 拿结构化结果，靠 `--json` 保存过程，靠 `exec resume <UUID>` 返工和中断恢复。任务 003 的调研只做了离线参数检查，以下行为仍"未核实"。本任务通过**真实运行**补上。

**先读：** `research/workflow-templates.md` 第 1.3 节、第 4 节、第 6.3 节、第 6.5 节。

- 可执行文件：`~/.codex/packages/standalone/current/bin/codex`（版本 codex-cli 0.160.1，不在 PATH 中）
- 本任务在外层 Codex 沙箱内运行（已开放网络，并允许写入 `~/.codex` 以保存内层会话）。内层 codex 处于嵌套的 macOS seatbelt 中：若某个用例因嵌套沙箱无法运行或结果受影响（尤其 T07、T08、T11），如实记录错误输出，结论写"未能确认（嵌套沙箱）"，不要设法绕过沙箱。

## 要做的内容

所有试验在 `research/scratch-004/` 下进行，每个用例一个子目录（内层 codex 的 `-C` 指向该子目录，必要时先 `git init`）。内层运行一律使用 `-m gpt-6-astra -c 'model_reasoning_effort="low"'` 以控制成本；若该模型不可用，改用 `gpt-6.1-sol` 并在报告中说明。提示词保持很短。

每个用例保存原始证据到 `evidence/004/<用例编号>/`：完整命令（`command.txt`）、stdout JSONL、stderr、`-o` 输出、退出码、必要的文件列表或内容。

## 必须有的用例

| 编号 | 内容 | 要回答的问题 |
|---|---|---|
| T01 | `exec --output-schema`，schema 含必填字符串、整数、枚举字段 | `-o` 文件是否为合法 JSON 且符合 schema；JSONL 最后的 agent_message 与 `-o` 是否一致 |
| T02 | schema 为"清单"形状：`items` 数组，每项含 `id`、`status`（枚举：pass / fail / unverifiable / unprocessed）、`evidence`。让模型对 3 个给定条目逐项给结果，连续运行 3 次 | 3 次是否都符合 schema；数组项是否完整 |
| T03 | 不符合 OpenAI strict 要求的 schema（例如缺少 `additionalProperties: false`，或有字段不在 `required` 中）；以及语法错误的 schema 文件 | 分别是什么退出码和错误信息；是在调用模型前还是调用后失败 |
| T04 | `--output-schema` 下让模型同时创建一个文件 | schema 是否限制了模型的动作（预期不限制） |
| T05 | `--json` 事件 | 列出出现的全部事件类型；thread_id 在哪个事件；token 用量在哪个事件、有哪些字段 |
| T06 | 第一轮告诉模型一个暗号；`exec resume <UUID>` 第二轮换一个不同的 schema，要求返回暗号 | 上下文是否保留；第二轮 `-o` 是否按新 schema 输出；resume 后 JSONL 的 thread_id 是否不变 |
| T07 | `-s read-only` 下要求模型写文件 | 是否被阻止；模型如何报告 |
| T08 | 第一轮 `-s workspace-write`；resume 时用 `-c 'sandbox_mode="read-only"'` 要求写文件 | resume 时的沙箱设置是否生效（resume 不支持 `-s`，确认这一点） |
| T09 | 要求模型启动子代理完成一件小事：分别在默认设置和 `--disable multi_agent` 下运行 | 两种情况下是否出现子代理相关事件；禁用后模型如何处理 |
| T10 | 3 个 `codex exec` 并发运行，各自在不同子目录 | 是否全部成功；thread_id 各不相同；会话互不串扰 |
| T11 | 长任务中断：让模型依次执行 5 步，每步向 `log.txt` 追加一行并 `sleep 8`；在第 2~3 步时对 codex 进程发 SIGTERM；另做一次 SIGKILL。然后 `exec resume <UUID>` 要求"继续完成剩余步骤" | 中断时退出码与 JSONL 末尾；会话是否可恢复；恢复后是否重复执行已完成的步骤（看 `log.txt` 是否有重复行） |
| T12 | `--ephemeral` 运行后尝试 resume | 是否失败、错误信息 |
| T13 | 失败情况：不存在的模型名、不存在的 resume UUID | 退出码、JSONL 中的错误事件 |

## 不要做的内容

- 不修改仓库中任何已有文件；不写 Helm 实现代码；不安装任何依赖（校验 JSON 用系统自带的 `python3` 标准库或 `node` 内置能力自行写小脚本，脚本放在 `research/scratch-004/` 下）。
- 内层 codex 的 `-C` 只能指向 `research/scratch-004/` 下的子目录；内层提示词不得要求访问该目录以外的路径、网络或执行有副作用的命令（只允许在子目录内创建文件、`sleep`、`echo`）。
- 不修改 `~/.codex/config.toml`、认证文件或其他全局配置；不删除、不归档任何 Codex 会话（包括本任务创建的会话）。
- 不调用 Codex 以外的外部服务；不发布任何内容。
- 内层运行总次数不超过 30 次。
- 结论只写观察到的事实；观察不到或结果不确定的，写"未能确认"及原因。

## 交付物

1. `research/codex-cli-verification.md`（中文）：
   - 每个用例一行汇总表：编号、问题、结论（是 / 否 / 部分 / 未能确认）、证据路径；
   - 每个用例的简要说明：实际命令、关键输出摘录；
   - 结尾"对 Helm 设计的影响"：逐条对照 `research/workflow-templates.md` 第 6.3 节的建议映射，说明哪些可以直接采用、哪些需要调整；
   - 本任务创建的全部会话 thread_id 列表。
2. `evidence/004/` 下的原始证据。

## 验收标准

- T01–T13 全部执行并有证据文件；每个结论能在证据中找到对应输出。
- 内层运行次数 ≤ 30，报告中写明实际次数。
- `research/scratch-004/` 已删除；没有残留的 codex 或 sleep 进程（报告中附 `ps` 检查结果）。
- `git status` 只新增 `research/codex-cli-verification.md`、`evidence/004/`，以及本任务说明和报告文件。

## 报告要求（中文）

写到 `-o` 指定的报告文件：完成情况、各用例一句话结论、对 Helm 设计影响最大的 3 个发现、未能确认的条目、内层运行次数、交付物路径。
