# 任务 019 返工 1：用 `codex sandbox` 补测 S05 读取限制，并补充 S10 分析（不调用模型）

报告第一行仍写 `session-id: <你的会话 ID>`。

## 问题

1. **S05 没有测到真正要测的东西。** 模型看到禁读配置后拒绝调用 shell，所以"内核是否拦截读取、cat 能否绕过"仍是未能确认。本版本有 `codex sandbox [-c ...] -- <命令>` 子命令，可以不经过模型，直接在同一套沙箱策略下运行命令，用它补测就能得到确定结论。
2. **S10 的数据其实已经能说明一部分问题，但报告没有给出。** 我的读法如下，请核对证据后确认或纠正：
   - a 是第一轮，就有 cached 9856；b 用了同样的约 3000 词前缀，cached 仍是 9856，未命中部分反而更多。这说明用户前缀**没有**跨会话命中，命中的只是 Codex 自身固定的那一段。
   - c、D1、D3 为 0，说明连这一段跨会话命中也不稳定。
   - e（resume）命中 82.7%，说明同一会话内命中正常。

## 要做的内容

1. **S05b（不调用模型）**：在 `research/scratch-019/` 下重建与 S05 相同的目录和假文件（重新生成 `FAKE-019-` 假内容串）。用 `codex sandbox`，并通过 `-c` 传入与 S05 相同结构的权限配置（`default_permissions` 和 `permissions.<名>`），分两组运行：
   - 组 A：工作区可写，`outside` 目录和 `**/*.env` 禁读；
   - 组 B：只读，同样的禁读规则。

   每组依次执行以下命令，记录退出码、stdout、stderr：
   - `cat ../outside/fake-secret.txt`
   - `cat ../outside/fake.env`
   - `cat fake.env`（工作区内）
   - `cat normal.txt`（工作区内的普通文件，作为可读对照）
   - `python3 -c "print(open('../outside/fake-secret.txt').read())"`
   - `cp ../outside/fake-secret.txt copied.txt`（仅组 A）
   - `ln -s ../outside/fake-secret.txt link.txt && cat link.txt`（仅组 A）
   - 写入 `../outside/x.txt`

   以假内容串是否出现在 stdout 作为判定依据。如果 `codex sandbox` 不接受该权限配置，记录错误，并改用 `--sandbox-state-json` 或 help 中列出的等价参数再试一次。
2. **对照组**：不带禁读配置，用 `codex sandbox` 默认策略执行同样的 `cat ../outside/fake-secret.txt`，证明能读到，从而确认是禁读配置在起作用。
3. **S10 补充分析（不新增运行）**：
   - 按上面的读法核对 `evidence/019/S10/` 的原始用量，并补一列"未命中 token 数"。
   - 离线查证 Codex 是否按会话设置 `prompt_cache_key`（或类似字段），方法包括 `codex debug prompt-input`、`app-server generate-json-schema`、二进制字符串检索。查到写出处，查不到写"未能确认"。
   - 修正"对 Helm 设计的影响"第⑦条。
4. 更新 `research/codex-sandbox-recheck.md` 中 S05 和 S10 的结论、汇总表和"对 Helm 设计的影响"第③、⑦条，标注"返工 1 补充"。

## 不要做的内容（边界）

- **本次不调用任何模型**：不运行 `codex exec`、不运行 `resume`。`codex sandbox` 不启动模型，不计入 35 次预算。
- 原任务的全部边界继续有效：写入范围仅限 `research/scratch-019/`、`evidence/019/` 和报告文件；只使用自己编造的假文件；不修改全局配置；不删除会话。
- 证据保存到 `evidence/019/S05b/` 和 `evidence/019/S10/analysis/`，不覆盖已有证据文件。

## 验收标准

- S05b 两组加对照组全部执行；每条命令都有退出码和输出；结论以假内容串是否出现为准。
- S05 的结论变为"是 / 否 / 部分"中的一个。只有 `codex sandbox` 确实无法应用该权限配置时，才允许保留"未能确认"，并附错误输出。
- S10 的结论和第⑦条按证据修正。
- `research/scratch-019/` 已删除，没有残留进程；`git status` 只有原任务的 4 项新增内容（报告中附输出）。

## 报告

覆盖写入 `tasks/019-report.md`：第一行 `session-id: <id>`，然后写返工内容、S05b 结果表、S10 修正后的结论、`git status`。
