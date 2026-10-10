# Codex CLI 作为编排步骤执行器：实测核验（任务 004）

日期：2026-10-11（Asia/Shanghai）。本机二进制 `/Users/dikui/.codex/packages/standalone/current/bin/codex`，实际版本 `codex-cli 0.160.1`。先读了 workflow-templates.md 第 1.3、4、6.3、6.5 节；本报告仅写本次运行观察，不扩展为其他版本或平台保证。

T01–T13 均已执行尝试并保存证据；实际内层 **30 次 exec/resume 尝试**，包括语法错误和参数拒绝，未超限。原计划 28 次，另 2 次用于原 SIGTERM 轮未实际发出信号后的补测。计数见 [runs.jsonl](../evidence/004/runs.jsonl)和 [integrity-check.json](../evidence/004/integrity-check.json)。另有 7 次不启动会话的离线检查（version 2 次、exec --help 2 次、resume --help 2 次、features list 1 次），不计入内层执行尝试。

所有实际执行用 `-m gpt-6-astra -c 'model_reasoning_effort="low"'`；模型可用，**没有降级**。T13 无效模型是预定负向例外；T09 两个子代理也确认是 gpt-6-astra/low。普通轮次额外固定 approval_policy=never，workspace-write；T07 及 T08 第二轮按用例改变沙箱。保留本机默认功能设置，T09 仅禁用组添加 --disable multi_agent。没有修改全局配置/认证、安装依赖、调用 Codex 以外的服务或发布内容。部分 stderr 有 `failed to refresh available models: request timed out`，原样保存；成功轮次仍 exit 0，这不构成指定模型不可用的证据。

每轮 -C 是 scratch-004 下的 Git 子目录，schema 和 -o 也在该工作目录内，执行后复制到 evidence。每个用例的 command.txt 汇总完整命令；各子目录有 argv.json、prompt.txt、原始 stdout.jsonl/stderr.txt、exit-code.txt、metadata.json、files.json、工作文件快照、output.json 或 output-missing.txt。stdout 流式直接写文件，未删改原始事件；中断码同时保存 Python returncode 与 shell 等价码。JSON 校验仅用 Python 标准库实现本任务所用 type/required/enum/additionalProperties/items 子集，并额外核对清单 ID；校验源码文本在 [reproduction/](../evidence/004/reproduction/)，不声称覆盖任意 JSON Schema。

补充工具证据只读提取本任务已知 UUID 的持久化会话记录，来源和可定位字段一并保存；没有修改、删除或归档任何 Codex 会话。共享 UUID 的 session-tools / parent-session-tools 文件可能包含初轮及 resume 多轮，应按 timestamp/turn_id 区分。

## 用例汇总

“是”表示所列观察得到确认；“否”是预期控制效果未成立；“部分”是局部结果可确认；“未能确认”不等于该能力不存在。T07/T08/T11 的执行效果按要求标为未能确认（嵌套沙箱），T04 的文件创建也同样未确认。

| 编号 | 问题 | 结论 | 观察 | 证据 |
|---|---|---|---|---|
| T01 | 最终 JSON、schema 与最后消息是否一致 | 是 | 合法、必填字段/类型/枚举合规，逐字及 JSON 语义一致。 | [T01](../evidence/004/T01/) |
| T02 | 清单连续三次是否合规且完整 | 是 | 3/3 合规；每次 ID 恰为 A、B、C，无遗漏或重复。 | [T02](../evidence/004/T02/) |
| T03 | strict 不合规及 JSON 语法错误如何失败 | 是 | 两种 strict 错误 exit 1/API 400；语法错误 exit 1/本地解析失败。 | [T03](../evidence/004/T03/) |
| T04 | schema 下是否仍能创建文件 | 部分 | 实际发出 echo 写入工具调用；创建被嵌套 seatbelt 阻止，文件创建未能确认。 | [T04](../evidence/004/T04/) |
| T05 | 事件、thread_id 和 token 字段是否可读取 | 是 | 读取到线程及用量；本用例 4 类顶层事件，全试验合计 7 类。 | [T05](../evidence/004/T05/) |
| T06 | resume 是否保留上下文、采用新 schema 和原 ID | 是 | 暗号保留；第二轮符合新 schema；thread_id 相同。 | [T06](../evidence/004/T06/) |
| T07 | read-only 是否阻止写入 | 未能确认 | 嵌套沙箱启动 shell 失败，不能归因只读权限。 | [T07](../evidence/004/T07/) |
| T08 | resume 沙箱配置是否生效；是否支持 -s | 未能确认 | 记录配置变为 read-only；执行效果受嵌套沙箱遮蔽；子命令后的 -s 被 exit 2 拒绝。 | [T08](../evidence/004/T08/) |
| T09 | 默认与禁用 multi_agent 的子代理行为 | 否 | 两组都真实创建子代理；此环境 --disable multi_agent 未阻止 collaboration.spawn_agent 路径。 | [T09](../evidence/004/T09/) |
| T10 | 三并发是否成功、线程独立且无串扰 | 是 | 3/3 exit 0，标记与结果正确，3 个 thread_id 不同。 | [T10](../evidence/004/T10/) |
| T11 | 两种信号中断、恢复和重复步骤 | 未能确认 | SIGTERM 在 0 步时成功；SIGKILL 尝试被拒；无法达到第 2–3 步或检查重复。 | [T11](../evidence/004/T11/) |
| T12 | ephemeral 会话 resume 是否失败 | 是 | 初轮 exit 0；resume exit 1，no rollout found，stdout 为空。 | [T12](../evidence/004/T12/) |
| T13 | 无效模型与不存在 UUID 的错误表现 | 是 | 均 exit 1；模型有 item.completed（item.type=error）、error/turn.failed，UUID 错误仅在 stderr。 | [T13](../evidence/004/T13/) |

