# 03 — DeepSeek 执行者

**What to build:** 调度者能把派单交给 DeepSeek，默认沿用用户 `dsh web` 登录的账号，不用管 API key；用户想按量计费时可以自己加一个 API 模板，不改代码。执行者只能写卡片副本，派单结果、token、取消、续跑和其他家一致。见 [spec](../spec.md) 的"模型与推理强度""沙箱、环境与计费""结果映射"。

**Blocked by:** 02 — ACP 派单的中止、续跑和异常结束

**Status:** ready-for-agent

- [ ] 模板 `driver` 新增 `deepseek`，登记 dsh 档案（`dsh --profile acp`）；内置 `deepseek-executor` 模板用账号路线 `deepseek-flash`；调度者角色不可用
- [ ] 模型和推理强度经 `session/set_config_option` 下发；按模型 id 在 `configOptions` 里找对应取值（计费路线随之确定）；找不到的模型 id 或对方没有的档位（如 `medium`）让模板不可用并写明原因
- [ ] 显式设 `DSH_PERMISSION_MODE=workspace-write`；默认模板不设 `DEEPSEEK_API_KEY`；API 模板按第二阶段做法用专用主目录
- [ ] token 用量在派单结束后按会话 id 读 `~/.dsh/sessions/.../session.v4.jsonl.zstd`，累加每步 `usage`；用一个小的 zstd 样本测解析
- [ ] 报错 `CONTEXT_WINDOW_EXCEEDED` 记为上下文溢出；档案提供额度报错匹配规则
- [ ] 文字反问后 `end_turn` 按正常完成处理，没调用"提交结论"记为未声明
- [ ] 可用性检查：命令能执行并完成 `initialize`，不可用时给出修复命令（安装或 `dsh web`）
- [ ] 假 ACP agent 测试覆盖以上行为；`npm run check`、`npm test` 通过
- [ ] `deepseek-executor.real` 接进 `npm run test:real`，覆盖：跑完一轮、"提交结论"和浏览器工具、写副本以外被拦、记录 token、取消、续跑答对上一轮；跑完后看一眼账号路线的计费方式，记进本单 Comments

## Comments
