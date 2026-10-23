# 02 — 实测：订阅与 API 模板并存、skills 按模板隔离、Claude fast

**What to build:** 第二阶段 grilling（2026-10-23）定下模板以文件为准、API 模板用模板专用主目录、skills 按模板挂载，实测这些做法在 Claude、Codex 上是否成立。见 [第二阶段 spec](../spec.md)、[ADR 0004](../../../docs/adr/0004-agent-homes-and-cli-owned-credentials.md)。

**Blocked by:** 01

**Status:** resolved

- [x] 订阅模板（共用 `~/.helm/agent-homes/<cli>/`）和 API 模板（模板专用主目录，接口和 key 写在 CLI 自己的配置里）能同时运行，互不串用
- [x] 两个订阅模板共用一个 CLI 主目录时，各自只看得到自己的 skills，看不到用户自己的 skills
- [x] Claude Agent SDK 能否开 fast，订阅下是否计入 extra usage

## Answer

2026-10-23 本机实测，版本同 [01](01-agent-home-isolation.md)：claude 2.1.300、Agent SDK 0.3.308、codex-cli 0.163.0。被测进程用干净环境，模型 haiku / Codex 默认模型、低推理强度。脚本是一次性的，放在未提交的 `.scratch/prototype/helm-drivers/coexist.mjs`、`skills.mjs`。

**订阅与 API 并存：成立。** 本机起一个只记录请求、一律返回 400 的假接口，四个进程同时跑：

| 进程 | 主目录与配置 | 结果 |
|---|---|---|
| Claude 订阅 | `~/.helm/agent-homes/claude/`，`settingSources: []` | 答 `ok`，`apiKeySource: none`，请求没进假接口 |
| Claude API | 临时目录，`settings.json` 的 `env` 写 `ANTHROPIC_BASE_URL`（假接口）、`ANTHROPIC_AUTH_TOKEN=sk-test-claude`，`settingSources: ['user']` | 请求进假接口 `/v1/messages`，带 `Authorization: Bearer sk-test-claude`，拿到 400 后报错结束 |
| Codex 订阅 | `~/.helm/agent-homes/codex/`（`auth.json` 软链接） | 答 `ok`（gpt-6.1-sol，3003 token） |
| Codex API | 临时 `CODEX_HOME`，`config.toml` 自定义 provider，`base_url` 指假接口，`experimental_bearer_token=sk-test-codex` | 请求进假接口 `/v1/responses`，带 `Authorization: Bearer sk-test-codex` |

- Claude API 模板的 init 消息里 `apiKeySource` 也是 `none`，不能用它区分订阅和 API 计费；计费方式只能由模板的主目录说明。
- Codex 发往 127.0.0.1 的请求，在环境里没有任何代理变量时仍返回 403、没到假接口；加上 `NO_PROXY=127.0.0.1,localhost` 后才通。原因可能是读了系统代理设置，也可能是本会话沙箱的网络限制，未分辨。Helm 的 `templateEnvironment` 已经设 `NO_PROXY`。
- `experimental_bearer_token` 字段在 codex 0.163.0 的程序里存在，名字带 experimental，升级后可能变。
- 未用真实第三方接口跑；未核对用户 `~/.claude`、`~/.codex` 在测试前后有无变化。

**skills 按模板隔离：成立。** 模板 A、B 各挂一个模拟 skill（暗号 `ALPHA-7`、`BRAVO-9`），同时运行，共用订阅主目录：

| CLI | 挂载方式 | 结果 |
|---|---|---|
| Claude | SDK `plugins: [{ type: 'local', path }]`，每个模板一个插件目录，`skills: 'all'` | A 的 init `skills` 只有 `tpl-a:secret-a`，答 `ALPHA-7`；B 只有 `tpl-b:secret-b`，答 `BRAVO-9` |
| Codex | 每个 app-server 进程 `skills/extraRoots/set` 指向模板的 skills 目录 | A 的 `skills/list` 只有 `secret-a`（scope `user`），答 `ALPHA-7`；B 只有 `secret-b`，答 `BRAVO-9` |

- 用户自己的 skills（`~/.claude/skills/synced/` 里的 `docx`、`deep-research` 等）都没出现。
- 两家都带自己的一批：Claude Code 自带插件里的 `code-review`、`simplify`、`dataviz`、`design`、`loop` 等；Codex 的系统 skills（`imagegen`、`skill-creator` 等），以及自动下载到专用主目录 `plugins/cache/openai-curated-remote/` 的 OpenAI 精选插件（`pages`、`sites`、`work-pets`、`frontend-design-premium`）。用户决定（Q16）：Claude 的 `skills` 参数只列模板自己的 skill，藏起自带的；Codex 保留。精选插件占多少空间未量。

**Claude fast：订阅下要 extra usage。** 用 `settings: { fastMode: true }` 只取初始化结果、不发提示词（没有产生用量）：opus、haiku 两种都是 `fast_mode_state: off`、`fast_mode_disabled_reason: extra_usage_disabled`；`supportsFastMode` 只有 Opus 系列。即 fast 要开 extra usage 才能用，并计入 extra usage。按 grilling Q10，设了 fast 的 Claude 模板拒绝加载；Codex 的 `service_tier="fast"` 照常支持。