## 各用例实际命令与关键输出

以下为真实 argv 对应的完整 shell 表示，只供复核；scratch 已按验收要求删除，schema/文件内容均已留存到证据。每轮最终输出/错误的完整内容以证据文件为准。

### T01

schema 包含必填 `message:string`、`count:integer`、`verdict:pass|fail`，所有对象设置 `additionalProperties:false`。`-o` 为 `{"message":"ok","count":3,"verdict":"pass"}`。标准库校验没有错误，输出文件不带末尾 LF，与最后一条 `item.completed/agent_message.text` 逐字和解析后都相等。见 [validation.json](../evidence/004/T01/run1/validation.json)。

实际命令：

```sh
# run1
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T01 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T01/run1.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T01/run1.schema.json 'Return message=ok, count=3, verdict=pass. No tools.'
```

逐轮关键输出：

- `run1`：exit **0**；[-o / 缺失记录](../evidence/004/T01/run1/output.json)；[stdout](../evidence/004/T01/run1/stdout.jsonl) / [stderr](../evidence/004/T01/run1/stderr.txt)。

```text
{"message":"ok","count":3,"verdict":"pass"}
```

### T02

三个给定条目是 A「2+2=4」、B「2+2=5」、C「明天下雨，未给数据」。`items` 中每项必填 `id/status/evidence`，status 为 pass/fail/unverifiable/unprocessed。三次**顺序**运行（其他独立用例可同时运行），退出码均 0，schema 校验均通过，ID 集合均恰为 A、B、C，状态分别 pass/fail/unverifiable。完整性是额外核对 ID 集合得到的，schema 本身没有固定数组长度或 ID 枚举。每轮 validation.json 保存类型/枚举/必填项、集合完整性和消息一致性检查。

实际命令：

```sh
# run1
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T02 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T02/run1.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T02/run1.schema.json 'For each item return one result: A: 2+2=4; B: 2+2=5; C: tomorrow rains (no data). Use pass/fail/unverifiable. No tools.'
# run2
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T02 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T02/run2.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T02/run2.schema.json 'For each item return one result: A: 2+2=4; B: 2+2=5; C: tomorrow rains (no data). Use pass/fail/unverifiable. No tools.'
# run3
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T02 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T02/run3.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T02/run3.schema.json 'For each item return one result: A: 2+2=4; B: 2+2=5; C: tomorrow rains (no data). Use pass/fail/unverifiable. No tools.'
```

逐轮关键输出：

- `run1`：exit **0**；[-o / 缺失记录](../evidence/004/T02/run1/output.json)；[stdout](../evidence/004/T02/run1/stdout.jsonl) / [stderr](../evidence/004/T02/run1/stderr.txt)。

```text
{"items":[{"id":"A","status":"pass","evidence":"2+2=4."},{"id":"B","status":"fail","evidence":"2+2=4, not 5."},{"id":"C","status":"unverifiable","evidence":"No weather data provided."}]}
```

- `run2`：exit **0**；[-o / 缺失记录](../evidence/004/T02/run2/output.json)；[stdout](../evidence/004/T02/run2/stdout.jsonl) / [stderr](../evidence/004/T02/run2/stderr.txt)。

```text
{"items":[{"id":"A","status":"pass","evidence":"2+2=4."},{"id":"B","status":"fail","evidence":"2+2=4, not 5."},{"id":"C","status":"unverifiable","evidence":"No weather data provided."}]}
```

- `run3`：exit **0**；[-o / 缺失记录](../evidence/004/T02/run3/output.json)；[stdout](../evidence/004/T02/run3/stdout.jsonl) / [stderr](../evidence/004/T02/run3/stderr.txt)。

```text
{"items":[{"id":"A","status":"pass","evidence":"2+2=4."},{"id":"B","status":"fail","evidence":"2+2=4, not 5."},{"id":"C","status":"unverifiable","evidence":"No weather data provided."}]}
```

### T03

共三种输入：①缺少 `additionalProperties:false`；②properties 中有 optional，但 required 没有 optional；③文件内容为 `{"type":"object",`。前两种退出码 1，已有 thread.started/turn.started，随后 error 和 turn.failed；错误对象 `status:400`、`code:invalid_json_schema`、`param:text.format.schema`。关键文本分别为 `schema.additionalProperties ... required ... false when strict is true` 和 `schema.required ... include every key ... Missing 'optional'`。这证明本地 JSON 解析通过后请求被服务端 schema 校验拒绝，没有观察到 agent_message 或用量；不能把 turn.started 当成模型已生成。语法错误退出码 1、stdout 空，stderr 为 `is not valid JSON: EOF while parsing a value at line 1 column 17`，约 0.1 秒就结束，属于模型请求前的本地读取/解析失败。三轮均没有 -o 文件。

实际命令：

```sh
# missing-additional
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T03 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T03/missing-additional.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T03/missing-additional.schema.json 'Return value=ok. No tools.'
# missing-required
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T03 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T03/missing-required.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T03/missing-required.schema.json 'Return value=ok. No tools.'
# syntax-error
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T03 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T03/syntax-error.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T03/syntax-error.schema.json 'Return value=ok. No tools.'
```

逐轮关键输出：

- `missing-additional`：exit **1**；[-o / 缺失记录](../evidence/004/T03/missing-additional/output-missing.txt)；[stdout](../evidence/004/T03/missing-additional/stdout.jsonl) / [stderr](../evidence/004/T03/missing-additional/stderr.txt)。

