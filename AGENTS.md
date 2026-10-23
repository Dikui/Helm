## Agent skills

### Issue tracker

任务以本地 Markdown 存放在 `.scratch/<feature>/`。See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认五个状态（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），写在任务文件的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目录 `GLOSSARY.md` 加 `docs/adr/`。涉及业务或架构设计时，参阅 `docs/agents/domain.md` 中的资料入口与按需读取规则。

### Document layout

文档放置约定见 `docs/agents/layout.md`。

### Commit rules

禁止 `--no-verify`、`git add -A` / `git add .` 和强推。

### Real smoke

改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，须在沙箱外运行 `npm run test:real --cache /private/tmp/helm-npm-cache`。需要本机已登录的真实 Claude CLI 和有界面的 Playwright Chromium；查看测试输出的截图。沙箱内只跑 `npm run check`、`npm test`，浏览器使用工具替身，不启动真实浏览器。
