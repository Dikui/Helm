## Agent skills

### Issue tracker

任务以本地 Markdown 存放在 `.scratch/<feature>/`。See `docs/agents/issue-tracker.md`.

### Triage labels

使用默认五个状态（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），写在任务文件的 `Status:` 行。See `docs/agents/triage-labels.md`.

### Domain docs

single-context：根目录 `GLOSSARY.md` 加 `docs/adr/`。涉及业务或架构设计时，参阅 `docs/agents/domain.md` 中的资料入口与按需读取规则。

### Document layout

文档放置约定见 `docs/agents/layout.md`。

### Testing

开发中只运行受影响的测试，按 `/local-test` 做：后端 `npm run test:unit -- <模块名> [--test-name-pattern=<用例>]`（模块名即 `tests/<模块名>.test.ts`，可写多个），界面 `npm run test:ui -- <测试文件>`，类型检查 `npm run check`。全量测试 `npm test` 由 `.githooks/pre-push` 在版本号（`package.json`）前两位变化时运行。

### Commit rules

禁止 `--no-verify`、`git add -A` / `git add .` 和强推。

### Real smoke

改动驱动、浏览器、进程清理、子进程环境或 `helm serve` 后，须在沙箱外运行 `npm run test:real --cache /private/tmp/helm-npm-cache`。需要本机已登录的真实 Claude CLI 和 Playwright 自带的 Chromium；浏览器一律无头运行，避免弹窗抢用户焦点；查看测试输出的截图。开发中只跑受影响的组（命令末尾加 `-- <组名>`），合入 main 前跑全量；失败组会自动重跑一次，出现“反复失败”提示时按缺陷排查，不当偶发。这是全局“浏览器只用 ego lite”规则的例外：真实冒烟用自己隔离的 Chrome for Testing，不碰用户登录态；其余界面验收仍用 ego lite。沙箱内不跑 `test:real`，浏览器使用工具替身，不启动真实浏览器。

### Restart local helmd

重启本机服务一律用 `npm run restart`（可加 `-- <超时秒数>`，默认 60）：构建、重启 launchd / systemd 用户服务、轮询 `list-works` 直到就绪，失败时说明原因并打印服务日志末尾。不要手敲 build、kickstart、sleep、curl。服务只跑一个检出的 `dist`（通常是主检出），在别的 worktree 里运行会直接报错，不会重启。