```text
{"type":"error","error":{"message":"Invalid schema for response_format 'codex_output_schema': 'schema.additionalProperties' is required to be supplied and to be false when strict is true.","type":"invalid_request_error","param":"text.format.schema","code":"invalid_json_schema"},"status":400}
```

- `missing-required`：exit **1**；[-o / 缺失记录](../evidence/004/T03/missing-required/output-missing.txt)；[stdout](../evidence/004/T03/missing-required/stdout.jsonl) / [stderr](../evidence/004/T03/missing-required/stderr.txt)。

```text
{"type":"error","error":{"message":"Invalid schema for response_format 'codex_output_schema': 'schema.required' is required to include every key in properties. Missing 'optional'.","type":"invalid_request_error","param":"text.format.schema","code":"invalid_json_schema"},"status":400}
```

- `syntax-error`：exit **1**；[-o / 缺失记录](../evidence/004/T03/syntax-error/output-missing.txt)；[stdout](../evidence/004/T03/syntax-error/stdout.jsonl) / [stderr](../evidence/004/T03/syntax-error/stderr.txt)。

```text
Reading additional input from stdin...
Output schema file /Users/dikui/Project/Helm/research/scratch-004/T03/syntax-error.schema.json is not valid JSON: EOF while parsing a value at line 1 column 17
```

### T04

最终 JSON 合规，但 `created:false`，made.txt 不存在。会话工具原始记录明确有 `tools.exec_command({cmd:"echo hello > made.txt",...})`，其结果 `exit_code:71`、`sandbox-exec: sandbox_apply: Operation not permitted`。因此能确认 output-schema 没有禁止这次**工具调用尝试**；文件成功创建及完整动作效果**未能确认（嵌套沙箱）**。不能把失败归因 schema。本次 JSONL 中先有普通文字 agent_message，再有符合 schema 的最后消息，说明输出读取必须取最后消息。实际工具调用/结果见 [session-tools.jsonl](../evidence/004/T04/run1/session-tools.jsonl)，CLI stdout 没有 command_execution 事件。

实际命令：

```sh
# run1
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T04 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T04/run1.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T04/run1.schema.json 'Only this cwd; no network. Create made.txt containing hello using echo. Report actual result.'
```

逐轮关键输出：

- `run1`：exit **0**；[-o / 缺失记录](../evidence/004/T04/run1/output.json)；[stdout](../evidence/004/T04/run1/stdout.jsonl) / [stderr](../evidence/004/T04/run1/stderr.txt)。

```text
{"created":false,"detail":"The echo command failed: sandbox-exec: sandbox_apply: Operation not permitted. Could not create or verify made.txt."}
```

### T05

本用例实际出现 `thread.started`、`turn.started`、`item.completed`、`turn.completed`；item.type 为 agent_message。整个 T01–T13 出现的**全部顶层类型**是 `error`、`item.completed`、`item.started`、`thread.started`、`turn.completed`、`turn.failed`、`turn.started`；全部 item.type 是 `agent_message`、`collab_tool_call`、`error`。没有观察到 command_execution、item.updated 等其他类型，不能据此断言 CLI 不支持它们。

thread_id 在 `thread.started.thread_id`；T09 的协作条目另有 sender_thread_id。token 用量在 `turn.completed.usage`，本用例为 `{"input_tokens":28868,"cached_input_tokens":19456,"cache_write_input_tokens":0,"output_tokens":83,"reasoning_output_tokens":0}`，共 5 个字段。保存的是原始数值，没有据此推算账单或子代理用量。echo 实际因 seatbelt 启动失败，CLI 仍 exit 0/turn.completed；工具结果只在本次会话摘录中取到。全部事件联合清单与逐轮用量见 [summary.json](../evidence/004/summary.json)。

实际命令：

```sh
# run1
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T05 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T05/run1.output.json 'Only this cwd; no network. Run echo event-probe, then reply done.'
```

逐轮关键输出：

- `run1`：exit **0**；[-o / 缺失记录](../evidence/004/T05/run1/output.json)；[stdout](../evidence/004/T05/run1/stdout.jsonl) / [stderr](../evidence/004/T05/run1/stderr.txt)。

```text
Couldn’t run the command: sandbox denied execution.
```

### T06

第一轮 schema 只有 `ack:string`，告知暗号 ORCHID-004-71；第二轮没有再次给出暗号，schema 改为必填 `secret:string`、`remembered:boolean`。resume 返回 `{"secret":"ORCHID-004-71","remembered":true}`，新 schema 校验通过；两轮 `thread.started.thread_id` 都为 `01a12767-dc85-7490-bb99-39ec1df59cc3`，退出码均 0。能确认本次会话上下文续接与 schema 替换，未测试上下文截断、压缩或不同执行者复用。

实际命令：

```sh
# initial
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T06 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T06/initial.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T06/initial.schema.json 'Remember secret ORCHID-004-71. Return ack=stored. No tools.'
# resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T06 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write resume 01a12767-dc85-7490-bb99-39ec1df59cc3 --json -o /Users/dikui/Project/Helm/research/scratch-004/T06/resume.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T06/resume.schema.json 'Return the secret from our first turn and remembered=true. No tools.'
```

逐轮关键输出：

- `initial`：exit **0**；[-o / 缺失记录](../evidence/004/T06/initial/output.json)；[stdout](../evidence/004/T06/initial/stdout.jsonl) / [stderr](../evidence/004/T06/initial/stderr.txt)。

```text
{"ack":"stored"}
```

- `resume`：exit **0**；[-o / 缺失记录](../evidence/004/T06/resume/output.json)；[stdout](../evidence/004/T06/resume/stdout.jsonl) / [stderr](../evidence/004/T06/resume/stderr.txt)。

