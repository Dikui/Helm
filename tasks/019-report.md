session-id: 01a12b84-b3fc-7451-83df-bd60e4dfb1ef

返工 1 已完成。**没有调用模型，没有运行 exec/resume**；原调用数仍为 35。研究报告的 S05、S10、汇总表及设计影响第③、⑦条已更新，并标注“返工 1 补充”。

S05b 结论：**是，读取限制由系统强制生效**。首次缺少必填 `-P` 的错误已保留；补上该参数后，两组及对照共 15 条命令全部执行。

| 命令 | A：可写，退出码 / 假串 | B：只读，退出码 / 假串 |
|---|---|---|
| `cat ../outside/fake-secret.txt` | 1 / 未出现 | 1 / 未出现 |
| `cat ../outside/fake.env` | 1 / 未出现 | 1 / 未出现 |
| `cat fake.env` | 1 / 未出现 | 1 / 未出现 |
| `cat normal.txt` | 0 / 出现 | 0 / 出现 |
| Python `open` 读取外部假文件 | 1 / 未出现 | 1 / 未出现 |
| `cp ../outside/fake-secret.txt copied.txt` | 1 / 未出现，目标未创建 | 按任务不执行 |
| 创建符号链接后 `cat link.txt` | 1 / 未出现，链接创建成功 | 按任务不执行 |
| 写入 `../outside/x.txt` | 1，文件未创建 | 1，文件未创建 |

禁读操作报 `Operation not permitted`，Python 报 `PermissionError`。无禁读对照使用内置 `-P :workspace`，没有传禁读配置：**exit 0，stdout 出现完整外部假串**。因此所测 cat、Python、复制及符号链接读取均未绕过限制。

S10 核对结果：

| 轮次 | input_tokens | cached_input_tokens | 未命中 token | 命中比例 |
|---|---:|---:|---:|---:|
| a | 14767 | 9856 | 4911 | 66.74% |
| b | 15785 | 9856 | 5929 | 62.44% |
| c | 14767 | 0 | 14767 | 0% |
| D1 | 14768 | 0 | 14768 | 0% |
| D2 | 14768 | 9856 | 4912 | 66.74% |
| D3 | 14768 | 0 | 14768 | 0% |
| e：resume | 29564 | 24448 | 5116 | 82.70% |

你的读法基本得到数据支持：

- a、b 的 cached 都为 9856，b 未命中反而增加 1018：**用户固定前缀没有带来可观察的新增跨会话缓存**。9856 更符合固定注入部分的缓存，但仅凭总量不能逐 token 证明“命中的只是 Codex 自身固定段”。
- c、D1、D3 为零，确认跨会话命中不稳定；不能单独把 c 的零值归因于首行改字。
- e 确认本次同会话 resume 的高命中，不能推广为所有 resume 的保证。

缓存键离线查证：二进制中找到一次 `prompt_cache_key` 字符串，偏移为 **183294320**；`debug prompt-input` 未显示该字段，生成的 440 个协议 JSON 文件也未找到相关字段。**是否按会话设置、具体如何取值仍未能确认**。出处、二进制哈希和检索结果均已保存。

设计影响已修正：第③条允许依赖本机本版本显式权限 profile 对已测路径实施系统级读取限制；第⑦条不再把固定用户上下文包跨新会话共享缓存作为收益前提。

scratch 已删除，本次记录的 34 个测试 PID 均已退出：

```text
ps exit-code: 1
Recorded PID count: 34
Live recorded test PIDs: 0
```

`git status --short`：

```text
 M FEATURES.md
?? evidence/019/
?? research/codex-sandbox-recheck.md
?? tasks/019-codex-sandbox-recheck.md
?? tasks/019-report.md
?? tasks/019-rework-1.md
```

“四项新增”状态未满足：返工开始前已有 `FEATURES.md` 修改和 `tasks/019-rework-1.md`，本次没有修改或撤销它们。

交付物：

- [更新后的研究报告](/Users/dikui/Project/Helm/research/codex-sandbox-recheck.md)
- [S05b 原始证据](/Users/dikui/Project/Helm/evidence/019/S05b/)
- [S10 补充分析](/Users/dikui/Project/Helm/evidence/019/S10/analysis/analysis.md)
- [返工报告](/Users/dikui/Project/Helm/tasks/019-report.md)