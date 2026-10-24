# 04 — Grok、DeepSeek 模板的 skills

**What to build:** 用户给 Grok 或 DeepSeek 执行者模板放了 skills 目录时，执行者能用上这些 skills，且不改用户全局配置；做不到的一家，带 skills 目录的模板显示为不可用并写明原因。见 [spec](../spec.md) 的 Further Notes。

**Blocked by:** 03 — DeepSeek 执行者

**Status:** resolved

- [x] 查清 `grok agent stdio`、`dsh --profile acp` 加载 skills 的方式（一手来源或源码），结论记进本单 Comments
- [x] 有不改用户全局配置、按会话或进程生效的办法：档案按模板 `skillsPath` 接上，两个模板的 skills 互不可见
- [x] 没有办法的一家：带 skills 目录的模板不可用，原因写明（不适用：两家均找到进程级入口）
- [x] 假 ACP agent 测试覆盖接上或不可用的行为；`npm run check`、`npm test` 通过
- [x] 接上的一家在其 `*.real` 冒烟里验证执行者确实用到了模板 skill（已补断言；按本次要求只编译，真实执行待沙箱外）

## Comments

2026-10-23 加载方式核实（一手来源）：

- Grok：本机 `/Users/dikui/.grok/bin/grok` 指向 `../downloads/grok-1.0.67-macos-aarch64`。临时 HOME 下运行 `grok agent --help` 确认 `--plugin-dir <DIR>` 明确为“this process only”、可重复；`grok agent stdio --help` 确认 stdio 子命令。CLI 自带文档 [09-plugins.md](/Users/dikui/.grok/docs/user-guide/09-plugins.md) 的 “What a plugin contains” 和 “Where Grok looks for plugins” 确认 `skills/` 是标准插件组件，`plugin.json` 可省略，`--plugin-dir` 是进程级入口，leader 模式会忽略它。因此给带 skills 的模板传 `--no-leader --plugin-dir <skillsPath 的父目录>`，不安装插件、不写 `~/.grok`，保留原有全局配置及技能来源。没有采用 `GROK_CONFIG` 的 skills.paths：CLI 自带 [05-configuration.md](/Users/dikui/.grok/docs/user-guide/05-configuration.md) 说明该 overlay 的白名单不允许增加 discovery source。
- DeepSeek：本机 `@deepseek-ai/dsh` 为 `0.2.1-rc.2`，安装根目录 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`。`dsh --help` 和该目录 `lib/bin.js` 确认 `--patch <path>` 是本次启动的可重复 overlay；`lib/profile-boot-C14i-8IN.js` 的 `composeProfile` 确认 overlay 在用户配置之后参与本进程组合。安装根下 `node_modules/@deepseek-ai/dsh-app-boot/lib/index.js` 的 `loadOverlayPatches`、`node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js` 的 `applyEntryPatches` 确认 JSON patch list 的 `insert` 会增加条目。`node_modules/@deepseek-ai/dsh-base/cordis.patch.yml` 提供默认 `skill-filesystem`；`node_modules/@deepseek-ai/dsh-skill-filesystem/README.md` 及 `lib/index.js` 确认 `providerName`、`customSkillDirs`、`includeDefaultRoots` 的行为。上游为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。因此在系统临时目录生成 JSON 补丁，增加独立的 `helm-template` 文件系统技能提供者，只扫描本模板 `skillsPath`；原提供者和默认来源保留，补丁不写入 `~/.dsh`、API 专用主目录或卡片副本。另直接调用本机已安装的补丁算法和提供者离线验证：原条目未改写、alpha 可发现并加载、beta 不可见；未启动 profile 或会话。

实现：两家的差异留在 `src/acp-agents.ts`；共用 ACP 驱动增加启动资源的成对准备与释放。DeepSeek 的账号模板仍沿用默认主目录，API 模板仍按 ADR 0005 使用各自 `~/.helm/agent-homes/<模板 id>/`；技能补丁独立于两者。假 ACP 测试覆盖可用性、并行两模板、续跑、无 skills 模板不残留注入、含空格/引号的路径，以及正常结束、可用性失败、启动/配置失败、启动中止、取消后的补丁删除。未新增依赖。

沙箱内验证：`npm run check --cache /private/tmp/helm-npm-cache` 通过；定向 `node --test dist/tests/acp-skills.test.js dist/tests/acp-driver.test.js dist/tests/deepseek-executor.test.js` 95 项通过；临时 HOME 下 `npm test --cache /private/tmp/helm-npm-cache` 431 项通过，0 失败、0 跳过，`.real` 仅由 TypeScript 编译。

验收待沙箱外：`grok-executor.real.ts`、`deepseek-executor.real.ts` 均已添加模板技能与正文专有随机暗号，断言 `skill-proof.txt` 内容、卡片提交及最终回答中的技能名；暗号没有进入派单提示词。按用户要求，本轮不运行任何 `*.real`、`test:real`、浏览器或真实 CLI 会话。后续在本机已登录 CLI 和有界面 Chromium 的环境运行 `npm run test:real --cache /private/tmp/helm-npm-cache` 并查看截图，重点确认两家真实加载模板技能；状态保留 `ready-for-human` 等待该验收。

- 2026-10-23 沙箱外完整 `test:real`（2ee3c35）18/18 通过：Grok（`--plugin-dir`）和 DeepSeek（`--patch` 临时技能提供者）执行者都读取了模板 SKILL.md 并写出只在正文里的随机暗号。关闭。