```text
{"secret":"ORCHID-004-71","remembered":true}
```

### T07

提示要求只经 shell 尝试一次 `echo blocked > forbidden.txt`、不采用替代工具。模型返回 `created:false`，报告 shell exit 71；文件没有创建。原始工具结果同样为 `sandbox-exec: sandbox_apply: Operation not permitted`。该错误也在 workspace-write 下出现，不能据此确认 read-only 的写保护效果。结论为**未能确认（嵌套沙箱）**。CLI 本身仍 exit 0、最终 JSON 合规。

实际命令：

```sh
# run1
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T07 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s read-only --json -o /Users/dikui/Project/Helm/research/scratch-004/T07/run1.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T07/run1.schema.json 'Only this cwd; no network. Attempt echo blocked > forbidden.txt via shell once. Report actual result; no alternative tools.'
```

逐轮关键输出：

- `run1`：exit **0**；[-o / 缺失记录](../evidence/004/T07/run1/output.json)；[stdout](../evidence/004/T07/run1/stdout.jsonl) / [stderr](../evidence/004/T07/run1/stderr.txt)。

```text
{"created":false,"detail":"Attempted once. Shell execution failed with exit code 71: sandbox-exec: sandbox_apply: Operation not permitted"}
```

### T08

第一轮 -s workspace-write，第二轮将 `-c 'sandbox_mode="read-only"'` 放在 resume 子命令参数中。只读提取的 turn_context 分别记录 `sandbox_policy.type:workspace-write` 和 `sandbox_policy.type:read-only`，见 [recorded-turn-settings.json](../evidence/004/T08/recorded-turn-settings.json)；这证明配置被接受并记入该轮，不能证明真实执行限制已强制生效。两轮写入均因 seatbelt exit 71 失败，initial.txt 和 after-resume.txt 均未创建，CLI 两轮均 exit 0。执行权限效果为**未能确认（嵌套沙箱）**。

另一次明确把 `-s read-only` 放在 `exec resume <UUID>` 之后，退出码 **2**，stdout 空，stderr `unexpected argument '-s' found`。resume --help 也没有 -s；但 exec 顶层的 -s 可以放在 resume **之前**（T06 实际这样执行），不能误称整条 resume 调用不能带沙箱设置。

实际命令：

```sh
# initial
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T08 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T08/initial.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T08/initial.schema.json 'Only this cwd; no network. Create initial.txt containing first using echo. Report actual result.'
# resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T08 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' resume 01a12769-0894-76c2-8a48-ad8f13db7e9e --json -o /Users/dikui/Project/Helm/research/scratch-004/T08/resume.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T08/resume.schema.json -c 'sandbox_mode="read-only"' 'Only this cwd; no network. Attempt echo second > after-resume.txt via shell once. Report actual result; no alternative tools.'
# resume-s-rejected
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T08 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' resume 01a12769-0894-76c2-8a48-ad8f13db7e9e --json -o /Users/dikui/Project/Helm/research/scratch-004/T08/resume-s-rejected.output.json -s read-only 'No tools. Reply ok.'
```

逐轮关键输出：

- `initial`：exit **0**；[-o / 缺失记录](../evidence/004/T08/initial/output.json)；[stdout](../evidence/004/T08/initial/stdout.jsonl) / [stderr](../evidence/004/T08/initial/stderr.txt)。

```text
{"created":false,"detail":"The echo command failed with exit code 71: sandbox-exec: sandbox_apply: Operation not permitted. initial.txt was not created; verification was also blocked."}
```

- `resume`：exit **0**；[-o / 缺失记录](../evidence/004/T08/resume/output.json)；[stdout](../evidence/004/T08/resume/stdout.jsonl) / [stderr](../evidence/004/T08/resume/stderr.txt)。

```text
{"created":false,"detail":"Attempted once. Shell failed with exit code 71: sandbox-exec: sandbox_apply: Operation not permitted. No alternative tools used."}
```

- `resume-s-rejected`：exit **2**；[-o / 缺失记录](../evidence/004/T08/resume-s-rejected/output-missing.txt)；[stdout](../evidence/004/T08/resume-s-rejected/stdout.jsonl) / [stderr](../evidence/004/T08/resume-s-rejected/stderr.txt)。

```text
error: unexpected argument '-s' found

  tip: to pass '-s' as a value, use '-- -s'

Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]

For more information, try '--help'.
```

### T09

默认设置与 `--disable multi_agent` 两轮均 exit 0，均出现 `item.started/item.completed` 的 `collab_tool_call(tool:wait)`，但 `receiver_thread_ids:[]`、`agents_states:{}`，stdout 没有 spawn 或子线程 UUID。两轮模型均称实际创建了子代理并得到 5。

为避免只采信模型自述，只读提取各自本次 parent rollout：两组都实际调用 `collaboration.spawn_agent`，都有 `SubAgentActivity` 的 started/completed 记录；相应 child rollout 的最终答案是 5。默认子 UUID `01a12765-f438-7582-9c0d-52872c124dff`，禁用组子 UUID `01a12766-a0a4-72f1-a439-4f583fa8ff53`。两个 child 的 turn_context 都是 gpt-6-astra/low，没有继续 spawn。见两组 [原始父工具片段](../evidence/004/T09/default/rollout-agent-fragments.jsonl)、[禁用组片段](../evidence/004/T09/disabled/rollout-agent-fragments.jsonl)及 [child inventory](../evidence/004/T09/child-session-inventory.json)。

