# 06 — DeepSeek 执行者的禁止推送 git 配置失效

**What to build:** DeepSeek 执行者里 git 能正常运行，且推送仍被拦住。混合端到端（[05](05-mixed-acp-e2e.md) Comments）里 dsh 的 shell 环境有 `GIT_CONFIG_COUNT=11` 却缺 `GIT_CONFIG_KEY_n`（疑似 dsh 按变量名过滤含 `KEY` 的环境变量），git 一律报 `missing config key GIT_CONFIG_KEY_0` 退出；执行者 `unset` 后能继续，但禁止推送的配置（`src/templates.ts` 约 137 行）随之失效，本地裸远端不需要令牌即可推送，违反 spec 用户故事 9。

**Blocked by:** None

**Status:** resolved

- [x] 在本机 dsh 源码里找到过滤规则并记进 Comments（文件路径、规则）
- [x] Helm 改用不会被 dsh 过滤、且 Claude、Codex、Grok 也照常生效的方式注入禁止推送配置（对所有驱动一致，不按档案分叉，除非证据表明必须）
- [x] 单元测试覆盖新的注入方式下本地远端推送被拦、普通 git 命令可用；`npm run check`、`npm test` 通过
- [x] `grok-executor.real`、`deepseek-executor.real` 增加：执行者在卡片副本里跑 `git status` 成功、`git push` 到本地远端被拦；沙箱外跑通

## Comments

2026-10-23 实现（待沙箱外真实冒烟）：

- 本机 dsh 版本 `0.2.1-rc.2`。过滤发生在 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subprocess/lib/index.js:32`：`SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i`；同文件 `scrubbedParentEnv()`（50–55 行）删除命中该正则或名称以 `DSH_` 开头（忽略大小写）的父环境变量。故 `GIT_CONFIG_KEY_n` 被删，`GIT_CONFIG_COUNT`、`GIT_CONFIG_VALUE_n` 留下，解释了 05 的 git exit 128。终端也走该规则：`dsh-subprocess-local/lib/index.js:1624` 调用 `targetEnvironment(spec)`，`dsh-subprocess-local/lib/runner-launch-B2zsQ1Dz.js:1516` 经 `childEnv(spec.env)`（694 行）调用 `scrubbedParentEnv()`。以上三个包目录均在上述 dsh 的 `node_modules/@deepseek-ai/` 下；只读源码，未启动 dsh 会话。
- 公共 `src/templates.ts` 的执行者环境统一改用 `GIT_CONFIG_PARAMETERS`，按 Git 的单引号规则编码完整 `key=value`（含单引号转义），不再产生 `COUNT/KEY_n/VALUE_n`。沿用原有 `pushInsteadOf` 和项目显式 `pushurl` 的 `insteadOf`，不修改用户配置、主目录或 agent 档案。该变量名不命中 dsh 过滤规则；四个驱动的子进程环境测试均覆盖新变量传递。
- 先扩展既有本地远端测试，模拟 dsh 过滤，复现 `git status` 的 `missing config key GIT_CONFIG_KEY_0`；修复后同时检查原环境和过滤环境中 `git status`、`git log` 成功，直接路径/命名远端显式 `pushurl` 推送被 Helm 地址重写拦截，远端无禁止引用，普通 `ls-remote` 可用。远端路径包含空格、单引号和反斜杠，验证编码不破坏路径。`npm run check --cache /private/tmp/helm-npm-cache` 退出 0；定向测试 140 项通过；`npm test --cache /private/tmp/helm-npm-cache` 441 项通过，0 失败、0 跳过（约 74.9 秒）。
- `grok-executor.real.ts`、`deepseek-executor.real.ts` 补充已写并参与 TypeScript 编译：执行者在卡片副本原样执行 `git status`、创建副本内的临时裸远端并尝试推送；断言工具输出的真实退出码、`/dev/null/helm-push-disabled/` 拦截原因、远端引用为空，再由宿主环境对同一远端做成功推送对照。裸远端在 `.gitignore` 中排除，避免进入运行层提交。
- 按本次用户要求，未启动浏览器、未发起任何真实 agent 会话、未运行任何 `*.real` 或 `test:real`。最后一项包含“沙箱外跑通”，因此保持未勾选。需要人工在沙箱外运行 `npm run test:real --cache /private/tmp/helm-npm-cache`，检查 Grok/DeepSeek 的 git 探针、对照推送、原有真实冒烟断言及输出截图；通过后再勾选最后一项。

- 2026-10-23 沙箱外完整 `test:real`（75615c2）18/18 通过：Grok、DeepSeek 执行者在卡片副本里 `git status` 成功，推送到本地远端被 Helm 禁推配置拦截，宿主对照推送成功；Claude、Codex 套件仍通过。关闭。
