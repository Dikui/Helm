# 03 — DeepSeek 执行者

**What to build:** 调度者能把派单交给 DeepSeek，默认沿用用户 `dsh web` 登录的账号，不用管 API key；用户想按量计费时可以自己加一个 API 模板，不改代码。执行者只能写卡片副本，派单结果、token、取消、续跑和其他家一致。见 [spec](../spec.md) 的"模型与推理强度""沙箱、环境与计费""结果映射"。

**Blocked by:** 02 — ACP 派单的中止、续跑和异常结束

**Status:** ready-for-human

- [x] 模板 `driver` 新增 `deepseek`，登记 dsh 档案（`dsh --profile acp`）；内置 `deepseek-executor` 模板用账号路线 `deepseek-flash`；调度者角色不可用
- [x] 模型和推理强度经 `session/set_config_option` 下发；按模型 id 在 `configOptions` 里找对应取值（计费路线随之确定）；找不到的模型 id 或对方没有的档位（如 `medium`）让模板不可用并写明原因
- [x] 显式设 `DSH_PERMISSION_MODE=workspace-write`；默认模板不设 `DEEPSEEK_API_KEY`；API 模板按第二阶段做法用专用主目录
- [x] token 用量在派单结束后按会话 id 读 `~/.dsh/sessions/.../session.v4.jsonl.zstd`，累加每步 `usage`；用一个小的 zstd 样本测解析
- [x] 报错 `CONTEXT_WINDOW_EXCEEDED` 记为上下文溢出；档案提供额度报错匹配规则
- [x] 文字反问后 `end_turn` 按正常完成处理，没调用"提交结论"记为未声明
- [x] 可用性检查：命令能执行并完成 `initialize`，不可用时给出修复命令（安装或 `dsh web`）
- [x] 假 ACP agent 测试覆盖以上行为；`npm run check`、`npm test` 通过
- [ ] `deepseek-executor.real` 接进 `npm run test:real`，覆盖：跑完一轮、"提交结论"和浏览器工具、写副本以外被拦、记录 token、取消、续跑答对上一轮；跑完后看一眼账号路线的计费方式，记进本单 Comments

## Comments

2026-10-23 实现：在现有通用 ACP 驱动登记 DeepSeek，默认 `deepseek-flash` / low / shared；调度者、未知模型、medium、fast 和带 skills 目录的模板不可用（skills 留给任务单 04）。按 dsh 公布的 JSON `[provider, model]` 选项值选择账号或 official API 路线，设置 model、reasoning_effort 后核对完整状态，不带错误模型或强度发送 prompt。API 模板用 `~/.helm/agent-homes/<模板 id>/` 的 DSH_HOME，只检查 CLI 配置文件元数据，不读取、复制或转发凭据；共享模板不重定向默认主目录，清除继承的 key 和 DSH_HOME，强制 workspace-write，保留现有禁止推送环境。

通过本机已安装的 dsh 0.2.1-rc.2 源码确认：`session/close` 会排空并刷盘会话，结束时先有限等待 close，再按会话 id 读取 v4 zstd 文件；输入用量包括互不重叠的未缓存输入、缓存读和缓存写，避免重复计算嵌套 stream，续跑减去本轮开始前的累计值。优先 Node 内置 zstd；为项目现有 Node 22.13 / CI 锁定 `fzstd@0.1.1` 兜底。文件缺失、损坏或格式不符在派单输出记录诊断。运行层保留 `context-overflow`，不再改成普通 error；反问加 end_turn 正常完成，未提交结论则未声明。

硬约束补充：dsh 的 bash/fs 工具支持通过 `sandbox_permissions` 申请扩大权限。普通权限请求仍选 allow_once，从不选 allow_always；DeepSeek 档案拒绝扩大到 danger-full-access 等范围的请求，防止自动代答绕过卡片沙箱。假 ACP 按 dsh 的先发工具 rawInput、再按 toolCallId 请求权限的顺序验证。

验证：`npm run check --cache /private/tmp/helm-npm-cache` 通过；`npm test --cache /private/tmp/helm-npm-cache` 最终 423/423 通过。DeepSeek 定向测试及 Node 22.13 兼容测试各 34/34 通过，覆盖账号/API 路线、配置核对、用量与续跑增量、权限与提权拒绝、额度/溢出/普通错误、崩溃、取消、反问、自报结论、同端点 MCP 和浏览器工具替身、卡片提交及用量汇总。测试均使用临时 HOME；zstd 样本自行构造，未读取真实会话内容。

最后一项暂不勾选：`tests/deepseek-executor.real.ts` 已写并接入真实冒烟入口，覆盖一轮、同端点结论/浏览器/令牌、越界写入拒绝、token、账号模型与低推理强度、新进程续跑记忆及进行中取消；本轮按用户明确要求只编译、不运行任何真实冒烟或真实模型会话，也未启动浏览器。需在沙箱外用已登录的 dsh 和有界面的 Chromium 运行 `npm run test:real --cache /private/tmp/helm-npm-cache`（或构建后单独运行 `HELM_DEEPSEEK_EXECUTOR_REAL=1 node --test dist/tests/deepseek-executor.real.js`），检查输出的 deepseek.png、first.json、resume.json、cancel.json；随后在 dsh web 账户页确认账号路线的实际计费方式，追加到本 Comments。账号路线并不作为免费或订阅计费的证明；计费方式尚未实测。状态 ready-for-human，等待这些验收。