结论是此版本/本环境的该 collaboration 路径**没有被 --disable multi_agent 阻止**，禁用后模型仍通过子代理完成请求。没有实测其他平台/提供方，也没有确定该开关失效的原因。仅凭 CLI JSONL 不能准确枚举本次子线程，不能推断父 usage 是否包括子用量。

实际命令：

```sh
# default
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T09/default -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T09/default/default.output.json 'In the current working directory context, start one sub-agent to calculate 2+3 and return 5. Use no file, shell, or network tools. Report whether you actually started a sub-agent and the result.'
# disabled
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T09/disabled -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --disable multi_agent --json -o /Users/dikui/Project/Helm/research/scratch-004/T09/disabled/disabled.output.json 'In the current working directory context, start one sub-agent to calculate 2+3 and return 5. Use no file, shell, or network tools. Report whether you actually started a sub-agent and the result.'
```

逐轮关键输出：

- `default`：exit **0**；[-o / 缺失记录](../evidence/004/T09/default/output.json)；[stdout](../evidence/004/T09/default/stdout.jsonl) / [stderr](../evidence/004/T09/default/stderr.txt)。

```text
I actually started one sub-agent. It returned **5** for 2 + 3. No file, shell, or network tools were used.
```

- `disabled`：exit **0**；[-o / 缺失记录](../evidence/004/T09/disabled/output.json)；[stdout](../evidence/004/T09/disabled/stdout.jsonl) / [stderr](../evidence/004/T09/disabled/stderr.txt)。

```text
I actually started one sub-agent. It returned **5** for 2 + 3. No file, shell, or network tools were used.
```

### T10

ThreadPoolExecutor 同时启动 3 个独立 exec，-C 各自指向 T10/a、T10/b、T10/c，输入标记和算式不同。三份结果分别为 `{"marker":"PAR-A-004","answer":5}`、`{"marker":"PAR-B-004","answer":7}`、`{"marker":"PAR-C-004","answer":9}`，全 exit 0、schema 合规且符合各自预期，线程 UUID 不同。本次没有观察到上下文串扰。整批约 22.55 秒；ledger 与 elapsed 推算的三方共同重叠约 22.19 秒，该数值是进程区间估计而非 ps 采样。见 [concurrency.json](../evidence/004/T10/concurrency.json)。这没有测试共享目录写冲突或高并发资源上限。

实际命令：

```sh
# c
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T10/c -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T10/c/c.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T10/c/c.schema.json 'No tools. Return marker PAR-C-004 and answer to 4+5.'
# b
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T10/b -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T10/b/b.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T10/b/b.schema.json 'No tools. Return marker PAR-B-004 and answer to 3+4.'
# a
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T10/a -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T10/a/a.output.json --output-schema /Users/dikui/Project/Helm/research/scratch-004/T10/a/a.schema.json 'No tools. Return marker PAR-A-004 and answer to 2+3.'
```

逐轮关键输出：

- `c`：exit **0**；[-o / 缺失记录](../evidence/004/T10/c/output.json)；[stdout](../evidence/004/T10/c/stdout.jsonl) / [stderr](../evidence/004/T10/c/stderr.txt)。

```text
{"marker":"PAR-C-004","answer":9}
```

- `b`：exit **0**；[-o / 缺失记录](../evidence/004/T10/b/output.json)；[stdout](../evidence/004/T10/b/stdout.jsonl) / [stderr](../evidence/004/T10/b/stderr.txt)。

```text
{"marker":"PAR-B-004","answer":7}
```

- `a`：exit **0**；[-o / 缺失记录](../evidence/004/T10/a/output.json)；[stdout](../evidence/004/T10/a/stdout.jsonl) / [stderr](../evidence/004/T10/a/stderr.txt)。

```text
{"marker":"PAR-A-004","answer":5}
```

### T11

共 6 次调用：原 SIGTERM/恢复、原 SIGKILL/恢复，加一次 SIGTERM 重试/恢复。所有预定写入/sleep 都只在各自子目录；第 1 步实际工具命令为 `echo step-1 >> log.txt && sleep 8`。shell 启动报 seatbelt exit 71，日志未创建，无法到指定第 2–3 步。因此整体是**未能确认（嵌套沙箱）**，尤其无法核实已完成步骤是否重复。

原 term-interrupted 未捕捉到 CLI 中的工具失败事件，因此没发 SIGTERM，自然 exit 0；原 kill-interrupted 的外层辅助监控尝试 `os.kill(65742,SIGKILL)`，被 `PermissionError(1,'Operation not permitted')` 拒绝，`signal_sent:false`，进程自然 exit 0。它们的 JSONL 末尾均是 turn.completed；不能把它们记为 exit 143/137 或成功中断。相应 resume 均保留 ID，但继续检查日志仍被 seatbelt 拒绝。

补测 term-retry-interrupted 在 thread.started 后约 10 秒、日志 **0 行**时，由创建它的同一父进程发 SIGTERM 成功：Python returncode **-15**，等价 shell exit **143**。发送时没有 turn.completed；stdout 原始末行是 `item.completed` 的准备执行 agent_message，没有 turn.completed/turn.failed，-o 文件缺失，末行是完整 JSON。用 UUID `01a12768-a67c-71a3-a902-7a789270b687` resume 得到 exit 0、同一个 thread_id，仍保留原任务上下文，随后因读取日志 shell exit 71 停止。

这仅确认**零步骤时 SIGTERM 会话可以继续对话**，没有确认第 2–3 步时的中断语义、SIGKILL 恢复或去重。恢复提示还显式要求按日志跳过已完成项，即使将来观察到无重复，也不能解释为 CLI 自动去重。原始信号记录、各轮工具与 stdout 末尾、日志前后及补测理由见 [observations.md](../evidence/004/T11/observations.md)和 [all-results.json](../evidence/004/T11/all-results.json)。

实际命令：

```sh
# term-interrupted
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/term -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/term/term-interrupted.output.json '仅当前工作目录，不访问网络。依次做 1..5：每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8。遇错误立即停止并报告，不绕过限制。'
# term-resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/term -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -c 'sandbox_mode="workspace-write"' resume 01a12766-6802-7d71-ad80-04c347b6848a --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/term/term-resume.output.json '继续完成剩余步骤。每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8；仅当前工作目录，不访问网络。根据日志跳过已完成项，遇错误停止并报告，不绕过限制。'
# kill-interrupted
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/kill -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/kill/kill-interrupted.output.json '仅当前工作目录，不访问网络。依次做 1..5：每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8。遇错误立即停止并报告，不绕过限制。'
# kill-resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/kill -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -c 'sandbox_mode="workspace-write"' resume 01a12767-6bbe-7332-ac5d-df6d792735ab --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/kill/kill-resume.output.json '继续完成剩余步骤。每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8；仅当前工作目录，不访问网络。根据日志跳过已完成项，遇错误停止并报告，不绕过限制。'
# term-retry-interrupted
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/term-retry -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/term-retry/term-retry-interrupted.output.json '仅当前工作目录，不访问网络。依次做 1..5：每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8。遇错误立即停止并报告，不绕过限制。'
# term-retry-resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T11/term-retry -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -c 'sandbox_mode="workspace-write"' resume 01a12768-a67c-71a3-a902-7a789270b687 --json -o /Users/dikui/Project/Helm/research/scratch-004/T11/term-retry/term-retry-resume.output.json '继续完成剩余步骤。每步独立 shell 调用 echo step-N >> log.txt 后 sleep 8；仅当前工作目录，不访问网络。根据日志跳过已完成项，遇错误停止并报告，不绕过限制。'
```

逐轮关键输出：

- `term-interrupted`：exit **0**；[-o / 缺失记录](../evidence/004/T11/term-interrupted/output.json)；[stdout](../evidence/004/T11/term-interrupted/stdout.jsonl) / [stderr](../evidence/004/T11/term-interrupted/stderr.txt)。

```text
第 1 步遇错，已立即停止，未执行第 2–5 步。

错误：`sandbox-exec: sandbox_apply: Operation not permitted`（退出码 71）。shell 未能启动，未追加日志；未尝试绕过限制。
```

- `term-resume`：exit **0**；[-o / 缺失记录](../evidence/004/T11/term-resume/output.json)；[stdout](../evidence/004/T11/term-resume/stdout.jsonl) / [stderr](../evidence/004/T11/term-resume/stderr.txt)。

```text
读取 log.txt 时失败，已立即停止。

错误：`sandbox-exec: sandbox_apply: Operation not permitted`（退出码 71）。

无法确认已完成项，未执行任何步骤，未访问网络或绕过限制。
```

- `kill-interrupted`：exit **0**；[-o / 缺失记录](../evidence/004/T11/kill-interrupted/output.json)；[stdout](../evidence/004/T11/kill-interrupted/stdout.jsonl) / [stderr](../evidence/004/T11/kill-interrupted/stderr.txt)。

```text
第 1 步 shell 调用失败：`sandbox-exec: sandbox_apply: Operation not permitted`（退出码 71）。

已立即停止，未执行第 2–5 步，未绕过限制或访问网络。
```

- `kill-resume`：exit **0**；[-o / 缺失记录](../evidence/004/T11/kill-resume/output.json)；[stdout](../evidence/004/T11/kill-resume/stdout.jsonl) / [stderr](../evidence/004/T11/kill-resume/stderr.txt)。

```text
读取日志的 shell 调用失败：`sandbox-exec: sandbox_apply: Operation not permitted`（退出码 71）。

已立即停止，无法确认已完成项，未执行任何步骤，未绕过限制或访问网络。
```

- `term-retry-interrupted`：exit **143**；[-o / 缺失记录](../evidence/004/T11/term-retry-interrupted/output-missing.txt)；[stdout](../evidence/004/T11/term-retry-interrupted/stdout.jsonl) / [stderr](../evidence/004/T11/term-retry-interrupted/stderr.txt)。

```text
我会仅在当前工作目录操作，不访问网络，按顺序执行 5 次独立 shell 调用；遇到错误立即停止并报告。

```

- `term-retry-resume`：exit **0**；[-o / 缺失记录](../evidence/004/T11/term-retry-resume/output.json)；[stdout](../evidence/004/T11/term-retry-resume/stdout.jsonl) / [stderr](../evidence/004/T11/term-retry-resume/stderr.txt)。

```text
检查日志时即出错：`sandbox-exec: sandbox_apply: Operation not permitted`（退出码 71）。

已立即停止，未执行任何剩余步骤，也未绕过限制。
```

### T12

ephemeral 初轮 exit 0、有 thread.started，-o 为 `ephemeral-marker-004`。使用该 UUID resume 退出码 **1**，stdout **0 字节**，没有 error/turn.failed 事件；stderr `Error: thread/resume: thread/resume failed: no rollout found for thread id 01a1276a-0db5-7ae1-8d8c-02c8368582d9 (code -32600)`。没有新的 thread.started，没有 -o。能确认这个 ephemeral UUID 无法恢复。

实际命令：

```sh
# ephemeral
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T12 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --ephemeral --json -o /Users/dikui/Project/Helm/research/scratch-004/T12/ephemeral.output.json 'Return ephemeral-marker-004. No tools.'
# resume
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T12 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write resume 01a1276a-0db5-7ae1-8d8c-02c8368582d9 --json -o /Users/dikui/Project/Helm/research/scratch-004/T12/resume.output.json 'Repeat our prior marker. If absent reply NO_CONTEXT. No tools.'
```

逐轮关键输出：

- `ephemeral`：exit **0**；[-o / 缺失记录](../evidence/004/T12/ephemeral/output.json)；[stdout](../evidence/004/T12/ephemeral/stdout.jsonl) / [stderr](../evidence/004/T12/ephemeral/stderr.txt)。

```text
ephemeral-marker-004
```

- `resume`：exit **1**；[-o / 缺失记录](../evidence/004/T12/resume/output-missing.txt)；[stdout](../evidence/004/T12/resume/stdout.jsonl) / [stderr](../evidence/004/T12/resume/stderr.txt)。

```text
Error: thread/resume: thread/resume failed: no rollout found for thread id 01a1276a-0db5-7ae1-8d8c-02c8368582d9 (code -32600)
```

### T13

不存在模型 helm-nonexistent-model-004 是本任务唯一故意违反模型名的负向输入，其余执行与两个 child 都用指定 gpt-6-astra。模型用例 exit **1**，有 thread.started，随后 `item.completed(item.type:error)` 的 `Model metadata ... not found. Defaulting to fallback metadata` 警告，再有顶层 `error(status:400)` 和 `turn.failed`，错误为该模型 `is not supported when using Codex with a ChatGPT account`。metadata fallback 不等于成功改用别的推理模型，没有最终消息、usage 或 -o。

不存在 UUID `00000000-0000-0000-0000-000000000000` 的 resume exit **1**，stdout **0 字节**，没有 JSONL 错误事件；stderr `no rollout found ... (code -32600)`，没有新建线程或 -o。由此应同时读取进程退出状态与 stderr，不能依赖 error/turn.failed 事件一定出现。

实际命令：

```sh
# bad-model
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T13 -m helm-nonexistent-model-004 -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write --json -o /Users/dikui/Project/Helm/research/scratch-004/T13/bad-model.output.json 'Reply ok. No tools.'
# bad-uuid
/Users/dikui/.codex/packages/standalone/current/bin/codex exec -C /Users/dikui/Project/Helm/research/scratch-004/T13 -m gpt-6-astra -c 'model_reasoning_effort="low"' -c 'approval_policy="never"' -s workspace-write resume 00000000-0000-0000-0000-000000000000 --json -o /Users/dikui/Project/Helm/research/scratch-004/T13/bad-uuid.output.json 'Reply NONEXISTENT_SESSION_PROBE. No tools.'
```

逐轮关键输出：

- `bad-model`：exit **1**；[-o / 缺失记录](../evidence/004/T13/bad-model/output-missing.txt)；[stdout](../evidence/004/T13/bad-model/stdout.jsonl) / [stderr](../evidence/004/T13/bad-model/stderr.txt)。

```text
{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'helm-nonexistent-model-004' model is not supported when using Codex with a ChatGPT account."}}
```

- `bad-uuid`：exit **1**；[-o / 缺失记录](../evidence/004/T13/bad-uuid/output-missing.txt)；[stdout](../evidence/004/T13/bad-uuid/stdout.jsonl) / [stderr](../evidence/004/T13/bad-uuid/stderr.txt)。

```text
Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-0000-0000-0000-000000000000 (code -32600)
```

## 全部新建会话 thread_id

共 **23 个不同 thread_id**：21 个从本次 stdout 的 thread.started 取得，另 2 个子线程由本任务父子会话记录确认。包含 ephemeral、无效模型创建的线程；各次 resume 复用原线程，查找失败未创建新线程。完整机器清单见 [threads.json](../evidence/004/threads.json)。

| thread_id | 来源 |
|---|---|
| `01a12764-910a-79d1-9d76-adfa81f7e48d` | T01/run1 |
| `01a12765-34a4-7482-ae6a-410a2daee222` | T02/run1 |
| `01a12765-8b40-7423-90ff-d5b3cc39c930` | T02/run2 |
| `01a12765-d498-73b3-8b65-352f20c1b0b5` | T09/default |
| `01a12765-e1d5-7a61-bc19-459e53d2f3f2` | T02/run3 |
| `01a12766-3855-7ca0-b3ce-cebc6b4a200a` | T03/missing-additional |
| `01a12766-6802-7d71-ad80-04c347b6848a` | T11/term-interrupted, T11/term-resume |
| `01a12766-81aa-78d0-85d7-6de20454f39f` | T09/disabled |
| `01a12766-86df-7751-b7bf-12b28d24f776` | T03/missing-required |
| `01a12766-d61f-7c33-a3f3-b95ccd45c4e1` | T04/run1 |
| `01a12767-2e5b-72d1-b107-7999ab2fa551` | T10/c |
| `01a12767-2e59-7132-b7b6-9951c55fd63f` | T10/b |
| `01a12767-2e56-7021-8d2e-00ec18661fc3` | T10/a |
| `01a12767-5e67-79d3-9822-17f3dde959bf` | T05/run1 |
| `01a12767-6bbe-7332-ac5d-df6d792735ab` | T11/kill-interrupted, T11/kill-resume |
| `01a12767-dc85-7490-bb99-39ec1df59cc3` | T06/initial, T06/resume |
| `01a12768-8990-7ee1-bded-6f3ea85968f6` | T07/run1 |
| `01a12768-a67c-71a3-a902-7a789270b687` | T11/term-retry-interrupted, T11/term-retry-resume |
| `01a12769-0894-76c2-8a48-ad8f13db7e9e` | T08/initial, T08/resume |
| `01a1276a-0db5-7ae1-8d8c-02c8368582d9` | T12/ephemeral |
| `01a1276a-6bb2-7cd1-a46f-78c5a7bf6e0c` | T13/bad-model |
| `01a12765-f438-7582-9c0d-52872c124dff` | T09/child |
| `01a12766-a0a4-72f1-a439-4f583fa8ff53` | T09/child |

## 清理、进程与变更范围

全部 30 个已记录内层 Codex PID/PGID 用 os.kill(pid,0)/os.killpg(pgid,0) 核对均不存在，见 [process-check-final.json](../evidence/004/process-check-final.json)。所有 shell 在启动阶段失败，没有观察到成功启动的 sleep。T11 保存了其所属进程组清理/检查记录；没有对无关进程发送信号。scratch-004 删除及最终 git 状态见 [cleanup.txt](../evidence/004/cleanup.txt)、[git-status-final.txt](../evidence/004/git-status-final.txt)。没有修改已有仓库文件，git diff 为空；初始未跟踪 tasks/004-verify-codex-cli.md 原样保留。新增交付物是本报告、evidence/004/、tasks/004-report.md。

按验收要求实际尝试了 ps，结果如下，见 [ps-final.txt](../evidence/004/ps-final.txt)：

```text
ps -axo pid,ppid,pgid,stat,command
PermissionError(1, 'Operation not permitted')
```

因此能确认本任务记录的进程及进程组均已退出；**全局 ps 无残留检查未能确认（外层沙箱拒绝 ps）**，没有通过其他渠道枚举进程或绕过沙箱。T11 第 2–3 步中断、SIGKILL 成功发送、完成剩余步骤/去重仍未确认。模型拒绝/截断、子代理树崩溃恢复、通用 token 硬封顶及只读资料范围隔离没有覆盖，保持未核实。

## 对 Helm 设计的影响

以下逐条对照 workflow-templates.md 第 6.3 节建议映射；仅更新本报告，不改原调研文件或 Helm 实现。

| 第 6.3 节动作 | 可直接采用的部分 | 需要调整或保留未确认 |
|---|---|---|
| 新执行 | 固定 0.160.1、argv 数组、独立 exec、-C、--json、--output-schema、-o 的基本组合实跑成立；T10 支持隔离目录的三并发。 | 默认 --disable multi_agent 在本环境未阻止实际 spawn，不能当硬限额边界；须另外验证工具能力控制/线程统计，未验证前不能宣称 fan-out 已封住。stdin 传递未单独测试（本任务用短 argv 提示）；OS 权限执行效果受嵌套沙箱影响。 |
| 输出读取 | 保存 stdout JSONL/stderr、thread.started 的 ID、独立 -o 并重新校验；T01/T02 支持结构化数据读取和清单集合检查。 | --json 本次遗漏 functions.exec 内的 shell 事件和真实 spawn/子 ID，仅出现空接收方 wait；不能把 JSONL 当全部动作审计。turn.completed/exit 0 即使工具失败也出现；还必须验证业务字段、文件与固定测试。用量解析须接受本版本 5 个实际字段，不推定对子代理的覆盖。 |
| 返工续跑 | 明确 UUID、同任务同执行者续跑、按第二轮 schema 重新校验已由 T06 确认。exec 顶层 -s 在 resume 前实际可用；resume 内 -c sandbox_mode 被接受并记录。 | 子命令后的 -s 不支持（exit 2）；权限强制效果未确认。不存在/ephemeral UUID exit 1 时 stdout 为空，必须读取 stderr。仍禁止 --last，且不得把上下文续接当副作用去重。 |
| 核对/挑错 | 新 exec 使用独立上下文是可采用的进程组织方式；-s read-only 参数被接受。 | T07 无法区分只读保护与嵌套 seatbelt 启动失败；只读实际写限制和资料范围隔离未确认，不能作为此轮已通过的安全验收。 |
| 崩溃/取消 | host 记录 intent/thread/信号/返回码/缺失 -o、先核对现场仍适用；T11 SIGTERM 显示无终态 JSONL 时也可退出。 | SIGTERM 只确认零步骤会话可续接；第 2–3 步、SIGKILL 及去重未确认。host 必须处理没有 turn.failed/completed 的退出，并管理所属进程，恢复前核对已落盘副作用。 |
| 错误/拒绝/缺输出 | 把 schema、模型、会话查找、工具失败、信号退出分开记账；注册重试策略与剩余预算继续由 host 决定。 | strict schema 的本地完整预检不能只靠 CLI：本次语法本地拒绝，strict 错误到 API 400 才拒绝。缺失会话仅 stderr 报错，模型 metadata 警告在 item.completed 中，item.type=error；工具 exit 71 仍可有合规 JSON/exit 0。拒绝和截断尚未实测，不能按缺证据传 pass。 |

第 6.3 节表外建议也分别处理：独立 exec/隔离并发现场可采用，范围限于此次 3 个纯输出任务；需要恢复的步骤**不使用 ephemeral**（T12 已证实）；CLI 会话文件不能作为 Helm 唯一证据日志（本次仅作补充取证）；权限注册、输出大小与业务检查仍需 host 实现，此任务没有验证完整席位隔离或幂等协议。

对设计影响最大的 3 个发现：

1. `--disable multi_agent` 没有封住本环境实际的 collaboration 子代理路径，runtime 的并发/调用上限不能仅依靠该开关。
2. `--json` 没有公开本次全部工具动作或子线程身份，输出审计与子代理预算不能只依赖这份事件流。
3. 合规 JSON、exit 0 和 turn.completed 可以同时伴随工具失败；SIGTERM 又可以留下无终态事件、无 -o 的会话。步骤成功/失败必须综合进程、最终数据及产物证据判定。
